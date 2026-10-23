import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildChildEnv,
  FLUSH_DELAY_MS,
  PAUSE_ABOVE_UNACKED,
  RESUME_BELOW_UNACKED,
  TerminalService,
  type PtyProcess,
  type TerminalServiceDeps
} from '../../src/main/terminal-service'
import type { ShellDefinition } from '../../src/main/shells'

const ID = '11111111-1111-4111-8111-111111111111'

class FakePty implements PtyProcess {
  pid = 4242
  written: string[] = []
  resizes: Array<[number, number]> = []
  killed = false
  paused = false
  resumeCount = 0
  throwOnResize = false
  private dataListener: (data: string) => void = () => undefined
  private exitListener: (event: { exitCode: number; signal?: number }) => void = () => undefined

  onData(listener: (data: string) => void): void {
    this.dataListener = listener
  }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void {
    this.exitListener = listener
  }
  write(data: string): void {
    this.written.push(data)
  }
  resize(cols: number, rows: number): void {
    if (this.throwOnResize) throw new Error('already exited')
    this.resizes.push([cols, rows])
  }
  kill(): void {
    this.killed = true
  }
  pause(): void {
    this.paused = true
  }
  resume(): void {
    this.paused = false
    this.resumeCount++
  }
  emitData(data: string): void {
    this.dataListener(data)
  }
  emitExit(exitCode: number): void {
    this.exitListener({ exitCode })
  }
}

const cmdShell: ShellDefinition = {
  id: 'cmd',
  label: 'Command Prompt',
  kind: 'cmd',
  executable: 'C:\\Windows\\System32\\cmd.exe',
  args: []
}
const wslShell: ShellDefinition = {
  id: 'wsl:Ubuntu',
  label: 'WSL: Ubuntu',
  kind: 'wsl',
  executable: 'C:\\Windows\\System32\\wsl.exe',
  args: ['-d', 'Ubuntu']
}

interface Harness {
  service: TerminalService
  pty: FakePty
  spawn: ReturnType<typeof vi.fn>
  data: Array<{ id: string; data: string }>
  exits: Array<{ id: string; exitCode: number }>
  deps: TerminalServiceDeps
}

function harness(overrides: Partial<TerminalServiceDeps> = {}): Harness {
  const pty = new FakePty()
  const spawn = vi.fn(() => pty)
  const data: Harness['data'] = []
  const exits: Harness['exits'] = []
  const deps: TerminalServiceDeps = {
    spawn,
    getShells: async () => [cmdShell, wslShell],
    isDirectory: () => true,
    findExecutable: () => 'C:\\bin\\claude.exe',
    baseEnv: { PATH: 'C:\\bin', ELECTRON_RENDERER_URL: 'http://localhost:5173' },
    emitData: (event) => data.push(event),
    emitExit: (event) => exits.push(event),
    ...overrides
  }
  return { service: new TerminalService(deps), pty, spawn, data, exits, deps }
}

const request = { id: ID, shellId: 'cmd', cwd: 'C:\\work', cols: 120, rows: 30 }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TerminalService.create', () => {
  it('spawns the chosen shell in the project folder with the requested size', async () => {
    const { service, spawn } = harness()
    const result = await service.create(request)
    expect(result).toMatchObject({ ok: true, pid: 4242, shell: { id: 'cmd', kind: 'cmd' } })
    expect(spawn).toHaveBeenCalledWith(
      cmdShell.executable,
      [],
      expect.objectContaining({ cwd: 'C:\\work', cols: 120, rows: 30 })
    )
  })

  it('types the agent command into the shell when an agent is requested', async () => {
    const { service, pty } = harness()
    await service.create({ ...request, agentId: 'claude' })
    expect(pty.written).toEqual(['claude\r'])
  })

  it('does not type anything for a plain terminal', async () => {
    const { service, pty } = harness()
    await service.create(request)
    expect(pty.written).toEqual([])
  })

  it('refuses an unknown shell id', async () => {
    const { service, spawn } = harness()
    const result = await service.create({ ...request, shellId: 'zsh' })
    expect(result).toMatchObject({ ok: false, code: 'shell-missing' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('refuses a folder that does not exist', async () => {
    const { service, spawn } = harness({ isDirectory: () => false })
    const result = await service.create(request)
    expect(result).toMatchObject({ ok: false, code: 'cwd-missing', message: 'C:\\work' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('refuses to start an agent that is not installed', async () => {
    const { service, spawn } = harness({ findExecutable: () => null })
    const result = await service.create({ ...request, agentId: 'claude' })
    expect(result).toMatchObject({ ok: false, code: 'agent-missing', message: 'claude' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('still lets a plain terminal open when the agent is not installed', async () => {
    const { service } = harness({ findExecutable: () => null })
    expect((await service.create(request)).ok).toBe(true)
  })

  it('skips the Windows PATH check for WSL because the agent lives inside Linux', async () => {
    const { service, pty } = harness({ findExecutable: () => null })
    const result = await service.create({ ...request, shellId: 'wsl:Ubuntu', agentId: 'claude' })
    expect(result.ok).toBe(true)
    expect(pty.written).toEqual(['claude\r'])
  })

  it('reports a spawn failure instead of throwing', async () => {
    const { service } = harness({
      spawn: () => {
        throw new Error('File not found')
      }
    })
    expect(await service.create(request)).toMatchObject({
      ok: false,
      code: 'spawn-failed',
      message: 'File not found'
    })
    expect(service.size).toBe(0)
  })

  it('rejects a second terminal with the same id', async () => {
    const { service } = harness()
    await service.create(request)
    expect(await service.create(request)).toMatchObject({ ok: false, code: 'duplicate-id' })
  })
})

describe('TerminalService output', () => {
  it('joins output that arrives within a few milliseconds into one message', async () => {
    const { service, pty, data } = harness()
    await service.create(request)
    pty.emitData('he')
    pty.emitData('llo')
    expect(data).toEqual([])
    vi.advanceTimersByTime(FLUSH_DELAY_MS)
    expect(data).toEqual([{ id: ID, data: 'hello' }])
  })

  it('sends a very large burst immediately instead of waiting', async () => {
    const { service, pty, data } = harness()
    await service.create(request)
    pty.emitData('x'.repeat(70 * 1024))
    expect(data).toHaveLength(1)
  })

  it('delivers the last output before reporting the exit', async () => {
    const { service, pty, data, exits } = harness()
    await service.create(request)
    pty.emitData('bye')
    pty.emitExit(3)
    expect(data).toEqual([{ id: ID, data: 'bye' }])
    expect(exits).toEqual([{ id: ID, exitCode: 3, signal: undefined }])
    expect(service.size).toBe(0)
  })

  it('stops the process from flooding the window when the window falls behind', async () => {
    const { service, pty } = harness()
    await service.create(request)
    pty.emitData('x'.repeat(PAUSE_ABOVE_UNACKED + 1))
    expect(pty.paused).toBe(true)
  })

  it('lets the process continue once the window has caught up', async () => {
    const { service, pty } = harness()
    await service.create(request)
    const burst = PAUSE_ABOVE_UNACKED + 1
    pty.emitData('x'.repeat(burst))
    service.ack(ID, burst - RESUME_BELOW_UNACKED)
    expect(pty.paused).toBe(true)
    service.ack(ID, 2)
    expect(pty.paused).toBe(false)
    expect(pty.resumeCount).toBe(1)
  })

  it('never lets the unacknowledged count go negative', async () => {
    const { service, pty } = harness()
    await service.create(request)
    service.ack(ID, 1_000_000)
    pty.emitData('x'.repeat(PAUSE_ABOVE_UNACKED + 1))
    expect(pty.paused).toBe(true)
  })
})

describe('TerminalService input and control', () => {
  it('passes input and size changes to the process', async () => {
    const { service, pty } = harness()
    await service.create(request)
    service.write(ID, 'dir\r')
    service.resize(ID, 100, 40)
    expect(pty.written).toContain('dir\r')
    expect(pty.resizes).toEqual([[100, 40]])
  })

  it('ignores input, resize and acks for unknown terminals', () => {
    const { service } = harness()
    expect(() => {
      service.write(ID, 'x')
      service.resize(ID, 80, 24)
      service.ack(ID, 10)
    }).not.toThrow()
  })

  it('survives a resize on a process that already exited', async () => {
    const { service, pty } = harness()
    await service.create(request)
    pty.throwOnResize = true
    expect(() => service.resize(ID, 80, 24)).not.toThrow()
  })

  it('kills the process, forgets it and sends no exit message for an intentional close', async () => {
    const { service, pty, data, exits } = harness()
    await service.create(request)
    pty.emitData('pending')
    expect(service.kill(ID)).toBe(true)
    expect(pty.killed).toBe(true)
    pty.emitExit(1)
    vi.advanceTimersByTime(FLUSH_DELAY_MS * 2)
    expect(exits).toEqual([])
    expect(data).toEqual([])
    expect(service.size).toBe(0)
  })

  it('allows the same id to be started again after a kill (restart)', async () => {
    const { service } = harness()
    await service.create(request)
    service.kill(ID)
    expect((await service.create(request)).ok).toBe(true)
  })

  it('reports false when killing something that does not exist', () => {
    expect(harness().service.kill(ID)).toBe(false)
  })

  it('kills every process on shutdown', async () => {
    const first = harness()
    await first.service.create(request)
    await first.service.create({ ...request, id: '22222222-2222-4222-8222-222222222222' })
    first.service.killAll()
    expect(first.service.size).toBe(0)
  })
})

describe('buildChildEnv', () => {
  it('removes Electron variables so child programs do not behave like Electron', () => {
    const env = buildChildEnv({ PATH: 'x', ELECTRON_RUN_AS_NODE: '1', electron_renderer_url: 'y' })
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(env).not.toHaveProperty('electron_renderer_url')
    expect(env['PATH']).toBe('x')
  })

  it('does not pass on the markers of the Claude Code session that happened to launch AgentGrid', () => {
    const env = buildChildEnv({
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      claude_code_entrypoint: 'cli',
      CLAUDE_CODE_USE_BEDROCK: '1',
      PATH: 'x'
    })
    expect(Object.keys(env).sort()).toEqual(
      ['CLAUDE_CODE_USE_BEDROCK', 'COLORTERM', 'PATH', 'TERM_PROGRAM'].sort()
    )
  })

  it('marks the terminal as AgentGrid with colour support and drops undefined values', () => {
    const env = buildChildEnv({ A: undefined, B: 'b' })
    expect(env).toMatchObject({ B: 'b', TERM_PROGRAM: 'AgentGrid', COLORTERM: 'truecolor' })
    expect(env).not.toHaveProperty('A')
  })
})
