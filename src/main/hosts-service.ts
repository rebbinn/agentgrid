import {
  knownHostsAddress,
  type Host,
  type HostSaveRequest,
  type HostSaveResult,
  type HostView,
  type HostsTransferResult,
  type KeyPickResult
} from '@shared/hosts'
import { MAX_HOSTS } from '@shared/hosts'
import { forgetKnownHost } from './known-hosts'
import { exportDocument, parseExportDocument, planImport, type HostsStore } from './hosts-store'
import type { SecretStore } from './secret-store'

export interface HostsServiceDeps {
  store: HostsStore
  secrets: SecretStore
  knownHostsPath: string
  chooseExportPath(): Promise<string | null>
  chooseImportPath(): Promise<string | null>
  chooseKeyPath(): Promise<string | null>
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  newId(): string
}

const MAX_IMPORT_BYTES = 5 * 1024 * 1024

export class HostsService {
  constructor(private readonly deps: HostsServiceDeps) {}

  views(): HostView[] {
    return this.deps.store.list().map((host) => this.viewOf(host))
  }

  async save(request: HostSaveRequest): Promise<HostSaveResult> {
    const { store, secrets } = this.deps
    const existing = store.get(request.host.id)
    const host: Host = { ...request.host, lastConnectedAt: existing?.lastConnectedAt ?? null }
    const problem = await store.save(host)
    if (problem) return { ok: false, code: problem }

    if (host.auth !== 'password') await secrets.set(host.id, 'password', null)
    else if (request.password !== undefined) await secrets.set(host.id, 'password', request.password)
    if (host.auth !== 'key') await secrets.set(host.id, 'passphrase', null)
    else if (request.passphrase !== undefined) await secrets.set(host.id, 'passphrase', request.passphrase)

    return { ok: true, view: this.viewOf(host) }
  }

  async remove(id: string): Promise<void> {
    await this.deps.store.remove(id)
    await this.deps.secrets.removeHost(id)
  }

  async exportAll(): Promise<HostsTransferResult> {
    const path = await this.deps.chooseExportPath()
    if (!path) return { status: 'cancelled' }
    const hosts = this.deps.store.list()
    try {
      await this.deps.writeText(path, exportDocument(hosts))
    } catch {
      return { status: 'failed', reason: 'write' }
    }
    return { status: 'exported', count: hosts.length }
  }

  async importFile(): Promise<HostsTransferResult> {
    const path = await this.deps.chooseImportPath()
    if (!path) return { status: 'cancelled' }
    let text: string
    try {
      text = await this.deps.readText(path)
    } catch {
      return { status: 'failed', reason: 'read' }
    }
    if (text.length > MAX_IMPORT_BYTES) return { status: 'failed', reason: 'format' }
    let raw: unknown
    try {
      raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    } catch {
      return { status: 'failed', reason: 'format' }
    }
    const rawHosts = parseExportDocument(raw)
    if (!rawHosts) return { status: 'failed', reason: 'format' }

    const plan = planImport(this.deps.store.list(), rawHosts, this.deps.newId)
    if (this.deps.store.list().length + plan.added.length > MAX_HOSTS) {
      return { status: 'failed', reason: 'too-many' }
    }
    if (!(await this.deps.store.addMany(plan.added))) return { status: 'failed', reason: 'too-many' }
    return { status: 'imported', added: plan.added.length, skipped: plan.skipped, invalid: plan.invalid }
  }

  async pickKey(): Promise<KeyPickResult> {
    return { path: await this.deps.chooseKeyPath() }
  }

  async forgetHostKey(id: string): Promise<boolean> {
    const host = this.deps.store.get(id)
    if (!host) return false
    return forgetKnownHost(this.deps.knownHostsPath, knownHostsAddress(host))
  }

  private viewOf(host: Host): HostView {
    return {
      host,
      hasPassword: this.deps.secrets.has(host.id, 'password'),
      hasPassphrase: this.deps.secrets.has(host.id, 'passphrase')
    }
  }
}
