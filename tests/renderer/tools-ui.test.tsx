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
import type { Preset } from '../../src/shared/settings'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

const WS = '11111111-1111-4111-8111-111111111111'

function preset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Dev server',
    kind: 'command',
    command: 'npm run dev',
    shellId: null,
    cwd: null,
    ...overrides
  }
}

let api: AgentGridMock

beforeEach(() => {
  api = createAgentGridMock()
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
  useWorkspaceStore.setState({
    ready: true,
    workspaces: [
      {
        id: WS,
        name: 'Shop',
        projectPath: null,
        layout: { preset: 'auto', columnSizes: [], rowSizes: [], focusMode: false },
        panes: [],
        activePane: null,
        autoStart: false
      }
    ],
    activeId: WS
  })
})

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

function managedOf(index: number) {
  return fakeRegistry.get(useTerminalStore.getState().panes[index]!.id)!
}

function sendButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Göndər' }) as HTMLButtonElement
}

describe('send a command to an existing terminal', () => {
  it('does not appear until it is opened, and never before there is a terminal', async () => {
    render(<App />)
    expect(screen.queryByRole('region', { name: 'Komandanı terminala göndər' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    expect(await screen.findByText('Əvvəlcə bir terminal açın.')).toBeTruthy()
    expect(useUiStore.getState().sendPanelOpen).toBe(false)
  })

  it('opens from the side button, with the cursor in the text box', async () => {
    await openPanes(1)
    const button = screen.getByRole('button', { name: 'Komandanı terminala göndər' })
    fireEvent.click(button)
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    expect(document.activeElement).toBe(box)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/yalnız "Göndər" düyməsinə basanda/)).toBeTruthy()
  })

  it('sends the text to the active terminal and presses Enter for you', async () => {
    await openPanes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    fireEvent.change(box, { target: { value: 'npm test' } })
    fireEvent.click(sendButton())
    expect(managedOf(1).sendText).toHaveBeenCalledWith('npm test', true)
    expect(managedOf(0).sendText).not.toHaveBeenCalled()
    expect(await screen.findByText('Göndərildi: Claude 2')).toBeTruthy()
    expect((box as HTMLTextAreaElement).value).toBe('')
  })

  it('writes nothing into any terminal while you are only typing or pasting', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    fireEvent.change(box, { target: { value: 'rm -r important' } })
    fireEvent.change(box, { target: { value: 'rm -r important\nrm -r more' } })
    expect(managedOf(0).sendText).not.toHaveBeenCalled()
    expect(api.terminal.write).not.toHaveBeenCalled()
  })

  it('can paste without running it when the Enter option is switched off', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    fireEvent.click(screen.getByRole('checkbox', { name: /Enter bas/ }))
    fireEvent.change(box, { target: { value: 'git push' } })
    fireEvent.click(sendButton())
    expect(managedOf(0).sendText).toHaveBeenCalledWith('git push', false)
  })

  it('sends with Ctrl+Enter', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    fireEvent.change(box, { target: { value: 'dir' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(managedOf(0).sendText).toHaveBeenCalledWith('dir', true)
  })

  it('does not send on a plain Enter, which just adds a new line', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    fireEvent.change(box, { target: { value: 'dir' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(managedOf(0).sendText).not.toHaveBeenCalled()
  })

  it('keeps the send button off while the text is empty or only spaces', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    expect(sendButton().disabled).toBe(true)
    fireEvent.change(box, { target: { value: '   \n  ' } })
    expect(sendButton().disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'x' } })
    expect(sendButton().disabled).toBe(false)
  })

  it('counts the lines of a pasted block', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    expect(screen.getByText('0 sətir')).toBeTruthy()
    fireEvent.change(box, { target: { value: 'a\nb\nc\n' } })
    expect(screen.getByText('3 sətir')).toBeTruthy()
  })

  it('lets you pick a different running terminal', async () => {
    await openPanes(3)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    const target = screen.getByRole('combobox', { name: 'Hədəf terminal' }) as HTMLSelectElement
    expect(target.value).toBe(useTerminalStore.getState().panes[2]!.id)
    fireEvent.change(target, { target: { value: useTerminalStore.getState().panes[0]!.id } })
    fireEvent.change(box, { target: { value: 'echo hi' } })
    fireEvent.click(sendButton())
    expect(managedOf(0).sendText).toHaveBeenCalledWith('echo hi', true)
    expect(managedOf(2).sendText).not.toHaveBeenCalled()
  })

  it('only offers terminals that are really running', async () => {
    await openPanes(2)
    act(() => useTerminalStore.getState().handleExit({ id: useTerminalStore.getState().panes[1]!.id, exitCode: 0 }))
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    const target = screen.getByRole('combobox', { name: 'Hədəf terminal' })
    expect(within(target).getAllByRole('option').map((option) => option.textContent)).toEqual(['Claude'])
  })

  it('explains and blocks sending when no terminal is running', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    act(() => useTerminalStore.getState().handleExit({ id: useTerminalStore.getState().panes[0]!.id, exitCode: 0 }))
    fireEvent.change(box, { target: { value: 'dir' } })
    expect(screen.getByRole('combobox', { name: 'Hədəf terminal' }).textContent).toContain('İşləyən terminal yoxdur')
    expect(sendButton().disabled).toBe(true)
  })

  it('keeps the text and warns when the terminal stopped just before sending', async () => {
    await openPanes(1)
    managedOf(0).sendText.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = (await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'dir' } })
    fireEvent.click(sendButton())
    expect(await screen.findByText('Hədəf terminal işləmir.')).toBeTruthy()
    expect(box.value).toBe('dir')
  })

  it('closes with Escape and gives the keyboard back to the terminal', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    const box = await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    managedOf(0).focus.mockClear()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Komandanı terminala göndər' })).toBeNull()
    expect(managedOf(0).focus).toHaveBeenCalled()
  })

  it('remembers an unsent draft when the panel is closed and opened again', async () => {
    await openPanes(1)
    const toggle = screen.getByRole('button', { name: 'Komandanı terminala göndər' })
    fireEvent.click(toggle)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' }), { target: { value: 'half written' } })
    fireEvent.click(toggle)
    expect(screen.queryByRole('region', { name: 'Komandanı terminala göndər' })).toBeNull()
    fireEvent.click(toggle)
    expect(((await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })) as HTMLTextAreaElement).value).toBe('half written')
  })

  it('disappears together with the last terminal', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Komandanı terminala göndər' }))
    await screen.findByRole('textbox', { name: 'Göndəriləcək mətn' })
    act(() => {
      useTerminalStore.getState().handleExit({ id: useTerminalStore.getState().panes[0]!.id, exitCode: 0 })
      useTerminalStore.getState().close(useTerminalStore.getState().panes[0]!.id)
    })
    expect(screen.queryByRole('textbox', { name: 'Göndəriləcək mətn' })).toBeNull()
  })
})

describe('the presets list in the sidebar', () => {
  it('shows the ready-made agents and says which one is not installed', async () => {
    api.agents.status.mockResolvedValue({ claude: true, codex: false, gemini: true })
    render(<App />)
    const section = screen.getByRole('region', { name: 'Şablonlar' })
    await waitFor(() => expect(within(section).getByText(/codex · tapılmadı/)).toBeTruthy())
    expect(within(section).getByText('claude')).toBeTruthy()
    expect(within(section).getByText('gemini')).toBeTruthy()
    expect(within(section).getByText('Hələ şablon yoxdur.')).toBeTruthy()
  })

  it('starts Claude from its row', async () => {
    render(<App />)
    const section = screen.getByRole('region', { name: 'Şablonlar' })
    fireEvent.click(within(section).getByRole('button', { name: 'Claude şablonunu başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ agentId: 'claude' })
  })

  it('starts Codex when its row is used', async () => {
    render(<App />)
    const section = screen.getByRole('region', { name: 'Şablonlar' })
    fireEvent.click(within(section).getByRole('button', { name: 'Codex şablonunu başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ agentId: 'codex' })
  })

  it('lists my presets with their commands', () => {
    usePresetsStore.setState({ presets: [preset(), preset({ id: '55555555-5555-4555-8555-555555555555', name: 'Boş', command: '' })] })
    render(<App />)
    const section = screen.getByRole('region', { name: 'Şablonlar' })
    expect(within(section).getByText('Dev server')).toBeTruthy()
    expect(within(section).getByText('npm run dev')).toBeTruthy()
    expect(within(section).getByText('adi terminal')).toBeTruthy()
  })

  it('starts one of my presets: types its command, names the terminal after it, uses its shell and folder', async () => {
    usePresetsStore.setState({
      presets: [preset({ shellId: 'powershell', cwd: 'C:\\work\\blog' })]
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Dev server şablonunu başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({
      shellId: 'powershell',
      cwd: 'C:\\work\\blog',
      startupCommand: 'npm run dev'
    })
    expect(api.terminal.create.mock.calls[0]![0].requireInstalled).toBeUndefined()
    expect(useTerminalStore.getState().panes[0]!.title).toBe('Dev server')
  })

  it('uses the workspace project folder and the default shell when the preset leaves them open', async () => {
    usePresetsStore.setState({ presets: [preset()] })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Dev server şablonunu başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ cwd: 'C:\\work\\shop', shellId: 'cmd' })
  })

  it('opens a plain terminal for a preset without a command', async () => {
    usePresetsStore.setState({ presets: [preset({ command: '' })] })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Dev server şablonunu başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0].startupCommand).toBeUndefined()
  })

  it('asks the main process to check an agent-style preset is installed, and shows the problem in the pane', async () => {
    usePresetsStore.setState({ presets: [preset({ name: 'Aider', kind: 'agent', command: 'aider --yes' })] })
    api.terminal.create.mockResolvedValueOnce({ ok: false, code: 'agent-missing', message: 'aider' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Aider şablonunu başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ startupCommand: 'aider --yes', requireInstalled: true })
    expect((await screen.findByRole('alert')).textContent).toMatch(/"aider" proqramı quraşdırılmayıb/)
  })

  it('remembers the command on the pane so Restart runs the same thing again', async () => {
    usePresetsStore.setState({ presets: [preset()] })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Dev server şablonunu başlat' }))
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.status).toBe('running'))
    api.terminal.create.mockClear()
    await useTerminalStore.getState().restart(useTerminalStore.getState().panes[0]!.id)
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ startupCommand: 'npm run dev' })
  })

  it('removes a preset only after confirmation', async () => {
    usePresetsStore.setState({ presets: [preset()] })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Dev server şablonunu sil' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Şablon silinsin?' })
    expect(dialog.textContent).toContain('"Dev server" şablonu silinəcək')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ləğv et' }))
    expect(usePresetsStore.getState().presets).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Dev server şablonunu sil' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sil' }))
    expect(usePresetsStore.getState().presets).toHaveLength(0)
    expect(api.terminal.kill).not.toHaveBeenCalled()
  })
})

describe('creating and editing a preset', () => {
  async function openEditor(): Promise<HTMLElement> {
    render(<App />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Şablonlar' })).getByRole('button', { name: 'Yeni şablon' }))
    return screen.findByRole('dialog', { name: 'Yeni şablon' })
  }

  it('tells clearly that saving does not run anything', async () => {
    const dialog = await openEditor()
    expect(dialog.textContent).toContain('Yadda saxlamaq komandanı işə salmır')
    expect(dialog.textContent).toContain('yalnız "Başlat" düyməsinə basanda icra olunur')
  })

  it('saves a preset without starting it', async () => {
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'Testləri işlət' } })
    fireEvent.change(within(dialog).getByLabelText(/^Komanda/), { target: { value: 'npm test' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(usePresetsStore.getState().presets).toHaveLength(1)
    expect(usePresetsStore.getState().presets[0]).toMatchObject({
      name: 'Testləri işlət',
      kind: 'command',
      command: 'npm test',
      shellId: null,
      cwd: null
    })
    expect(await screen.findByText('"Testləri işlət" şablonu yadda saxlandı. İşə salınmadı.')).toBeTruthy()
    expect(api.terminal.create).not.toHaveBeenCalled()
    expect(api.terminal.write).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('refuses an empty name', async () => {
    const dialog = await openEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(within(dialog).getByRole('alert').textContent).toBe('Ad boş ola bilməz.')
    expect(usePresetsStore.getState().presets).toHaveLength(0)
  })

  it('needs a command for an agent preset', async () => {
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'Aider' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: /Agent proqramı/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(within(dialog).getByRole('alert').textContent).toBe('Agent şablonu üçün komanda lazımdır.')
    fireEvent.change(within(dialog).getByLabelText(/^Komanda/), { target: { value: 'aider' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(usePresetsStore.getState().presets[0]).toMatchObject({ kind: 'agent', command: 'aider' })
  })

  it('refuses a command that carries control characters, such as one pasted from a terminal log', async () => {
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'Bad' } })
    fireEvent.change(within(dialog).getByLabelText(/^Komanda/), { target: { value: 'echo a\u001b[31m' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('bir sətir olmalıdır')
    expect(usePresetsStore.getState().presets).toHaveLength(0)
  })

  it('allows an empty command for an ordinary preset: it just opens a terminal', async () => {
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'Boş' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(usePresetsStore.getState().presets[0]).toMatchObject({ name: 'Boş', command: '' })
  })

  it('needs a folder when "fixed folder" is chosen, and takes it from the folder picker', async () => {
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'Blog' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sabit qovluq' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('Sabit qovluğu seçin')
    api.project.pick.mockResolvedValue({ path: 'C:\\work\\blog' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Seç…' }))
    await waitFor(() => expect(within(dialog).getByText('C:\\work\\blog')).toBeTruthy())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(usePresetsStore.getState().presets[0]!.cwd).toBe('C:\\work\\blog')
    expect(useProjectStore.getState().projectPath).toBe('C:\\work\\shop')
  })

  it('keeps the old folder when the picker is cancelled', async () => {
    const dialog = await openEditor()
    api.project.pick.mockResolvedValue({ path: null })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sabit qovluq' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Seç…' }))
    await waitFor(() => expect(api.project.pick).toHaveBeenCalled())
    expect(within(dialog).getByText('Qovluq seçilməyib')).toBeTruthy()
  })

  it('lets me choose the shell the preset should use', async () => {
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'PS' } })
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Windows PowerShell' })).toBeTruthy())
    fireEvent.change(within(dialog).getByLabelText('Shell'), { target: { value: 'powershell' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(usePresetsStore.getState().presets[0]!.shellId).toBe('powershell')
  })

  it('edits an existing preset in place, starting from its current values', async () => {
    usePresetsStore.setState({ presets: [preset({ shellId: 'powershell', cwd: 'C:\\work\\blog' })] })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Dev server şablonunu düzəlt' }))
    const dialog = await screen.findByRole('dialog', { name: 'Şablonu düzəlt' })
    expect((within(dialog).getByLabelText('Ad') as HTMLInputElement).value).toBe('Dev server')
    expect((within(dialog).getByLabelText(/^Komanda/) as HTMLInputElement).value).toBe('npm run dev')
    expect(within(dialog).getByText('C:\\work\\blog')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText(/^Komanda/), { target: { value: 'npm run dev -- --host' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(usePresetsStore.getState().presets).toHaveLength(1)
    expect(usePresetsStore.getState().presets[0]).toMatchObject({
      id: '44444444-4444-4444-8444-444444444444',
      command: 'npm run dev -- --host'
    })
    expect(api.terminal.create).not.toHaveBeenCalled()
  })

  it('cancels with Escape without saving', async () => {
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'Draft' } })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(usePresetsStore.getState().presets).toHaveLength(0)
  })

  it('stops at one hundred presets', async () => {
    usePresetsStore.setState({
      presets: Array.from({ length: 100 }, (_, index) =>
        preset({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: `P${index}` })
      )
    })
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByLabelText('Ad'), { target: { value: 'One too many' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }))
    expect(within(dialog).getByRole('alert').textContent).toBe('Şablon limiti dolub (100).')
    expect(usePresetsStore.getState().presets).toHaveLength(100)
  })
})

describe('start with choices', () => {
  async function openLaunch(): Promise<HTMLElement> {
    render(<App />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Şablonlar' })).getByRole('button', { name: 'Seçimlə başlat…' }))
    return screen.findByRole('dialog', { name: 'Seçimlə başlat' })
  }

  it('starts the chosen agent in the chosen shell and folder', async () => {
    const dialog = await openLaunch()
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Windows PowerShell' })).toBeTruthy())
    fireEvent.change(within(dialog).getByLabelText('Proqram'), { target: { value: 'agent:gemini' } })
    fireEvent.change(within(dialog).getByLabelText('Shell'), { target: { value: 'powershell' } })
    api.project.pick.mockResolvedValue({ path: 'C:\\work\\blog' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Seç…' }))
    await waitFor(() => expect(within(dialog).getByText('C:\\work\\blog')).toBeTruthy())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({
      agentId: 'gemini',
      shellId: 'powershell',
      cwd: 'C:\\work\\blog'
    })
    expect(useProjectStore.getState().projectPath).toBe('C:\\work\\shop')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('uses the current project and the default shell when nothing is changed', async () => {
    const dialog = await openLaunch()
    expect(within(dialog).getByText('C:\\work\\shop')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0]).toMatchObject({ agentId: 'claude', cwd: 'C:\\work\\shop', shellId: 'cmd' })
  })

  it('warns before starting an agent that is not on the PATH', async () => {
    api.agents.status.mockResolvedValue({ claude: true, codex: false, gemini: true })
    const dialog = await openLaunch()
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Codex (tapılmadı)' })).toBeTruthy())
    fireEvent.change(within(dialog).getByLabelText('Proqram'), { target: { value: 'agent:codex' } })
    expect(within(dialog).getByRole('note').textContent).toContain('PATH-də tapılmadı')
    fireEvent.change(within(dialog).getByLabelText('Proqram'), { target: { value: 'agent:claude' } })
    expect(within(dialog).queryByRole('note')).toBeNull()
  })

  it('can start a plain terminal or one of my presets', async () => {
    usePresetsStore.setState({ presets: [preset()] })
    const dialog = await openLaunch()
    fireEvent.change(within(dialog).getByLabelText('Proqram'), { target: { value: 'plain' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0].agentId).toBeUndefined()
    expect(api.terminal.create.mock.calls[0]![0].startupCommand).toBeUndefined()

    fireEvent.click(within(screen.getByRole('region', { name: 'Şablonlar' })).getByRole('button', { name: 'Seçimlə başlat…' }))
    const second = await screen.findByRole('dialog', { name: 'Seçimlə başlat' })
    fireEvent.change(within(second).getByLabelText('Proqram'), { target: { value: `preset:${preset().id}` } })
    fireEvent.click(within(second).getByRole('button', { name: 'Başlat' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(2))
    expect(api.terminal.create.mock.calls[1]![0]).toMatchObject({ startupCommand: 'npm run dev' })
  })

  it('starts nothing when cancelled', async () => {
    const dialog = await openLaunch()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ləğv et' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.terminal.create).not.toHaveBeenCalled()
  })

  it('keeps focus inside the dialog when Tab goes past the last button', async () => {
    const dialog = await openLaunch()
    const start = within(dialog).getByRole('button', { name: 'Başlat' })
    start.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})

describe('settings', () => {
  async function openSettings(): Promise<HTMLElement> {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Ayarlar' }))
    return screen.findByRole('dialog', { name: 'Ayarlar' })
  }

  it('shows the current font size and changes it with the buttons, within limits', async () => {
    const dialog = await openSettings()
    const value = (): string => dialog.querySelector('.stepper__value')!.textContent!
    expect(value()).toBe('13')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Şrifti böyüt' }))
    expect(value()).toBe('14')
    expect(usePrefsStore.getState().defaultFontSize).toBe(14)
    usePrefsStore.setState({ defaultFontSize: 28 })
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Şrifti böyüt' }) as HTMLButtonElement).disabled).toBe(true))
    usePrefsStore.setState({ defaultFontSize: 9 })
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Şrifti kiçilt' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('gives new terminals the chosen font size but leaves open ones alone', async () => {
    await (async () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
      await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(1))
    })()
    act(() => usePrefsStore.getState().setDefaultFontSize(17))
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(2))
    expect(useTerminalStore.getState().panes.map((pane) => pane.fontSize)).toEqual([13, 17])
  })

  it('can apply the font size to every open terminal in one go', async () => {
    render(<App />)
    for (let index = 0; index < 2; index++) {
      fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
      await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(index + 1))
    }
    act(() => usePrefsStore.getState().setDefaultFontSize(19))
    fireEvent.click(screen.getByRole('button', { name: 'Ayarlar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ayarlar' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bütün açıq terminallara tətbiq et' }))
    expect(useTerminalStore.getState().panes.map((pane) => pane.fontSize)).toEqual([19, 19])
  })

  it('"Reset font size" in a pane goes back to the chosen default, not to a fixed number', async () => {
    usePrefsStore.setState({ defaultFontSize: 16 })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(1))
    const id = useTerminalStore.getState().panes[0]!.id
    act(() => useTerminalStore.getState().setFontSize(id, 22))
    act(() => useTerminalStore.getState().resetFontSize(id))
    expect(useTerminalStore.getState().panes[0]!.fontSize).toBe(16)
  })

  it('lets me choose which shell the plain New terminal button uses', async () => {
    const dialog = await openSettings()
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Windows PowerShell' })).toBeTruthy())
    fireEvent.change(within(dialog).getByLabelText('Standart shell'), { target: { value: 'powershell' } })
    expect(usePrefsStore.getState().defaultShellId).toBe('powershell')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bağla' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yeni terminal' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0].shellId).toBe('powershell')
  })

  it('goes back to automatic shell choice', async () => {
    usePrefsStore.setState({ defaultShellId: 'powershell' })
    const dialog = await openSettings()
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Windows PowerShell' })).toBeTruthy())
    fireEvent.change(within(dialog).getByLabelText('Standart shell'), { target: { value: '' } })
    expect(usePrefsStore.getState().defaultShellId).toBeNull()
  })

  it('falls back to CMD when the chosen default shell is gone from the computer', async () => {
    usePrefsStore.setState({ defaultShellId: 'wsl:Removed' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Yeni terminal' }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
    expect(api.terminal.create.mock.calls[0]![0].shellId).toBe('cmd')
  })

  it('lists every shortcut and what the terminal itself keeps for Ctrl+C and friends', async () => {
    const dialog = await openSettings()
    const shortcuts = within(dialog).getByRole('region', { name: 'Qısayollar' })
    expect(shortcuts.textContent).toContain('Əmr paleti')
    expect(shortcuts.textContent).toContain('Ctrl+K')
    expect(shortcuts.textContent).toContain('Ctrl+Shift+T')
    expect(shortcuts.textContent).toContain('Ctrl+1 … Ctrl+9')
    expect(shortcuts.textContent).toContain('Seçim varsa kopyalayır, yoxdursa proqramı dayandırır')
    expect(shortcuts.textContent).toContain('Yeganə istisna Ctrl+K-dır')
  })

  it('shows the version and says nothing leaves the computer', async () => {
    const dialog = await openSettings()
    await waitFor(() => expect(within(dialog).getByText('AgentGrid 0.1.0')).toBeTruthy())
    expect(within(dialog).getByText(/heç yerə göndərilmir/)).toBeTruthy()
  })

  it('closes with the button and with Escape', async () => {
    const dialog = await openSettings()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bağla' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ayarlar' }))
    fireEvent.keyDown(await screen.findByRole('dialog', { name: 'Ayarlar' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
