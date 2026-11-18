import { z } from 'zod'
import type { HostAuthMethod } from '@shared/hosts'

export interface HostSpec {
  label: string
  address: string
  port: number
  username: string
  auth: HostAuthMethod
  password?: string
  keyPath?: string
  passphrase?: string
}

interface TransferCommand<Op extends string> {
  op: Op
  sid: string
  tid: string
  localPath: string
  remotePath: string
  overwrite: boolean
  resume?: boolean
}

export type HelperCommand =
  | {
      op: 'connect'
      sid: string
      mode: 'shell' | 'test'
      target: HostSpec
      jump: HostSpec | null
      cols: number
      rows: number
    }
  | { op: 'input'; sid: string; data: string }
  | { op: 'resize'; sid: string; cols: number; rows: number }
  | { op: 'pause'; sid: string }
  | { op: 'resume'; sid: string }
  | { op: 'answer'; sid: string; rid: string; accept?: boolean; answers?: string[]; cancel?: boolean }
  | { op: 'close'; sid: string }
  | { op: 'sftp-open'; sid: string; via?: string; target?: HostSpec; jump?: HostSpec | null }
  | { op: 'sftp-close'; sid: string }
  | { op: 'sftp-list'; sid: string; rid: string; path: string }
  | { op: 'sftp-realpath'; sid: string; rid: string; path: string }
  | { op: 'sftp-mkdir'; sid: string; rid: string; path: string }
  | { op: 'sftp-rename'; sid: string; rid: string; from: string; to: string }
  | { op: 'sftp-remove'; sid: string; rid: string; path: string; recursive: boolean }
  | { op: 'sftp-chmod'; sid: string; rid: string; path: string; mode: number }
  | TransferCommand<'sftp-upload'>
  | TransferCommand<'sftp-download'>
  | { op: 'transfer-cancel'; sid: string; tid: string }

const Sid = z.string().min(1).max(100)
const Text = z.string().max(4000)
const ErrorSchema = z.object({ code: z.string().max(100), message: Text.optional().default('') })

export const HelperEventSchema = z.discriminatedUnion('ev', [
  z.object({ ev: z.literal('ready'), version: z.number() }),
  z.object({ ev: z.literal('phase'), sid: Sid, phase: z.enum(['connecting', 'authenticating']), host: Text }),
  z.object({
    ev: z.literal('hostkey'),
    sid: Sid,
    rid: Sid,
    host: Text,
    address: Text,
    keyType: Text,
    fingerprint: Text
  }),
  z.object({
    ev: z.literal('prompt'),
    sid: Sid,
    rid: Sid,
    host: Text,
    kind: z.enum(['password', 'passphrase', 'keyboard-interactive']),
    name: Text.optional().default(''),
    instruction: Text.optional().default(''),
    questions: z.array(z.object({ text: Text, echo: z.boolean() })).max(10)
  }),
  z.object({ ev: z.literal('connected'), sid: Sid }),
  z.object({ ev: z.literal('data'), sid: Sid, data: z.string() }),
  z.object({ ev: z.literal('latency'), sid: Sid, ms: z.number().nonnegative() }),
  z.object({
    ev: z.literal('failed'),
    sid: Sid,
    kind: z.string().max(100),
    message: Text.optional().default(''),
    host: Text.optional(),
    fingerprint: Text.optional(),
    knownHostsFile: Text.optional()
  }),
  z.object({
    ev: z.literal('closed'),
    sid: Sid,
    reason: z.enum(['exit', 'lost', 'closed']),
    exitStatus: z.number().int().optional()
  }),
  z.object({ ev: z.literal('sftp-ready'), sid: Sid, home: z.string().max(4096) }),
  z.object({
    ev: z.literal('sftp-reply'),
    sid: Sid,
    rid: Sid,
    ok: z.boolean(),
    path: z.string().max(4096).optional(),
    entries: z.array(z.unknown()).optional(),
    error: ErrorSchema.optional()
  }),
  z.object({
    ev: z.literal('transfer'),
    sid: Sid,
    tid: Sid,
    bytes: z.number().nonnegative(),
    total: z.number().nonnegative(),
    files: z.number().int().nonnegative(),
    filesTotal: z.number().int().nonnegative(),
    current: z.string().max(4096).optional().default('')
  }),
  z.object({ ev: z.literal('transfer-done'), sid: Sid, tid: Sid, ok: z.boolean(), error: ErrorSchema.optional() })
])
export type HelperEvent = z.infer<typeof HelperEventSchema>

export interface HelperChild {
  write(line: string): boolean
  end(): void
  kill(): void
  onStdout(listener: (chunk: string) => void): void
  onStderr(listener: (chunk: string) => void): void
  onExit(listener: () => void): void
}

export interface SshHelperLike {
  send(command: HelperCommand): boolean
  onEvent(listener: (event: HelperEvent) => void): () => void
  onExit(listener: () => void): () => void
}

const MAX_BUFFERED_CHARS = 64 * 1024 * 1024

export class SshHelper implements SshHelperLike {
  private child: HelperChild | null = null
  private buffer = ''
  private readonly eventListeners = new Set<(event: HelperEvent) => void>()
  private readonly exitListeners = new Set<() => void>()

  constructor(
    private readonly start: () => HelperChild | null,
    private readonly log: (message: string) => void = () => undefined
  ) {}

  get running(): boolean {
    return this.child !== null
  }

  send(command: HelperCommand): boolean {
    const child = this.child ?? this.launch()
    if (!child) return false
    child.write(`${JSON.stringify(command)}\n`)
    return true
  }

  onEvent(listener: (event: HelperEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  stop(): void {
    const child = this.child
    if (!child) return
    this.child = null
    child.end()
    setTimeout(() => child.kill(), 2000).unref?.()
  }

  private launch(): HelperChild | null {
    let child: HelperChild | null
    try {
      child = this.start()
    } catch (error) {
      this.log(`SSH helper did not start: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
    if (!child) return null
    this.child = child
    this.buffer = ''
    child.onStdout((chunk) => this.receive(child, chunk))
    child.onStderr((chunk) => this.log(chunk.trimEnd()))
    child.onExit(() => {
      if (this.child !== child) return
      this.child = null
      this.buffer = ''
      for (const listener of this.exitListeners) listener()
    })
    return child
  }

  private receive(child: HelperChild, chunk: string): void {
    if (this.child !== child) return
    const parts = (this.buffer + chunk).split('\n')
    this.buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (line.length > 0) this.dispatch(line)
    }
    if (this.buffer.length > MAX_BUFFERED_CHARS) {
      this.log('SSH helper sent an oversized line; restarting it')
      this.buffer = ''
      child.kill()
    }
  }

  private dispatch(line: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      this.log('SSH helper wrote a line that is not JSON')
      return
    }
    const parsed = HelperEventSchema.safeParse(raw)
    if (!parsed.success) {
      this.log('SSH helper wrote an unknown event')
      return
    }
    for (const listener of this.eventListeners) listener(parsed.data)
  }
}
