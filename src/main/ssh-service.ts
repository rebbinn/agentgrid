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
import {
  RemoteEntrySchema,
  SFTP_ERROR_CODES,
  type RemoteEntry,
  type SftpErrorCode,
  type SftpEvent,
  type SftpOpenRequest,
  type SftpOpenResult,
  type SftpReply,
  type SftpRequest,
  type TransferRequest
} from '@shared/sftp'
import type { SecretKind } from './secret-store'
import type { HelperCommand, HelperEvent, HostSpec, SshHelperLike } from './ssh-helper'
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
  emitSftpEvent(event: SftpEvent): void
  now(): number
}

type RequestKind = 'hostkey' | SshPromptKind

interface PendingRequest {
  kind: RequestKind
  hostId: string
}

interface Session {
  id: string
  mode: 'shell' | 'test' | 'sftp'
  home: string | null
  replies: Map<string, (reply: SftpReply) => void>
  transfers: Set<string>
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
const KNOWN_SFTP_ERRORS = new Set<string>(SFTP_ERROR_CODES)
export const SFTP_REQUEST_TIMEOUT_MS = 60_000

function sftpError(code: SftpErrorCode, message: string): SftpReply {
  return { ok: false, error: { code, message } }
}

function toSftpError(error: { code: string; message: string } | undefined): { code: SftpErrorCode; message: string } {
  const code = error && KNOWN_SFTP_ERRORS.has(error.code) ? (error.code as SftpErrorCode) : 'failure'
  return { code, message: error?.message ?? '' }
}

function validEntries(raw: unknown[] | undefined): RemoteEntry[] | undefined {
  if (!raw) return undefined
  const entries: RemoteEntry[] = []
  for (const item of raw) {
    const parsed = RemoteEntrySchema.safeParse(item)
    if (parsed.success) entries.push(parsed.data)
  }
  return entries
}

function sftpCommand(request: SftpRequest, sid: string, rid: string): HelperCommand {
  switch (request.op) {
    case 'list':
      return { op: 'sftp-list', sid, rid, path: request.path }
    case 'realpath':
      return { op: 'sftp-realpath', sid, rid, path: request.path }
    case 'mkdir':
      return { op: 'sftp-mkdir', sid, rid, path: request.path }
    case 'rename':
      return { op: 'sftp-rename', sid, rid, from: request.from, to: request.to }
    case 'remove':
      return { op: 'sftp-remove', sid, rid, path: request.path, recursive: request.recursive }
    case 'chmod':
      return { op: 'sftp-chmod', sid, rid, path: request.path, mode: request.mode }
  }
}

function failure(
  code: SshErrorCode,
  message: string,
  extra: Partial<SshFailure> = {}
): { ok: false; failure: SshFailure } {
  return { ok: false, failure: { code, message, ...extra } }
}

export class SshService {
  private readonly sessions = new Map<string, Session>()
  private requestCounter = 0

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
      storedHostIds: new Set([host.id, ...(jump ? [jump.id] : [])]),
      command: {
        op: 'connect',
        sid: request.id,
        mode: 'shell',
        target: targetSpec,
        jump: jumpSpec,
        cols: request.cols,
        rows: request.rows
      }
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
      storedHostIds: new Set(),
      command: {
        op: 'connect',
        sid: request.sessionId,
        mode: 'test',
        target: targetSpec,
        jump: jumpSpec,
        cols: 80,
        rows: 24
      }
    })
  }

  async openSftp(request: SftpOpenRequest): Promise<SftpOpenResult> {
    const host = this.deps.hosts.get(request.hostId)
    if (!host) return failure('host-missing', request.hostId)
    if (this.sessions.has(request.id)) return failure('duplicate-id', request.id)
    const via = request.viaId ? this.sessions.get(request.viaId) : undefined
    let command: HelperCommand
    let jump: Host | null = null
    if (via?.sink && via.mode === 'shell' && via.targetHostId === host.id) {
      command = { op: 'sftp-open', sid: request.id, via: via.id }
    } else {
      jump = host.jumpHostId ? (this.deps.hosts.get(host.jumpHostId) ?? null) : null
      if (host.jumpHostId && !jump) return failure('jump', host.jumpHostId)
      const target = await this.specFor(host, {})
      const jumpSpec = jump ? await this.specFor(jump, {}) : null
      if (this.sessions.has(request.id)) return failure('duplicate-id', request.id)
      command = { op: 'sftp-open', sid: request.id, target, jump: jumpSpec }
    }
    const result = await this.start({
      id: request.id,
      mode: 'sftp',
      target: host,
      jump,
      storedHostIds: new Set([host.id, ...(jump ? [jump.id] : [])]),
      command
    })
    if (!result.ok) return result
    const home = this.sessions.get(request.id)?.home
    return typeof home === 'string' ? { ok: true, home } : failure('other', 'closed')
  }

  sftpRequest(request: SftpRequest): Promise<SftpReply> {
    const session = this.sessions.get(request.sessionId)
    if (!session || session.mode !== 'sftp' || session.home === null) {
      return Promise.resolve(sftpError('connection', ''))
    }
    const rid = `q${++this.requestCounter}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        session.replies.delete(rid)
        resolve(sftpError('connection', 'timeout'))
      }, SFTP_REQUEST_TIMEOUT_MS)
      session.replies.set(rid, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      if (!this.deps.helper.send(sftpCommand(request, session.id, rid))) {
        session.replies.delete(rid)
        clearTimeout(timer)
        resolve(sftpError('connection', ''))
      }
    })
  }

  transfer(request: TransferRequest): void {
    const session = this.sessions.get(request.sessionId)
    const sent =
      session?.mode === 'sftp' &&
      session.home !== null &&
      this.deps.helper.send({
        op: request.direction === 'upload' ? 'sftp-upload' : 'sftp-download',
        sid: session.id,
        tid: request.transferId,
        localPath: request.localPath,
        remotePath: request.remotePath,
        overwrite: request.overwrite,
        ...(request.resume ? { resume: true } : {})
      })
    if (sent && session) {
      session.transfers.add(request.transferId)
      return
    }
    this.deps.emitSftpEvent({
      kind: 'transfer-done',
      sessionId: request.sessionId,
      transferId: request.transferId,
      error: { code: 'connection', message: '' }
    })
  }

  cancelTransfer(sessionId: string, transferId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session?.transfers.has(transferId)) return
    this.deps.helper.send({ op: 'transfer-cancel', sid: sessionId, tid: transferId })
  }

  closeSftp(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.mode !== 'sftp') return
    this.deps.helper.send({ op: 'sftp-close', sid: sessionId })
    if (session.home === null) this.finish(session, failure('cancelled', ''))
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
    if (session.mode === 'sftp') {
      this.closeSftp(sessionId)
      return
    }
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
    mode: 'shell' | 'test' | 'sftp'
    target: Host
    jump: Host | null
    storedHostIds: Set<string>
    command: HelperCommand
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
        home: null,
        replies: new Map(),
        transfers: new Set(),
        requests: new Map(),
        remembered: [],
        decoder: new TextDecoder('utf-8'),
        resolve,
        sink: null
      }
      this.sessions.set(options.id, session)
      const sent = this.deps.helper.send(options.command)
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
            session.mode !== 'test' &&
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
      case 'sftp-ready': {
        session.home = event.home
        const resolve = session.resolve
        session.resolve = null
        resolve?.({ ok: true })
        void this.deps.hosts.touch(session.targetHostId, this.deps.now()).catch(() => undefined)
        this.saveRemembered(session)
        return
      }
      case 'sftp-reply': {
        const reply = session.replies.get(event.rid)
        if (!reply) return
        session.replies.delete(event.rid)
        const entries = validEntries(event.entries)
        reply(
          event.ok
            ? { ok: true, ...(event.path !== undefined ? { path: event.path } : {}), ...(entries ? { entries } : {}) }
            : { ok: false, error: toSftpError(event.error) }
        )
        return
      }
      case 'transfer':
        if (!session.transfers.has(event.tid)) return
        this.deps.emitSftpEvent({
          kind: 'transfer',
          sessionId: session.id,
          transferId: event.tid,
          bytes: event.bytes,
          total: event.total,
          files: event.files,
          filesTotal: event.filesTotal,
          current: event.current
        })
        return
      case 'transfer-done':
        if (!session.transfers.delete(event.tid)) return
        this.deps.emitSftpEvent({
          kind: 'transfer-done',
          sessionId: session.id,
          transferId: event.tid,
          ...(event.ok ? {} : { error: toSftpError(event.error) })
        })
        return
      case 'closed': {
        const sink = session.sink
        this.sessions.delete(session.id)
        if (session.mode === 'sftp' && session.home !== null) {
          this.endSftp(session, event.reason)
          return
        }
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
    this.saveRemembered(session)
  }

  private saveRemembered(session: Session): void {
    for (const item of session.remembered) {
      void this.deps.secrets.set(item.hostId, item.kind, item.value).catch(() => undefined)
    }
    session.remembered = []
  }

  private endSftp(session: Session, reason: 'exit' | 'lost' | 'closed'): void {
    for (const reply of session.replies.values()) reply(sftpError('connection', reason))
    session.replies.clear()
    for (const transferId of session.transfers) {
      this.deps.emitSftpEvent({
        kind: 'transfer-done',
        sessionId: session.id,
        transferId,
        error: { code: reason === 'closed' ? 'cancelled' : 'connection', message: '' }
      })
    }
    session.transfers.clear()
    this.deps.emitSftpEvent({ kind: 'sftp-closed', sessionId: session.id, reason })
  }

  private finish(session: Session, result: SshResult): void {
    this.sessions.delete(session.id)
    const resolve = session.resolve
    session.resolve = null
    resolve?.(result)
  }

  private handleHelperExit(): void {
    for (const session of [...this.sessions.values()]) {
      if (session.mode === 'sftp' && session.home !== null) {
        this.sessions.delete(session.id)
        this.endSftp(session, 'lost')
      } else if (session.sink) {
        this.sessions.delete(session.id)
        session.sink.exit(-1, 'lost')
      } else {
        this.finish(session, failure('other', HELPER_STOPPED))
      }
    }
  }
}
