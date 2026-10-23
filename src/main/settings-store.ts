import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  SettingsSchema,
  defaultSettings,
  parseSettings,
  toAppState,
  type AppState,
  type LoadedSettings,
  type Settings,
  type SettingsNotice,
  type WindowState
} from '@shared/settings'

export const SETTINGS_FILE = 'settings.json'
export const BACKUP_FILE = 'settings.json.bak'
const RENAME_ATTEMPTS = 6
const RENAME_RETRY_MS = 60

type ReadOutcome =
  | { kind: 'missing' }
  | { kind: 'ok'; settings: Settings; notices: SettingsNotice[] }
  | { kind: 'newer' }
  | { kind: 'invalid' }

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
}

export class SettingsStore {
  private current: Settings = defaultSettings()
  private pending: Settings | null = null
  private writing: Promise<void> | null = null
  private backedUpThisRun = false
  private writeFailures = 0

  constructor(private readonly directory: string) {}

  get path(): string {
    return join(this.directory, SETTINGS_FILE)
  }

  get backupPath(): string {
    return join(this.directory, BACKUP_FILE)
  }

  get windowState(): WindowState | undefined {
    return this.current.window
  }

  snapshot(): Settings {
    return this.current
  }

  get failedWrites(): number {
    return this.writeFailures
  }

  async load(): Promise<LoadedSettings> {
    const notices: SettingsNotice[] = []
    const main = await this.read(this.path)

    if (main.kind === 'ok') {
      this.current = main.settings
      return { state: toAppState(main.settings), notices: main.notices }
    }
    if (main.kind === 'missing') {
      this.current = defaultSettings()
      return { state: toAppState(this.current), notices }
    }

    const backupFile = await this.preserveUnreadableFile(main.kind)
    const fallback = await this.read(this.backupPath)
    if (fallback.kind === 'ok' && main.kind === 'invalid') {
      this.current = fallback.settings
      notices.push({ kind: 'recovered-from-backup', backupFile }, ...fallback.notices)
      return { state: toAppState(fallback.settings), notices }
    }

    this.current = defaultSettings()
    notices.push({ kind: main.kind === 'newer' ? 'newer-version' : 'reset-corrupt', backupFile })
    return { state: toAppState(this.current), notices }
  }

  save(state: AppState): Promise<void> {
    this.current = { ...this.current, ...state, version: this.current.version }
    return this.enqueue()
  }

  updateWindowState(windowState: WindowState): Promise<void> {
    this.current = { ...this.current, window: windowState }
    return this.enqueue()
  }

  async flush(): Promise<void> {
    while (this.writing) await this.writing
  }

  private enqueue(): Promise<void> {
    this.pending = this.current
    if (!this.writing) {
      this.writing = this.drain().finally(() => {
        this.writing = null
      })
    }
    return this.writing
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const settings = this.pending
      this.pending = null
      try {
        await this.writeAtomically(settings)
        this.writeFailures = 0
      } catch {
        this.writeFailures++
      }
    }
  }

  private async writeAtomically(settings: Settings): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    if (!this.backedUpThisRun) {
      this.backedUpThisRun = true
      await copyFile(this.path, this.backupPath).catch(() => undefined)
    }
    const temporary = join(this.directory, `${SETTINGS_FILE}.${process.pid}.tmp`)
    await writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8')
    for (let attempt = 1; ; attempt++) {
      try {
        await rename(temporary, this.path)
        return
      } catch (error) {
        if (attempt >= RENAME_ATTEMPTS) {
          await rm(temporary, { force: true })
          throw error
        }
        await pause(RENAME_RETRY_MS * attempt)
      }
    }
  }

  private async read(path: string): Promise<ReadOutcome> {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      return isMissing(error) ? { kind: 'missing' } : { kind: 'invalid' }
    }
    let raw: unknown
    try {
      raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    } catch {
      return { kind: 'invalid' }
    }
    const outcome = parseSettings(raw)
    if (!outcome.ok) return { kind: outcome.reason === 'newer' ? 'newer' : 'invalid' }
    const checked = SettingsSchema.safeParse(outcome.settings)
    return checked.success
      ? { kind: 'ok', settings: checked.data, notices: outcome.notices }
      : { kind: 'invalid' }
  }

  private async preserveUnreadableFile(kind: 'newer' | 'invalid'): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(dirname(this.path), `settings.${kind === 'newer' ? 'newer' : 'corrupt'}-${stamp}.json`)
    try {
      await rename(this.path, target)
    } catch {
      await copyFile(this.path, target).catch(() => undefined)
    }
    return basename(target)
  }
}
