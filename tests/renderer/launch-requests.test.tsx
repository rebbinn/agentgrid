import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { App } from '../../src/renderer/src/App'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { useLayoutStore } from '../../src/renderer/src/state/layout-store'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import type { LaunchRequest } from '../../src/shared/ipc'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

const SESSION = {
  id: '3975237b-df03-44fe-b8e1-be208c6646d1',
  title: 'Fix the login bug',
  cwd: 'C:\\work\\shop',
  modifiedAt: Date.now()
}

let api: AgentGridMock
let deliver: (request: LaunchRequest) => void

beforeEach(() => {
  api = createAgentGridMock()
  deliver = () => undefined
  api.launcher.onRequest.mockImplementation((listener) => {
    deliver = listener
    return () => undefined
  })
  window.agentgrid = api
  resetShellsCache()
  resetAppInfoCache()
  fakeRegistry.reset()
  useProjectStore.setState({ projectPath: 'C:\\work\\other', recentPaths: [] })
  useUiStore.setState({ sidebarOpen: true, toasts: [], pendingCloseId: null })
  useTerminalStore.setState({ panes: [], activePaneId: null })
  useLayoutStore.setState({ preset: 'auto', focusMode: false, columnSizes: [], rowSizes: [] })
})

describe('requests from the taskbar icon', () => {
  it('asks the main process for requests that arrived before the window was ready', async () => {
    api.launcher.takePending.mockResolvedValueOnce([{ kind: 'resume', session: SESSION }])
    render(<App />)
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'claude', resumeSessionId: SESSION.id, cwd: 'C:\\work\\shop' })
    )
  })

  it('opens the chat a user picked from the taskbar menu while the app is running', async () => {
    render(<App />)
    await waitFor(() => expect(api.launcher.takePending).toHaveBeenCalled())
    act(() => deliver({ kind: 'resume', session: SESSION }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('region', { name: 'Terminal: Claude · Fix the login bug' })).toBeTruthy()
  })

  it('starts a new Claude from the taskbar menu in the current project', async () => {
    render(<App />)
    await waitFor(() => expect(api.launcher.takePending).toHaveBeenCalled())
    act(() => deliver({ kind: 'claude' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ agentId: 'claude', cwd: 'C:\\work\\other' })
    expect(api.terminal.create.mock.calls[0]![0].resumeSessionId).toBeUndefined()
  })

  it('tells the user when a chat in the taskbar menu no longer exists', async () => {
    render(<App />)
    await waitFor(() => expect(api.launcher.takePending).toHaveBeenCalled())
    act(() => deliver({ kind: 'session-missing' }))
    expect(await screen.findByText('Bu söhbət tapılmadı, silinmiş ola bilər.')).toBeTruthy()
    expect(api.terminal.create).not.toHaveBeenCalled()
  })

  it('does not open the same chat twice when it is picked again', async () => {
    render(<App />)
    await waitFor(() => expect(api.launcher.takePending).toHaveBeenCalled())
    act(() => deliver({ kind: 'resume', session: SESSION }))
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.status).toBe('running'))
    act(() => deliver({ kind: 'resume', session: SESSION }))
    await waitFor(() => expect(screen.getByText('Bu söhbət artıq açıqdır, ona keçdim.')).toBeTruthy())
    expect(useTerminalStore.getState().panes).toHaveLength(1)
  })
})
