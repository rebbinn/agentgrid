import { describe, expect, it } from 'vitest'
import {
  SHORTCUT_IDS,
  focusPaneShortcut,
  formatShortcut,
  matchShortcut,
  paneShortcutIndex,
  withShortcut,
  type KeyEventLike
} from '../../src/renderer/src/lib/shortcuts'

function press(code: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike {
  return { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, code, ...modifiers }
}

describe('matchShortcut', () => {
  it.each([
    ['palette', 'KeyK', false],
    ['newTerminal', 'KeyT', true],
    ['newClaude', 'KeyL', true],
    ['closePane', 'KeyW', true],
    ['toggleFocus', 'KeyM', true],
    ['toggleSidebar', 'KeyB', true],
    ['toggleSessions', 'KeyH', true],
    ['toggleSend', 'KeyS', true],
    ['openSettings', 'Comma', false],
    ['nextPane', 'PageDown', false],
    ['previousPane', 'PageUp', false],
    ['focusPane1', 'Digit1', false],
    ['focusPane9', 'Digit9', false]
  ] as const)('%s is %s with Shift=%s', (id, code, shift) => {
    expect(matchShortcut(press(code, { shiftKey: shift }))).toBe(id)
  })

  it('needs Ctrl', () => {
    expect(matchShortcut(press('KeyK', { ctrlKey: false }))).toBeNull()
  })

  it('does not fire when Alt or the Windows key is also held, so AltGr layouts keep working', () => {
    expect(matchShortcut(press('KeyK', { altKey: true }))).toBeNull()
    expect(matchShortcut(press('KeyK', { metaKey: true }))).toBeNull()
    expect(matchShortcut(press('Digit1', { altKey: true }))).toBeNull()
  })

  it('treats Shift as part of the shortcut: Ctrl+T is not Ctrl+Shift+T', () => {
    expect(matchShortcut(press('KeyT'))).toBeNull()
    expect(matchShortcut(press('KeyK', { shiftKey: true }))).toBeNull()
    expect(matchShortcut(press('Digit1', { shiftKey: true }))).toBeNull()
  })

  it('ignores unknown keys', () => {
    expect(matchShortcut(press('KeyZ'))).toBeNull()
    expect(matchShortcut(press('F5'))).toBeNull()
  })

  it('does not depend on the keyboard layout letters, only on physical keys', () => {
    expect(matchShortcut({ ...press('KeyK'), key: 'ç' } as KeyEventLike)).toBe('palette')
  })
})

describe('shortcuts must not steal keys a terminal needs', () => {
  const terminalKeys: Array<[string, KeyEventLike]> = [
    ['Ctrl+C (interrupt / copy)', press('KeyC')],
    ['Ctrl+Shift+C (copy)', press('KeyC', { shiftKey: true })],
    ['Ctrl+V (paste)', press('KeyV')],
    ['Ctrl+Shift+V (paste)', press('KeyV', { shiftKey: true })],
    ['Ctrl+D (end of input)', press('KeyD')],
    ['Ctrl+Z (suspend)', press('KeyZ')],
    ['Ctrl+L (clear)', press('KeyL')],
    ['Ctrl+R (history search)', press('KeyR')],
    ['Ctrl+A (line start)', press('KeyA')],
    ['Ctrl+E (line end)', press('KeyE')],
    ['Ctrl+U (kill line)', press('KeyU')],
    ['Ctrl+W (delete word)', press('KeyW')],
    ['Ctrl+B (back)', press('KeyB')],
    ['Ctrl+F (forward)', press('KeyF')],
    ['Ctrl+N (next history)', press('KeyN')],
    ['Ctrl+P (previous history)', press('KeyP')],
    ['Ctrl+T (transpose)', press('KeyT')],
    ['Ctrl+H (backspace)', press('KeyH')],
    ['Ctrl+M (enter)', press('KeyM')],
    ['Ctrl+S (pause output)', press('KeyS')],
    ['Ctrl+Q (resume output)', press('KeyQ')],
    ['Ctrl+O', press('KeyO')],
    ['Ctrl+G', press('KeyG')],
    ['Ctrl+X', press('KeyX')],
    ['Ctrl+Y (yank)', press('KeyY')],
    ['Ctrl+J', press('KeyJ')],
    ['Ctrl+I (tab)', press('KeyI')],
    ['Ctrl+[ (escape)', press('BracketLeft')],
    ['Ctrl+\\ (quit)', press('Backslash')],
    ['Ctrl+Tab', press('Tab')],
    ['Ctrl+Enter', press('Enter')],
    ['Ctrl+Backspace (delete word)', press('Backspace')],
    ['Ctrl+Left / Right (word jump)', press('ArrowLeft')],
    ['Ctrl+Up / Down', press('ArrowDown')],
    ['Ctrl+Home / End', press('Home')],
    ['Ctrl++ (zoom)', press('Equal')],
    ['Ctrl+- (zoom)', press('Minus')],
    ['Ctrl+0 (zoom reset)', press('Digit0')]
  ]

  it.each(terminalKeys)('%s is left to the terminal', (_name, event) => {
    expect(matchShortcut(event)).toBeNull()
  })

  it('leaves every plain key and every Shift-only or Alt-only combination to the terminal', () => {
    for (const code of ['KeyA', 'KeyK', 'KeyT', 'Digit1', 'Comma', 'PageDown']) {
      expect(matchShortcut(press(code, { ctrlKey: false }))).toBeNull()
      expect(matchShortcut(press(code, { ctrlKey: false, shiftKey: true }))).toBeNull()
      expect(matchShortcut(press(code, { ctrlKey: false, altKey: true }))).toBeNull()
    }
  })
})

describe('the shortcut table', () => {
  it('gives every shortcut its own key combination', () => {
    const labels = SHORTCUT_IDS.map(formatShortcut)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('formats labels the way they are shown in tooltips and menus', () => {
    expect(formatShortcut('palette')).toBe('Ctrl+K')
    expect(formatShortcut('newClaude')).toBe('Ctrl+Shift+L')
    expect(formatShortcut('openSettings')).toBe('Ctrl+,')
    expect(withShortcut('Yeni terminal', 'newTerminal')).toBe('Yeni terminal (Ctrl+Shift+T)')
  })

  it('maps the first nine terminals to Ctrl+1 … Ctrl+9', () => {
    expect(paneShortcutIndex('focusPane1')).toBe(0)
    expect(paneShortcutIndex('focusPane9')).toBe(8)
    expect(paneShortcutIndex('palette')).toBeNull()
    expect(focusPaneShortcut(0)).toBe('focusPane1')
    expect(focusPaneShortcut(8)).toBe('focusPane9')
    expect(focusPaneShortcut(9)).toBeNull()
  })
})
