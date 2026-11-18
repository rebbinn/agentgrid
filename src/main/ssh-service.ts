import { TextDecoder } from 'node:util'
import type { Host } from '@shared/hosts'
import {
  SSH_ERROR_CODES,
  type SshAnswer,
  type SshErrorCode,
  type SshEvent,
  type SshFailure,
  type SshOpenRequest,
  type SshPromptKind,
  type SshResult,
  type SshTestRequest
} from '@shared/ssh'
import type { SecretKind } from './secret-store'
import type { HelperEvent, HostSpec, SshHelperLike } from './ssh-helper'
import type { RemoteSink, TerminalService } from './terminal-service'

export interface HostLookup {
  get(id: string): Host | undefined
  touch(id: string, at: number): Promise<void>
}

export interface SecretAccess {
  get(hostId: string, kind: SecretKind): Promise<string | undefined>
  set(hostId: string, kind: SecretKind, value: string | null): Promise<boolean>
}

export interface SshServiceDeps {
  helper: SshHelperLike
  terminals: Pick<TerminalService, 'attachRemote' | 'has'>
  hosts: HostLookup
  secrets: SecretAccess
  emitEvent(event: SshEvent): void
  now(): number
}

type RequestKind = 'hostkey' | SshPromptKind

interface PendingRequest {
  kind: RequestKind
  hostId: string
}

interface Session {
  id: string
  mode: 'shell' | 'test'
  targetHostId: string
  names: Map<string, string>
  storedHostIds: Set<string>
  requests: Map<string, PendingRequest>
  remembered: Array<{ hostId: string; kind: SecretKind; value: string }>
  decoder: TextDecoder
  resolve: ((result: SshResult) => void) | null
  sink: RemoteSink | null
}

const KNOWN_FAILURES = new Set<string>(SSH_ERROR_CODES)
const HELPER_STOPPED = 'SSH köməkçi proqramı gözlənilmədən dayandı.'

function failure(code: SshErrorCode, message: string, extra: Partial<SshFailure> = {}): SshResult {
  return { ok: false, failure: { code, message, ...extra } }
}

export class SshService {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly deps: SshServiceDeps) {
    deps.helper.onEvent((event) => this.handleEvent(event))
    deps.helper.onExit(() => this.handleHelperExit())
  }

  get activeCount(): number {
    return this.sessions.size
  }

  async open(request: SshOpenRequest): Promise<SshResult> {
    const host = this.deps.hosts.get(request.hostId)
    if (!host) return failure('host-missing', request.hostId)
    const jump = host.jumpHostId ? this.deps.hosts.get(host.jumpHostId) : null
    if (host.jumpHostId && !jump) return failure('jump', host.jumpHostId)
    const targetSpec = await this.specFor(host, {})
    const jumpSpec = jump ? await this.specFor(jump, {}) : null
    if (this.sessions.has(request.id) || this.deps.terminals.has(request.id)) {
      return failure('duplicate-id', request.id)
    }

    return this.start({
      id: request.id,
      mode: 'shell',
      target: host,
      jump: jump ?? null,
      targetSpec,
      jumpSpec,
      storedHostIds: new Set([host.id, ...(jump ? [jump.id] : [])]),
      cols: request.cols,
      rows: request.rows
    })
  }

  async test(request: SshTestRequest): Promise<SshResult> {
    const draft = request.host
    const jump = draft.jumpHostId ? this.deps.hosts.get(draft.jumpHostId) : null
    if (draft.jumpHostId && !jump) return failure('jump', draft.jumpHostId)
    const stored = this.deps.hosts.get(draft.id)
    const targetSpec = await this.specFor(draft, {
      password: request.password,
      passphrase: request.passphrase,
      useStored: stored !== undefined
    })
    const jumpSpec = jump ? await this.specFor(jump, {}) : null
    if (this.sessions.has(request.sessionId)) return failure('duplicate-id', request.sessionId)
    return this.start({
      id: request.sessionId,
      mode: 'test',
      target: draft,
      jump: jump ?? null,
      targetSpec,
      jumpSpec,
      storedHostIds: new Set(),
      cols: 80,
      rows: 24
    })
  }

  answer(answer: SshAnswer): void {
    const session = this.sessions.get(answer.sessionId)
    const pending = session?.requests.get(answer.requestId)
    if (!session || !pending) return
    session.requests.delete(answer.requestId)

    if (answer.cancel) {
      this.deps.helper.send({ op: 'answer', sid: session.id, rid: answer.requestId, cancel: true })
      return
    }
    if (pending.kind === 'hostkey') {
      this.deps.helper.send({
        op: 'answer',
        sid: session.id,
        rid: answer.requestId,
        accept: answer.accept === true
      })
      return
    }
    const answers = answer.answers ?? []
    const secret = answers[0]
    const rememberable = pending.kind === 'password' || pending.kind === 'passphrase'
    if (answer.remember && rememberable && secret && session.storedHostIds.has(pending.hostId)) {
      session.remembered = session.remembered.filter(
        (item) => !(item.hostId === pending.hostId && item.kind === pending.kind)
      )
      session.remembered.push({ hostId: pending.hostId, kind: pending.kind as SecretKind, value: secret })
    }
    this.deps.helper.send({ op: 'answer', sid: session.id, rid: answer.requestId, answers })
  }

  cancel(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.sink) return
    this.deps.helper.send({ op: 'close', sid: sessionId })
    this.finish(session, failure('cancelled', ''))
  }

  cancelAll(): void {
    for (const session of [...this.sessions.values()]) {
      if (!session.sink) this.cancel(session.id)
    }
  }

  private start(options: {
    id: string
    mode: 'shell' | 'test'
    target: Host
    jump: Host | null
    targetSpec: HostSpec
    jumpSpec: HostSpec | null
    storedHostIds: Set<string>
    cols: number
    rows: number
  }): Promise<SshResult> {
    return new Promise((resolve) => {
      const session: Session = {
        id: options.id,
        mode: options.mode,
        targetHostId: options.target.id,
        names: new Map([
          [options.target.id, options.target.name],
          ...(options.jump ? ([[options.jump.id, options.jump.name]] as const) : [])
        ]),
        storedHostIds: options.storedHostIds,
        requests: new Map(),
        remembered: [],
        decoder: new TextDecoder('utf-8'),
        resolve,
        sink: null
      }
      this.sessions.set(options.id, session)
      const sent = this.deps.helper.send({
        op: 'connect',
        sid: options.id,
        mode: options.mode,
        target: options.targetSpec,
        jump: options.jumpSpec,
        cols: options.cols,
        rows: options.rows
      })
      if (!sent) this.finish(session, failure('helper-missing', ''))
    })
  }

  private async specFor(
    host: Host,
    overrides: { password?: string; passphrase?: string; useStored?: boolean }
  ): Promise<HostSpec> {
    const useStored = overrides.useStored ?? true
    const spec: HostSpec = {
      label: host.id,
      address: host.address,
      port: host.port,
      username: host.username,
      auth: host.auth
    }
    if (host.auth === 'password') {
      const password = overrides.password ?? (useStored ? await this.deps.secrets.get(host.id, 'password') : undefined)
      if (password) spec.password = password
    }
    if (host.auth === 'key' && host.keyPath) {
      spec.keyPath = host.keyPath
      const passphrase =
        overrides.passphrase ?? (useStored ? await this.deps.secrets.get(host.id, 'passphrase') : undefined)
      if (passphrase) spec.passphrase = passphrase
    }
    return spec
  }

  private nameOf(session: Session, label: string | undefined): string {
    if (!label) return session.names.get(session.targetHostId) ?? ''
    return session.names.get(label) ?? label
  }

  private handleEvent(event: HelperEvent): void {
    if (event.ev === 'ready') return
    const session = this.sessions.get(event.sid)
    if (!session) return

    switch (event.ev) {
      case 'phase':
        this.deps.emitEvent({
          kind: 'phase',
          sessionId: session.id,
          phase: event.phase,
          hostName: this.nameOf(session, event.host)
        })
        return
      case 'hostkey':
        session.requests.set(event.rid, { kind: 'hostkey', hostId: event.host })
        this.deps.emitEvent({
          kind: 'hostkey',
          sessionId: session.id,
          requestId: event.rid,
          hostName: this.nameOf(session, event.host),
          address: event.address,
          keyType: event.keyType,
          fingerprint: event.fingerprint
        })
        return
      case 'prompt':
        session.requests.set(event.rid, { kind: event.kind, hostId: event.host })
        this.deps.emitEvent({
          kind: 'prompt',
          sessionId: session.id,
          requestId: event.rid,
          hostName: this.nameOf(session, event.host),
          promptKind: event.kind,
          name: event.name,
          instruction: event.instruction,
          questions: event.questions,
          canRemember:
            session.mode === 'shell' &&
            event.kind !== 'keyboard-interactive' &&
            session.storedHostIds.has(event.host)
        })
        return
      case 'connected':
        this.handleConnected(session)
        return
      case 'data':
        session.sink?.data(session.decoder.decode(Buffer.from(event.data, 'base64'), { stream: true }))
        return
      case 'latency':
        this.deps.emitEvent({ kind: 'latency', sessionId: session.id, ms: Math.round(event.ms) })
        return
      case 'failed': {
        const code = KNOWN_FAILURES.has(event.kind) ? (event.kind as SshErrorCode) : 'other'
        this.finish(
          session,
          failure(code, event.message, {
            hostName: this.nameOf(session, event.host),
            ...(event.fingerprint ? { fingerprint: event.fingerprint } : {}),
            ...(event.knownHostsFile ? { knownHostsFile: event.knownHostsFile } : {})
          })
        )
        return
      }
      case 'closed': {
        const sink = session.sink
        this.sessions.delete(session.id)
        if (sink) {
          const tail = session.decoder.decode()
          if (tail.length > 0) sink.data(tail)
          sink.exit(event.exitStatus ?? (event.reason === 'exit' ? 0 : -1), event.reason)
        } else if (session.resolve) {
          const resolve = session.resolve
          session.resolve = null
          resolve(session.mode === 'test' ? { ok: true } : failure('other', event.reason))
        }
        return
      }
    }
  }

  private handleConnected(session: Session): void {
    if (session.mode === 'test') {
      const resolve = session.resolve
      session.resolve = null
      resolve?.({ ok: true })
      return
    }
    const sid = session.id
    const helper = this.deps.helper
    const sink = this.deps.terminals.attachRemote(sid, {
      write: (data) => helper.send({ op: 'input', sid, data: Buffer.from(data, 'utf8').toString('base64') }),
      resize: (cols, rows) => helper.send({ op: 'resize', sid, cols, rows }),
      pause: () => helper.send({ op: 'pause', sid }),
      resume: () => helper.send({ op: 'resume', sid }),
      kill: () => {
        this.sessions.delete(sid)
        helper.send({ op: 'close', sid })
      }
    })
    if (!sink) {
      helper.send({ op: 'close', sid })
      this.finish(session, failure('duplicate-id', sid))
      return
    }
    session.sink = sink
    const resolve = session.resolve
    session.resolve = null
    resolve?.({ ok: true })
    void this.deps.hosts.touch(session.targetHostId, this.deps.now()).catch(() => undefined)
    for (const item of session.remembered) {
      void this.deps.secrets.set(item.hostId, item.kind, item.value).catch(() => undefined)
    }
    session.remembered = []
  }

  private finish(session: Session, result: SshResult): void {
    this.sessions.delete(session.id)
    const resolve = session.resolve
    session.resolve = null
    resolve?.(result)
  }

  private handleHelperExit(): void {
    for (const session of [...this.sessions.values()]) {
      if (session.sink) {
        this.sessions.delete(session.id)
        session.sink.exit(-1, 'lost')
      } else {
        this.finish(session, failure('other', HELPER_STOPPED))
      }
    }
  }
}
