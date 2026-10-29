import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AppRoot } from '../../src/renderer/src/AppRoot'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { useLayoutStore } from '../../src/renderer/src/state/layout-store'
import { resetPersistenceForTests, SAVE_DELAY_MS } from '../../src/renderer/src/state/persistence'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useSessionsStore } from '../../src/renderer/src/state/sessions-store'
import { useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import { deleteWorkspace } from '../../src/renderer/src/state/workspace-actions'
import { useWorkspaceStore } from '../../src/renderer/src/state/workspace-store'
import {
  defaultAppState,
  type AppState,
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
  fontSize: 13
}
const resumedPane: SavedPane = { ...claudePane, title: 'Claude · Fix login', resumeSessionId: SESSION }
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
    projectPath: 'C:\\work\\shop',
    layout: { preset: 'auto', columnSizes: [], rowSizes: [], focusMode: false },
    panes: [],
    activePane: null,
    autoStart: false,
    ...overrides
  }
}

let api: AgentGridMock

function givenSaved(state: Partial<AppState>): void {
  api.settings.load.mockResolvedValue({ state: { ...defaultAppState(), ...state }, notices: [] })
}

async function openApp(): Promise<void> {
  render(<AppRoot />)
  await screen.findByRole('button', { name: 'İş sahəsi' })
}

function switcher(): HTMLElement {
  return screen.getByRole('button', { name: 'İş sahəsi' })
}

function chooseFromSwitcher(name: RegExp): void {
  fireEvent.click(switcher())
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

function chooseWorkspace(name: RegExp): void {
  fireEvent.click(switcher())
  fireEvent.click(screen.getByRole('menuitemradio', { name }))
}

beforeEach(() => {
  api = createAgentGridMock()
  window.agentgrid = api
  resetShellsCache()
  resetAppInfoCache()
  resetPersistenceForTests()
  fakeRegistry.reset()
  useTerminalStore.setState({ panes: [], activePaneId: null, parked: {} })
  useLayoutStore.setState({ preset: 'auto', focusMode: false, columnSizes: [], rowSizes: [] })
  useProjectStore.setState({ projectPath: null, recentPaths: [] })
  useSessionsStore.setState({ sessions: [], status: 'idle', showAll: false, query: '' })
  useUiStore.setState({
    sidebarOpen: true,
    sidebarTab: 'projects',
    sessionsTabOpen: false,
    toasts: [],
    pendingCloseId: null,
    dialog: null
  })
  useWorkspaceStore.setState({ ready: false, workspaces: [], activeId: null })
})

afterEach(() => {
  resetPersistenceForTests()
})

describe('starting the app', () => {
  it('shows nothing but the dark background until the saved state is back, then the app', async () => {
    let release: (value: unknown) => void = () => undefined
    api.settings.load.mockReturnValue(new Promise((resolve) => (release = resolve)))
    render(<AppRoot />)
    expect(screen.getByRole('status', { name: 'Yüklənir…' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'İş sahəsi' })).toBeNull()
    release({ state: defaultAppState(), notices: [] })
    expect(await screen.findByRole('button', { name: 'İş sahəsi' })).toBeTruthy()
  })

  it('opens with a default workspace on the first launch', async () => {
    await openApp()
    expect(within(switcher()).getByText('Əsas')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /hələ terminal yoxdur/i })).toBeTruthy()
  })

  it('shows the name of the restored workspace', async () => {
    givenSaved({ activeWorkspaceId: ID_B, workspaces: [workspace(ID_A, 'Shop'), workspace(ID_B, 'Blog')] })
    await openApp()
    expect(within(switcher()).getByText('Blog')).toBeTruthy()
  })

  it('warns when the settings file was damaged', async () => {
    api.settings.load.mockResolvedValue({
      state: defaultAppState(),
      notices: [{ kind: 'reset-corrupt', backupFile: 'settings.corrupt-x.json' }]
    })
    await openApp()
    expect(await screen.findByText(/settings\.corrupt-x\.json/)).toBeTruthy()
  })
})

describe('restored terminals are waiting, not running', () => {
  beforeEach(() => {
    givenSaved({
      activeWorkspaceId: ID_A,
      workspaces: [workspace(ID_A, 'Shop', { panes: [claudePane, resumedPane, shellPane], activePane: 0 })]
    })
  })

  it('shows every saved terminal as waiting, and starts nothing', async () => {
    await openApp()
    expect(screen.getAllByRole('group', { name: 'Saxlanmış terminal' })).toHaveLength(3)
    expect(screen.getAllByRole('img', { name: 'Gözləyir' })).toHaveLength(3)
    expect(api.terminal.create).not.toHaveBeenCalled()
  })

  it('explains honestly that processes did not continue', async () => {
    await openApp()
    const banner = screen.getByRole('status', { name: 'Bərpa olunmuş terminallar' })
    expect(banner.textContent).toContain('3 terminal saxlanmış konfiqurasiyadan bərpa olundu')
    expect(banner.textContent).toContain('Proseslər proqram bağlananda dayanıb')
  })

  it('tells which command will run when a waiting Claude terminal is started', async () => {
    await openApp()
    const overlays = screen.getAllByRole('group', { name: 'Saxlanmış terminal' })
    expect(overlays[0]!.textContent).toContain('Başlayanda bu komanda işə düşəcək: claude')
    expect(overlays[1]!.textContent).toContain('claude --resume …')
    expect(overlays[2]!.textContent).not.toContain('komanda işə düşəcək')
  })

  it('starts exactly the terminal whose start button was pressed', async () => {
    await openApp()
    const overlays = screen.getAllByRole('group', { name: 'Saxlanmış terminal' })
    fireEvent.click(within(overlays[1]!).getByRole('button', { name: 'Başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'claude', resumeSessionId: SESSION, cwd: 'C:\\work\\shop' })
    )
    await waitFor(() => expect(screen.getAllByRole('group', { name: 'Saxlanmış terminal' })).toHaveLength(2))
    expect(screen.getByRole('status', { name: 'Bərpa olunmuş terminallar' }).textContent).toContain('2 terminal saxlanmış')
  })

  it('starts all of them with one button, and the banner goes away', async () => {
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: 'Hamısını başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Saxlanmış terminal' })).toBeNull())
    expect(screen.queryByText(/bərpa olundu/)).toBeNull()
  })

  it('can be told to start by itself next time, and that choice is saved', async () => {
    await openApp()
    const toggle = screen.getByRole('button', { name: /Həmişə avtomatik başlat/ })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(useWorkspaceStore.getState().workspaces[0]!.autoStart).toBe(true)
    await waitFor(
      () => {
        const calls = api.settings.save.mock.calls
        expect(calls.length).toBeGreaterThan(0)
        expect((calls[calls.length - 1]![0] as AppState).workspaces[0]!.autoStart).toBe(true)
      },
      { timeout: SAVE_DELAY_MS * 10 }
    )
  })

  it('closes a waiting terminal without asking, because nothing is running', async () => {
    await openApp()
    const pane = screen.getByRole('region', { name: 'Terminal: Command Prompt' })
    fireEvent.click(within(pane).getAllByRole('button', { name: 'Bağla' })[0]!)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(2))
  })

  it('restarts a waiting terminal from the pane menu the same way as the start button', async () => {
    await openApp()
    const pane = screen.getByRole('region', { name: 'Terminal: Command Prompt' })
    fireEvent.click(within(pane).getByRole('button', { name: 'Panel əməliyyatları' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /yenidən başlat/i }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.kill).toHaveBeenCalledTimes(0)
  })
})

describe('the workspace menu', () => {
  it('lists all workspaces with what is in them and marks the open one', async () => {
    givenSaved({
      activeWorkspaceId: ID_A,
      workspaces: [
        workspace(ID_A, 'Shop', { panes: [claudePane, shellPane] }),
        workspace(ID_B, 'Blog', { projectPath: 'C:\\work\\blog', panes: [shellPane] })
      ]
    })
    await openApp()
    fireEvent.click(switcher())
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => item.querySelector('.menu__label')!.textContent)).toEqual(['Shop', 'Blog'])
    expect(items[0]!.getAttribute('aria-checked')).toBe('true')
    expect(items[0]!.textContent).toContain('2 terminal · shop')
    expect(items[1]!.textContent).toContain('1 terminal · blog')
  })

  it('shows what is open right now for the active workspace, not what was saved earlier', async () => {
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(1))
    fireEvent.click(switcher())
    expect(screen.getByRole('menuitemradio', { name: /Əsas/ }).textContent).toContain('1 terminal')
  })
})

describe('creating, renaming and deleting', () => {
  it('creates a workspace from a dialog and switches to it', async () => {
    await openApp()
    chooseFromSwitcher(/yeni iş sahəsi/i)
    const dialog = screen.getByRole('dialog', { name: 'Yeni iş sahəsi' })
    const input = within(dialog).getByLabelText('Ad') as HTMLInputElement
    expect(input.value).toBe('İş sahəsi 2')
    fireEvent.change(input, { target: { value: 'Blog saytı' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yarat' }))
    await waitFor(() => expect(within(switcher()).getByText('Blog saytı')).toBeTruthy())
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('refuses an empty name and keeps the dialog open', async () => {
    await openApp()
    chooseFromSwitcher(/yeni iş sahəsi/i)
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: '   ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yarat' }))
    expect(within(dialog).getByRole('alert').textContent).toBe('Ad boş ola bilməz.')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })

  it('cancels with Escape without creating anything', async () => {
    await openApp()
    chooseFromSwitcher(/yeni iş sahəsi/i)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })

  it('creates the workspace when Enter is pressed in the name field', async () => {
    await openApp()
    chooseFromSwitcher(/yeni iş sahəsi/i)
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'Enter test' } })
    fireEvent.submit(dialog)
    await waitFor(() => expect(within(switcher()).getByText('Enter test')).toBeTruthy())
  })

  it('renames the open workspace, starting from its current name', async () => {
    await openApp()
    chooseFromSwitcher(/adı dəyişdir/i)
    const dialog = screen.getByRole('dialog', { name: 'İş sahəsinin adı' })
    const input = within(dialog).getByLabelText('Ad') as HTMLInputElement
    expect(input.value).toBe('Əsas')
    fireEvent.change(input, { target: { value: 'Mağaza' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(within(switcher()).getByText('Mağaza')).toBeTruthy()
  })

  it('asks before deleting and keeps the workspace when cancelled', async () => {
    givenSaved({ activeWorkspaceId: ID_A, workspaces: [workspace(ID_A, 'Shop'), workspace(ID_B, 'Blog')] })
    await openApp()
    chooseFromSwitcher(/bu iş sahəsini sil/i)
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('"Shop" iş sahəsi və onun saxlanmış terminal düzülüşü silinəcək')
    expect(dialog.textContent).toContain('Layihə qovluğunuza toxunulmayacaq')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ləğv et' }))
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2)
  })

  it('deletes after confirmation and moves to the other workspace', async () => {
    givenSaved({ activeWorkspaceId: ID_A, workspaces: [workspace(ID_A, 'Shop'), workspace(ID_B, 'Blog')] })
    await openApp()
    chooseFromSwitcher(/bu iş sahəsini sil/i)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sil' }))
    await waitFor(() => expect(useWorkspaceStore.getState().workspaces).toHaveLength(1))
    expect(within(switcher()).getByText('Blog')).toBeTruthy()
  })

  it('warns that running terminals will be stopped when deleting the open workspace', async () => {
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.status).toBe('running'))
    chooseFromSwitcher(/bu iş sahəsini sil/i)
    expect(screen.getByRole('alertdialog').textContent).toContain('İçindəki 1 işləyən terminal dayandırılacaq')
  })
})

describe('switching', () => {
  beforeEach(() => {
    givenSaved({
      activeWorkspaceId: ID_A,
      workspaces: [
        workspace(ID_A, 'Shop', { panes: [shellPane] }),
        workspace(ID_B, 'Blog', { projectPath: 'C:\\work\\blog', panes: [claudePane, resumedPane] })
      ]
    })
  })

  it('switches at once when nothing is running', async () => {
    await openApp()
    chooseWorkspace(/Blog/)
    await waitFor(() => expect(within(switcher()).getByText('Blog')).toBeTruthy())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getAllByRole('group', { name: 'Saxlanmış terminal' })).toHaveLength(2)
    expect(screen.getByText('C:\\work\\blog', { selector: '.statusbar__item' })).toBeTruthy()
  })

  async function startFirstWorkspaceTerminal(): Promise<string> {
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: 'Hamısını başlat' }))
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.status).toBe('running'))
    return useTerminalStore.getState().panes[0]!.id
  }

  it('switches without asking and without stopping the running terminals', async () => {
    const running = await startFirstWorkspaceTerminal()
    chooseWorkspace(/Blog/)
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe(ID_B))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.terminal.kill).not.toHaveBeenCalledWith(running)
    expect(useTerminalStore.getState().parked[ID_A]?.panes[0]?.status).toBe('running')
    expect(useTerminalStore.getState().panes.map((pane) => pane.status)).toEqual(['idle', 'idle'])
  })

  it('gives the same running terminal back when returning to the workspace', async () => {
    const running = await startFirstWorkspaceTerminal()
    chooseWorkspace(/Blog/)
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe(ID_B))
    chooseWorkspace(/Shop/)
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe(ID_A))
    const [pane] = useTerminalStore.getState().panes
    expect(pane?.id).toBe(running)
    expect(pane?.status).toBe('running')
    expect(useTerminalStore.getState().parked[ID_B]).toBeUndefined()
    expect(api.terminal.kill).not.toHaveBeenCalledWith(running)
  })

  it('shows how many terminals keep running in the other workspace', async () => {
    await startFirstWorkspaceTerminal()
    chooseWorkspace(/Blog/)
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe(ID_B))
    const list = screen.getByRole('region', { name: 'İş sahələri' })
    expect(within(list).getByRole('button', { name: /Shop/ }).textContent).toContain('1 işləyir')
  })

  it('notices when a terminal in the other workspace exits', async () => {
    const running = await startFirstWorkspaceTerminal()
    chooseWorkspace(/Blog/)
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe(ID_B))
    useTerminalStore.getState().handleExit({ id: running, exitCode: 0 })
    expect(useTerminalStore.getState().parked[ID_A]?.panes[0]?.status).toBe('exited')
  })

  it('does not keep terminals that never started', async () => {
    await openApp()
    chooseWorkspace(/Blog/)
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe(ID_B))
    expect(useTerminalStore.getState().parked).toEqual({})
  })

  it('stops the parked terminals when their workspace is deleted', async () => {
    const running = await startFirstWorkspaceTerminal()
    chooseWorkspace(/Blog/)
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe(ID_B))
    await deleteWorkspace(ID_A)
    expect(api.terminal.kill).toHaveBeenCalledWith(running)
    expect(useTerminalStore.getState().parked).toEqual({})
  })

  it('switches from the sidebar list as well', async () => {
    await openApp()
    const list = screen.getByRole('region', { name: 'İş sahələri' })
    fireEvent.click(within(list).getByRole('button', { name: /Blog/ }))
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe(ID_B))
    expect(within(list).getByRole('button', { name: /Blog/ }).getAttribute('aria-current')).toBe('true')
  })

  it('creates a workspace from the sidebar button', async () => {
    await openApp()
    const list = screen.getByRole('region', { name: 'İş sahələri' })
    fireEvent.click(within(list).getByRole('button', { name: /Yeni iş sahəsi/ }))
    expect(screen.getByRole('dialog', { name: 'Yeni iş sahəsi' })).toBeTruthy()
  })

  it('keeps the open workspace saved while the app is closing', async () => {
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(2))
    api.settings.onFlushRequest.mock.calls[0]![0]()
    const saved = api.settings.save.mock.calls.at(-1)![0] as AppState
    expect(saved.workspaces.find((item) => item.id === ID_A)!.panes).toHaveLength(2)
    expect(api.settings.flushDone).toHaveBeenCalled()
  })
})
