import { statSync } from 'node:fs'
import { spawn as spawnPty } from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import { findOnPath } from '../../src/main/executables'
import {
  createShellDiscoveryDeps,
  discoverShells,
  type ShellDefinition
} from '../../src/main/shells'
import {
  PAUSE_ABOVE_UNACKED,
  TerminalService,
  type PtyProcess
} from '../../src/main/terminal-service'

const describeOnWindows = process.platform === 'win32' ? describe : describe.skip

const ID = '33333333-3333-4333-8333-333333333333'

function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error('Timed out waiting for condition'))
      }
    }, 25)
  })
}

describeOnWindows('TerminalService with a real Windows pseudo-terminal', () => {
  const discoveryDeps = createShellDiscoveryDeps()
  let service: TerminalService | null = null
  let shells: ShellDefinition[] = []
  let output = ''
  let exitCode: number | null = null
  const pauses: string[] = []

  async function start(extra: Partial<Parameters<TerminalService['create']>[0]> = {}) {
    shells = await discoverShells(discoveryDeps)
    output = ''
    exitCode = null
    pauses.length = 0
    service = new TerminalService({
      spawn: (file, args, options) => {
        const pty = spawnPty(file, args, {
          name: 'xterm-256color',
          cols: options.cols,
          rows: options.rows,
          cwd: options.cwd,
          env: options.env
        })
        const wrapped: PtyProcess = {
          pid: pty.pid,
          onData: (listener) => pty.onData(listener),
          onExit: (listener) => pty.onExit(listener),
          write: (data) => pty.write(data),
          resize: (cols, rows) => pty.resize(cols, rows),
          kill: () => pty.kill(),
          pause: () => {
            pauses.push('pause')
            pty.pause()
          },
          resume: () => {
            pauses.push('resume')
            pty.resume()
          }
        }
        return wrapped
      },
      getShells: async () => shells,
      isDirectory: (path) => {
        try {
          return statSync(path).isDirectory()
        } catch {
          return false
        }
      },
      findExecutable: (name) => findOnPath(name, discoveryDeps),
      baseEnv: process.env,
      emitData: (event) => {
        output += event.data
      },
      emitExit: (event) => {
        exitCode = event.exitCode
      }
    })
    return service.create({ id: ID, shellId: 'cmd', cwd: process.cwd(), cols: 100, rows: 30, ...extra })
  }

  afterEach(() => {
    service?.killAll()
    service = null
  })

  it('runs a command typed into a real cmd.exe in the requested folder', async () => {
    const result = await start()
    expect(result.ok).toBe(true)
    await waitFor(() => output.includes('>'), 10_000)
    service?.write(ID, 'echo agentgrid-real-pty\r')
    await waitFor(() => output.includes('agentgrid-real-pty\r\n'), 10_000)
    expect(output).toContain(process.cwd())
  }, 20_000)

  it('reports the exit code when the shell ends', async () => {
    await start()
    await waitFor(() => output.includes('>'), 10_000)
    service?.write(ID, 'exit 7\r')
    await waitFor(() => exitCode !== null, 10_000)
    expect(exitCode).toBe(7)
    expect(service?.size).toBe(0)
  }, 20_000)

  it('accepts a size change while the shell is running', async () => {
    await start()
    await waitFor(() => output.includes('>'), 10_000)
    service?.resize(ID, 60, 20)
    service?.write(ID, 'mode con\r')
    await waitFor(() => /Columns:\s+60/.test(output), 10_000)
    expect(output).toMatch(/Lines:\s+20/)
  }, 20_000)

  it('pauses a flooding process until the receiver catches up, then continues', async () => {
    await start()
    await waitFor(() => output.includes('>'), 10_000)
    service?.write(ID, 'for /L %i in (1,1,60000) do @echo flood-line-%i-padding-padding-padding\r')
    await waitFor(() => pauses.includes('pause'), 20_000)
    const sizeAtPause = output.length
    expect(sizeAtPause).toBeGreaterThan(PAUSE_ABOVE_UNACKED)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(output.length - sizeAtPause).toBeLessThan(PAUSE_ABOVE_UNACKED)

    const drain = setInterval(() => service?.ack(ID, 64 * 1024), 5)
    try {
      await waitFor(() => output.includes('flood-line-60000-'), 60_000)
    } finally {
      clearInterval(drain)
    }
    expect(pauses).toContain('resume')
  }, 90_000)

  it('refuses to start a missing agent without launching any process', async () => {
    const result = await start({ agentId: 'codex' })
    if (findOnPath('codex', discoveryDeps)) return
    expect(result).toMatchObject({ ok: false, code: 'agent-missing' })
    expect(service?.size).toBe(0)
  })
})
