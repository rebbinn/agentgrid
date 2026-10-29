import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from '../../src/renderer/src/App'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { useAgentsStore } from '../../src/renderer/src/state/agents-store'
import { useLayoutStore } from '../../src/renderer/src/state/layout-store'
import { usePrefsStore } from '../../src/renderer/src/state/prefs-store'
import { usePresetsStore } from '../../src/renderer/src/state/presets-store'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useSessionsStore } from '../../src/renderer/src/state/sessions-store'
import { useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import { useWorkspaceStore } from '../../src/renderer/src/state/workspace-store'
import type { ClaudeSession } from '../../src/shared/ipc'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

const WS_A = '11111111-1111-4111-8111-111111111111'
const WS_B = '22222222-2222-4222-8222-222222222222'
const PRESET = '44444444-4444-4444-8444-444444444444'
const SESSION: ClaudeSession = {
  id: '3975237b-df03-44fe-b8e1-be208c6646d1',
  title: 'Fix the login bug',
  cwd: 'C:\\work\\shop',
  modifiedAt: Date.now()
}

let api: AgentGridMock

function workspace(id: string, name: string) {
  return {
    id,
    name,
    projectPath: null,
    layout: { preset: 'auto' as const, columnSizes: [], rowSizes: [], focusMode: false },
    panes: [],
    activePane: null,
    autoStart: false
  }
}

beforeEach(() => {
  api = createAgentGridMock()
  api.sessions.list.mockResolvedValue([SESSION])
  window.agentgrid = api
  resetShellsCache()
  resetAppInfoCache()
  fakeRegistry.reset()
  useProjectStore.setState({ projectPath: 'C:\\work\\shop', recentPaths: ['C:\\work\\shop'] })
  useUiStore.setState({
    sidebarOpen: true,
    sidebarTab: 'projects',
    sessionsTabOpen: false,
    toasts: [],
    pendingCloseId: null,
    dialog: null,
    paletteOpen: false,
    sendPanelOpen: false,
    sendDraft: '',
    renameRequestId: null
  })
  useTerminalStore.setState({ panes: [], activePaneId: null })
  useLayoutStore.setState({ preset: 'auto', focusMode: false, columnSizes: [], rowSizes: [] })
  useSessionsStore.setState({ sessions: [], status: 'idle', showAll: false, query: '' })
  usePresetsStore.setState({ presets: [] })
  usePrefsStore.setState({ defaultFontSize: 13, defaultShellId: null })
  useAgentsStore.setState({ status: null })
  useWorkspaceStore.setState({ ready: true, workspaces: [workspace(WS_A, 'Shop'), workspace(WS_B, 'Blog')], activeId: WS_A })
})

function keys(code: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { code, key: code, ctrlKey: true, ...init })
}

async function openPanes(count: number): Promise<void> {
  render(<App />)
  for (let index = 0; index < count; index++) {
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(index + 1))
  }
  await waitFor(() =>
    expect(useTerminalStore.getState().panes.every((pane) => pane.status === 'running')).toBe(true)
  )
}

async function openPalette(): Promise<HTMLInputElement> {
  keys('KeyK')
  return (await screen.findByRole('combobox', { name: 'Əmr paleti' })) as HTMLInputElement
}

function options(): string[] {
  return screen.queryAllByRole('option').map((option) => option.querySelector('.palette__title')!.textContent!)
}

describe('opening and closing the command palette', () => {
  it('opens with Ctrl+K and puts the cursor in the search box', async () => {
    render(<App />)
    const input = await openPalette()
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('dialog', { name: 'Əmr paleti' })).toBeTruthy()
  })

  it('closes with Escape, with Ctrl+K again, and by clicking outside', async () => {
    render(<App />)
    const input = await openPalette()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Əmr paleti' })).toBeNull()
    await openPalette()
    keys('KeyK')
    expect(screen.queryByRole('dialog', { name: 'Əmr paleti' })).toBeNull()
    await openPalette()
    fireEvent.mouseDown(document.querySelector('.palette-backdrop')!)
    expect(screen.queryByRole('dialog', { name: 'Əmr paleti' })).toBeNull()
  })

  it('opens from the header button too, which also tells the shortcut', async () => {
    render(<App />)
    const button = screen.getByRole('button', { name: 'Əmrlər' })
    expect(button.textContent).toContain('Ctrl+K')
    expect(button.getAttribute('data-tip')).toBe('Əmr paleti (Ctrl+K)')
    fireEvent.click(button)
    expect(await screen.findByRole('dialog', { name: 'Əmr paleti' })).toBeTruthy()
  })

  it('starts empty every time it is opened', async () => {
    render(<App />)
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'claude' } })
    keys('KeyK')
    const again = await openPalette()
    expect(again.value).toBe('')
  })
})

describe('what the palette offers', () => {
  it('lists the everyday actions with their shortcuts', async () => {
    render(<App />)
    await openPalette()
    const titles = options()
    expect(titles).toContain('Yeni terminal')
    expect(titles).toContain('Claude başlat')
    expect(titles.some((title) => title.startsWith('Codex başlat'))).toBe(true)
    expect(titles.some((title) => title.startsWith('Gemini CLI başlat'))).toBe(true)
    expect(titles).toContain('Ayarları aç')
    expect(titles).toContain('Düzülüş: 2 × 2')
    expect(titles).toContain('Yeni iş sahəsi…')
    expect(titles).toContain('Yan paneli göstər / gizlət')
    const row = screen.getAllByRole('option').find((item) => item.textContent?.includes('Yeni terminal'))!
    expect(row.querySelector('kbd')!.textContent).toBe('Ctrl+Shift+T')
  })

  it('hides terminal actions until there is a terminal to act on', async () => {
    render(<App />)
    await openPalette()
    expect(options()).not.toContain('Aktiv terminalı bağla')
    expect(options()).not.toContain('Komandanı terminala göndər…')
  })

  it('offers actions for the active terminal once one is open', async () => {
    await openPanes(1)
    await openPalette()
    expect(options()).toEqual(
      expect.arrayContaining([
        'Aktiv terminalı bağla',
        'Aktiv terminalı yenidən başlat',
        'Aktiv terminalın ekranını təmizlə',
        'Aktiv terminalın adını dəyiş',
        'Aktiv terminalı böyüt (fokus rejimi)',
        'Komandanı terminala göndər…',
        'Terminala keç: Claude'
      ])
    )
  })

  it('switches the maximize action to restore while in focus mode', async () => {
    await openPanes(1)
    act(() => useLayoutStore.getState().setFocusMode(true))
    await openPalette()
    expect(options()).toContain('Fokus rejimindən çıx')
    expect(options()).not.toContain('Aktiv terminalı böyüt (fokus rejimi)')
  })

  it('says when Codex or Gemini are not installed, but still lets you try', async () => {
    api.agents.status.mockResolvedValue({ claude: true, codex: false, gemini: false })
    render(<App />)
    await openPalette()
    await waitFor(() => expect(options()).toContain('Codex başlat (tapılmadı)'))
    expect(options()).toContain('Claude başlat')
  })

  it('lists other workspaces to switch to, but not the open one', async () => {
    render(<App />)
    await openPalette()
    expect(options()).toContain('İş sahəsinə keç: Blog')
    expect(options()).not.toContain('İş sahəsinə keç: Shop')
  })

  it('offers each shell separately when the computer has several', async () => {
    render(<App />)
    await openPalette()
    await waitFor(() => expect(options()).toContain('Yeni terminal: Windows PowerShell'))
    expect(options()).toContain('Yeni terminal: Command Prompt')
  })

  it('lists the saved command presets', async () => {
    usePresetsStore.setState({
      presets: [{ id: PRESET, name: 'Dev server', kind: 'command', command: 'npm run dev', shellId: null, cwd: null }]
    })
    render(<App />)
    await openPalette()
    expect(options()).toContain('Şablon: Dev server')
  })

  it('lists recent Claude chats, loaded when the palette opens', async () => {
    render(<App />)
    await openPalette()
    await waitFor(() => expect(options()).toContain('Söhbəti aç: Fix the login bug'))
    expect(api.sessions.list).toHaveBeenCalled()
  })

  it('shows at most twenty chats so the list stays usable', async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      ...SESSION,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Chat ${index}`
    }))
    api.sessions.list.mockResolvedValue(many)
    render(<App />)
    await openPalette()
    await waitFor(() => expect(options().filter((title) => title.startsWith('Söhbəti aç'))).toHaveLength(20))
  })
})

describe('searching and choosing', () => {
  it('filters as you type and says so when nothing matches', async () => {
    render(<App />)
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'claude' } })
    expect(options()[0]).toBe('Claude başlat')
    fireEvent.change(input, { target: { value: 'zzzqqq' } })
    expect(screen.getByText('Uyğun əmr tapılmadı.')).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('runs the highlighted command with Enter and closes', async () => {
    render(<App />)
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'claude' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('dialog', { name: 'Əmr paleti' })).toBeNull()
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ agentId: 'claude', cwd: 'C:\\work\\shop' })
  })

  it('moves the highlight with the arrow keys, wrapping around', async () => {
    render(<App />)
    const input = await openPalette()
    const selected = (): string => screen.getAllByRole('option').find((item) => item.getAttribute('aria-selected') === 'true')!.querySelector('.palette__title')!.textContent!
    const first = selected()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(selected()).not.toBe(first)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(selected()).toBe(first)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(selected()).toBe(options()[options().length - 1])
    fireEvent.keyDown(input, { key: 'Home' })
    expect(selected()).toBe(first)
    fireEvent.keyDown(input, { key: 'End' })
    expect(selected()).toBe(options()[options().length - 1])
  })

  it('tells assistive technology which option is active', async () => {
    render(<App />)
    const input = await openPalette()
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-option-0')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-option-1')
    expect(screen.getByRole('listbox', { name: 'Əmrlər' })).toBeTruthy()
  })

  it('runs a command that is clicked', async () => {
    render(<App />)
    await openPalette()
    fireEvent.click(screen.getAllByRole('option').find((item) => item.textContent?.includes('Yeni terminal'))!)
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0].agentId).toBeUndefined()
  })

  it('does nothing on Enter when nothing matches', async () => {
    render(<App />)
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'zzzqqq' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'Əmr paleti' })).toBeTruthy()
    expect(api.terminal.create).not.toHaveBeenCalled()
  })

  it('sends the keyboard back to the active terminal after a command that opens nothing', async () => {
    await openPanes(1)
    const managed = fakeRegistry.get(useTerminalStore.getState().panes[0]!.id)!
    const input = await openPalette()
    managed.focus.mockClear()
    fireEvent.change(input, { target: { value: 'ekranını təmizlə' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(managed.clear).toHaveBeenCalled()
    await waitFor(() => expect(managed.focus).toHaveBeenCalled())
  })
})

describe('commands from the palette really do their job', () => {
  async function run(query: string): Promise<void> {
    const input = await openPalette()
    fireEvent.change(input, { target: { value: query } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }

  it('switches the layout', async () => {
    render(<App />)
    await run('düzülüş 2 × 2')
    expect(useLayoutStore.getState().preset).toBe('grid-2x2')
  })

  it('switches the workspace', async () => {
    render(<App />)
    await run('keç Blog')
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe(WS_B))
  })

  it('opens the new-workspace dialog', async () => {
    render(<App />)
    await run('yeni iş sahəsi')
    expect(await screen.findByRole('dialog', { name: 'Yeni iş sahəsi' })).toBeTruthy()
  })

  it('opens the settings', async () => {
    render(<App />)
    await run('ayarları aç')
    expect(await screen.findByRole('dialog', { name: 'Ayarlar' })).toBeTruthy()
  })

  it('opens the "start with choices" dialog', async () => {
    render(<App />)
    await run('seçimlə')
    expect(await screen.findByRole('dialog', { name: 'Seçimlə başlat' })).toBeTruthy()
  })

  it('opens the new-preset dialog', async () => {
    render(<App />)
    await run('yeni şablon')
    expect(await screen.findByRole('dialog', { name: 'Yeni şablon' })).toBeTruthy()
  })

  it('jumps to a chosen terminal', async () => {
    await openPanes(2)
    expect(useTerminalStore.getState().activePaneId).toBe(useTerminalStore.getState().panes[1]!.id)
    await run('terminala keç: Claude')
    await waitFor(() => expect(useTerminalStore.getState().activePaneId).toBe(useTerminalStore.getState().panes[0]!.id))
  })

  it('asks before closing a running terminal', async () => {
    await openPanes(1)
    await run('aktiv terminalı bağla')
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(api.terminal.kill).not.toHaveBeenCalled()
  })

  it('starts renaming the active terminal', async () => {
    await openPanes(1)
    await run('adını dəyiş')
    expect(await screen.findByRole('textbox', { name: 'Terminalın adı' })).toBeTruthy()
  })

  it('maximizes the active terminal', async () => {
    await openPanes(2)
    await run('böyüt')
    expect(useLayoutStore.getState().focusMode).toBe(true)
  })

  it('opens the send panel', async () => {
    await openPanes(1)
    await run('komandanı terminala göndər')
    expect(await screen.findByRole('region', { name: 'Komandanı terminala göndər' })).toBeTruthy()
  })

  it('opens a saved preset as a new terminal that types its command', async () => {
    usePresetsStore.setState({
      presets: [{ id: PRESET, name: 'Dev server', kind: 'command', command: 'npm run dev', shellId: null, cwd: 'C:\\work\\blog' }]
    })
    render(<App />)
    await run('dev server')
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({
      startupCommand: 'npm run dev',
      cwd: 'C:\\work\\blog'
    })
    expect(useTerminalStore.getState().panes[0]!.title).toBe('Dev server')
  })

  it('resumes a chat', async () => {
    render(<App />)
    const input = await openPalette()
    await waitFor(() => expect(options()).toContain('Söhbəti aç: Fix the login bug'))
    fireEvent.change(input, { target: { value: 'login' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ resumeSessionId: SESSION.id, agentId: 'claude' })
  })

  it('hides and shows the sidebar', async () => {
    render(<App />)
    await run('yan paneli')
    expect(screen.getByLabelText('Layihələr').hasAttribute('hidden')).toBe(true)
  })
})

describe('keyboard shortcuts', () => {
  it('Ctrl+Shift+T opens a terminal', async () => {
    render(<App />)
    keys('KeyT', { shiftKey: true })
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
  })

  it('Ctrl+Shift+L opens Claude', async () => {
    render(<App />)
    keys('KeyL', { shiftKey: true })
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0].agentId).toBe('claude')
  })

  it('Ctrl+Shift+W asks before closing a running terminal', async () => {
    await openPanes(1)
    keys('KeyW', { shiftKey: true })
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })

  it('Ctrl+Shift+W closes an exited terminal at once', async () => {
    await openPanes(1)
    act(() => useTerminalStore.getState().handleExit({ id: useTerminalStore.getState().panes[0]!.id, exitCode: 0 }))
    keys('KeyW', { shiftKey: true })
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(0))
  })

  it('Ctrl+Shift+M toggles focus mode', async () => {
    await openPanes(2)
    keys('KeyM', { shiftKey: true })
    expect(useLayoutStore.getState().focusMode).toBe(true)
    keys('KeyM', { shiftKey: true })
    expect(useLayoutStore.getState().focusMode).toBe(false)
  })

  it('Ctrl+Shift+B hides and shows the sidebar', () => {
    render(<App />)
    keys('KeyB', { shiftKey: true })
    expect(useUiStore.getState().sidebarOpen).toBe(false)
    keys('KeyB', { shiftKey: true })
    expect(useUiStore.getState().sidebarOpen).toBe(true)
  })

  it('Ctrl+Shift+H opens and closes the chats tab', async () => {
    render(<App />)
    keys('KeyH', { shiftKey: true })
    expect(await screen.findByRole('tab', { name: 'Söhbətlər' })).toBeTruthy()
    keys('KeyH', { shiftKey: true })
    expect(screen.queryByRole('tab', { name: 'Söhbətlər' })).toBeNull()
  })

  it('Ctrl+, opens the settings', async () => {
    render(<App />)
    keys('Comma')
    expect(await screen.findByRole('dialog', { name: 'Ayarlar' })).toBeTruthy()
  })

  it('Ctrl+1…9 jumps to that terminal, and quietly ignores numbers without a terminal', async () => {
    await openPanes(3)
    keys('Digit1')
    expect(useTerminalStore.getState().activePaneId).toBe(useTerminalStore.getState().panes[0]!.id)
    keys('Digit2')
    expect(useTerminalStore.getState().activePaneId).toBe(useTerminalStore.getState().panes[1]!.id)
    keys('Digit9')
    expect(useTerminalStore.getState().activePaneId).toBe(useTerminalStore.getState().panes[1]!.id)
  })

  it('Ctrl+PageDown and Ctrl+PageUp cycle through the terminals', async () => {
    await openPanes(3)
    const ids = useTerminalStore.getState().panes.map((pane) => pane.id)
    expect(useTerminalStore.getState().activePaneId).toBe(ids[2])
    keys('PageDown')
    expect(useTerminalStore.getState().activePaneId).toBe(ids[0])
    keys('PageUp')
    expect(useTerminalStore.getState().activePaneId).toBe(ids[2])
    keys('PageUp')
    expect(useTerminalStore.getState().activePaneId).toBe(ids[1])
  })

  it('Ctrl+Shift+S opens the send panel, or explains that there is nothing to send to', async () => {
    render(<App />)
    keys('KeyS', { shiftKey: true })
    expect(await screen.findByText('Əvvəlcə bir terminal açın.')).toBeTruthy()
    expect(useUiStore.getState().sendPanelOpen).toBe(false)
  })

  it('stops the browser from also acting on the key', () => {
    render(<App />)
    const event = new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not touch the keys a terminal needs', async () => {
    await openPanes(1)
    for (const code of ['KeyC', 'KeyD', 'KeyZ', 'KeyL', 'KeyR', 'KeyA', 'KeyE', 'KeyU', 'KeyW']) {
      const event = new KeyboardEvent('keydown', { code, ctrlKey: true, bubbles: true, cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(useUiStore.getState().paletteOpen).toBe(false)
    expect(useTerminalStore.getState().panes).toHaveLength(1)
  })

  it('ignores held-down keys so a shortcut cannot fire again and again', async () => {
    render(<App />)
    keys('KeyT', { shiftKey: true })
    keys('KeyT', { shiftKey: true, repeat: true })
    keys('KeyT', { shiftKey: true, repeat: true })
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
  })

  it('does not act behind an open dialog', async () => {
    render(<App />)
    keys('Comma')
    await screen.findByRole('dialog', { name: 'Ayarlar' })
    keys('KeyT', { shiftKey: true })
    keys('KeyK')
    expect(api.terminal.create).not.toHaveBeenCalled()
    expect(useUiStore.getState().paletteOpen).toBe(false)
  })

  it('does not run other shortcuts while the palette is open, but Ctrl+K still closes it', async () => {
    render(<App />)
    await openPalette()
    keys('KeyT', { shiftKey: true })
    expect(api.terminal.create).not.toHaveBeenCalled()
    keys('KeyK')
    expect(useUiStore.getState().paletteOpen).toBe(false)
  })

  it('works while typing in a text box inside the app', async () => {
    render(<App />)
    keys('KeyH', { shiftKey: true })
    const search = await screen.findByRole('searchbox')
    search.focus()
    fireEvent.keyDown(search, { code: 'KeyK', key: 'k', ctrlKey: true })
    expect(useUiStore.getState().paletteOpen).toBe(true)
    expect(within(document.body).queryByRole('dialog', { name: 'Əmr paleti' })).toBeTruthy()
  })
})

describe('shortcuts are shown where the actions are', () => {
  it('in the tooltips of the side buttons and the new-terminal button', async () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }).getAttribute('data-tip')).toBe(
      'Claude — yeni CMD-də işə sal (Ctrl+Shift+L)'
    )
    expect(screen.getByRole('button', { name: 'Claude söhbətləri' }).getAttribute('data-tip')).toContain('Ctrl+Shift+H')
    expect(screen.getByRole('button', { name: 'Ayarlar' }).getAttribute('data-tip')).toContain('Ctrl+,')
    expect(screen.getByRole('button', { name: 'Yeni terminal' }).getAttribute('data-tip')).toContain('Ctrl+Shift+T')
  })

  it('in the maximize and close buttons of a pane', async () => {
    await openPanes(1)
    const pane = screen.getByRole('region', { name: 'Terminal: Claude' })
    expect(within(pane).getByRole('button', { name: 'Böyüt' }).getAttribute('data-tip')).toBe('Böyüt (Ctrl+Shift+M)')
    expect(within(pane).getAllByRole('button', { name: 'Bağla' })[0]!.getAttribute('data-tip')).toBe('Bağla (Ctrl+Shift+W)')
  })
})
