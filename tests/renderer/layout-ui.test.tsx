import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from '../../src/renderer/src/App'
import { resetAppInfoCache } from '../../src/renderer/src/lib/app-info'
import { resetShellsCache } from '../../src/renderer/src/lib/shells'
import { useLayoutStore } from '../../src/renderer/src/state/layout-store'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useTerminalStore } from '../../src/renderer/src/state/terminal-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'
import { fakeRegistry } from './fake-registry'

let api: AgentGridMock

beforeEach(() => {
  api = createAgentGridMock()
  window.agentgrid = api
  resetShellsCache()
  resetAppInfoCache()
  fakeRegistry.reset()
  useProjectStore.setState({ projectPath: 'C:\\work\\shop', recentPaths: ['C:\\work\\shop'] })
  useUiStore.setState({ sidebarOpen: true, toasts: [], pendingCloseId: null })
  useTerminalStore.setState({ panes: [], activePaneId: null })
  useLayoutStore.setState({ preset: 'auto', focusMode: false, columnSizes: [], rowSizes: [] })
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

function grid(): HTMLElement {
  return document.querySelector<HTMLElement>('.pane-grid')!
}

function chooseLayout(name: RegExp): void {
  fireEvent.click(screen.getByRole('button', { name: 'Düzülüş' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name }))
}

function paneTitlesInGridOrder(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.pane'))
    .sort((a, b) => {
      const rowA = Number(a.style.gridRow)
      const rowB = Number(b.style.gridRow)
      return rowA - rowB || Number(a.style.gridColumn) - Number(b.style.gridColumn)
    })
    .map((pane) => pane.querySelector('.pane__title')!.textContent!)
}

describe('layout menu', () => {
  it('lists every ready-made layout and marks the current one', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Düzülüş' }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => item.querySelector('.menu__label')!.textContent)).toEqual([
      'Avtomatik',
      'Tək terminal',
      'İki sütun',
      'İki sətir',
      '2 × 2',
      '3 × 2',
      '2 × 3'
    ])
    expect(items[0]!.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemcheckbox', { name: /fokus rejimi/i })).toBeTruthy()
  })

  it('switches to two columns', async () => {
    await openPanes(2)
    chooseLayout(/^İki sütun/)
    expect(useLayoutStore.getState().preset).toBe('columns')
    expect(grid().style.gridTemplateColumns).toBe('0.5fr 0.5fr')
    expect(grid().style.gridTemplateRows).toBe('1fr')
  })

  it('switches to two rows', async () => {
    await openPanes(2)
    chooseLayout(/^İki sətir/)
    expect(grid().style.gridTemplateColumns).toBe('1fr')
    expect(grid().style.gridTemplateRows).toBe('0.5fr 0.5fr')
  })

  it('offers empty slots for the room that is left in a fixed layout', async () => {
    await openPanes(1)
    chooseLayout(/2 × 2/)
    expect(screen.getAllByRole('group', { name: 'Boş yuva' })).toHaveLength(3)
  })

  it('starts Claude in an empty slot', async () => {
    await openPanes(1)
    chooseLayout(/2 × 2/)
    const slot = screen.getAllByRole('group', { name: 'Boş yuva' })[0]!
    fireEvent.click(within(slot).getByRole('button', { name: /claude başlat/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(2))
    expect(screen.getAllByRole('group', { name: 'Boş yuva' })).toHaveLength(2)
  })

  it('grows on its own when more terminals are opened than the chosen layout holds', async () => {
    await openPanes(1)
    chooseLayout(/tək terminal/i)
    expect(screen.queryAllByRole('group', { name: 'Boş yuva' })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(2))
    expect(grid().style.gridTemplateColumns).toBe('0.5fr 0.5fr')
    expect(screen.getByRole('button', { name: 'Düzülüş' }).getAttribute('data-tip')).toMatch(/avtomatik böyüdüldü/)
  })

  it('shows the current grid size in the status bar', async () => {
    await openPanes(4)
    expect(screen.getByText('2 × 2')).toBeTruthy()
  })

  it('keeps terminals assigned to the same places when the layout changes', async () => {
    await openPanes(3)
    useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[0]!.id, 'A')
    useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[1]!.id, 'B')
    useTerminalStore.getState().renamePane(useTerminalStore.getState().panes[2]!.id, 'C')
    chooseLayout(/2 × 3/)
    expect(paneTitlesInGridOrder()).toEqual(['A', 'B', 'C'])
    chooseLayout(/3 × 2/)
    expect(paneTitlesInGridOrder()).toEqual(['A', 'B', 'C'])
  })

  it('closes the menu with Escape', async () => {
    await openPanes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Düzülüş' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('closing a pane adapts the grid', () => {
  it('moves the remaining panes up and shrinks the grid in automatic mode', async () => {
    await openPanes(3)
    expect(grid().style.gridTemplateColumns).toBe('0.5fr 0.5fr')
    const second = useTerminalStore.getState().panes[1]!.id
    act(() => useTerminalStore.getState().close(second))
    expect(paneTitlesInGridOrder()).toEqual(['Claude', 'Claude 3'])
    expect(grid().style.gridTemplateRows).toBe('1fr')
  })
})

describe('focus mode', () => {
  it('shows only the active pane with tabs for switching', async () => {
    await openPanes(3)
    fireEvent.click(screen.getByRole('button', { name: 'Düzülüş' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /fokus rejimi/i }))
    const visible = Array.from(document.querySelectorAll<HTMLElement>('.pane')).filter(
      (pane) => pane.style.display !== 'none'
    )
    expect(visible).toHaveLength(1)
    expect(visible[0]!.getAttribute('aria-label')).toBe('Terminal: Claude 3')
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Claude', 'Claude 2', 'Claude 3'])
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.getByText('Fokus')).toBeTruthy()
  })

  it('switches the visible pane from the tabs and keeps the others running', async () => {
    await openPanes(2)
    useTerminalStore.getState().toggleFocus(useTerminalStore.getState().panes[1]!.id)
    fireEvent.click(await screen.findByRole('tab', { name: /^Claude$/ }))
    const visible = Array.from(document.querySelectorAll<HTMLElement>('.pane')).filter(
      (pane) => pane.style.display !== 'none'
    )
    expect(visible[0]!.getAttribute('aria-label')).toBe('Terminal: Claude')
    expect(api.terminal.kill).not.toHaveBeenCalled()
    expect(useTerminalStore.getState().panes.every((pane) => pane.status === 'running')).toBe(true)
  })

  it('maximizes from the pane button and restores from the same button', async () => {
    await openPanes(2)
    const first = screen.getByRole('region', { name: 'Terminal: Claude' })
    fireEvent.click(within(first).getByRole('button', { name: 'Böyüt' }))
    expect(useLayoutStore.getState().focusMode).toBe(true)
    const focused = screen.getByRole('region', { name: 'Terminal: Claude' })
    fireEvent.click(within(focused).getByRole('button', { name: 'Bərpa et' }))
    expect(useLayoutStore.getState().focusMode).toBe(false)
    expect(Array.from(document.querySelectorAll<HTMLElement>('.pane')).every((pane) => pane.style.display !== 'none')).toBe(true)
  })

  it('maximizes when the pane header is double-clicked', async () => {
    await openPanes(2)
    const header = screen.getByRole('region', { name: 'Terminal: Claude' }).querySelector('.pane__header')!
    fireEvent.doubleClick(header)
    expect(useLayoutStore.getState().focusMode).toBe(true)
  })

  it('opens a new terminal visibly even while in focus mode', async () => {
    await openPanes(1)
    useTerminalStore.getState().toggleFocus(useTerminalStore.getState().panes[0]!.id)
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(2))
    const visible = Array.from(document.querySelectorAll<HTMLElement>('.pane')).filter(
      (pane) => pane.style.display !== 'none'
    )
    expect(visible[0]!.getAttribute('aria-label')).toBe('Terminal: Claude 2')
  })
})

describe('pane menu', () => {
  function openMenu(title: string): HTMLElement {
    const pane = screen.getByRole('region', { name: `Terminal: ${title}` })
    fireEvent.click(within(pane).getByRole('button', { name: 'Panel əməliyyatları' }))
    return pane
  }

  it('renames a pane with Enter', async () => {
    await openPanes(1)
    openMenu('Claude')
    fireEvent.click(screen.getByRole('menuitem', { name: /adı dəyişdir/i }))
    const input = screen.getByRole('textbox', { name: 'Terminalın adı' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Backend' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useTerminalStore.getState().panes[0]!.title).toBe('Backend')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('region', { name: 'Terminal: Backend' })).toBeTruthy()
  })

  it('keeps the old name when renaming is cancelled with Escape', async () => {
    await openPanes(1)
    openMenu('Claude')
    fireEvent.click(screen.getByRole('menuitem', { name: /adı dəyişdir/i }))
    const input = screen.getByRole('textbox', { name: 'Terminalın adı' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(useTerminalStore.getState().panes[0]!.title).toBe('Claude')
  })

  it('renames when the title is double-clicked', async () => {
    await openPanes(1)
    fireEvent.doubleClick(screen.getByText('Claude', { selector: '.pane__title' }))
    expect(screen.getByRole('textbox', { name: 'Terminalın adı' })).toBeTruthy()
    expect(useLayoutStore.getState().focusMode).toBe(false)
  })

  it('restarts from the menu', async () => {
    await openPanes(1)
    api.terminal.create.mockClear()
    openMenu('Claude')
    fireEvent.click(screen.getByRole('menuitem', { name: /yenidən başlat/i }))
    await waitFor(() => expect(api.terminal.create).toHaveBeenCalledTimes(1))
  })

  it('clears the screen from the menu', async () => {
    await openPanes(1)
    openMenu('Claude')
    fireEvent.click(screen.getByRole('menuitem', { name: /ekranı təmizlə/i }))
    expect(fakeRegistry.all()[0]!.clear).toHaveBeenCalled()
  })

  it('moves a pane earlier and later', async () => {
    await openPanes(3)
    openMenu('Claude 3')
    fireEvent.click(screen.getByRole('menuitem', { name: /əvvələ çək/i }))
    expect(paneTitlesInGridOrder()).toEqual(['Claude', 'Claude 3', 'Claude 2'])
    openMenu('Claude')
    fireEvent.click(screen.getByRole('menuitem', { name: /sonraya çək/i }))
    expect(paneTitlesInGridOrder()).toEqual(['Claude 3', 'Claude', 'Claude 2'])
  })

  it('changes the font size of one pane only and applies it to the terminal', async () => {
    await openPanes(2)
    openMenu('Claude')
    fireEvent.click(screen.getByRole('menuitem', { name: /şrifti böyüt/i }))
    expect(useTerminalStore.getState().panes.map((pane) => pane.fontSize)).toEqual([14, 13])
    await waitFor(() => expect(fakeRegistry.all()[0]!.setFontSize).toHaveBeenLastCalledWith(14))
    openMenu('Claude')
    fireEvent.click(screen.getByRole('menuitem', { name: /şrifti kiçilt/i }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Terminal: Claude' })).getByRole('button', { name: 'Panel əməliyyatları' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /şrift ölçüsünü sıfırla/i }))
    expect(useTerminalStore.getState().panes[0]!.fontSize).toBe(13)
  })

  it('disables the larger option at the biggest size', async () => {
    await openPanes(1)
    useTerminalStore.getState().setFontSize(useTerminalStore.getState().panes[0]!.id, 28)
    openMenu('Claude')
    expect(screen.getByRole('menuitem', { name: /şrifti böyüt/i }).getAttribute('aria-disabled')).toBe('true')
  })
})

describe('dragging a pane onto another', () => {
  class FakeDataTransfer {
    types: string[] = []
    effectAllowed = 'move'
    dropEffect = 'move'
    private readonly store = new Map<string, string>()

    setData(type: string, value: string): void {
      this.store.set(type, value)
      this.types.push(type)
    }

    getData(type: string): string {
      return this.store.get(type) ?? ''
    }
  }

  function dataTransfer(): DataTransfer {
    return new FakeDataTransfer() as unknown as DataTransfer
  }

  it('swaps their places', async () => {
    await openPanes(2)
    const first = screen.getByRole('region', { name: 'Terminal: Claude' })
    const second = screen.getByRole('region', { name: 'Terminal: Claude 2' })
    const transfer = dataTransfer()
    fireEvent.dragStart(first.querySelector('.pane__header')!, { dataTransfer: transfer })
    fireEvent.dragOver(second, { dataTransfer: transfer })
    expect(second.getAttribute('data-drop-target')).toBe('true')
    fireEvent.drop(second, { dataTransfer: transfer })
    expect(paneTitlesInGridOrder()).toEqual(['Claude 2', 'Claude'])
    expect(second.getAttribute('data-drop-target')).toBe('false')
  })

  it('ignores drags that are not panes', async () => {
    await openPanes(2)
    const second = screen.getByRole('region', { name: 'Terminal: Claude 2' })
    fireEvent.dragOver(second, { dataTransfer: dataTransfer() })
    expect(second.getAttribute('data-drop-target')).toBe('false')
  })
})

describe('resizing with the dividers', () => {
  it('shows one divider between two columns and none for a single pane', async () => {
    await openPanes(1)
    expect(screen.queryAllByRole('separator')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    await waitFor(() => expect(useTerminalStore.getState().panes).toHaveLength(2))
    const separators = screen.getAllByRole('separator')
    expect(separators).toHaveLength(1)
    expect(separators[0]!.getAttribute('aria-label')).toBe('Sütun ayırıcısı 1')
    expect(separators[0]!.getAttribute('aria-orientation')).toBe('vertical')
    expect(separators[0]!.getAttribute('aria-valuenow')).toBe('50')
  })

  it('shows dividers in both directions for a 2 × 2 grid', async () => {
    await openPanes(4)
    expect(screen.getAllByRole('separator').map((item) => item.getAttribute('aria-orientation'))).toEqual([
      'vertical',
      'horizontal'
    ])
  })

  it('moves a divider with the arrow keys and resets it with Enter', async () => {
    await openPanes(2)
    const separator = screen.getByRole('separator', { name: 'Sütun ayırıcısı 1' })
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(useLayoutStore.getState().columnSizes[0]).toBeCloseTo(0.52)
    expect(separator.getAttribute('aria-valuenow')).toBe('52')
    fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true })
    expect(useLayoutStore.getState().columnSizes[0]).toBeCloseTo(0.42)
    fireEvent.keyDown(separator, { key: 'Enter' })
    expect(useLayoutStore.getState().columnSizes).toEqual([0.5, 0.5])
  })

  it('stops a pane from being squeezed away', async () => {
    await openPanes(2)
    const separator = screen.getByRole('separator', { name: 'Sütun ayırıcısı 1' })
    for (let press = 0; press < 20; press++) fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true })
    expect(useLayoutStore.getState().columnSizes[0]).toBeCloseTo(0.1)
  })

  it('writes the new sizes into the grid', async () => {
    await openPanes(2)
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight', shiftKey: true })
    expect(grid().style.gridTemplateColumns).toBe('0.6fr 0.4fr')
  })

  it('resizes by dragging', async () => {
    await openPanes(2)
    const container = grid()
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 600, left: 0, top: 0, right: 1000, bottom: 600, x: 0, y: 0 }) as DOMRect
    const separator = screen.getByRole('separator')
    separator.setPointerCapture = () => undefined
    separator.hasPointerCapture = () => false
    fireEvent.pointerDown(separator, { pointerId: 1, button: 0, clientX: 500, clientY: 100 })
    expect(grid().getAttribute('data-dragging')).toBe('true')
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 700, clientY: 100 })
    expect(useLayoutStore.getState().columnSizes[0]).toBeCloseTo(0.7)
    fireEvent.pointerUp(separator, { pointerId: 1 })
    expect(grid().getAttribute('data-dragging')).toBe('false')
  })

  it('resets the sizes when the divider is double-clicked', async () => {
    await openPanes(2)
    const separator = screen.getByRole('separator')
    fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true })
    fireEvent.doubleClick(separator)
    expect(useLayoutStore.getState().columnSizes).toEqual([0.5, 0.5])
  })
})
