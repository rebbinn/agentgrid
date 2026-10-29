import { launchTerminal, requestClosePane } from '../state/launch-actions'
import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { paneShortcutIndex, type ShortcutId } from '../lib/shortcuts'

function activePaneId(): string | null {
  return useTerminalStore.getState().activePaneId
}

export function newTerminal(): void {
  void launchTerminal()
}

export function newClaude(): void {
  void launchTerminal({ agentId: 'claude' })
}

export function closeActivePane(): void {
  const id = activePaneId()
  if (id) requestClosePane(id)
}

export function toggleFocusOnActivePane(): void {
  const id = activePaneId()
  if (id) useTerminalStore.getState().toggleFocus(id)
}

export function toggleSidebar(): void {
  useUiStore.getState().toggleSidebar()
}

export function toggleSessionsTab(): void {
  useUiStore.getState().toggleSessionsTab()
}

export function togglePalette(): void {
  const { paletteOpen, setPaletteOpen } = useUiStore.getState()
  setPaletteOpen(!paletteOpen)
}

export function toggleSendPanel(): void {
  const ui = useUiStore.getState()
  if (ui.sendPanelOpen) {
    ui.setSendPanelOpen(false)
    return
  }
  if (useTerminalStore.getState().panes.length === 0) {
    ui.pushToast('warning', strings.send.noTerminal)
    return
  }
  ui.setSendPanelOpen(true)
}

export function openSettings(): void {
  useUiStore.getState().openDialog({ kind: 'settings' })
}

export function focusPaneAt(index: number): void {
  const pane = useTerminalStore.getState().panes[index]
  if (pane) useTerminalStore.getState().setActive(pane.id)
}

export function focusRelativePane(delta: 1 | -1): void {
  const { panes, activePaneId: current } = useTerminalStore.getState()
  if (panes.length === 0) return
  const index = panes.findIndex((pane) => pane.id === current)
  const next = (index + delta + panes.length) % panes.length
  const target = panes[next]
  if (target) useTerminalStore.getState().setActive(target.id)
}

export function runShortcut(id: ShortcutId): void {
  const paneIndex = paneShortcutIndex(id)
  if (paneIndex !== null) {
    focusPaneAt(paneIndex)
    return
  }
  switch (id) {
    case 'palette':
      togglePalette()
      break
    case 'newTerminal':
      newTerminal()
      break
    case 'newClaude':
      newClaude()
      break
    case 'closePane':
      closeActivePane()
      break
    case 'toggleFocus':
      toggleFocusOnActivePane()
      break
    case 'toggleSidebar':
      toggleSidebar()
      break
    case 'toggleSessions':
      toggleSessionsTab()
      break
    case 'toggleSend':
      toggleSendPanel()
      break
    case 'openSettings':
      openSettings()
      break
    case 'nextPane':
      focusRelativePane(1)
      break
    case 'previousPane':
      focusRelativePane(-1)
      break
  }
}
