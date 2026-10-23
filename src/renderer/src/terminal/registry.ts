import type { TerminalExitEvent } from '@shared/ipc'
import { ManagedTerminal } from './managed-terminal'

type ExitHandler = (event: TerminalExitEvent) => void

class TerminalRegistry {
  private readonly terminals = new Map<string, ManagedTerminal>()
  private unsubscribers: Array<() => void> = []

  init(onExit: ExitHandler): void {
    this.dispose()
    const api = window.agentgrid.terminal
    this.unsubscribers = [
      api.onData((event) => this.terminals.get(event.id)?.write(event.data)),
      api.onExit((event) => {
        this.terminals.get(event.id)?.markExited(event.exitCode)
        onExit(event)
      })
    ]
  }

  create(id: string, windowsBuild: number): ManagedTerminal {
    const terminal = new ManagedTerminal(id, windowsBuild)
    this.terminals.set(id, terminal)
    return terminal
  }

  get(id: string): ManagedTerminal | undefined {
    return this.terminals.get(id)
  }

  remove(id: string): void {
    this.terminals.get(id)?.dispose()
    this.terminals.delete(id)
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
  }
}

export const terminalRegistry = new TerminalRegistry()
