import { join } from 'node:path'
import { z } from 'zod'
import { SerialWriter, readJsonFile } from './atomic-write'

export const SECRETS_FILE = 'secrets.json'
const SECRETS_VERSION = 1

export type SecretKind = 'password' | 'passphrase'

export interface SecretCipher {
  isAvailable(): Promise<boolean>
  encrypt(text: string): Promise<Buffer>
  decrypt(data: Buffer): Promise<string>
}

const EntrySchema = z.object({
  password: z.string().max(8192).optional(),
  passphrase: z.string().max(8192).optional()
})

const SecretsFileSchema = z.object({
  version: z.literal(SECRETS_VERSION),
  entries: z.record(z.uuid(), EntrySchema)
})

type Entry = z.infer<typeof EntrySchema>

export class SecretStore {
  private entries: Record<string, Entry> = {}
  private readonly writer: SerialWriter

  constructor(
    private readonly directory: string,
    private readonly cipher: SecretCipher
  ) {
    this.writer = new SerialWriter(directory, SECRETS_FILE)
  }

  get path(): string {
    return join(this.directory, SECRETS_FILE)
  }

  async load(): Promise<void> {
    const outcome = await readJsonFile(this.path)
    const parsed = outcome.kind === 'ok' ? SecretsFileSchema.safeParse(outcome.value) : null
    this.entries = parsed?.success ? parsed.data.entries : {}
  }

  has(hostId: string, kind: SecretKind): boolean {
    return this.entries[hostId]?.[kind] !== undefined
  }

  async get(hostId: string, kind: SecretKind): Promise<string | undefined> {
    const stored = this.entries[hostId]?.[kind]
    if (stored === undefined) return undefined
    try {
      if (!(await this.cipher.isAvailable())) return undefined
      return await this.cipher.decrypt(Buffer.from(stored, 'base64'))
    } catch {
      return undefined
    }
  }

  async set(hostId: string, kind: SecretKind, value: string | null): Promise<boolean> {
    if (value === null) {
      const entry = this.entries[hostId]
      if (!entry || entry[kind] === undefined) return true
      const rest = { ...entry }
      delete rest[kind]
      this.replace(hostId, rest)
      await this.persist()
      return true
    }
    if (!(await this.cipher.isAvailable())) return false
    const encrypted = (await this.cipher.encrypt(value)).toString('base64')
    this.replace(hostId, { ...this.entries[hostId], [kind]: encrypted })
    await this.persist()
    return true
  }

  async removeHost(hostId: string): Promise<void> {
    if (!this.entries[hostId]) return
    this.replace(hostId, {})
    await this.persist()
  }

  flush(): Promise<void> {
    return this.writer.flush()
  }

  private replace(hostId: string, entry: Entry): void {
    const next = { ...this.entries }
    if (entry.password === undefined && entry.passphrase === undefined) delete next[hostId]
    else next[hostId] = entry
    this.entries = next
  }

  private persist(): Promise<void> {
    return this.writer.write(JSON.stringify({ version: SECRETS_VERSION, entries: this.entries }))
  }
}
