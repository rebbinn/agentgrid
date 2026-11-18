import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../../src/renderer/src/App'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { useHostsStore } from '../../src/renderer/src/state/hosts-store'
import { useLayoutStore } from '../../src/renderer/src/state/layout-store'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useSshStore } from '../../src/renderer/src/state/ssh-store'
import { useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import type { Host, HostView } from '../../src/shared/hosts'
import type { SshEvent } from '../../src/shared/ssh'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

const APP = '11111111-1111-4111-8111-111111111111'
const STAGE = '22222222-2222-4222-8222-222222222222'
const DEV = '33333333-3333-4333-8333-333333333333'

function host(overrides: Partial<Host>): Host {
  return {
    id: APP,
    name: 'xl-app-01',
    group: 'Xəzər Logistika',
    address: '10.20.4.11',
    port: 22,
    username: 'deploy',
    auth: 'password',
    keyPath: null,
    environment: 'prod',
    jumpHostId: null,
    note: '',
    lastConnectedAt: null,
    ...overrides
  }
}

const VIEWS: HostView[] = [
  { host: host({}), hasPassword: true, hasPassphrase: false },
  {
    host: host({ id: STAGE, name: 'xl-stage', address: '10.20.9.5', environment: 'preprod' }),
    hasPassword: false,
    hasPassphrase: false
  },
  {
    host: host({ id: DEV, name: 'dev', group: '', address: 'dev.local', username: 'root', port: 2222, environment: 'dev' }),
    hasPassword: false,
    hasPassphrase: false
  }
]

let api: AgentGridMock
let emitSsh: (event: SshEvent) => void

beforeEach(() => {
  api = createAgentGridMock()
  api.hosts.list.mockResolvedValue(VIEWS)
  api.ssh.open.mockImplementation(() => new Promise(() => undefined))
  api.ssh.onEvent.mockImplementation((listener) => {
    emitSsh = listener
    return () => undefined
  })
  window.agentgrid = api
  resetShellsCache()
  resetAppInfoCache()
  fakeRegistry.reset()
  useProjectStore.setState({ projectPath: 'C:\\work\\shop', recentPaths: [] })
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
})

async function openServers(): Promise<HTMLElement> {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Serverlər (SSH)' }))
  return await screen.findByRole('region', { name: 'Serverlər' })
}

function rowNames(panel: HTMLElement): string[] {
  return Array.from(panel.querySelectorAll('.server-row__name')).map((item) => item.textContent ?? '')
}

describe('the servers tab', () => {
  it('opens from the rail and lists servers by customer, ungrouped last', async () => {
    const panel = await openServers()
    await waitFor(() => expect(rowNames(panel)).toEqual(['xl-app-01', 'xl-stage', 'dev']))
    expect(screen.getByRole('tab', { name: 'Serverlər' }).getAttribute('aria-selected')).toBe('true')
    expect(within(panel).getByRole('button', { name: 'Xəzər Logistika qrupunu yığ' })).toBeTruthy()
    expect(within(panel).getByText('root@dev.local:2222')).toBeTruthy()
    expect(within(panel).getByText('3 server')).toBeTruthy()
  })

  it('filters by name, customer or address', async () => {
    const panel = await openServers()
    await waitFor(() => expect(rowNames(panel)).toHaveLength(3))
    fireEvent.change(within(panel).getByRole('searchbox', { name: 'Serverlərdə axtar' }), {
      target: { value: '10.20.9' }
    })
    expect(rowNames(panel)).toEqual(['xl-stage'])
  })

  it('opens a non-prod server straight away in a new SSH pane', async () => {
    const panel = await openServers()
    fireEvent.click(await within(panel).findByRole('button', { name: 'xl-stage: yeni terminal' }))
    await waitFor(() => expect(api.ssh.open).toHaveBeenCalledTimes(1))
    const pane = useTerminalStore.getState().panes[0]!
    expect(pane).toMatchObject({ title: 'xl-stage', sshHostId: STAGE, status: 'starting' })
    expect(api.ssh.open).toHaveBeenCalledWith({ id: pane.id, hostId: STAGE, cols: 100, rows: 30 })
    expect(api.terminal.create).not.toHaveBeenCalled()
  })

  it('asks before connecting to a prod server', async () => {
    const panel = await openServers()
    fireEvent.click(await within(panel).findByRole('button', { name: 'xl-app-01: yeni terminal' }))
    const overlay = await screen.findByRole('group', { name: 'Bu PROD serverdir' })
    expect(within(overlay).getByText('xl-app-01 (Xəzər Logistika)')).toBeTruthy()
    expect(api.ssh.open).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Hamısını başlat' })).toBeNull()
    fireEvent.click(within(overlay).getByRole('button', { name: 'Qoşul' }))
    await waitFor(() => expect(api.ssh.open).toHaveBeenCalledTimes(1))
  })

  it('offers to start restored SSH panes once the server list has loaded', async () => {
    let resolveList: (views: HostView[]) => void = () => undefined
    api.hosts.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve
        })
    )
    render(<App />)
    await act(async () => {
      await useTerminalStore
        .getState()
        .restorePanes([{ title: 'xl-stage', shellId: 'ssh', shellLabel: 'SSH', cwd: '~', fontSize: 13, sshHostId: STAGE }], 0, false)
    })
    expect(screen.queryByRole('status', { name: 'Bərpa olunmuş terminallar' })).toBeNull()
    await act(async () => resolveList(VIEWS))
    expect(await screen.findByRole('status', { name: 'Bərpa olunmuş terminallar' })).toBeTruthy()
  })

  it('never connects to prod servers when all saved terminals are started at once', async () => {
    render(<App />)
    await waitFor(() => expect(useHostsStore.getState().status).toBe('ready'))
    await act(async () => {
      await useTerminalStore.getState().restorePanes(
        [
          { title: 'xl-app-01', shellId: 'ssh', shellLabel: 'SSH', cwd: '~', fontSize: 13, sshHostId: APP },
          { title: 'xl-stage', shellId: 'ssh', shellLabel: 'SSH', cwd: '~', fontSize: 13, sshHostId: STAGE }
        ],
        0,
        false
      )
    })
    expect(screen.getByRole('status', { name: 'Bərpa olunmuş terminallar' }).textContent).toContain('1 terminal')
    fireEvent.click(screen.getByRole('button', { name: 'Hamısını başlat' }))
    await waitFor(() => expect(api.ssh.open).toHaveBeenCalledTimes(1))
    expect(api.ssh.open.mock.calls[0]![0]).toMatchObject({ hostId: STAGE })
    expect(useTerminalStore.getState().panes.find((pane) => pane.sshHostId === APP)?.status).toBe('idle')
  })

  it('shows an unknown host key and sends the answer back', async () => {
    const panel = await openServers()
    fireEvent.click(await within(panel).findByRole('button', { name: 'xl-stage: yeni terminal' }))
    await waitFor(() => expect(api.ssh.open).toHaveBeenCalled())
    const paneId = useTerminalStore.getState().panes[0]!.id
    act(() =>
      emitSsh({
        kind: 'hostkey',
        sessionId: paneId,
        requestId: 'r1',
        hostName: 'xl-stage',
        address: '10.20.9.5',
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abcdef'
      })
    )
    expect(await screen.findByText('ssh-ed25519 SHA256:abcdef')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Qəbul et və qoşul' }))
    expect(api.ssh.answer).toHaveBeenCalledWith({ sessionId: paneId, requestId: 'r1', accept: true })
    expect(screen.queryByText('ssh-ed25519 SHA256:abcdef')).toBeNull()
  })

  it('asks for a password and can remember it', async () => {
    const panel = await openServers()
    fireEvent.click(await within(panel).findByRole('button', { name: 'xl-stage: yeni terminal' }))
    await waitFor(() => expect(api.ssh.open).toHaveBeenCalled())
    const paneId = useTerminalStore.getState().panes[0]!.id
    act(() =>
      emitSsh({
        kind: 'prompt',
        sessionId: paneId,
        requestId: 'p1',
        hostName: 'xl-stage',
        promptKind: 'password',
        name: '',
        instruction: '',
        questions: [{ text: 'Password: ', echo: false }],
        canRemember: true
      })
    )
    const field = await screen.findByLabelText('Password:')
    expect(field.getAttribute('type')).toBe('password')
    fireEvent.change(field, { target: { value: 'gizli' } })
    fireEvent.click(screen.getByLabelText('Yadda saxla (şifrəli, yalnız bu kompüterdə)'))
    fireEvent.click(screen.getByRole('button', { name: 'Davam et' }))
    expect(api.ssh.answer).toHaveBeenCalledWith({
      sessionId: paneId,
      requestId: 'p1',
      answers: ['gizli'],
      remember: true
    })
  })

  it('explains a failed connection', async () => {
    api.ssh.open.mockResolvedValue({
      ok: false,
      failure: { code: 'auth', message: 'denied', hostName: 'xl-stage' }
    })
    const panel = await openServers()
    fireEvent.click(await within(panel).findByRole('button', { name: 'xl-stage: yeni terminal' }))
    expect(
      await screen.findByText('xl-stage: giriş alınmadı. İstifadəçi adı, parol və ya açar səhvdir.')
    ).toBeTruthy()
  })

  it('refuses a changed host key and reconnects only after the old key is forgotten', async () => {
    api.ssh.open.mockResolvedValueOnce({
      ok: false,
      failure: { code: 'hostkey-changed', message: '', hostName: 'xl-stage', fingerprint: 'SHA256:new' }
    })
    api.hosts.forgetHostKey.mockResolvedValue(true)
    const panel = await openServers()
    fireEvent.click(await within(panel).findByRole('button', { name: 'xl-stage: yeni terminal' }))
    expect(await screen.findByText('SHA256:new')).toBeTruthy()
    expect(api.ssh.open).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Köhnə izi unut və yenidən qoşul' }))
    await waitFor(() => expect(api.hosts.forgetHostKey).toHaveBeenCalledWith(STAGE))
    await waitFor(() => expect(api.ssh.open).toHaveBeenCalledTimes(2))
  })

  it('deletes a server from the right-click menu after confirmation', async () => {
    const panel = await openServers()
    const row = (await within(panel).findByText('xl-stage')).closest('li')!
    fireEvent.contextMenu(row, { clientX: 40, clientY: 40 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sil…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Server silinsin?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sil' }))
    await waitFor(() => expect(api.hosts.remove).toHaveBeenCalledWith(STAGE))
  })
})

describe('the server editor', () => {
  it('saves a new server with its password', async () => {
    api.hosts.save.mockResolvedValue({ ok: true, view: VIEWS[0]! })
    const panel = await openServers()
    fireEvent.click(within(panel).getByRole('button', { name: 'Yeni server' }))
    const dialog = await screen.findByRole('dialog', { name: 'Yeni server' })
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'qt-crm' } })
    fireEvent.change(within(dialog).getByLabelText('Müştəri / qrup'), { target: { value: 'Qala Telekom' } })
    fireEvent.change(within(dialog).getByLabelText('Ünvan'), { target: { value: '203.0.113.40' } })
    fireEvent.change(within(dialog).getByLabelText('Port'), { target: { value: '2222' } })
    fireEvent.change(within(dialog).getByLabelText('İstifadəçi'), { target: { value: 'root' } })
    fireEvent.change(within(dialog).getByLabelText('Parol'), { target: { value: 's3cret' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'prod' }))
    expect(within(dialog).getByText(/Prod serverə qoşulmazdan əvvəl/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Saxla' }))

    await waitFor(() => expect(api.hosts.save).toHaveBeenCalledTimes(1))
    expect(api.hosts.save.mock.calls[0]![0]).toMatchObject({
      host: {
        name: 'qt-crm',
        group: 'Qala Telekom',
        address: '203.0.113.40',
        port: 2222,
        username: 'root',
        auth: 'password',
        environment: 'prod',
        jumpHostId: null
      },
      password: 's3cret'
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('does not save an address with spaces', async () => {
    const panel = await openServers()
    fireEvent.click(within(panel).getByRole('button', { name: 'Yeni server' }))
    const dialog = await screen.findByRole('dialog', { name: 'Yeni server' })
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'x' } })
    fireEvent.change(within(dialog).getByLabelText('Ünvan'), { target: { value: '10.0.0.1 extra' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Saxla' }))
    expect(await within(dialog).findByText(/Ünvan düzgün deyil/)).toBeTruthy()
    expect(api.hosts.save).not.toHaveBeenCalled()
  })

  it('keeps a stored password unless a new one is typed', async () => {
    api.hosts.save.mockResolvedValue({ ok: true, view: VIEWS[0]! })
    const panel = await openServers()
    const row = (await within(panel).findByText('xl-app-01')).closest('li')!
    fireEvent.contextMenu(row, { clientX: 40, clientY: 40 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Redaktə et…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Serveri redaktə et' })
    expect(within(dialog).getByLabelText('Parol').getAttribute('placeholder')).toBe('•••••••• (saxlanıb)')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Saxla' }))
    await waitFor(() => expect(api.hosts.save).toHaveBeenCalledTimes(1))
    expect(api.hosts.save.mock.calls[0]![0]).not.toHaveProperty('password')
  })
})
