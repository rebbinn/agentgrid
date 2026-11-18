import { findAgent } from '@shared/agents'
import { firstCommandToken, isPathLike, isSingleLineCommand } from '@shared/command-text'
import type {
  ExitReason,
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent
} from '@shared/ipc'
import type { ShellDefinition } from './shells'

export interface PtyProcess {
  pid: number
  onData(listener: (data: string) => void): unknown
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  pause(): void
  resume(): void
}

export interface TerminalBackend {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  pause(): void
  resume(): void
}

export interface RemoteSink {
  data(text: string): void
  exit(exitCode: number, reason: ExitReason): void
}

export interface PtySpawnOptions {
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
}

export interface TerminalServiceDeps {
  spawn(file: string, args: string[], options: PtySpawnOptions): PtyProcess
  getShells(): Promise<ShellDefinition[]>
  isDirectory(path: string): boolean
  findExecutable(name: string): string | null
  baseEnv: NodeJS.ProcessEnv
  emitData(event: TerminalDataEvent): void
  emitExit(event: TerminalExitEvent): void
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const FLUSH_DELAY_MS = 6
export const FLUSH_SIZE_CHARS = 64 * 1024
export const PAUSE_ABOVE_UNACKED = 512 * 1024
export const RESUME_BELOW_UNACKED = 128 * 1024

interface TerminalEntry {
  backend: TerminalBackend
  pending: string
  flushTimer: ReturnType<typeof setTimeout> | null
  unacked: number
  paused: boolean
}

const PARENT_SESSION_MARKERS = new Set(['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT'])

export function buildChildEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    const upperKey = key.toUpperCase()
    if (upperKey.startsWith('ELECTRON_')) continue
    if (PARENT_SESSION_MARKERS.has(upperKey)) continue
    env[key] = value
  }
  env['TERM_PROGRAM'] = 'AgentGrid'
  env['COLORTERM'] = 'truecolor'
  return env
}

export class TerminalService {
  private readonly entries = new Map<string, TerminalEntry>()

  constructor(private readonly deps: TerminalServiceDeps) {}

  get size(): number {
    return this.entries.size
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  attachRemote(id: string, backend: TerminalBackend): RemoteSink | null {
    if (this.entries.has(id)) return null
    const entry: TerminalEntry = { backend, pending: '', flushTimer: null, unacked: 0, paused: false }
    this.entries.set(id, entry)
    return {
      data: (text) => this.handleData(id, entry, text),
      exit: (exitCode, reason) => this.handleExit(id, entry, { exitCode }, reason)
    }
  }

  async create(request: TerminalCreateRequest): Promise<TerminalCreateResult> {
    if (this.entries.has(request.id)) {
      return { ok: false, code: 'duplicate-id', message: request.id }
    }

    const shells = await this.deps.getShells()
    const shell = shells.find((candidate) => candidate.id === request.shellId)
    if (!shell) {
      return { ok: false, code: 'shell-missing', message: request.shellId }
    }

    if (!this.deps.isDirectory(request.cwd)) {
      return { ok: false, code: 'cwd-missing', message: request.cwd }
    }

    const agent = request.agentId ? findAgent(request.agentId) : null
    if (
      request.resumeSessionId !== undefined &&
      (agent?.id !== 'claude' || !SESSION_ID.test(request.resumeSessionId))
    ) {
      return { ok: false, code: 'spawn-failed', message: 'Only a Claude session id can be resumed' }
    }
    if (agent && shell.kind !== 'wsl' && !this.deps.findExecutable(agent.command)) {
      return { ok: false, code: 'agent-missing', message: agent.command }
    }

    const customCommand = request.startupCommand
    if (customCommand !== undefined) {
      if (agent || !isSingleLineCommand(customCommand)) {
        return { ok: false, code: 'spawn-failed', message: 'The startup command is not allowed' }
      }
      const executable = firstCommandToken(customCommand)
      const mustBeInstalled =
        request.requireInstalled === true && shell.kind !== 'wsl' && !isPathLike(executable)
      if (mustBeInstalled && !this.deps.findExecutable(executable)) {
        return { ok: false, code: 'agent-missing', message: executable }
      }
    }

    let pty: PtyProcess
    try {
      pty = this.deps.spawn(shell.executable, shell.args, {
        cwd: request.cwd,
        cols: request.cols,
        rows: request.rows,
        env: buildChildEnv(this.deps.baseEnv)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, code: 'spawn-failed', message }
    }

    const entry: TerminalEntry = { backend: pty, pending: '', flushTimer: null, unacked: 0, paused: false }
    this.entries.set(request.id, entry)

    pty.onData((data) => this.handleData(request.id, entry, data))
    pty.onExit((event) => this.handleExit(request.id, entry, event))

    if (agent) {
      const resume = request.resumeSessionId ? ` --resume ${request.resumeSessionId}` : ''
      pty.write(`${agent.command}${resume}\r`)
    } else if (customCommand !== undefined) {
      pty.write(`${customCommand}\r`)
    }

    return {
      ok: true,
      pid: pty.pid,
      shell: { id: shell.id, label: shell.label, kind: shell.kind }
    }
  }

  write(id: string, data: string): void {
    this.entries.get(id)?.backend.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    try {
      entry.backend.resize(cols, rows)
    } catch {
      return
    }
  }

  ack(id: string, bytes: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.unacked = Math.max(0, entry.unacked - bytes)
    if (entry.paused && entry.unacked < RESUME_BELOW_UNACKED) {
      entry.paused = false
      entry.backend.resume()
    }
  }

  kill(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    this.entries.delete(id)
    if (entry.flushTimer) clearTimeout(entry.flushTimer)
    try {
      entry.backend.kill()
    } catch {
      return true
    }
    return true
  }

  killAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id)
  }

  private handleData(id: string, entry: TerminalEntry, data: string): void {
    if (this.entries.get(id) !== entry) return
    entry.pending += data
    if (entry.pending.length >= FLUSH_SIZE_CHARS) {
      this.flush(id, entry)
      return
    }
    if (!entry.flushTimer) {
      entry.flushTimer = setTimeout(() => this.flush(id, entry), FLUSH_DELAY_MS)
    }
  }

  private flush(id: string, entry: TerminalEntry): void {
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    if (entry.pending.length === 0) return
    const data = entry.pending
    entry.pending = ''
    entry.unacked += data.length
    this.deps.emitData({ id, data })
    if (!entry.paused && entry.unacked > PAUSE_ABOVE_UNACKED) {
      entry.paused = true
      entry.backend.pause()
    }
  }

  private handleExit(
    id: string,
    entry: TerminalEntry,
    event: { exitCode: number; signal?: number },
    reason?: ExitReason
  ): void {
    if (this.entries.get(id) !== entry) return
    this.flush(id, entry)
    this.entries.delete(id)
    this.deps.emitExit({
      id,
      exitCode: event.exitCode,
      ...(event.signal !== undefined ? { signal: event.signal } : {}),
      ...(reason ? { reason } : {})
    })
  }
}
