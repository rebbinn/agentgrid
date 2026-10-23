import type { ITheme } from '@xterm/xterm'

export const TERMINAL_FONT_FAMILY =
  "'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', Consolas, 'Courier New', monospace"

export const DEFAULT_FONT_SIZE = 13
export const SCROLLBACK_LINES = 5000

export const terminalTheme: ITheme = {
  background: '#0a0c0f',
  foreground: '#d7dce2',
  cursor: '#2dd4bf',
  cursorAccent: '#0a0c0f',
  selectionBackground: 'rgba(45, 212, 191, 0.28)',
  black: '#1b1f26',
  red: '#f85149',
  green: '#3fb950',
  yellow: '#e3b341',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#c9d1d9',
  brightBlack: '#6b7480',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#f2cc60',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f3f6'
}
