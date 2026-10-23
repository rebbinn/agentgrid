import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_FILE, SETTINGS_FILE, SettingsStore } from '../../src/main/settings-store'
import { defaultAppState, type AppState, type Workspace } from '../../src/shared/settings'

const ID_A = '11111111-1111-4111-8111-111111111111'

function workspace(name: string, id = ID_A): Workspace {
  return {
    id,
    name,
    projectPath: 'C:\\work\\shop',
    layout: { preset: 'auto', columnSizes: [], rowSizes: [], focusMode: false },
    panes: [],
    activePane: null,
    autoStart: false
  }
}

function state(name: string): AppState {
  return { ...defaultAppState(), activeWorkspaceId: ID_A, workspaces: [workspace(name)] }
}

describe('SettingsStore', () => {
  let directory: string
  let store: SettingsStore

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agentgrid-settings-'))
    store = new SettingsStore(directory)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function files(): Promise<string[]> {
    return (await readdir(directory)).sort()
  }

  it('starts with defaults and no notices when there is no file yet', async () => {
    const loaded = await store.load()
    expect(loaded.state).toEqual(defaultAppState())
    expect(loaded.notices).toEqual([])
  })

  it('saves and loads the same state again, as readable versioned JSON', async () => {
    await store.save(state('Shop'))
    const text = await readFile(join(directory, SETTINGS_FILE), 'utf8')
    expect(JSON.parse(text)).toMatchObject({ version: 1, workspaces: [{ name: 'Shop' }] })
    const reloaded = await new SettingsStore(directory).load()
    expect(reloaded.state.workspaces[0]?.name).toBe('Shop')
    expect(reloaded.notices).toEqual([])
  })

  it('leaves no temporary files behind', async () => {
    await store.save(state('One'))
    await store.save(state('Two'))
    expect((await files()).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('writes the newest state when many saves arrive at once', async () => {
    const saves = ['A', 'B', 'C', 'D', 'E'].map((name) => store.save(state(name)))
    await Promise.all(saves)
    await store.flush()
    const reloaded = await new SettingsStore(directory).load()
    expect(reloaded.state.workspaces[0]?.name).toBe('E')
  })

  it('keeps a copy of the previous session file as a backup before the first overwrite', async () => {
    await store.save(state('Yesterday'))
    const next = new SettingsStore(directory)
    await next.load()
    await next.save(state('Today'))
    const backup = JSON.parse(await readFile(join(directory, BACKUP_FILE), 'utf8'))
    expect(backup.workspaces[0].name).toBe('Yesterday')
    const main = JSON.parse(await readFile(join(directory, SETTINGS_FILE), 'utf8'))
    expect(main.workspaces[0].name).toBe('Today')
  })

  it('moves a corrupted file aside and starts clean, telling the user', async () => {
    await writeFile(join(directory, SETTINGS_FILE), '{ this is not json')
    const loaded = await store.load()
    expect(loaded.state).toEqual(defaultAppState())
    expect(loaded.notices).toHaveLength(1)
    expect(loaded.notices[0]?.kind).toBe('reset-corrupt')
    const saved = loaded.notices[0]?.backupFile ?? ''
    expect(saved).toMatch(/^settings\.corrupt-.*\.json$/)
    expect(await readFile(join(directory, saved), 'utf8')).toBe('{ this is not json')
    expect((await files()).includes(SETTINGS_FILE)).toBe(false)
  })

  it('recovers from the backup when the main file is corrupted', async () => {
    await store.save(state('Good'))
    const second = new SettingsStore(directory)
    await second.load()
    await second.save(state('Newer good'))
    await writeFile(join(directory, SETTINGS_FILE), '\u0000\u0000garbage')
    const loaded = await new SettingsStore(directory).load()
    expect(loaded.state.workspaces[0]?.name).toBe('Good')
    expect(loaded.notices.map((notice) => notice.kind)).toEqual(['recovered-from-backup'])
    expect(loaded.notices[0]?.backupFile).toMatch(/^settings\.corrupt-/)
  })

  it('treats a structurally wrong file as corrupted too', async () => {
    await writeFile(join(directory, SETTINGS_FILE), JSON.stringify({ version: 1, workspaces: 'many' }))
    const loaded = await store.load()
    expect(loaded.state.workspaces).toEqual([])
  })

  it('never overwrites a file from a newer version: it is set aside untouched', async () => {
    const newer = JSON.stringify({ version: 99, secret: 'future format' })
    await writeFile(join(directory, SETTINGS_FILE), newer)
    const loaded = await store.load()
    expect(loaded.notices[0]?.kind).toBe('newer-version')
    expect(loaded.state).toEqual(defaultAppState())
    const kept = loaded.notices[0]?.backupFile ?? ''
    expect(kept).toMatch(/^settings\.newer-/)
    expect(await readFile(join(directory, kept), 'utf8')).toBe(newer)
  })

  it('does not use an old backup in place of a newer-version file', async () => {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, BACKUP_FILE), JSON.stringify({ ...defaultAppStateFile('Old backup') }))
    await writeFile(join(directory, SETTINGS_FILE), JSON.stringify({ version: 2 }))
    const loaded = await store.load()
    expect(loaded.state.workspaces).toEqual([])
  })

  it('reads a file saved with a byte order mark', async () => {
    const text = JSON.stringify({ version: 1, ...defaultAppState() })
    await writeFile(join(directory, SETTINGS_FILE), `\uFEFF${text}`)
    const loaded = await store.load()
    expect(loaded.notices).toEqual([])
  })

  it('reports damaged workspaces but keeps the good ones', async () => {
    const file = { version: 1, ...state('Keeper'), workspaces: [workspace('Keeper'), { id: 'bad' }] }
    await writeFile(join(directory, SETTINGS_FILE), JSON.stringify(file))
    const loaded = await store.load()
    expect(loaded.state.workspaces.map((item) => item.name)).toEqual(['Keeper'])
    expect(loaded.notices).toEqual([{ kind: 'dropped-workspaces', count: 1 }])
  })

  it('stores the window position separately from what the window can save', async () => {
    await store.save(state('X'))
    await store.updateWindowState({ width: 1000, height: 700, x: 5, y: 6, maximized: true })
    await store.save(state('Y'))
    const written = JSON.parse(await readFile(join(directory, SETTINGS_FILE), 'utf8'))
    expect(written.window).toEqual({ width: 1000, height: 700, x: 5, y: 6, maximized: true })
    expect(written.workspaces[0].name).toBe('Y')
    expect(new SettingsStore(directory).windowState).toBeUndefined()
    const reloaded = new SettingsStore(directory)
    await reloaded.load()
    expect(reloaded.windowState).toEqual({ width: 1000, height: 700, x: 5, y: 6, maximized: true })
  })

  it('does not throw when the folder cannot be written, and counts the failure', async () => {
    const occupied = join(directory, 'occupied')
    await writeFile(occupied, 'a file where a folder should be')
    const blocked = new SettingsStore(occupied)
    await blocked.save(state('X'))
    expect(blocked.failedWrites).toBeGreaterThan(0)
  })

  it('creates the settings folder when it does not exist yet', async () => {
    const nested = new SettingsStore(join(directory, 'a', 'b'))
    await nested.save(state('Deep'))
    expect(JSON.parse(await readFile(join(directory, 'a', 'b', SETTINGS_FILE), 'utf8')).workspaces[0].name).toBe('Deep')
  })

  it('never writes terminal output, only configuration', async () => {
    await store.save(state('Plain'))
    const text = await readFile(join(directory, SETTINGS_FILE), 'utf8')
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(
      ['activeWorkspaceId', 'preferences', 'recentProjects', 'version', 'workspaces'].sort()
    )
  })
})

function defaultAppStateFile(name: string): Record<string, unknown> {
  return { version: 1, ...state(name) }
}
