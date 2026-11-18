import { copyFile, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  HOSTS_EXPORT_FORMAT,
  HOSTS_FILE_VERSION,
  HostSchema,
  HostsExportFileSchema,
  HostsFileSchema,
  MAX_HOSTS,
  checkJumpHost,
  isSameEndpoint,
  type Host,
  type HostSaveError
} from '@shared/hosts'
import { SerialWriter, readJsonFile } from './atomic-write'

export const HOSTS_FILE = 'hosts.json'

export interface HostsLoadReport {
  dropped: number
  preservedAs: string | null
}

export interface ImportOutcome {
  added: Host[]
  skipped: number
  invalid: number
}

export function planImport(
  existing: readonly Host[],
  rawHosts: readonly unknown[],
  newId: () => string
): ImportOutcome {
  const parsed: Host[] = []
  let invalid = 0
  for (const raw of rawHosts) {
    const result = HostSchema.safeParse(raw)
    if (result.success) parsed.push(result.data)
    else invalid++
  }

  const idMap = new Map<string, string>()
  const fresh: Host[] = []
  let skipped = 0
  for (const host of parsed) {
    if (idMap.has(host.id)) {
      invalid++
      continue
    }
    const twin = existing.find((candidate) => candidate.name === host.name && isSameEndpoint(candidate, host))
    if (twin) {
      idMap.set(host.id, twin.id)
      skipped++
      continue
    }
    const id = newId()
    idMap.set(host.id, id)
    fresh.push({ ...host, id, lastConnectedAt: null })
  }

  const added = fresh.map((host) => ({
    ...host,
    jumpHostId: host.jumpHostId ? (idMap.get(host.jumpHostId) ?? null) : null
  }))
  const all = [...existing, ...added]
  return {
    added: added.map((host) => (checkJumpHost(all, host) === null ? host : { ...host, jumpHostId: null })),
    skipped,
    invalid
  }
}

export function exportDocument(hosts: readonly Host[]): string {
  return JSON.stringify(
    {
      format: HOSTS_EXPORT_FORMAT,
      version: HOSTS_FILE_VERSION,
      hosts: hosts.map((host) => ({ ...host, lastConnectedAt: null }))
    },
    null,
    2
  )
}

export function parseExportDocument(value: unknown): unknown[] | null {
  const parsed = HostsExportFileSchema.safeParse(value)
  return parsed.success ? parsed.data.hosts : null
}

export class HostsStore {
  private hosts: Host[] = []
  private readonly writer: SerialWriter

  constructor(private readonly directory: string) {
    this.writer = new SerialWriter(directory, HOSTS_FILE)
  }

  get path(): string {
    return join(this.directory, HOSTS_FILE)
  }

  async load(): Promise<HostsLoadReport> {
    const outcome = await readJsonFile(this.path)
    if (outcome.kind === 'missing') {
      this.hosts = []
      return { dropped: 0, preservedAs: null }
    }
    const file = outcome.kind === 'ok' ? HostsFileSchema.safeParse(outcome.value) : null
    if (!file?.success) {
      this.hosts = []
      return { dropped: 0, preservedAs: await this.preserveUnreadable() }
    }

    const hosts: Host[] = []
    const seen = new Set<string>()
    let dropped = 0
    for (const raw of file.data.hosts.slice(0, MAX_HOSTS)) {
      const parsed = HostSchema.safeParse(raw)
      if (parsed.success && !seen.has(parsed.data.id)) {
        seen.add(parsed.data.id)
        hosts.push(parsed.data)
      } else {
        dropped++
      }
    }
    dropped += Math.max(0, file.data.hosts.length - MAX_HOSTS)
    this.hosts = hosts.map((host) => (checkJumpHost(hosts, host) === null ? host : { ...host, jumpHostId: null }))
    return { dropped, preservedAs: null }
  }

  list(): Host[] {
    return [...this.hosts]
  }

  get(id: string): Host | undefined {
    return this.hosts.find((host) => host.id === id)
  }

  async save(host: Host): Promise<HostSaveError | null> {
    const exists = this.hosts.some((candidate) => candidate.id === host.id)
    if (!exists && this.hosts.length >= MAX_HOSTS) return 'too-many'
    const next = exists
      ? this.hosts.map((candidate) => (candidate.id === host.id ? host : candidate))
      : [...this.hosts, host]
    const jumpProblem = checkJumpHost(next, host)
    if (jumpProblem) return jumpProblem
    this.hosts = next
    await this.persist()
    return null
  }

  async remove(id: string): Promise<boolean> {
    if (!this.hosts.some((host) => host.id === id)) return false
    this.hosts = this.hosts
      .filter((host) => host.id !== id)
      .map((host) => (host.jumpHostId === id ? { ...host, jumpHostId: null } : host))
    await this.persist()
    return true
  }

  async touch(id: string, at: number): Promise<void> {
    if (!this.hosts.some((host) => host.id === id)) return
    this.hosts = this.hosts.map((host) => (host.id === id ? { ...host, lastConnectedAt: at } : host))
    await this.persist()
  }

  async addMany(hosts: readonly Host[]): Promise<boolean> {
    if (this.hosts.length + hosts.length > MAX_HOSTS) return false
    this.hosts = [...this.hosts, ...hosts]
    await this.persist()
    return true
  }

  flush(): Promise<void> {
    return this.writer.flush()
  }

  private persist(): Promise<void> {
    return this.writer.write(JSON.stringify({ version: HOSTS_FILE_VERSION, hosts: this.hosts }, null, 2))
  }

  private async preserveUnreadable(): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(this.directory, `hosts.unreadable-${stamp}.json`)
    try {
      await rename(this.path, target)
    } catch {
      await copyFile(this.path, target).catch(() => undefined)
    }
    return basename(target)
  }
}
