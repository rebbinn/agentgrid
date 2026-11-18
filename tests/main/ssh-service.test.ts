import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HelperCommand, HelperEvent, SshHelperLike } from '../../src/main/ssh-helper'
import { SshService, type SecretAccess } from '../../src/main/ssh-service'
import { TerminalService } from '../../src/main/terminal-service'
import type { TerminalDataEvent, TerminalExitEvent } from '../../src/shared/ipc'
import type { Host } from '../../src/shared/hosts'
import type { SftpEvent } from '../../src/shared/sftp'
import type { SshEvent } from '../../src/shared/ssh'

const PANE = '11111111-1111-4111-8111-111111111111'
const TARGET = '22222222-2222-4222-8222-222222222222'
const JUMP = '33333333-3333-4333-8333-333333333333'

class FakeHelper implements SshHelperLike {
  sent: HelperCommand[] = []
  available = true
  private eventListener: (event: HelperEvent) => void = () => undefined
  private exitListener: () => void = () => undefined

  send(command: HelperCommand): boolean {
    if (!this.available) return false
    this.sent.push(command)
    return true
  }
  onEvent(listener: (event: HelperEvent) => void): () => void {
    this.eventListener = listener
    return () => undefined
  }
  onExit(listener: () => void): () => void {
    this.exitListener = listener
    return () => undefined
  }
  emit(event: HelperEvent): void {
    this.eventListener(event)
  }
  crash(): void {
    this.exitListener()
  }
  last<K extends HelperCommand['op']>(op: K): Extract<HelperCommand, { op: K }> | undefined {
    return [...this.sent].reverse().find((command) => command.op === op) as
      | Extract<HelperCommand, { op: K }>
      | undefined
  }
}

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: TARGET,
    name: 'xl-app-01',
    group: 'Xəzər Logistika',
    address: '10.20.4.11',
    port: 22,
    username: 'deploy',
    auth: 'password',
    keyPath: null,
    environment: 'prod',
    jumpHostId: null,
    note: '',
    lastConnectedAt: null,
    ...overrides
  }
}

let helper: FakeHelper
let hosts: Map<string, Host>
let secrets: Map<string, string>
let events: SshEvent[]
let sftpEvents: SftpEvent[]
let data: TerminalDataEvent[]
let exits: TerminalExitEvent[]
let touched: Array<[string, number]>
let terminals: TerminalService
let service: SshService

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  helper = new FakeHelper()
  hosts = new Map([[TARGET, host()]])
  secrets = new Map([[`${TARGET}:password`, 'stored-pass']])
  events = []
  sftpEvents = []
  data = []
  exits = []
  touched = []
  terminals = new TerminalService({
    spawn: () => {
      throw new Error('not used')
    },
    getShells: async () => [],
    isDirectory: () => true,
    findExecutable: () => null,
    baseEnv: {},
    emitData: (event) => data.push(event),
    emitExit: (event) => exits.push(event)
  })
  const secretAccess: SecretAccess = {
    get: async (hostId, kind) => secrets.get(`${hostId}:${kind}`),
    set: async (hostId, kind, value) => {
      if (value === null) secrets.delete(`${hostId}:${kind}`)
      else secrets.set(`${hostId}:${kind}`, value)
      return true
    }
  }
  service = new SshService({
    helper,
    terminals,
    hosts: {
      get: (id) => hosts.get(id),
      touch: async (id, at) => {
        touched.push([id, at])
      }
    },
    secrets: secretAccess,
    emitEvent: (event) => events.push(event),
    emitSftpEvent: (event) => sftpEvents.push(event),
    now: () => 777
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('opening an SSH terminal', () => {
  it('sends the stored password to the helper, never to the renderer, and becomes a terminal when connected', async () => {
    const result = service.open({ id: PANE, hostId: TARGET, cols: 120, rows: 40 })
    await settle()
    const connect = helper.last('connect')!
    expect(connect).toMatchObject({
      sid: PANE,
      mode: 'shell',
      cols: 120,
      rows: 40,
      jump: null,
      target: { label: TARGET, address: '10.20.4.11', port: 22, username: 'deploy', auth: 'password', password: 'stored-pass' }
    })

    helper.emit({ ev: 'phase', sid: PANE, phase: 'connecting', host: TARGET })
    helper.emit({ ev: 'connected', sid: PANE })
    await expect(result).resolves.toEqual({ ok: true })
    expect(events).toEqual([{ kind: 'phase', sessionId: PANE, phase: 'connecting', hostName: 'xl-app-01' }])
    expect(JSON.stringify(events)).not.toContain('stored-pass')
    expect(terminals.has(PANE)).toBe(true)
    expect(touched).toEqual([[TARGET, 777]])
  })

  it('decodes UTF-8 that is split across helper reads', async () => {
    const result = service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    helper.emit({ ev: 'connected', sid: PANE })
    await result
    const bytes = Buffer.from('Salam, dünya ə', 'utf8')
    helper.emit({ ev: 'data', sid: PANE, data: bytes.subarray(0, 9).toString('base64') })
    helper.emit({ ev: 'data', sid: PANE, data: bytes.subarray(9).toString('base64') })
    await vi.advanceTimersByTimeAsync(20)
    expect(data.map((event) => event.data).join('')).toBe('Salam, dünya ə')
  })

  it('forwards keystrokes, resizes and flow control to the helper', async () => {
    const result = service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    helper.emit({ ev: 'connected', sid: PANE })
    await result
    terminals.write(PANE, 'ls ə\r')
    terminals.resize(PANE, 100, 30)
    expect(helper.last('input')).toEqual({ op: 'input', sid: PANE, data: Buffer.from('ls ə\r').toString('base64') })
    expect(helper.last('resize')).toEqual({ op: 'resize', sid: PANE, cols: 100, rows: 30 })
  })

  it('reports how the shell ended', async () => {
    const result = service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    helper.emit({ ev: 'connected', sid: PANE })
    await result
    helper.emit({ ev: 'closed', sid: PANE, reason: 'lost' })
    expect(exits).toEqual([{ id: PANE, exitCode: -1, reason: 'lost' }])
    expect(terminals.has(PANE)).toBe(false)
  })

  it('closes the connection when the terminal is killed', async () => {
    const result = service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    helper.emit({ ev: 'connected', sid: PANE })
    await result
    expect(terminals.kill(PANE)).toBe(true)
    expect(helper.last('close')).toEqual({ op: 'close', sid: PANE })
    helper.emit({ ev: 'closed', sid: PANE, reason: 'closed' })
    expect(exits).toEqual([])
  })

  it('passes host key questions to the renderer and the answer back', async () => {
    const result = service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    helper.emit({
      ev: 'hostkey',
      sid: PANE,
      rid: 'r1',
      host: TARGET,
      address: '10.20.4.11',
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:abc'
    })
    expect(events.at(-1)).toMatchObject({ kind: 'hostkey', requestId: 'r1', hostName: 'xl-app-01', fingerprint: 'SHA256:abc' })
    service.answer({ sessionId: PANE, requestId: 'r1', accept: true })
    service.answer({ sessionId: PANE, requestId: 'r1', accept: true })
    expect(helper.sent.filter((command) => command.op === 'answer')).toEqual([
      { op: 'answer', sid: PANE, rid: 'r1', accept: true }
    ])
    helper.emit({ ev: 'failed', sid: PANE, kind: 'auth', message: 'denied', host: TARGET })
    await expect(result).resolves.toEqual({
      ok: false,
      failure: { code: 'auth', message: 'denied', hostName: 'xl-app-01' }
    })
  })

  it('remembers a typed password only after the connection succeeds', async () => {
    secrets.clear()
    const result = service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    expect(helper.last('connect')?.target.password).toBeUndefined()
    helper.emit({
      ev: 'prompt',
      sid: PANE,
      rid: 'p1',
      host: TARGET,
      kind: 'password',
      name: '',
      instruction: '',
      questions: [{ text: 'Password: ', echo: false }]
    })
    expect(events.at(-1)).toMatchObject({ kind: 'prompt', canRemember: true, promptKind: 'password' })
    service.answer({ sessionId: PANE, requestId: 'p1', answers: ['typed-pass'], remember: true })
    expect(helper.last('answer')).toEqual({ op: 'answer', sid: PANE, rid: 'p1', answers: ['typed-pass'] })
    expect(secrets.size).toBe(0)
    helper.emit({ ev: 'connected', sid: PANE })
    await result
    await vi.runAllTimersAsync()
    expect(secrets.get(`${TARGET}:password`)).toBe('typed-pass')
  })

  it('never offers to remember second-factor codes', async () => {
    void service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    helper.emit({
      ev: 'prompt',
      sid: PANE,
      rid: 'p1',
      host: TARGET,
      kind: 'keyboard-interactive',
      name: '',
      instruction: '',
      questions: [{ text: 'Code: ', echo: true }]
    })
    expect(events.at(-1)).toMatchObject({ canRemember: false })
  })

  it('connects through the jump host with its own credentials', async () => {
    hosts.set(JUMP, host({ id: JUMP, name: 'bastion', address: '10.0.0.1', environment: null }))
    hosts.set(TARGET, host({ jumpHostId: JUMP }))
    secrets.set(`${JUMP}:password`, 'jump-pass')
    void service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    expect(helper.last('connect')?.jump).toMatchObject({ label: JUMP, address: '10.0.0.1', password: 'jump-pass' })
  })

  it('fails clearly when the host or the helper is missing', async () => {
    await expect(
      service.open({ id: PANE, hostId: '44444444-4444-4444-8444-444444444444', cols: 80, rows: 24 })
    ).resolves.toMatchObject({ ok: false, failure: { code: 'host-missing' } })
    helper.available = false
    await expect(service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })).resolves.toMatchObject({
      ok: false,
      failure: { code: 'helper-missing' }
    })
  })

  it('cancels a connection that is still being set up', async () => {
    const result = service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    service.cancel(PANE)
    await expect(result).resolves.toMatchObject({ ok: false, failure: { code: 'cancelled' } })
    expect(helper.last('close')).toEqual({ op: 'close', sid: PANE })
  })

  it('ends every session when the helper process dies', async () => {
    const connected = service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    helper.emit({ ev: 'connected', sid: PANE })
    await connected
    const other = '55555555-5555-4555-8555-555555555555'
    const pending = service.open({ id: other, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    helper.crash()
    await expect(pending).resolves.toMatchObject({ ok: false, failure: { code: 'other' } })
    expect(exits).toEqual([{ id: PANE, exitCode: -1, reason: 'lost' }])
  })
})

describe('testing a connection from the editor', () => {
  it('uses the typed password and reports success without opening a terminal', async () => {
    const draft = host({ id: '66666666-6666-4666-8666-666666666666' })
    const result = service.test({ sessionId: PANE, host: draft, password: 'typed' })
    await settle()
    expect(helper.last('connect')).toMatchObject({ mode: 'test', target: { password: 'typed' } })
    helper.emit({ ev: 'connected', sid: PANE })
    await expect(result).resolves.toEqual({ ok: true })
    expect(terminals.has(PANE)).toBe(false)
  })

  it('falls back to the stored password of an existing host', async () => {
    void service.test({ sessionId: PANE, host: host() })
    await settle()
    expect(helper.last('connect')?.target.password).toBe('stored-pass')
  })
})

describe('SFTP sessions', () => {
  const SFTP = '77777777-7777-4777-8777-777777777777'
  const TRANSFER = '88888888-8888-4888-8888-888888888888'

  async function connectedShell(): Promise<void> {
    const result = service.open({ id: PANE, hostId: TARGET, cols: 80, rows: 24 })
    await settle()
    helper.emit({ ev: 'connected', sid: PANE })
    await result
  }

  async function readySftp(): Promise<void> {
    const opened = service.openSftp({ id: SFTP, hostId: TARGET })
    await settle()
    helper.emit({ ev: 'sftp-ready', sid: SFTP, home: '/home/deploy' })
    await opened
  }

  it('reuses the connection of a running terminal instead of logging in again', async () => {
    await connectedShell()
    const opened = service.openSftp({ id: SFTP, hostId: TARGET, viaId: PANE })
    await settle()
    expect(helper.last('sftp-open')).toEqual({ op: 'sftp-open', sid: SFTP, via: PANE })
    helper.emit({ ev: 'sftp-ready', sid: SFTP, home: '/home/deploy' })
    await expect(opened).resolves.toEqual({ ok: true, home: '/home/deploy' })
  })

  it('opens its own connection with the stored password when no terminal is running', async () => {
    const opened = service.openSftp({ id: SFTP, hostId: TARGET, viaId: PANE })
    await settle()
    expect(helper.last('sftp-open')).toMatchObject({ sid: SFTP, target: { password: 'stored-pass' }, jump: null })
    helper.emit({ ev: 'failed', sid: SFTP, kind: 'refused', message: 'no', host: TARGET })
    await expect(opened).resolves.toMatchObject({ ok: false, failure: { code: 'refused' } })
  })

  it('maps requests to helper commands and keeps only valid entries', async () => {
    await readySftp()
    const listed = service.sftpRequest({ sessionId: SFTP, op: 'list', path: '/var' })
    const command = helper.last('sftp-list')!
    expect(command).toMatchObject({ sid: SFTP, path: '/var' })
    helper.emit({
      ev: 'sftp-reply',
      sid: SFTP,
      rid: command.rid,
      ok: true,
      path: '/var',
      entries: [
        { name: 'log', kind: 'dir', size: 0, mtime: 1, mode: 493 },
        { name: '', kind: 'file', size: 1, mtime: 1, mode: 420 }
      ]
    })
    await expect(listed).resolves.toEqual({
      ok: true,
      path: '/var',
      entries: [{ name: 'log', kind: 'dir', size: 0, mtime: 1, mode: 493 }]
    })

    const removed = service.sftpRequest({ sessionId: SFTP, op: 'remove', path: '/var/x', recursive: true })
    const remove = helper.last('sftp-remove')!
    expect(remove).toMatchObject({ path: '/var/x', recursive: true })
    helper.emit({ ev: 'sftp-reply', sid: SFTP, rid: remove.rid, ok: false, error: { code: 'permission', message: 'denied' } })
    await expect(removed).resolves.toEqual({ ok: false, error: { code: 'permission', message: 'denied' } })
  })

  it('gives up on a request the helper never answers', async () => {
    await readySftp()
    const pending = service.sftpRequest({ sessionId: SFTP, op: 'realpath', path: '.' })
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'connection' } })
  })

  it('forwards transfer progress and the result to the renderer', async () => {
    await readySftp()
    service.transfer({
      sessionId: SFTP,
      transferId: TRANSFER,
      direction: 'download',
      localPath: 'C:\\Users\\me\\Downloads\\app.log',
      remotePath: '/var/log/app.log',
      overwrite: false
    })
    expect(helper.last('sftp-download')).toEqual({
      op: 'sftp-download',
      sid: SFTP,
      tid: TRANSFER,
      localPath: 'C:\\Users\\me\\Downloads\\app.log',
      remotePath: '/var/log/app.log',
      overwrite: false
    })
    helper.emit({ ev: 'transfer', sid: SFTP, tid: TRANSFER, bytes: 10, total: 100, files: 0, filesTotal: 1, current: 'app.log' })
    helper.emit({ ev: 'transfer', sid: SFTP, tid: 'unknown', bytes: 1, total: 1, files: 0, filesTotal: 1, current: '' })
    helper.emit({ ev: 'transfer-done', sid: SFTP, tid: TRANSFER, ok: false, error: { code: 'exists', message: '' } })
    expect(sftpEvents).toEqual([
      {
        kind: 'transfer',
        sessionId: SFTP,
        transferId: TRANSFER,
        bytes: 10,
        total: 100,
        files: 0,
        filesTotal: 1,
        current: 'app.log'
      },
      { kind: 'transfer-done', sessionId: SFTP, transferId: TRANSFER, error: { code: 'exists', message: '' } }
    ])
  })

  it('ends open requests and transfers when the session closes', async () => {
    await readySftp()
    const pending = service.sftpRequest({ sessionId: SFTP, op: 'list', path: '/' })
    service.transfer({
      sessionId: SFTP,
      transferId: TRANSFER,
      direction: 'upload',
      localPath: 'C:\\a.txt',
      remotePath: '/tmp/a.txt',
      overwrite: true
    })
    service.closeSftp(SFTP)
    expect(helper.last('sftp-close')).toEqual({ op: 'sftp-close', sid: SFTP })
    helper.emit({ ev: 'closed', sid: SFTP, reason: 'closed' })
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'connection' } })
    expect(sftpEvents).toEqual([
      { kind: 'transfer-done', sessionId: SFTP, transferId: TRANSFER, error: { code: 'cancelled', message: '' } },
      { kind: 'sftp-closed', sessionId: SFTP, reason: 'closed' }
    ])
  })
})
