import {
  AppStateSchema,
  defaultAppState,
  type AppState,
  type LoadedSettings,
  type Preferences,
  type SettingsNotice
} from '@shared/settings'
import { strings } from '../strings'
import { isPersistencePaused, onPersistenceResumed, withPersistencePaused } from './persistence-gate'
import { useLayoutStore } from './layout-store'
import { useProjectStore } from './project-store'
import { useSessionsStore } from './sessions-store'
import { useTerminalStore } from './terminal-store'
import { useUiStore } from './ui-store'
import { applyWorkspace, captureLive } from './workspace-actions'
import { emptyWorkspace, useWorkspaceStore } from './workspace-store'

export const SAVE_DELAY_MS = 300
const NARROW_QUERY = '(max-width: 900px)'

let restoring: Promise<void> | null = null
let started = false
let stopListening: Array<() => void> = []
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastSent = ''

export function collectAppState(): AppState {
  const { workspaces, activeId } = useWorkspaceStore.getState()
  const live = captureLive()
  const ui = useUiStore.getState()
  return {
    activeWorkspaceId: activeId,
    workspaces: workspaces.map((item) => (item.id === activeId ? { ...item, ...live } : item)),
    recentProjects: useProjectStore.getState().recentPaths,
    preferences: {
      sidebarOpen: ui.sidebarOpen,
      sidebarTab: ui.sidebarTab,
      sessionsTabOpen: ui.sessionsTabOpen,
      sessionsShowAll: useSessionsStore.getState().showAll
    }
  }
}

export function saveNow(): void {
  if (!useWorkspaceStore.getState().ready || isPersistencePaused()) return
  const checked = AppStateSchema.safeParse(collectAppState())
  if (!checked.success) {
    console.warn('Settings were not saved because the state is invalid', checked.error.issues)
    return
  }
  const serialized = JSON.stringify(checked.data)
  if (serialized === lastSent) return
  lastSent = serialized
  window.agentgrid.settings.save(checked.data)
}

export function scheduleSave(): void {
  if (!useWorkspaceStore.getState().ready || isPersistencePaused()) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS)
}

function noticeMessage(notice: SettingsNotice): string {
  const file = notice.backupFile ?? ''
  switch (notice.kind) {
    case 'reset-corrupt':
      return strings.notices.reset(file)
    case 'recovered-from-backup':
      return strings.notices.recovered(file)
    case 'newer-version':
      return strings.notices.newer(file)
    case 'dropped-workspaces':
      return strings.notices.dropped(notice.count ?? 0)
  }
}

function applyPreferences(preferences: Preferences): void {
  const narrow = window.matchMedia(NARROW_QUERY).matches
  useUiStore.setState({
    sidebarOpen: narrow ? false : preferences.sidebarOpen,
    sidebarTab: preferences.sessionsTabOpen ? preferences.sidebarTab : 'projects',
    sessionsTabOpen: preferences.sessionsTabOpen
  })
  useSessionsStore.setState({ showAll: preferences.sessionsShowAll })
}

export function startPersistence(): void {
  if (started) return
  started = true
  stopListening = [
    useTerminalStore.subscribe(scheduleSave),
    useLayoutStore.subscribe(scheduleSave),
    useProjectStore.subscribe(scheduleSave),
    useUiStore.subscribe(scheduleSave),
    useSessionsStore.subscribe(scheduleSave),
    useWorkspaceStore.subscribe(scheduleSave),
    onPersistenceResumed(scheduleSave),
    window.agentgrid.settings.onFlushRequest(() => {
      saveNow()
      window.agentgrid.settings.flushDone()
    })
  ]
  window.addEventListener('pagehide', saveNow)
}

async function loadSettingsSafely(): Promise<LoadedSettings> {
  try {
    return await window.agentgrid.settings.load()
  } catch {
    return {
      state: defaultAppState(),
      notices: [{ kind: 'reset-corrupt' }]
    }
  }
}

async function doRestore(): Promise<void> {
  const { state, notices } = await loadSettingsSafely()
  applyPreferences(state.preferences)
  useProjectStore.getState().setRecentPaths(state.recentProjects)

  const workspaces = state.workspaces.length > 0 ? state.workspaces : [emptyWorkspace(strings.workspace.defaultName)]
  const active = workspaces.find((item) => item.id === state.activeWorkspaceId) ?? workspaces[0]!
  useWorkspaceStore.getState().setWorkspaces(workspaces, active.id)
  await withPersistencePaused(() => applyWorkspace(active))
  useWorkspaceStore.getState().setReady(true)

  for (const notice of notices) useUiStore.getState().pushToast('warning', noticeMessage(notice))
  startPersistence()
  scheduleSave()
}

export function restoreSession(): Promise<void> {
  restoring ??= doRestore()
  return restoring
}

export function resetPersistenceForTests(): void {
  for (const stop of stopListening) stop()
  stopListening = []
  window.removeEventListener('pagehide', saveNow)
  started = false
  restoring = null
  lastSent = ''
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
}
