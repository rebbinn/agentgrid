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
import { cwdFromOsc7 } from '../../src/renderer/src/terminal/managed-terminal'
import type { HostView } from '../../src/shared/hosts'
import type { LocalChangedEvent, RemoteEntry, SftpEvent, SftpRequest, TransferRequest } from '../../src/shared/sftp'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

const STAGE = '22222222-2222-4222-8222-222222222222'
const VIEWS: HostView[] = [
  {
    host: {
      id: STAGE,
      name: 'xl-stage',
      group: '',
      address: '10.20.9.5',
      port: 22,
      username: 'deploy',
      auth: 'password',
      keyPath: null,
      environment: 'dev',
      jumpHostId: null,
      note: '',
      lastConnectedAt: null
    },
    hasPassword: true,
    hasPassphrase: false
  }
]
const REMOTE: Record<string, RemoteEntry[]> = {
  '/srv': [{ name: 'app.env', kind: 'file', size: 12, mtime: 1, mode: 0o600 }],
  '/var/log': [{ name: 'syslog', kind: 'file', size: 1, mtime: 1, mode: 0o640 }]
}

let api: AgentGridMock
let emitSftp: (event: SftpEvent) => void
let emitChanged: (event: LocalChangedEvent) => void

beforeEach(() => {
  api = createAgentGridMock()
  api.hosts.list.mockResolvedValue(VIEWS)
  api.sftp.open.mockResolvedValue({ ok: true, home: '/srv' })
  api.sftp.request.mockImplementation(async (request: SftpRequest) =>
    request.op === 'list' ? { ok: true, path: request.path, entries: REMOTE[request.path] ?? [] } : { ok: true }
  )
  api.sftp.onEvent.mockImplementation((listener) => {
    emitSftp = listener
    return () => undefined
  })
  api.local.onChanged.mockImplementation((listener) => {
    emitChanged = listener
    return () => undefined
  })
  window.agentgrid = api
  resetShellsCache()
  resetAppInfoCache()
  fakeRegistry.reset()
  useProjectStore.setState({ projectPath: 'C:\\work', recentPaths: [] })
  useUiStore.setState({ sidebarOpen: true, sidebarTab: 'projects', serversTabOpen: false, toasts: [], dialog: null })
  useTerminalStore.setState({ panes: [], activePaneId: null })
  useLayoutStore.setState({ preset: 'auto', focusMode: false, columnSizes: [], rowSizes: [] })
  useHostsStore.setState({ views: [], status: 'idle', query: '', collapsedGroups: [] })
  useSshStore.setState({ requests: {}, phases: {}, latency: {}, cwd: {} })
  useSftpStore.setState({ listings: {}, transfers: [], edits: [], follow: {} })
})

async function openSftp(): Promise<HTMLElement> {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Serverlər (SSH)' }))
  fireEvent.click(await screen.findByRole('button', { name: 'xl-stage: SFTP' }))
  const remote = await screen.findByRole('listbox', { name: 'xl-stage: fayllar' })
  await within(remote).findByText('app.env')
  return remote
}

function lastTransfer(): TransferRequest {
  return api.sftp.transfer.mock.calls.at(-1)![0]
}

describe('editing a server file in a local editor', () => {
  it('downloads it, opens it in an editor and uploads every save', async () => {
    const remote = await openSftp()
    const row = within(remote).getAllByRole('option').find((item) => item.dataset['name'] === 'app.env')!
    fireEvent.contextMenu(row, { clientX: 30, clientY: 30 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Redaktorda aç' }))

    await waitFor(() => expect(api.sftp.transfer).toHaveBeenCalledTimes(1))
    const download = lastTransfer()
    expect(download).toMatchObject({
      direction: 'download',
      remotePath: '/srv/app.env',
      localPath: 'C:\\Temp\\AgentGrid\\edit\\x\\app.env',
      overwrite: true
    })
    act(() => emitSftp({ kind: 'transfer-done', sessionId: download.sessionId, transferId: download.transferId }))
    await waitFor(() => expect(api.local.watch).toHaveBeenCalledWith('C:\\Temp\\AgentGrid\\edit\\x\\app.env'))
    expect(api.local.openInEditor).toHaveBeenCalledWith('C:\\Temp\\AgentGrid\\edit\\x\\app.env')
    const edits = screen.getByRole('region', { name: 'Redaktə olunan fayllar' })
    expect(within(edits).getByText('saxlayanda serverə yüklənəcək')).toBeTruthy()

    act(() => emitChanged({ path: 'C:\\Temp\\AgentGrid\\edit\\x\\app.env' }))
    const upload = lastTransfer()
    expect(upload).toMatchObject({ direction: 'upload', remotePath: '/srv/app.env', overwrite: true })
    act(() => emitSftp({ kind: 'transfer-done', sessionId: upload.sessionId, transferId: upload.transferId }))
    await waitFor(() =>
      expect(useUiStore.getState().toasts.map((toast) => toast.message)).toContain('app.env serverə yükləndi')
    )

    fireEvent.click(within(edits).getByRole('button', { name: 'app.env izləməsini dayandır' }))
    expect(api.local.unwatch).toHaveBeenCalledWith('C:\\Temp\\AgentGrid\\edit\\x\\app.env')
  })
})

describe('resuming a transfer', () => {
  it('offers to continue a transfer that stopped because the connection dropped', async () => {
    const remote = await openSftp()
    const row = within(remote).getAllByRole('option').find((item) => item.dataset['name'] === 'app.env')!
    fireEvent.mouseDown(row)
    fireEvent.click(screen.getByRole('button', { name: 'Endir' }))
    const first = lastTransfer()
    act(() =>
      emitSftp({
        kind: 'transfer-done',
        sessionId: first.sessionId,
        transferId: first.transferId,
        error: { code: 'connection', message: '' }
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'app.env köçürməsini davam etdir' }))
    expect(lastTransfer()).toMatchObject({ direction: 'download', remotePath: '/srv/app.env', resume: true })
    expect(lastTransfer().transferId).not.toBe(first.transferId)
  })
})

describe('following the terminal folder', () => {
  it('parses OSC 7 folder reports', () => {
    expect(cwdFromOsc7('file://xl-stage/var/log')).toBe('/var/log')
    expect(cwdFromOsc7('file://host/home/me/%C9%99l')).toBe('/home/me/əl')
    expect(cwdFromOsc7('http://evil/x')).toBeNull()
    expect(cwdFromOsc7('garbage')).toBeNull()
  })

  it('moves the server list to the folder the terminal reports', async () => {
    const remote = await openSftp()
    const follow = screen.getByRole('button', { name: 'Terminalın qovluğunu izlə' })
    expect(follow.hasAttribute('disabled')).toBe(true)

    const sftpPaneId = useTerminalStore.getState().panes[0]!.id
    act(() => {
      useTerminalStore.setState((state) => ({
        panes: [
          ...state.panes,
          {
            ...state.panes[0]!,
            id: '99999999-9999-4999-8999-999999999999',
            sftpHostId: undefined,
            sshHostId: STAGE,
            status: 'running'
          }
        ]
      }))
      useSshStore.getState().setCwd('99999999-9999-4999-8999-999999999999', '/var/log')
    })
    await waitFor(() => expect(follow.hasAttribute('disabled')).toBe(false))
    fireEvent.click(follow)
    await within(remote).findByText('syslog')
    expect(useSftpStore.getState().listings[sftpPaneId]?.remote.path).toBe('/var/log')
  })
})
