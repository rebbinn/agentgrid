import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from '../../src/renderer/src/App'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { useLayoutStore } from '../../src/renderer/src/state/layout-store'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useSessionsStore } from '../../src/renderer/src/state/sessions-store'
import { useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import type { ClaudeSession } from '../../src/shared/ipc'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

const ID_SHOP = '11111111-1111-4111-8111-111111111111'
const ID_SHOP_2 = '22222222-2222-4222-8222-222222222222'
const ID_BLOG = '33333333-3333-4333-8333-333333333333'
const ID_HOME = '44444444-4444-4444-8444-444444444444'

const NOW = Date.now()
const SESSIONS: ClaudeSession[] = [
  { id: ID_SHOP, title: 'Fix the login bug', cwd: 'C:\\work\\shop', modifiedAt: NOW - 5 * 60_000 },
  { id: ID_BLOG, title: 'Write release notes', cwd: 'C:\\work\\blog', modifiedAt: NOW - 3 * 3_600_000 },
  { id: ID_SHOP_2, title: 'Çətin şəkil problemi', cwd: 'c:/work/shop/', modifiedAt: NOW - 2 * 86_400_000 },
  { id: ID_HOME, title: 'İlk sorğu', cwd: 'C:\\Users\\me', modifiedAt: NOW - 9 * 86_400_000 }
]

let api: AgentGridMock

beforeEach(() => {
  api = createAgentGridMock()
  api.sessions.list.mockResolvedValue(SESSIONS)
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
    pendingCloseId: null
  })
  useTerminalStore.setState({ panes: [], activePaneId: null })
  useLayoutStore.setState({ preset: 'auto', focusMode: false, columnSizes: [], rowSizes: [] })
  useSessionsStore.setState({ sessions: [], status: 'idle', showAll: false, query: '' })
})

function railButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Claude söhbətləri' })
}

async function openSessionsTab(): Promise<void> {
  fireEvent.click(railButton())
  await waitFor(() => expect(screen.getByRole('list', { name: 'Claude söhbətləri' })).toBeTruthy())
}

function titles(): string[] {
  return within(screen.getByRole('list', { name: 'Claude söhbətləri' }))
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('.session-item__title')!.textContent!)
}

describe('the sessions tab', () => {
  it('is not shown until it is opened, so it never bothers anyone who does not want it', () => {
    render(<App />)
    expect(screen.queryByRole('tab', { name: 'Söhbətlər' })).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(api.sessions.list).not.toHaveBeenCalled()
  })

  it('opens from the rail button and shows the chats of the current project', async () => {
    render(<App />)
    await openSessionsTab()
    expect(screen.getByRole('tab', { name: 'Söhbətlər' }).getAttribute('aria-selected')).toBe('true')
    expect(railButton().getAttribute('aria-pressed')).toBe('true')
    expect(titles()).toEqual(['Fix the login bug', 'Çətin şəkil problemi'])
    expect(api.sessions.list).toHaveBeenCalledTimes(1)
  })

  it('shows how long ago each chat was used', async () => {
    render(<App />)
    await openSessionsTab()
    expect(screen.getByText('5 dəq əvvəl')).toBeTruthy()
    expect(screen.getByText('2 gün əvvəl')).toBeTruthy()
  })

  it('can be switched back and forth with the project tab without being closed', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(screen.getByRole('tab', { name: 'Layihə' }))
    expect(screen.getByText('Son açılanlar')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Söhbətlər' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Söhbətlər' }))
    expect(screen.getByRole('list', { name: 'Claude söhbətləri' })).toBeTruthy()
  })

  it('closes with its own x button and goes back to the project view', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(screen.getByRole('button', { name: 'Söhbətlər tabını bağla' }))
    expect(screen.queryByRole('tab', { name: 'Söhbətlər' })).toBeNull()
    expect(screen.getByText('Son açılanlar')).toBeTruthy()
    expect(railButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('can be opened again after it was closed', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(screen.getByRole('button', { name: 'Söhbətlər tabını bağla' }))
    await openSessionsTab()
    expect(titles()).toHaveLength(2)
  })

  it('closes when the rail button is pressed again', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(railButton())
    expect(screen.queryByRole('tab', { name: 'Söhbətlər' })).toBeNull()
  })

  it('opens the hidden sidebar when the rail button is pressed', async () => {
    useUiStore.setState({ sidebarOpen: false })
    render(<App />)
    await openSessionsTab()
    expect(screen.getByLabelText('Layihələr').hasAttribute('hidden')).toBe(false)
  })

  it('reloads the list every time the tab is opened', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(screen.getByRole('button', { name: 'Söhbətlər tabını bağla' }))
    await openSessionsTab()
    expect(api.sessions.list).toHaveBeenCalledTimes(2)
  })

  it('reloads from the refresh button', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(screen.getByRole('button', { name: 'Siyahını yenilə' }))
    await waitFor(() => expect(api.sessions.list).toHaveBeenCalledTimes(2))
  })
})

describe('all projects (Ctrl+A)', () => {
  it('switches to the chats of every project with Ctrl+A and back again', async () => {
    render(<App />)
    await openSessionsTab()
    const panel = screen.getByRole('region', { name: 'Söhbətlər' })
    fireEvent.keyDown(panel, { key: 'a', code: 'KeyA', ctrlKey: true })
    expect(titles()).toEqual([
      'Fix the login bug',
      'Write release notes',
      'Çətin şəkil problemi',
      'İlk sorğu'
    ])
    expect(screen.getByRole('button', { name: 'Bütün layihələr' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(panel, { key: 'a', code: 'KeyA', ctrlKey: true })
    expect(titles()).toHaveLength(2)
  })

  it('works while typing in the search box, like in Claude itself', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Söhbətlərdə axtar' }), {
      key: 'a',
      code: 'KeyA',
      ctrlKey: true
    })
    expect(titles()).toHaveLength(4)
  })

  it('does not steal Ctrl+A from the terminals', async () => {
    render(<App />)
    await openSessionsTab()
    const before = useSessionsStore.getState().showAll
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(1))
    const pane = screen.getByRole('region', { name: 'Terminal: Claude' })
    fireEvent.keyDown(pane, { key: 'a', code: 'KeyA', ctrlKey: true })
    expect(useSessionsStore.getState().showAll).toBe(before)
  })

  it('also switches with the buttons, and shows each chat\'s project folder name in the all view', async () => {
    render(<App />)
    await openSessionsTab()
    expect(screen.queryByText('blog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Bütün layihələr' }))
    expect(screen.getByText('blog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Bu layihə' }))
    expect(titles()).toHaveLength(2)
  })

  it('matches chats by project when no project is selected, using the home folder', async () => {
    useProjectStore.setState({ projectPath: null, recentPaths: [] })
    render(<App />)
    await openSessionsTab()
    await waitFor(() => expect(titles()).toEqual(['İlk sorğu']))
  })

  it('tells the user how to see other projects when the current one has no chats', async () => {
    useProjectStore.setState({ projectPath: 'C:\\work\\empty', recentPaths: [] })
    render(<App />)
    await openSessionsTab()
    expect(await screen.findByText('Bu layihədə köhnə Claude söhbəti yoxdur.')).toBeTruthy()
    expect(screen.getByText(/Ctrl\+A: bütün layihələrə keç/)).toBeTruthy()
  })
})

describe('searching', () => {
  it('filters by words in the title', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'login' } })
    expect(titles()).toEqual(['Fix the login bug'])
  })

  it('says so when nothing matches', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } })
    expect(screen.getByText('Axtarışa uyğun söhbət yoxdur.')).toBeTruthy()
  })

  it('finds Azerbaijani words regardless of capital letters', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ŞƏKİL' } })
    expect(titles()).toEqual(['Çətin şəkil problemi'])
  })
})

describe('loading and errors', () => {
  it('shows a message and a retry button when the chats cannot be read', async () => {
    api.sessions.list.mockRejectedValueOnce(new Error('disk'))
    render(<App />)
    fireEvent.click(railButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/oxuna bilmədi/)
    fireEvent.click(within(alert).getByRole('button', { name: 'Yenidən cəhd et' }))
    await waitFor(() => expect(titles()).toHaveLength(2))
  })

  it('keeps showing the old list while it reloads', async () => {
    render(<App />)
    await openSessionsTab()
    let release: (value: ClaudeSession[]) => void = () => undefined
    api.sessions.list.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    fireEvent.click(screen.getByRole('button', { name: 'Siyahını yenilə' }))
    expect(titles()).toHaveLength(2)
    release(SESSIONS)
  })
})

describe('continuing a chat in a pane', () => {
  function item(title: string): HTMLElement {
    return screen.getByRole('button', { name: `Söhbəti aç: ${title}` })
  }

  it('opens the chat in a new pane that resumes it in the chat\'s own folder', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(item('Fix the login bug'))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'claude',
        resumeSessionId: ID_SHOP,
        cwd: 'C:\\work\\shop',
        shellId: 'cmd'
      })
    )
    expect(screen.getByRole('region', { name: 'Terminal: Claude · Fix the login bug' })).toBeTruthy()
  })

  it('uses the chat\'s folder even when it is a different project than the current one', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(screen.getByRole('button', { name: 'Bütün layihələr' }))
    fireEvent.click(item('Write release notes'))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({
      cwd: 'C:\\work\\blog',
      resumeSessionId: ID_BLOG
    })
    expect(useProjectStore.getState().projectPath).toBe('C:\\work\\shop')
  })

  it('opens the same chat only once and jumps to the open pane instead', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(item('Fix the login bug'))
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.status).toBe('running'))
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(2))
    fireEvent.click(item('Fix the login bug'))
    expect(useTerminalStore.getState().panes).toHaveLength(2)
    expect(useTerminalStore.getState().activePaneId).toBe(useTerminalStore.getState().panes[0]!.id)
    expect(screen.getByText('Bu söhbət artıq açıqdır, ona keçdim.')).toBeTruthy()
  })

  it('allows opening the chat again once its pane has ended', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(item('Fix the login bug'))
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.status).toBe('running'))
    useTerminalStore.getState().handleExit({ id: useTerminalStore.getState().panes[0]!.id, exitCode: 0 })
    fireEvent.click(item('Fix the login bug'))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(2))
  })

  it('restarting a resumed pane resumes the same chat again', async () => {
    render(<App />)
    await openSessionsTab()
    fireEvent.click(item('Fix the login bug'))
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.status).toBe('running'))
    api.terminal.create.mockClear()
    await useTerminalStore.getState().restart(useTerminalStore.getState().panes[0]!.id)
    expect(api.terminal.create).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: ID_SHOP }))
  })

  it('shows the missing-folder error in the pane when the project folder was deleted', async () => {
    api.terminal.create.mockResolvedValueOnce({ ok: false, code: 'cwd-missing', message: 'C:\\work\\shop' })
    render(<App />)
    await openSessionsTab()
    fireEvent.click(item('Fix the login bug'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Layihə qovluğu tapılmadı: C:\\work\\shop/)
  })

  it('moves focus to the next chat with the arrow keys', async () => {
    render(<App />)
    await openSessionsTab()
    const first = item('Fix the login bug')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('Çətin şəkil problemi'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
  })
})
