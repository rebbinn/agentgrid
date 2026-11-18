import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { useLayoutStore } from '../../src/renderer/src/state/layout-store'
import {
  SAVE_DELAY_MS,
  collectAppState,
  resetPersistenceForTests,
  restoreSession,
  saveNow
} from '../../src/renderer/src/state/persistence'
import { withPersistencePaused } from '../../src/renderer/src/state/persistence-gate'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useSessionsStore } from '../../src/renderer/src/state/sessions-store'
import { useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import {
  createWorkspace,
  deleteWorkspace,
  renameWorkspace,
  switchWorkspace
} from '../../src/renderer/src/state/workspace-actions'
import { useWorkspaceStore } from '../../src/renderer/src/state/workspace-store'
import {
  defaultAppState,
  type AppState,
  type LoadedSettings,
  type SavedPane,
  type Workspace
} from '../../src/shared/settings'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const SESSION = '3975237b-df03-44fe-b8e1-be208c6646d1'

const claudePane: SavedPane = {
  title: 'Claude',
  shellId: 'cmd',
  shellLabel: 'Command Prompt',
  cwd: 'C:\\work\\shop',
  agentId: 'claude',
  fontSize: 15
}

const resumedPane: SavedPane = {
  title: 'Claude · Fix login',
  shellId: 'cmd',
  shellLabel: 'Command Prompt',
  cwd: 'C:\\work\\shop',
  agentId: 'claude',
  resumeSessionId: SESSION,
  fontSize: 13
}

const shellPane: SavedPane = {
  title: 'Command Prompt',
  shellId: 'cmd',
  shellLabel: 'Command Prompt',
  cwd: 'C:\\work\\shop',
  fontSize: 13
}

function workspace(id: string, name: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name,
    projectPath: null,
    layout: { preset: 'auto', columnSizes: [], rowSizes: [], focusMode: false },
    panes: [],
    activePane: null,
    autoStart: false,
    ...overrides
  }
}

function loaded(state: Partial<AppState> = {}, notices: LoadedSettings['notices'] = []): LoadedSettings {
  return { state: { ...defaultAppState(), ...state }, notices }
}

let api: AgentGridMock

function lastSaved(): AppState {
  const calls = api.settings.save.mock.calls
  return calls[calls.length - 1]![0] as AppState
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  api = createAgentGridMock()
  window.agentgrid = api
  resetShellsCache()
  resetAppInfoCache()
  resetPersistenceForTests()
  fakeRegistry.reset()
  useTerminalStore.setState({ panes: [], activePaneId: null })
  useLayoutStore.setState({ preset: 'auto', focusMode: false, columnSizes: [], rowSizes: [] })
  useProjectStore.setState({ projectPath: null, recentPaths: [] })
  useSessionsStore.setState({ sessions: [], status: 'idle', showAll: false, query: '' })
  useUiStore.setState({ sidebarOpen: true, sidebarTab: 'projects', sessionsTabOpen: false, toasts: [], dialog: null })
  useWorkspaceStore.setState({ ready: false, workspaces: [], activeId: null })
})

afterEach(() => {
  resetPersistenceForTests()
  vi.useRealTimers()
})

describe('restoring on start', () => {
  it('creates a default workspace on the very first launch and saves it', async () => {
    api.settings.load.mockResolvedValue(loaded())
    await restoreSession()
    const { workspaces, activeId, ready } = useWorkspaceStore.getState()
    expect(ready).toBe(true)
    expect(workspaces.map((item) => item.name)).toEqual(['Əsas'])
    expect(activeId).toBe(workspaces[0]!.id)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(lastSaved().workspaces).toHaveLength(1)
  })

  it('brings back the project, layout, sizes and every terminal as waiting configuration', async () => {
    api.settings.load.mockResolvedValue(
      loaded({
        activeWorkspaceId: ID_A,
        workspaces: [
          workspace(ID_A, 'Shop', {
            projectPath: 'C:\\work\\shop',
            layout: { preset: 'grid-2x2', columnSizes: [0.6, 0.4], rowSizes: [0.3, 0.7], focusMode: false },
            panes: [claudePane, resumedPane, shellPane],
            activePane: 1
          })
        ]
      })
    )
    await restoreSession()

    expect(useProjectStore.getState().projectPath).toBe('C:\\work\\shop')
    expect(useLayoutStore.getState()).toMatchObject({
      preset: 'grid-2x2',
      columnSizes: [0.6, 0.4],
      rowSizes: [0.3, 0.7],
      focusMode: false
    })
    const { panes, activePaneId } = useTerminalStore.getState()
    expect(panes.map((pane) => [pane.title, pane.status, pane.fontSize])).toEqual([
      ['Claude', 'idle', 15],
      ['Claude · Fix login', 'idle', 13],
      ['Command Prompt', 'idle', 13]
    ])
    expect(panes[1]).toMatchObject({ agentId: 'claude', resumeSessionId: SESSION, cwd: 'C:\\work\\shop' })
    expect(activePaneId).toBe(panes[1]!.id)
  })

  it('does NOT start any process by itself: a restored pane is only configuration', async () => {
    api.settings.load.mockResolvedValue(
      loaded({ activeWorkspaceId: ID_A, workspaces: [workspace(ID_A, 'Shop', { panes: [claudePane, shellPane] })] })
    )
    await restoreSession()
    expect(api.terminal.create).not.toHaveBeenCalled()
    expect(api.terminal.write).not.toHaveBeenCalled()
  })

  it('starts the saved terminals only when the workspace was explicitly set to auto-start', async () => {
    api.settings.load.mockResolvedValue(
      loaded({
        activeWorkspaceId: ID_A,
        workspaces: [workspace(ID_A, 'Shop', { panes: [claudePane, resumedPane], autoStart: true })]
      })
    )
    await restoreSession()
    expect(api.terminal.create).toHaveBeenCalledTimes(2)
    expect(api.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'claude', resumeSessionId: SESSION })
    )
    expect(useTerminalStore.getState().panes.every((pane) => pane.status === 'running')).toBe(true)
  })

  it('applies the saved interface preferences', async () => {
    api.settings.load.mockResolvedValue(
      loaded({
        preferences: {
          ...defaultAppState().preferences,
          sidebarOpen: false,
          sidebarTab: 'sessions',
          sessionsTabOpen: true,
          sessionsShowAll: true
        }
      })
    )
    await restoreSession()
    expect(useUiStore.getState()).toMatchObject({ sidebarOpen: false, sidebarTab: 'sessions', sessionsTabOpen: true })
    expect(useSessionsStore.getState().showAll).toBe(true)
  })

  it('does not open the sessions tab as the active one if the tab itself is closed', async () => {
    api.settings.load.mockResolvedValue(
      loaded({
        preferences: {
          ...defaultAppState().preferences,
          sidebarOpen: true,
          sidebarTab: 'sessions',
          sessionsTabOpen: false,
          sessionsShowAll: false
        }
      })
    )
    await restoreSession()
    expect(useUiStore.getState().sidebarTab).toBe('projects')
  })

  it('restores the recent projects list', async () => {
    api.settings.load.mockResolvedValue(loaded({ recentProjects: ['C:\\a', 'C:\\b'] }))
    await restoreSession()
    expect(useProjectStore.getState().recentPaths).toEqual(['C:\\a', 'C:\\b'])
  })

  it('tells the user what happened when the settings file had problems', async () => {
    api.settings.load.mockResolvedValue(
      loaded({}, [
        { kind: 'recovered-from-backup', backupFile: 'settings.corrupt-1.json' },
        { kind: 'dropped-workspaces', count: 2 }
      ])
    )
    await restoreSession()
    const messages = useUiStore.getState().toasts.map((toast) => toast.message)
    expect(messages[0]).toContain('settings.corrupt-1.json')
    expect(messages[0]).toContain('son yaxşı nüsxədən')
    expect(messages[1]).toContain('2 iş sahəsi')
    expect(useUiStore.getState().toasts.every((toast) => toast.kind === 'warning')).toBe(true)
  })

  it('starts clean and says so when the settings cannot be read at all', async () => {
    api.settings.load.mockRejectedValue(new Error('ipc'))
    await restoreSession()
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
    expect(useUiStore.getState().toasts).toHaveLength(1)
  })

  it('falls back to the first workspace when the saved active one is unknown', async () => {
    api.settings.load.mockResolvedValue(
      loaded({ activeWorkspaceId: ID_B, workspaces: [workspace(ID_A, 'Only', { projectPath: 'C:\\only' })] })
    )
    await restoreSession()
    expect(useWorkspaceStore.getState().activeId).toBe(ID_A)
    expect(useProjectStore.getState().projectPath).toBe('C:\\only')
  })

  it('only loads once even if asked several times (React strict mode)', async () => {
    api.settings.load.mockResolvedValue(loaded())
    await Promise.all([restoreSession(), restoreSession(), restoreSession()])
    expect(api.settings.load).toHaveBeenCalledTimes(1)
  })
})

describe('saving', () => {
  async function start(panes: SavedPane[] = [shellPane]): Promise<void> {
    api.settings.load.mockResolvedValue(
      loaded({ activeWorkspaceId: ID_A, workspaces: [workspace(ID_A, 'Shop', { panes })] })
    )
    await restoreSession()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    api.settings.save.mockClear()
  }

  it('saves a short moment after something changes, in one go', async () => {
    await start()
    useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[0]!.id, 'One')
    useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[0]!.id, 'Two')
    useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[0]!.id, 'Three')
    expect(api.settings.save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(api.settings.save).toHaveBeenCalledTimes(1)
    expect(lastSaved().workspaces[0]!.panes[0]!.title).toBe('Three')
  })

  it('does not save again when nothing that matters changed (for example a status change)', async () => {
    await start([claudePane])
    await useTerminalStore.getState().startAllIdle()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(api.settings.save).not.toHaveBeenCalled()
  })

  it('saves layout, project, sizes, font and order changes', async () => {
    await start([shellPane, claudePane])
    useLayoutStore.getState().setPreset('columns')
    useLayoutStore.getState().setColumnSizes([0.7, 0.3])
    useProjectStore.getState().openProject('C:\\work\\blog')
    useTerminalStore.getState().setFontSize(useTerminalStore.getState().panes[0]!.id, 20)
    useTerminalStore.getState().movePane(useTerminalStore.getState().panes[0]!.id, 1)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    const saved = lastSaved()
    expect(saved.workspaces[0]!.layout).toMatchObject({ preset: 'columns', columnSizes: [0.7, 0.3] })
    expect(saved.workspaces[0]!.projectPath).toBe('C:\\work\\blog')
    expect(saved.workspaces[0]!.panes.map((pane) => pane.title)).toEqual(['Claude', 'Command Prompt'])
    expect(saved.workspaces[0]!.panes[1]!.fontSize).toBe(20)
    expect(saved.recentProjects).toEqual(['C:\\work\\blog'])
  })

  it('saves interface preferences', async () => {
    await start()
    useUiStore.getState().toggleSessionsTab()
    useSessionsStore.getState().toggleShowAll()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(lastSaved().preferences).toEqual({
      sidebarOpen: true,
      sidebarTab: 'sessions',
      sessionsTabOpen: true,
      serversTabOpen: false,
      sessionsShowAll: true,
      defaultFontSize: 13,
      defaultShellId: null
    })
  })

  it('never saves terminal output, processes or state of the running programs', async () => {
    await start([claudePane])
    await useTerminalStore.getState().startAllIdle()
    useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[0]!.id, 'Renamed')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    const text = JSON.stringify(lastSaved())
    expect(Object.keys(lastSaved().workspaces[0]!.panes[0]!).sort()).toEqual(
      ['agentId', 'cwd', 'fontSize', 'shellId', 'shellLabel', 'title'].sort()
    )
    expect(text).not.toMatch(/status|exitCode|pid|output|token|password/i)
  })

  it('does not save while a workspace switch is in progress, then saves the final result', async () => {
    await start()
    await withPersistencePaused(async () => {
      useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[0]!.id, 'Mid-switch')
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 3)
      expect(api.settings.save).not.toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(lastSaved().workspaces[0]!.panes[0]!.title).toBe('Mid-switch')
  })

  it('does not save before the first restore finished', () => {
    saveNow()
    expect(api.settings.save).not.toHaveBeenCalled()
  })

  it('saves immediately when the window is about to close', async () => {
    await start()
    useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[0]!.id, 'Before close')
    window.dispatchEvent(new Event('pagehide'))
    expect(lastSaved().workspaces[0]!.panes[0]!.title).toBe('Before close')
  })

  it('saves and confirms when the main process asks for a final flush', async () => {
    await start()
    const listener = api.settings.onFlushRequest.mock.calls[0]![0]
    useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[0]!.id, 'Flushed')
    listener()
    expect(lastSaved().workspaces[0]!.panes[0]!.title).toBe('Flushed')
    expect(api.settings.flushDone).toHaveBeenCalledTimes(1)
  })

  it('confirms a flush request even when nothing changed', async () => {
    await start()
    api.settings.onFlushRequest.mock.calls[0]![0]()
    expect(api.settings.flushDone).toHaveBeenCalledTimes(1)
    expect(api.settings.save).not.toHaveBeenCalled()
  })

  it('refuses to send an invalid state instead of corrupting the file', async () => {
    await start()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    useTerminalStore.setState({
      panes: useTerminalStore.getState().panes.map((pane) => ({ ...pane, fontSize: 9999 }))
    })
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(api.settings.save).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('collects the live workspace into the saved list', async () => {
    await start()
    useProjectStore.getState().setProject('C:\\live')
    expect(collectAppState().workspaces[0]!.projectPath).toBe('C:\\live')
    expect(useWorkspaceStore.getState().workspaces[0]!.projectPath).toBeNull()
  })
})

describe('workspaces', () => {
  async function twoWorkspaces(): Promise<void> {
    api.settings.load.mockResolvedValue(
      loaded({
        activeWorkspaceId: ID_A,
        workspaces: [
          workspace(ID_A, 'Shop', {
            projectPath: 'C:\\work\\shop',
            panes: [claudePane],
            layout: { preset: 'single', columnSizes: [], rowSizes: [], focusMode: false }
          }),
          workspace(ID_B, 'Blog', {
            projectPath: 'C:\\work\\blog',
            panes: [shellPane, resumedPane],
            layout: { preset: 'columns', columnSizes: [0.4, 0.6], rowSizes: [], focusMode: false }
          })
        ]
      })
    )
    await restoreSession()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    api.settings.save.mockClear()
  }

  it('switches: the other workspace shows its own project, layout and terminals', async () => {
    await twoWorkspaces()
    await switchWorkspace(ID_B)
    expect(useWorkspaceStore.getState().activeId).toBe(ID_B)
    expect(useProjectStore.getState().projectPath).toBe('C:\\work\\blog')
    expect(useLayoutStore.getState()).toMatchObject({ preset: 'columns', columnSizes: [0.4, 0.6] })
    expect(useTerminalStore.getState().panes.map((pane) => pane.title)).toEqual([
      'Command Prompt',
      'Claude · Fix login'
    ])
  })

  it('remembers what you changed in the old workspace when you come back', async () => {
    await twoWorkspaces()
    useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[0]!.id, 'Edited')
    useLayoutStore.getState().setPreset('rows')
    await switchWorkspace(ID_B)
    await switchWorkspace(ID_A)
    expect(useTerminalStore.getState().panes[0]!.title).toBe('Edited')
    expect(useLayoutStore.getState().preset).toBe('rows')
  })

  it('keeps the processes of the workspace it leaves running in the background', async () => {
    await twoWorkspaces()
    await useTerminalStore.getState().startAllIdle()
    const leaving = useTerminalStore.getState().panes[0]!.id
    await switchWorkspace(ID_B)
    expect(api.terminal.kill).not.toHaveBeenCalledWith(leaving)
    expect(fakeRegistry.remove).not.toHaveBeenCalledWith(leaving)
    expect(useTerminalStore.getState().parked[ID_A]?.panes.map((pane) => pane.id)).toEqual([leaving])
  })

  it('does nothing when switching to the workspace that is already open or does not exist', async () => {
    await twoWorkspaces()
    await switchWorkspace(ID_A)
    await switchWorkspace('99999999-9999-4999-8999-999999999999')
    expect(useWorkspaceStore.getState().activeId).toBe(ID_A)
    expect(useTerminalStore.getState().panes).toHaveLength(1)
  })

  it('saves the switch: the new active id and both workspaces', async () => {
    await twoWorkspaces()
    await switchWorkspace(ID_B)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    const saved = lastSaved()
    expect(saved.activeWorkspaceId).toBe(ID_B)
    expect(saved.workspaces.map((item) => item.name)).toEqual(['Shop', 'Blog'])
    expect(saved.workspaces[0]!.panes).toHaveLength(1)
    expect(saved.workspaces[1]!.panes).toHaveLength(2)
  })

  it('creates a new empty workspace and switches to it, keeping the old one safe', async () => {
    await twoWorkspaces()
    await createWorkspace('  Fresh  ')
    const { workspaces, activeId } = useWorkspaceStore.getState()
    expect(workspaces.map((item) => item.name)).toEqual(['Shop', 'Blog', 'Fresh'])
    expect(workspaces.find((item) => item.id === activeId)!.name).toBe('Fresh')
    expect(useTerminalStore.getState().panes).toEqual([])
    expect(useProjectStore.getState().projectPath).toBeNull()
    expect(workspaces[0]!.panes).toHaveLength(1)
  })

  it('renames a workspace, trimming it, and refuses an empty name', async () => {
    await twoWorkspaces()
    renameWorkspace(ID_B, '  Journal  ')
    renameWorkspace(ID_A, '   ')
    expect(useWorkspaceStore.getState().workspaces.map((item) => item.name)).toEqual(['Shop', 'Journal'])
  })

  it('deletes the open workspace and moves to the next one', async () => {
    await twoWorkspaces()
    await deleteWorkspace(ID_A)
    expect(useWorkspaceStore.getState().workspaces.map((item) => item.id)).toEqual([ID_B])
    expect(useWorkspaceStore.getState().activeId).toBe(ID_B)
    expect(useTerminalStore.getState().panes).toHaveLength(2)
  })

  it('deletes the last workspace in the list and moves to the previous one', async () => {
    await twoWorkspaces()
    await switchWorkspace(ID_B)
    await deleteWorkspace(ID_B)
    expect(useWorkspaceStore.getState().activeId).toBe(ID_A)
  })

  it('deletes a workspace that is not open without touching the open one', async () => {
    await twoWorkspaces()
    await deleteWorkspace(ID_B)
    expect(useWorkspaceStore.getState().activeId).toBe(ID_A)
    expect(useTerminalStore.getState().panes).toHaveLength(1)
    expect(api.terminal.kill).not.toHaveBeenCalled()
  })

  it('creates a fresh default workspace when the last one is deleted', async () => {
    api.settings.load.mockResolvedValue(
      loaded({ activeWorkspaceId: ID_A, workspaces: [workspace(ID_A, 'Only', { panes: [shellPane] })] })
    )
    await restoreSession()
    await deleteWorkspace(ID_A)
    const { workspaces, activeId } = useWorkspaceStore.getState()
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0]!.id).not.toBe(ID_A)
    expect(workspaces[0]!.name).toBe('Əsas')
    expect(activeId).toBe(workspaces[0]!.id)
    expect(useTerminalStore.getState().panes).toEqual([])
  })
})
