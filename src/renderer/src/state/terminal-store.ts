import { create } from 'zustand'
import { findAgent, type AgentId } from '@shared/agents'
import type { ShellInfo, TerminalErrorCode, TerminalExitEvent } from '@shared/ipc'
import { getAppInfo } from '../lib/app-info'
import { getShells, pickDefaultShell } from '../lib/shells'
import { strings } from '../strings'
import { terminalRegistry } from '../terminal/registry'
import { useUiStore } from './ui-store'

export type PaneStatus = 'starting' | 'running' | 'exited' | 'error'

export interface Pane {
  id: string
  title: string
  shellId: string
  shellLabel: string
  cwd: string
  agentId?: AgentId
  status: PaneStatus
  exitCode?: number
  errorCode?: TerminalErrorCode
  errorDetail?: string
}

export interface LaunchOptions {
  cwd: string
  agentId?: AgentId
  shellId?: string
}

interface TerminalState {
  panes: Pane[]
  activePaneId: string | null
  launch: (options: LaunchOptions) => Promise<string | null>
  spawnPane: (id: string, cols: number, rows: number) => Promise<void>
  restart: (id: string) => Promise<void>
  close: (id: string) => void
  setActive: (id: string) => void
  clear: (id: string) => void
  handleExit: (event: TerminalExitEvent) => void
}

export function nextPaneTitle(base: string, existingTitles: readonly string[]): string {
  const used = new Set(existingTitles)
  for (let index = 1; ; index++) {
    const candidate = index === 1 ? base : `${base} ${index}`
    if (!used.has(candidate)) return candidate
  }
}

export const useTerminalStore = create<TerminalState>((set, get) => {
  function updatePane(id: string, patch: Partial<Pane>): void {
    set((state) => ({
      panes: state.panes.map((pane) => (pane.id === id ? { ...pane, ...patch } : pane))
    }))
  }

  function findPane(id: string): Pane | undefined {
    return get().panes.find((pane) => pane.id === id)
  }

  return {
    panes: [],
    activePaneId: null,

    launch: async ({ cwd, agentId, shellId }) => {
      const pushToast = useUiStore.getState().pushToast
      let shells: ShellInfo[]
      let windowsBuild: number
      try {
        shells = await getShells()
        windowsBuild = (await getAppInfo()).osBuild
      } catch {
        pushToast('error', strings.terminal.launchFailed)
        return null
      }

      const shell = shellId
        ? (shells.find((candidate) => candidate.id === shellId) ?? null)
        : pickDefaultShell(shells)
      if (!shell) {
        pushToast('error', strings.terminal.noShell)
        return null
      }

      const id = crypto.randomUUID()
      const base = agentId ? findAgent(agentId).label : shell.label
      const title = nextPaneTitle(
        base,
        get().panes.map((pane) => pane.title)
      )

      terminalRegistry.create(id, windowsBuild)
      set((state) => ({
        panes: [
          ...state.panes,
          { id, title, shellId: shell.id, shellLabel: shell.label, cwd, agentId, status: 'starting' }
        ],
        activePaneId: id
      }))
      return id
    },

    spawnPane: async (id, cols, rows) => {
      const pane = findPane(id)
      const managed = terminalRegistry.get(id)
      if (!pane || !managed) return
      updatePane(id, { status: 'starting', errorCode: undefined, errorDetail: undefined })

      const result = await window.agentgrid.terminal
        .create({ id, shellId: pane.shellId, cwd: pane.cwd, agentId: pane.agentId, cols, rows })
        .catch((error: unknown) => ({
          ok: false as const,
          code: 'spawn-failed' as const,
          message: error instanceof Error ? error.message : String(error)
        }))

      const current = findPane(id)
      if (!current) {
        if (result.ok) window.agentgrid.terminal.kill(id)
        return
      }
      if (current.status !== 'starting') return

      if (result.ok) {
        managed.markSpawned({ cols, rows })
        updatePane(id, { status: 'running' })
      } else {
        updatePane(id, { status: 'error', errorCode: result.code, errorDetail: result.message })
      }
    },

    restart: async (id) => {
      const managed = terminalRegistry.get(id)
      if (!managed || !findPane(id)) return
      window.agentgrid.terminal.kill(id)
      managed.reset()
      updatePane(id, {
        status: 'starting',
        exitCode: undefined,
        errorCode: undefined,
        errorDetail: undefined
      })
      managed.spawnRequested = true
      const size = managed.fit() ?? { cols: managed.term.cols, rows: managed.term.rows }
      await get().spawnPane(id, size.cols, size.rows)
      managed.focus()
    },

    close: (id) => {
      const { panes, activePaneId } = get()
      const index = panes.findIndex((pane) => pane.id === id)
      if (index === -1) return
      window.agentgrid.terminal.kill(id)
      terminalRegistry.remove(id)
      const remaining = panes.filter((pane) => pane.id !== id)
      const nextActive =
        activePaneId === id ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null) : activePaneId
      set({ panes: remaining, activePaneId: nextActive })
    },

    setActive: (id) => {
      if (get().activePaneId !== id) set({ activePaneId: id })
    },

    clear: (id) => {
      terminalRegistry.get(id)?.clear()
    },

    handleExit: (event) => {
      if (!findPane(event.id)) return
      updatePane(event.id, { status: 'exited', exitCode: event.exitCode })
    }
  }
})
