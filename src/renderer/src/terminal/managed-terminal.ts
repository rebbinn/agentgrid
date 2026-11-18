import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { ExitReason } from '@shared/ipc'
import { strings } from '../strings'
import {
  DEFAULT_FONT_SIZE,
  SCROLLBACK_LINES,
  TERMINAL_FONT_FAMILY,
  terminalTheme
} from './theme'

const ACK_BATCH_CHARS = 32 * 1024

export interface TerminalSize {
  cols: number
  rows: number
}

export type ZoomStep = number | 'reset'

export function zoomStepForKey(code: string): ZoomStep | null {
  if (code === 'Equal' || code === 'NumpadAdd') return 1
  if (code === 'Minus' || code === 'NumpadSubtract') return -1
  if (code === 'Digit0' || code === 'Numpad0') return 'reset'
  return null
}

export function cwdFromOsc7(data: string): string | null {
  try {
    const url = new URL(data)
    if (url.protocol !== 'file:') return null
    const path = decodeURIComponent(url.pathname)
    return path.startsWith('/') ? path : null
  } catch {
    return null
  }
}

function openLink(uri: string): void {
  void window.agentgrid.external.open(uri)
}

export class ManagedTerminal {
  readonly term: Terminal
  spawnRequested = false
  alive = false
  onZoom: (step: ZoomStep) => void = () => undefined
  onCwd: (path: string) => void = () => undefined

  private readonly fitAddon = new FitAddon()
  private container: HTMLElement | null = null
  private opened = false
  private lastSent: TerminalSize = { cols: 0, rows: 0 }
  private processedChars = 0

  constructor(
    readonly id: string,
    windowsBuild: number
  ) {
    this.term = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: DEFAULT_FONT_SIZE,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: SCROLLBACK_LINES,
      allowProposedApi: true,
      theme: terminalTheme,
      linkHandler: { activate: (_event, uri) => openLink(uri) },
      windowsPty: windowsBuild > 0 ? { backend: 'conpty', buildNumber: windowsBuild } : undefined
    })

    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)))
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'

    this.term.onData((data) => {
      if (this.alive) window.agentgrid.terminal.write(this.id, data)
    })
    this.term.attachCustomKeyEventHandler((event) => this.handleKey(event))
    this.term.parser.registerOscHandler(7, (data) => {
      const path = cwdFromOsc7(data)
      if (path) this.onCwd(path)
      return true
    })
  }

  attach(container: HTMLElement): void {
    this.container = container
    if (!this.opened) {
      this.term.open(container)
      this.opened = true
      this.loadWebgl()
      container.addEventListener('contextmenu', (event) => this.handleContextMenu(event))
    } else if (this.term.element && this.term.element.parentElement !== container) {
      container.appendChild(this.term.element)
    }
    this.fit()
  }

  detach(): void {
    this.container = null
  }

  fit(): TerminalSize | null {
    const container = this.container
    if (!container || container.clientWidth === 0 || container.clientHeight === 0) return null
    this.fitAddon.fit()
    const size = { cols: this.term.cols, rows: this.term.rows }
    if (this.alive && (size.cols !== this.lastSent.cols || size.rows !== this.lastSent.rows)) {
      window.agentgrid.terminal.resize(this.id, size.cols, size.rows)
      this.lastSent = size
    }
    return size
  }

  setFontSize(size: number): void {
    if (this.term.options.fontSize === size) return
    this.term.options.fontSize = size
    this.fit()
  }

  markSpawned(size: TerminalSize): void {
    this.alive = true
    this.lastSent = size
  }

  write(data: string): void {
    this.term.write(data, () => {
      this.processedChars += data.length
      if (this.processedChars >= ACK_BATCH_CHARS) {
        window.agentgrid.terminal.ack(this.id, this.processedChars)
        this.processedChars = 0
      }
    })
  }

  sendText(text: string, execute: boolean): boolean {
    if (!this.alive) return false
    const body = text.replace(/[\r\n]+$/, '')
    if (body.length > 0) this.term.paste(body)
    if (execute) window.agentgrid.terminal.write(this.id, '\r')
    return true
  }

  markExited(exitCode: number, reason?: ExitReason): void {
    this.alive = false
    const message = reason ? strings.ssh.exitMessage(reason, exitCode) : `[Proses bitdi, çıxış kodu ${exitCode}]`
    this.term.write(`\r\n\x1b[2m${message}\x1b[0m\r\n`)
  }

  reset(): void {
    this.alive = false
    this.spawnRequested = false
    this.processedChars = 0
    this.lastSent = { cols: 0, rows: 0 }
    this.term.reset()
  }

  clear(): void {
    this.term.clear()
  }

  focus(): void {
    this.term.focus()
  }

  dispose(): void {
    this.alive = false
    this.term.dispose()
  }

  private loadWebgl(): void {
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      this.term.loadAddon(webgl)
    } catch {
      return
    }
  }

  private copySelection(): void {
    const text = this.term.getSelection()
    if (!text) return
    void window.agentgrid.clipboard.writeText(text)
    this.term.clearSelection()
  }

  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true
    const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey

    if (ctrlOnly && event.code === 'KeyC' && (event.shiftKey || this.term.hasSelection())) {
      event.preventDefault()
      this.copySelection()
      return false
    }
    if (ctrlOnly && event.code === 'KeyV') return false
    if (ctrlOnly && !event.shiftKey && event.code === 'KeyK') return false

    const zoomStep = ctrlOnly ? zoomStepForKey(event.code) : null
    if (zoomStep !== null) {
      event.preventDefault()
      this.onZoom(zoomStep)
      return false
    }
    return true
  }

  private handleContextMenu(event: MouseEvent): void {
    event.preventDefault()
    if (this.term.hasSelection()) {
      this.copySelection()
      return
    }
    void window.agentgrid.clipboard.readText().then((text) => {
      if (text) this.term.paste(text)
    })
  }
}
