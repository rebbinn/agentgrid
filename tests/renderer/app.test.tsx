import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../../src/renderer/src/App'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

let api: AgentGridMock

function openProject(path = 'C:\\work\\shop'): void {
  useProjectStore.setState({ projectPath: path, recentPaths: [path] })
}

function claudeButton(): HTMLElement {
  return screen.getByRole('button', { name: /claude \(yeni terminal\)/i })
}

beforeEach(() => {
  api = createAgentGridMock()
  window.agentgrid = api
  resetShellsCache()
  resetAppInfoCache()
  fakeRegistry.reset()
  useProjectStore.setState({ projectPath: null, recentPaths: [] })
  useUiStore.setState({ sidebarOpen: true, toasts: [], pendingCloseId: null })
  useTerminalStore.setState({ panes: [], activePaneId: null })
})

describe('first launch and project selection', () => {
  it('offers Claude straight away on first launch and explains where terminals open', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /hələ terminal yoxdur/i })).toBeTruthy()
    expect(screen.getByText(/ev qovluğunuzda açılacaq/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /claude başlat/i })).toBeTruthy()
  })

  it('opens the picked folder and then offers to start Claude', async () => {
    api.project.pick.mockResolvedValue({ path: 'C:\\work\\shop' })
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /layihə qovluğu seç/i })[0]!)
    await waitFor(() => expect(screen.getByRole('heading', { name: /hələ terminal yoxdur/i })).toBeTruthy())
    expect(screen.getByText(/layihə açıldı: shop/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /claude başlat/i })).toBeTruthy()
  })

  it('does nothing when the folder dialog is cancelled', async () => {
    api.project.pick.mockResolvedValue({ path: null })
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /layihə qovluğu seç/i })[0]!)
    await waitFor(() => expect(api.project.pick).toHaveBeenCalled())
    expect(useProjectStore.getState().projectPath).toBeNull()
  })

  it('shows an error toast when picking a folder fails', async () => {
    api.project.pick.mockRejectedValue(new Error('boom'))
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /layihə qovluğu seç/i })[0]!)
    await waitFor(() => expect(screen.getByText(/qovluq seçmək alınmadı/i)).toBeTruthy())
  })

  it('shows the app version from the main process in the status bar', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('AgentGrid 0.1.0')).toBeTruthy())
  })

  it('hides and shows the sidebar from the rail button', () => {
    render(<App />)
    const toggle = screen.getByRole('button', { name: /yan paneli/i })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByLabelText('Layihələr').hasAttribute('hidden')).toBe(true)
  })
})

describe('the Claude button', () => {
  it('opens a new CMD pane that starts Claude in the project folder', async () => {
    openProject()
    render(<App />)
    fireEvent.click(claudeButton())
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ shellId: 'cmd', cwd: 'C:\\work\\shop', agentId: 'claude' })
    )
    await waitFor(() => expect(screen.getByRole('region', { name: 'Terminal: Claude' })).toBeTruthy())
    expect(screen.getByText('Command Prompt · shop')).toBeTruthy()
  })

  it('opens a separate session every time it is pressed', async () => {
    openProject()
    render(<App />)
    fireEvent.click(claudeButton())
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    fireEvent.click(claudeButton())
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('region', { name: 'Terminal: Claude' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Terminal: Claude 2' })).toBeTruthy()
    const ids = api.terminal.create.mock.calls.map((call) => call[0].id)
    expect(new Set(ids).size).toBe(2)
  })

  it('starts Claude in the home folder without asking anything when no project is selected', async () => {
    render(<App />)
    fireEvent.click(claudeButton())
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: 'C:\\Users\\me', agentId: 'claude' })
    )
    expect(api.project.pick).not.toHaveBeenCalled()
  })

  it('starts Claude from the empty-state button the same way', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /claude başlat/i }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ cwd: 'C:\\Users\\me', agentId: 'claude' })
  })

  it('reports an error instead of failing silently when the home folder cannot be read', async () => {
    api.app.info.mockRejectedValue(new Error('ipc down'))
    render(<App />)
    fireEvent.click(claudeButton())
    await waitFor(() => expect(screen.getByText(/terminal açmaq alınmadı/i)).toBeTruthy())
    expect(api.terminal.create).not.toHaveBeenCalled()
  })
})

describe('new terminal button and shell menu', () => {
  it('opens a plain terminal in the default shell', async () => {
    openProject()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Yeni terminal' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ shellId: 'cmd' })
    expect(api.terminal.create.mock.calls[0]![0].agentId).toBeUndefined()
  })

  it('lists the detected shells and opens the chosen one', async () => {
    openProject()
    render(<App />)
    await waitFor(() => expect(api.shell.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /başqa shell ilə aç/i }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Command Prompt', 'Windows PowerShell'])
    fireEvent.click(items[1]!)
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ shellId: 'powershell' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu with Escape', async () => {
    openProject()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /başqa shell ilə aç/i }))
    const menu = await screen.findByRole('menu')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('pane states', () => {
  it('explains a missing agent and lets the user retry', async () => {
    openProject()
    api.terminal.create.mockResolvedValueOnce({ ok: false, code: 'agent-missing', message: 'claude' })
    render(<App />)
    fireEvent.click(claudeButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/"claude" proqramı quraşdırılmayıb/)
    fireEvent.click(screen.getByRole('button', { name: /yenidən cəhd et/i }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('shows the exit code and a restart button when the process ends', async () => {
    openProject()
    render(<App />)
    fireEvent.click(claudeButton())
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalled())
    const id = useTerminalStore.getState().panes[0]!.id
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.status).toBe('running'))
    useTerminalStore.getState().handleExit({ id, exitCode: 2 })
    expect(await screen.findByText('Proses bitdi (çıxış kodu 2)')).toBeTruthy()
    const dot = screen.getByRole('img', { name: 'Bitib' })
    expect(dot).toBeTruthy()
  })

  it('restarts an exited pane from the footer button', async () => {
    openProject()
    render(<App />)
    fireEvent.click(claudeButton())
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.status).toBe('running'))
    const id = useTerminalStore.getState().panes[0]!.id
    useTerminalStore.getState().handleExit({ id, exitCode: 0 })
    await screen.findByText(/proses bitdi/i)
    const footerRestart = screen
      .getAllByRole('button', { name: /yenidən başlat/i })
      .find((button) => button.closest('footer'))!
    fireEvent.click(footerRestart)
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/proses bitdi/i)).toBeNull())
  })

  it('shows the pane count and the active pane in the status bar', async () => {
    openProject()
    render(<App />)
    expect(screen.getByText('0 terminal')).toBeTruthy()
    fireEvent.click(claudeButton())
    await waitFor(() => expect(screen.getByText('1 terminal')).toBeTruthy())
    expect(screen.getByText('Aktiv: Claude')).toBeTruthy()
  })

  it('makes a pane active when it is clicked', async () => {
    openProject()
    render(<App />)
    fireEvent.click(claudeButton())
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    fireEvent.click(claudeButton())
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(2))
    const first = screen.getByRole('region', { name: 'Terminal: Claude' })
    expect(first.getAttribute('data-active')).toBe('false')
    fireEvent.mouseDown(first)
    expect(first.getAttribute('data-active')).toBe('true')
    expect(screen.getByRole('region', { name: 'Terminal: Claude 2' }).getAttribute('data-active')).toBe('false')
  })
})

describe('closing a terminal', () => {
  async function runningPane(): Promise<string> {
    openProject()
    render(<App />)
    fireEvent.click(claudeButton())
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.status).toBe('running'))
    return useTerminalStore.getState().panes[0]!.id
  }

  it('asks before closing a running terminal and keeps it when cancelled', async () => {
    const id = await runningPane()
    fireEvent.click(screen.getByRole('button', { name: 'Bağla' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toMatch(/"Claude" hələ işləyir/)
    fireEvent.click(screen.getByRole('button', { name: 'Ləğv et' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useTerminalStore.getState().panes.map((pane) => pane.id)).toEqual([id])
    expect(api.terminal.kill).not.toHaveBeenCalled()
  })

  it('closes after confirmation and stops the process', async () => {
    const id = await runningPane()
    fireEvent.click(screen.getByRole('button', { name: 'Bağla' }))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getAllByRole('button', { name: 'Bağla' }).find((button) => button.classList.contains('btn--danger'))!)
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(0))
    expect(api.terminal.kill).toHaveBeenCalledWith(id)
    expect(screen.getByRole('heading', { name: /hələ terminal yoxdur/i })).toBeTruthy()
  })

  it('cancels with Escape', async () => {
    await runningPane()
    fireEvent.click(screen.getByRole('button', { name: 'Bağla' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useTerminalStore.getState().panes).toHaveLength(1)
  })

  it('closes an exited terminal without asking', async () => {
    const id = await runningPane()
    useTerminalStore.getState().handleExit({ id, exitCode: 0 })
    await screen.findByText(/proses bitdi/i)
    fireEvent.click(screen.getAllByRole('button', { name: 'Bağla' })[0]!)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(0))
  })
})
