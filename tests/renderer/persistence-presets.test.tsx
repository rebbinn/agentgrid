import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { AppRoot } from '../../src/renderer/src/AppRoot'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { useLayoutStore } from '../../src/renderer/src/state/layout-store'
import {
  SAVE_DELAY_MS,
  resetPersistenceForTests,
  restoreSession
} from '../../src/renderer/src/state/persistence'
import { usePrefsStore } from '../../src/renderer/src/state/prefs-store'
import { usePresetsStore } from '../../src/renderer/src/state/presets-store'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useSessionsStore } from '../../src/renderer/src/state/sessions-store'
import { capturePanes, useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import { useWorkspaceStore } from '../../src/renderer/src/state/workspace-store'
import { defaultAppState, type AppState, type Preset, type Workspace } from '../../src/shared/settings'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

const WS = '11111111-1111-4111-8111-111111111111'
const PRESET = '44444444-4444-4444-8444-444444444444'

const devPreset: Preset = {
  id: PRESET,
  name: 'Dev server',
  kind: 'command',
  command: 'npm run dev',
  shellId: 'powershell',
  cwd: 'C:\\work\\blog'
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: WS,
    name: 'Shop',
    projectPath: 'C:\\work\\shop',
    layout: { preset: 'auto', columnSizes: [], rowSizes: [], focusMode: false },
    panes: [],
    activePane: null,
    autoStart: false,
    ...overrides
  }
}

let api: AgentGridMock

function lastSaved(): AppState {
  return api.settings.save.mock.calls.at(-1)![0] as AppState
}

function givenSaved(state: Partial<AppState>): void {
  api.settings.load.mockResolvedValue({ state: { ...defaultAppState(), ...state }, notices: [] })
}

beforeEach(() => {
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
  usePresetsStore.setState({ presets: [] })
  usePrefsStore.setState({ defaultFontSize: 13, defaultShellId: null })
  useUiStore.setState({ sidebarOpen: true, sidebarTab: 'projects', sessionsTabOpen: false, toasts: [], dialog: null })
  useWorkspaceStore.setState({ ready: false, workspaces: [], activeId: null })
})

afterEach(() => {
  resetPersistenceForTests()
  vi.useRealTimers()
})

describe('presets and preferences survive a restart', () => {
  it('bring back the saved presets, default font size and default shell', async () => {
    givenSaved({
      presets: [devPreset],
      preferences: { ...defaultAppState().preferences, defaultFontSize: 17, defaultShellId: 'powershell' }
    })
    await restoreSession()
    expect(usePresetsStore.getState().presets).toEqual([devPreset])
    expect(usePrefsStore.getState()).toMatchObject({ defaultFontSize: 17, defaultShellId: 'powershell' })
  })

  it('give new terminals the restored font size from the first launch on', async () => {
    givenSaved({ preferences: { ...defaultAppState().preferences, defaultFontSize: 18 } })
    await restoreSession()
    await useTerminalStore.getState().launch({ cwd: 'C:\\work' })
    expect(useTerminalStore.getState().panes[0]!.fontSize).toBe(18)
  })

  it('are saved shortly after they change', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    givenSaved({ activeWorkspaceId: WS, workspaces: [workspace()] })
    await restoreSession()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    api.settings.save.mockClear()

    usePresetsStore.getState().savePreset(devPreset)
    usePrefsStore.getState().setDefaultFontSize(15)
    usePrefsStore.getState().setDefaultShellId('powershell')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)

    expect(api.settings.save).toHaveBeenCalledTimes(1)
    expect(lastSaved().presets).toEqual([devPreset])
    expect(lastSaved().preferences).toMatchObject({ defaultFontSize: 15, defaultShellId: 'powershell' })
  })

  it('are saved when a preset is deleted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    givenSaved({ activeWorkspaceId: WS, workspaces: [workspace()], presets: [devPreset] })
    await restoreSession()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    api.settings.save.mockClear()
    usePresetsStore.getState().removePreset(PRESET)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(lastSaved().presets).toEqual([])
  })
})

describe('terminals started from a command remember it', () => {
  it('stores the command and its kind in the saved workspace, next to the other settings', async () => {
    givenSaved({ activeWorkspaceId: WS, workspaces: [workspace()] })
    await restoreSession()
    await useTerminalStore.getState().launch({
      cwd: 'C:\\work\\blog',
      startupCommand: 'aider --yes',
      commandKind: 'agent',
      title: 'Aider'
    })
    expect(capturePanes().panes[0]).toEqual({
      title: 'Aider',
      shellId: 'cmd',
      shellLabel: 'Command Prompt',
      cwd: 'C:\\work\\blog',
      fontSize: 13,
      startupCommand: 'aider --yes',
      commandKind: 'agent'
    })
  })

  it('leaves the command out for ordinary terminals and built-in agents', async () => {
    givenSaved({ activeWorkspaceId: WS, workspaces: [workspace()] })
    await restoreSession()
    await useTerminalStore.getState().launch({ cwd: 'C:\\work' })
    await useTerminalStore.getState().launch({ cwd: 'C:\\work', agentId: 'claude' })
    const [plain, claude] = capturePanes().panes
    expect(plain).not.toHaveProperty('startupCommand')
    expect(claude).not.toHaveProperty('startupCommand')
    expect(claude).toHaveProperty('agentId', 'claude')
  })

  it('come back waiting, with the command that would run, and start it again only on request', async () => {
    givenSaved({
      activeWorkspaceId: WS,
      workspaces: [
        workspace({
          panes: [
            {
              title: 'Dev server',
              shellId: 'cmd',
              shellLabel: 'Command Prompt',
              cwd: 'C:\\work\\blog',
              fontSize: 13,
              startupCommand: 'npm run dev',
              commandKind: 'command'
            }
          ]
        })
      ]
    })
    render(<AppRoot />)
    const overlay = await screen.findByRole('group', { name: 'Saxlanmış terminal' })
    expect(overlay.textContent).toContain('Başlayanda bu komanda işə düşəcək: npm run dev')
    expect(api.terminal.create).not.toHaveBeenCalled()
    expect(api.terminal.write).not.toHaveBeenCalled()

    within(overlay).getByRole('button', { name: 'Başlat' }).click()
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({
      startupCommand: 'npm run dev',
      cwd: 'C:\\work\\blog'
    })
  })

  it('remember that an agent-style command must be checked for installation when started again', async () => {
    givenSaved({
      activeWorkspaceId: WS,
      workspaces: [
        workspace({
          panes: [
            {
              title: 'Aider',
              shellId: 'cmd',
              shellLabel: 'Command Prompt',
              cwd: 'C:\\work',
              fontSize: 13,
              startupCommand: 'aider',
              commandKind: 'agent'
            }
          ],
          autoStart: true
        })
      ]
    })
    await restoreSession()
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ startupCommand: 'aider', requireInstalled: true })
  })
})
