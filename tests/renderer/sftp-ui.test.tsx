import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../../src/renderer/src/App'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { useHostsStore } from '../../src/renderer/src/state/hosts-store'
import { useLayoutStore } from '../../src/renderer/src/state/layout-store'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useSftpStore } from '../../src/renderer/src/state/sftp-store'
import { useSshStore } from '../../src/renderer/src/state/ssh-store'
import { useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import type { Host, HostView } from '../../src/shared/hosts'
import type { LocalEntry, RemoteEntry, SftpEvent, SftpRequest } from '../../src/shared/sftp'
import type { SshResult } from '../../src/shared/ssh'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

const STAGE = '22222222-2222-4222-8222-222222222222'
const DOWNLOADS = 'C:\\Users\\me\\Downloads'

const STAGE_HOST: Host = {
  id: STAGE,
  name: 'xl-stage',
  group: 'Xəzər Logistika',
  address: '10.20.9.5',
  port: 22,
  username: 'deploy',
  auth: 'password',
  keyPath: null,
  environment: 'preprod',
  jumpHostId: null,
  note: '',
  lastConnectedAt: null
}
const VIEWS: HostView[] = [{ host: STAGE_HOST, hasPassword: true, hasPassphrase: false }]

const REMOTE: Record<string, RemoteEntry[]> = {
  '/home/deploy': [
    { name: 'app', kind: 'dir', size: 0, mtime: 1_700_000_000_000, mode: 0o755 },
    { name: 'app.log', kind: 'file', size: 2048, mtime: 1_700_000_000_000, mode: 0o644 },
    { name: '.bashrc', kind: 'file', size: 10, mtime: 1_700_000_000_000, mode: 0o644 }
  ],
  '/home/deploy/app': []
}

let api: AgentGridMock
let localEntries: LocalEntry[]
let emitSftp: (event: SftpEvent) => void

beforeEach(() => {
  api = createAgentGridMock()
  localEntries = []
  api.hosts.list.mockResolvedValue(VIEWS)
  api.sftp.open.mockResolvedValue({ ok: true, home: '/home/deploy' })
  api.sftp.request.mockImplementation(async (request: SftpRequest) => {
    if (request.op === 'list') return { ok: true, path: request.path, entries: REMOTE[request.path] ?? [] }
    return { ok: true }
  })
  api.local.list.mockImplementation(async (path: string) => ({ ok: true, path, entries: localEntries }))
  api.sftp.onEvent.mockImplementation((listener) => {
    emitSftp = listener
    return () => undefined
  })
  window.agentgrid = api
  resetShellsCache()
  resetAppInfoCache()
  fakeRegistry.reset()
  useProjectStore.setState({ projectPath: 'C:\\work', recentPaths: [] })
  useUiStore.setState({
    sidebarOpen: true,
    sidebarTab: 'projects',
    sessionsTabOpen: false,
    serversTabOpen: false,
    toasts: [],
    pendingCloseId: null,
    dialog: null
  })
  useTerminalStore.setState({ panes: [], activePaneId: null })
  useLayoutStore.setState({ preset: 'auto', focusMode: false, columnSizes: [], rowSizes: [] })
  useHostsStore.setState({ views: [], status: 'idle', query: '', collapsedGroups: [] })
  useSshStore.setState({ requests: {}, phases: {}, latency: {} })
  useSftpStore.setState({ listings: {}, transfers: [] })
})

async function openSftp(): Promise<{ remote: HTMLElement; local: HTMLElement }> {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Serverlər (SSH)' }))
  fireEvent.click(await screen.findByRole('button', { name: 'xl-stage: SFTP' }))
  const remote = await screen.findByRole('listbox', { name: 'xl-stage: fayllar' })
  const local = screen.getByRole('listbox', { name: 'Bu kompüter: fayllar' })
  await within(remote).findByText('app.log')
  return { remote, local }
}

function option(list: HTMLElement, name: string): HTMLElement {
  const found = within(list)
    .getAllByRole('option')
    .find((item) => item.dataset['name'] === name)
  if (!found) throw new Error(`No row ${name}`)
  return found
}

describe('the SFTP pane', () => {
  it('opens next to the server list and shows the computer and the server side by side', async () => {
    const { remote, local } = await openSftp()
    expect(api.sftp.open).toHaveBeenCalledWith({ id: expect.any(String), hostId: STAGE })
    expect(useTerminalStore.getState().panes[0]).toMatchObject({ title: 'SFTP · xl-stage', sftpHostId: STAGE })
    expect(within(remote).queryByText('.bashrc')).toBeNull()
    expect(within(remote).getByText('rwxr-xr-x')).toBeTruthy()
    expect(api.local.list).toHaveBeenCalledWith(DOWNLOADS)
    expect(within(local).getByText('Qovluq boşdur.')).toBeTruthy()
  })

  it('shows hidden files on request and goes into folders', async () => {
    const { remote } = await openSftp()
    fireEvent.click(screen.getAllByRole('button', { name: 'Gizli faylları göstər' })[1]!)
    expect(within(remote).getByText('.bashrc')).toBeTruthy()
    fireEvent.doubleClick(option(remote, 'app'))
    await waitFor(() =>
      expect(api.sftp.request).toHaveBeenCalledWith({ sessionId: expect.any(String), op: 'list', path: '/home/deploy/app' })
    )
  })

  it('downloads the selected file into the folder shown on the left and tracks progress', async () => {
    const { remote } = await openSftp()
    fireEvent.mouseDown(option(remote, 'app.log'))
    fireEvent.click(screen.getByRole('button', { name: 'Endir' }))
    expect(api.sftp.transfer).toHaveBeenCalledTimes(1)
    const request = api.sftp.transfer.mock.calls[0]![0]
    expect(request).toMatchObject({
      direction: 'download',
      localPath: `${DOWNLOADS}\\app.log`,
      remotePath: '/home/deploy/app.log',
      overwrite: false
    })
    act(() =>
      emitSftp({
        kind: 'transfer',
        sessionId: request.sessionId,
        transferId: request.transferId,
        bytes: 1024,
        total: 2048,
        files: 0,
        filesTotal: 1,
        current: 'app.log'
      })
    )
    const queue = screen.getByRole('region', { name: 'Köçürmələr' })
    expect(within(queue).getByRole('progressbar', { name: 'app.log' }).getAttribute('aria-valuenow')).toBe('50')
    act(() => emitSftp({ kind: 'transfer-done', sessionId: request.sessionId, transferId: request.transferId }))
    expect(within(queue).getByText(/Hazırdır/)).toBeTruthy()
    await waitFor(() => expect(api.local.list).toHaveBeenCalledTimes(2))
  })

  it('asks before overwriting a file that is already there', async () => {
    localEntries = [{ name: 'app.log', kind: 'file', size: 1, mtime: 1 }]
    const { remote } = await openSftp()
    fireEvent.mouseDown(option(remote, 'app.log'))
    fireEvent.click(screen.getByRole('button', { name: 'Endir' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Fayllar artıq var' })
    expect(api.sftp.transfer).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Üzərinə yaz' }))
    expect(api.sftp.transfer.mock.calls[0]![0]).toMatchObject({ overwrite: true })
  })

  it('deletes a folder with everything inside only after confirmation', async () => {
    const { remote } = await openSftp()
    const row = option(remote, 'app')
    fireEvent.mouseDown(row)
    fireEvent.keyDown(row, { key: 'Delete' })
    const dialog = await screen.findByRole('alertdialog', { name: 'Silinsin?' })
    expect(within(dialog).getByText(/içindəki hər şey/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sil' }))
    await waitFor(() =>
      expect(api.sftp.request).toHaveBeenCalledWith({
        sessionId: expect.any(String),
        op: 'remove',
        path: '/home/deploy/app',
        recursive: true
      })
    )
  })

  it('opens terminal and SFTP side by side with a single login', async () => {
    let finishLogin: (result: SshResult) => void = () => undefined
    api.ssh.open.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLogin = resolve
        })
    )
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Serverlər (SSH)' }))
    const row = (await screen.findByText('xl-stage')).closest('li')!
    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal + SFTP yan-yana' }))
    await waitFor(() => expect(api.ssh.open).toHaveBeenCalledTimes(1))
    expect(api.sftp.open).not.toHaveBeenCalled()
    const terminalId = useTerminalStore.getState().panes.find((pane) => pane.sshHostId === STAGE)!.id
    await act(async () => finishLogin({ ok: true }))
    await waitFor(() => expect(api.sftp.open).toHaveBeenCalledWith({ id: expect.any(String), hostId: STAGE, viaId: terminalId }))
  })
})
