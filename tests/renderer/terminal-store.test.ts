import { beforeEach, describe, expect, it } from 'vitest'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { nextPaneTitle, useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

let api: AgentGridMock

function paneIds(): string[] {
  return useTerminalStore.getState().panes.map((pane) => pane.id)
}

async function launchPane(options: { agentId?: 'claude'; shellId?: string } = {}): Promise<string> {
  const id = await useTerminalStore.getState().launch({ cwd: 'C:\\work\\shop', ...options })
  if (!id) throw new Error('launch returned null')
  return id
}

beforeEach(() => {
  api = createAgentGridMock()
  window.agentgrid = api
  resetShellsCache()
  resetAppInfoCache()
  fakeRegistry.reset()
  useTerminalStore.setState({ panes: [], activePaneId: null })
  useUiStore.setState({ toasts: [], pendingCloseId: null })
})

describe('nextPaneTitle', () => {
  it('numbers duplicates and reuses the smallest free number', () => {
    expect(nextPaneTitle('Claude', [])).toBe('Claude')
    expect(nextPaneTitle('Claude', ['Claude'])).toBe('Claude 2')
    expect(nextPaneTitle('Claude', ['Claude', 'Claude 2', 'Claude 3'])).toBe('Claude 4')
    expect(nextPaneTitle('Claude', ['Claude', 'Claude 3'])).toBe('Claude 2')
    expect(nextPaneTitle('Claude', ['Claude 2'])).toBe('Claude')
  })
})

describe('launching terminals', () => {
  it('adds an active pane that waits for its first size before the process starts', async () => {
    const id = await launchPane({ agentId: 'claude' })
    const { panes, activePaneId } = useTerminalStore.getState()
    expect(panes).toHaveLength(1)
    expect(panes[0]).toMatchObject({
      id,
      title: 'Claude',
      shellId: 'cmd',
      shellLabel: 'Command Prompt',
      cwd: 'C:\\work\\shop',
      agentId: 'claude',
      status: 'starting'
    })
    expect(activePaneId).toBe(id)
    expect(api.terminal.create).not.toHaveBeenCalled()
    expect(fakeRegistry.create).toHaveBeenCalledWith(id, 26200)
  })

  it('names plain terminals after their shell and numbers repeats', async () => {
    await launchPane()
    await launchPane()
    await launchPane({ shellId: 'powershell' })
    expect(useTerminalStore.getState().panes.map((pane) => pane.title)).toEqual([
      'Command Prompt',
      'Command Prompt 2',
      'Windows PowerShell'
    ])
  })

  it('prefers cmd when no shell is requested even if it is not first', async () => {
    api.shell.list.mockResolvedValue([
      { id: 'powershell', label: 'Windows PowerShell', kind: 'powershell' },
      { id: 'cmd', label: 'Command Prompt', kind: 'cmd' }
    ])
    await launchPane()
    expect(useTerminalStore.getState().panes[0]?.shellId).toBe('cmd')
  })

  it('tells the user when no shell exists on the computer', async () => {
    api.shell.list.mockResolvedValue([])
    const id = await useTerminalStore.getState().launch({ cwd: 'C:\\work' })
    expect(id).toBeNull()
    expect(useTerminalStore.getState().panes).toHaveLength(0)
    expect(useUiStore.getState().toasts[0]?.kind).toBe('error')
  })

  it('does not fall back to another shell when the requested one is gone', async () => {
    const id = await useTerminalStore.getState().launch({ cwd: 'C:\\work', shellId: 'wsl:Gone' })
    expect(id).toBeNull()
    expect(useUiStore.getState().toasts[0]?.kind).toBe('error')
  })

  it('reports an error when the shell list cannot be loaded', async () => {
    api.shell.list.mockRejectedValue(new Error('ipc down'))
    expect(await useTerminalStore.getState().launch({ cwd: 'C:\\work' })).toBeNull()
    expect(useUiStore.getState().toasts).toHaveLength(1)
  })
})

describe('starting the process', () => {
  it('sends folder, shell, agent and measured size, then marks the pane running', async () => {
    const id = await launchPane({ agentId: 'claude' })
    await useTerminalStore.getState().spawnPane(id, 140, 40)
    expect(api.terminal.create).toHaveBeenCalledWith({
      id,
      shellId: 'cmd',
      cwd: 'C:\\work\\shop',
      agentId: 'claude',
      cols: 140,
      rows: 40
    })
    expect(useTerminalStore.getState().panes[0]?.status).toBe('running')
    expect(fakeRegistry.get(id)?.markSpawned).toHaveBeenCalledWith({ cols: 140, rows: 40 })
  })

  it('shows the reason when the main process refuses to start it', async () => {
    api.terminal.create.mockResolvedValue({ ok: false, code: 'agent-missing', message: 'claude' })
    const id = await launchPane({ agentId: 'claude' })
    await useTerminalStore.getState().spawnPane(id, 100, 30)
    expect(useTerminalStore.getState().panes[0]).toMatchObject({
      status: 'error',
      errorCode: 'agent-missing',
      errorDetail: 'claude'
    })
    expect(fakeRegistry.get(id)?.markSpawned).not.toHaveBeenCalled()
  })

  it('turns a broken connection to the main process into a start failure', async () => {
    api.terminal.create.mockRejectedValue(new Error('channel closed'))
    const id = await launchPane()
    await useTerminalStore.getState().spawnPane(id, 100, 30)
    expect(useTerminalStore.getState().panes[0]).toMatchObject({
      status: 'error',
      errorCode: 'spawn-failed',
      errorDetail: 'channel closed'
    })
  })

  it('stops a process that finished starting after its pane was already closed', async () => {
    const id = await launchPane()
    const pending = useTerminalStore.getState().spawnPane(id, 100, 30)
    useTerminalStore.getState().close(id)
    api.terminal.kill.mockClear()
    await pending
    expect(api.terminal.kill).toHaveBeenCalledWith(id)
    expect(useTerminalStore.getState().panes).toHaveLength(0)
  })

  it('keeps the exited state when the process ended before the start reply arrived', async () => {
    const id = await launchPane()
    const pending = useTerminalStore.getState().spawnPane(id, 100, 30)
    useTerminalStore.getState().handleExit({ id, exitCode: 1 })
    await pending
    expect(useTerminalStore.getState().panes[0]).toMatchObject({ status: 'exited', exitCode: 1 })
    expect(fakeRegistry.get(id)?.markSpawned).not.toHaveBeenCalled()
  })
})

describe('restart, close and exit', () => {
  it('restarts in place: stops the old process, clears the screen and starts a new one', async () => {
    const id = await launchPane({ agentId: 'claude' })
    await useTerminalStore.getState().spawnPane(id, 100, 30)
    api.terminal.create.mockClear()
    await useTerminalStore.getState().restart(id)
    expect(api.terminal.kill).toHaveBeenCalledWith(id)
    expect(fakeRegistry.get(id)?.reset).toHaveBeenCalled()
    expect(api.terminal.create).toHaveBeenCalledWith(expect.objectContaining({ id, agentId: 'claude' }))
    expect(useTerminalStore.getState().panes[0]?.status).toBe('running')
    expect(paneIds()).toEqual([id])
  })

  it('clears the exit code and error when restarting', async () => {
    const id = await launchPane()
    useTerminalStore.getState().handleExit({ id, exitCode: 5 })
    await useTerminalStore.getState().restart(id)
    expect(useTerminalStore.getState().panes[0]?.exitCode).toBeUndefined()
  })

  it('closes a pane, stops its process and releases its screen', async () => {
    const id = await launchPane()
    useTerminalStore.getState().close(id)
    expect(api.terminal.kill).toHaveBeenCalledWith(id)
    expect(fakeRegistry.remove).toHaveBeenCalledWith(id)
    expect(paneIds()).toEqual([])
    expect(useTerminalStore.getState().activePaneId).toBeNull()
  })

  it('moves focus to the neighbour when the active pane closes', async () => {
    const first = await launchPane()
    const second = await launchPane()
    const third = await launchPane()
    useTerminalStore.getState().setActive(second)
    useTerminalStore.getState().close(second)
    expect(useTerminalStore.getState().activePaneId).toBe(third)
    useTerminalStore.getState().close(third)
    expect(useTerminalStore.getState().activePaneId).toBe(first)
  })

  it('keeps the active pane when a different pane closes', async () => {
    const first = await launchPane()
    const second = await launchPane()
    useTerminalStore.getState().close(first)
    expect(useTerminalStore.getState().activePaneId).toBe(second)
  })

  it('marks a pane exited with its exit code and ignores unknown terminals', async () => {
    const id = await launchPane()
    useTerminalStore.getState().handleExit({ id, exitCode: 130 })
    expect(useTerminalStore.getState().panes[0]).toMatchObject({ status: 'exited', exitCode: 130 })
    expect(() =>
      useTerminalStore.getState().handleExit({ id: '99999999-9999-4999-8999-999999999999', exitCode: 0 })
    ).not.toThrow()
  })

  it('clears only the requested screen', async () => {
    const first = await launchPane()
    const second = await launchPane()
    useTerminalStore.getState().clear(first)
    expect(fakeRegistry.get(first)?.clear).toHaveBeenCalled()
    expect(fakeRegistry.get(second)?.clear).not.toHaveBeenCalled()
  })
})
