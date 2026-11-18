import { spawn } from 'node:child_process'
import { existsSync, unwatchFile, watchFile } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

export interface LocalEditingDeps {
  tempDir: string
  windowsDir: string
  findOnPath(name: string): string | null
  emitChanged(path: string): void
  newId(): string
  editorOverride?: string
  launch?(executable: string, args: string[]): void
}

export const WATCH_INTERVAL_MS = 700
export const CHANGE_SETTLE_MS = 600

function launchDetached(executable: string, args: string[]): void {
  spawn(executable, args, { detached: true, stdio: 'ignore' }).unref()
}

export class LocalEditing {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout> | null>()
  readonly root: string

  constructor(private readonly deps: LocalEditingDeps) {
    this.root = join(deps.tempDir, 'AgentGrid', 'edit')
  }

  async editPath(name: string): Promise<string> {
    const directory = join(this.root, this.deps.newId())
    await mkdir(directory, { recursive: true })
    return join(directory, name)
  }

  editor(): string {
    if (this.deps.editorOverride) return this.deps.editorOverride
    const code = this.deps.findOnPath('code')
    if (code) {
      const executable = resolve(dirname(code), '..', 'Code.exe')
      if (existsSync(executable)) return executable
    }
    return join(this.deps.windowsDir, 'System32', 'notepad.exe')
  }

  async openInEditor(path: string): Promise<boolean> {
    if (!this.owns(path) || !existsSync(path)) return false
    ;(this.deps.launch ?? launchDetached)(this.editor(), [path])
    return true
  }

  watch(path: string): void {
    if (!this.owns(path) || this.timers.has(path)) return
    this.timers.set(path, null)
    watchFile(path, { interval: WATCH_INTERVAL_MS }, (current, previous) => {
      if (current.mtimeMs === 0) return
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return
      const pending = this.timers.get(path)
      if (pending) clearTimeout(pending)
      this.timers.set(
        path,
        setTimeout(() => {
          if (!this.timers.has(path)) return
          this.timers.set(path, null)
          this.deps.emitChanged(path)
        }, CHANGE_SETTLE_MS)
      )
    })
  }

  unwatch(path: string): void {
    if (!this.timers.has(path)) return
    const pending = this.timers.get(path)
    if (pending) clearTimeout(pending)
    this.timers.delete(path)
    unwatchFile(path)
  }

  unwatchAll(): void {
    for (const path of [...this.timers.keys()]) this.unwatch(path)
  }

  private owns(path: string): boolean {
    return resolve(path).toLowerCase().startsWith(`${resolve(this.root).toLowerCase()}${sep}`)
  }
}
