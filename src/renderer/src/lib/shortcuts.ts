export const PANE_SHORTCUT_COUNT = 9

const FOCUS_PANE_IDS = [
  'focusPane1',
  'focusPane2',
  'focusPane3',
  'focusPane4',
  'focusPane5',
  'focusPane6',
  'focusPane7',
  'focusPane8',
  'focusPane9'
] as const

export const SHORTCUT_IDS = [
  'palette',
  'newTerminal',
  'newClaude',
  'closePane',
  'toggleFocus',
  'toggleSidebar',
  'toggleSessions',
  'toggleSend',
  'openSettings',
  'nextPane',
  'previousPane',
  ...FOCUS_PANE_IDS
] as const

export type ShortcutId = (typeof SHORTCUT_IDS)[number]

interface Binding {
  shift: boolean
  code: string
  label: string
}

const BINDINGS: Record<ShortcutId, Binding> = {
  palette: { shift: false, code: 'KeyK', label: 'Ctrl+K' },
  newTerminal: { shift: true, code: 'KeyT', label: 'Ctrl+Shift+T' },
  newClaude: { shift: true, code: 'KeyL', label: 'Ctrl+Shift+L' },
  closePane: { shift: true, code: 'KeyW', label: 'Ctrl+Shift+W' },
  toggleFocus: { shift: true, code: 'KeyM', label: 'Ctrl+Shift+M' },
  toggleSidebar: { shift: true, code: 'KeyB', label: 'Ctrl+Shift+B' },
  toggleSessions: { shift: true, code: 'KeyH', label: 'Ctrl+Shift+H' },
  toggleSend: { shift: true, code: 'KeyS', label: 'Ctrl+Shift+S' },
  openSettings: { shift: false, code: 'Comma', label: 'Ctrl+,' },
  nextPane: { shift: false, code: 'PageDown', label: 'Ctrl+PageDown' },
  previousPane: { shift: false, code: 'PageUp', label: 'Ctrl+PageUp' },
  focusPane1: { shift: false, code: 'Digit1', label: 'Ctrl+1' },
  focusPane2: { shift: false, code: 'Digit2', label: 'Ctrl+2' },
  focusPane3: { shift: false, code: 'Digit3', label: 'Ctrl+3' },
  focusPane4: { shift: false, code: 'Digit4', label: 'Ctrl+4' },
  focusPane5: { shift: false, code: 'Digit5', label: 'Ctrl+5' },
  focusPane6: { shift: false, code: 'Digit6', label: 'Ctrl+6' },
  focusPane7: { shift: false, code: 'Digit7', label: 'Ctrl+7' },
  focusPane8: { shift: false, code: 'Digit8', label: 'Ctrl+8' },
  focusPane9: { shift: false, code: 'Digit9', label: 'Ctrl+9' }
}

export interface KeyEventLike {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  code: string
}

export function matchShortcut(event: KeyEventLike): ShortcutId | null {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null
  for (const id of SHORTCUT_IDS) {
    const binding = BINDINGS[id]
    if (binding.code === event.code && binding.shift === event.shiftKey) return id
  }
  return null
}

export function formatShortcut(id: ShortcutId): string {
  return BINDINGS[id].label
}

export function withShortcut(text: string, id: ShortcutId): string {
  return `${text} (${formatShortcut(id)})`
}

export function paneShortcutIndex(id: ShortcutId): number | null {
  const index = FOCUS_PANE_IDS.indexOf(id as (typeof FOCUS_PANE_IDS)[number])
  return index === -1 ? null : index
}

export function focusPaneShortcut(index: number): ShortcutId | null {
  return FOCUS_PANE_IDS[index] ?? null
}
