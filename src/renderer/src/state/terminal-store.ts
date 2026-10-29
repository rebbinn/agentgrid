import { create } from 'zustand'
import { findAgent, type AgentId } from '@shared/agents'
import type { ShellInfo, TerminalErrorCode, TerminalExitEvent } from '@shared/ipc'
import type { PresetKind, SavedPane } from '@shared/settings'
import { getAppInfo } from '../lib/app-info'
import { clampFontSize } from '../lib/font-size'
import { getShells, pickDefaultShell } from '../lib/shells'
import { strings } from '../strings'
import { terminalRegistry } from '../terminal/registry'
import { useLayoutStore } from './layout-store'
import { usePrefsStore } from './prefs-store'
import { useUiStore } from './ui-store'

export { clampFontSize }

export const MAX_TITLE_LENGTH = 40

export type PaneStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error'

export interface Pane {
  id: string
  seq: number
  fontSize: number
  title: string
  shellId: string
  shellLabel: string
  cwd: string
  agentId?: AgentId
  resumeSessionId?: string
  startupCommand?: string
  commandKind?: PresetKind
  status: PaneStatus
  exitCode?: number
  errorCode?: TerminalErrorCode
  errorDetail?: string
}

export interface LaunchOptions {
  cwd: string
  agentId?: AgentId
  shellId?: string
  resumeSessionId?: string
  startupCommand?: string
  commandKind?: PresetKind
  title?: string
}

interface TerminalState {
  panes: Pane[]
  activePaneId: string | null
  launch: (options: LaunchOptions) => Promise<string | null>
  spawnPane: (id: string, cols: number, rows: number) => Promise<void>
  restart: (id: string) => Promise<void>
  startPane: (id: string) => Promise<void>
  startAllIdle: () => Promise<void>
  restorePanes: (saved: readonly SavedPane[], activeIndex: number | null, autoStart: boolean) => Promise<void>
  reset: () => void
  close: (id: string) => void
  setActive: (id: string) => void
  clear: (id: string) => void
  handleExit: (event: TerminalExitEvent) => void
  renamePane: (id: string, title: string) => void
  movePane: (id: string, direction: -1 | 1) => void
  swapPanes: (firstId: string, secondId: string) => void
  setFontSize: (id: string, size: number) => void
  adjustFontSize: (id: string, step: number) => void
  resetFontSize: (id: string) => void
  toggleFocus: (id: string) => void
}

export function capturePanes(): { panes: SavedPane[]; activePane: number | null } {
  const { panes, activePaneId } = useTerminalStore.getState()
  const activeIndex = panes.findIndex((pane) => pane.id === activePaneId)
  return {
    panes: panes.map((pane) => ({
      title: pane.title,
      shellId: pane.shellId,
      shellLabel: pane.shellLabel,
      cwd: pane.cwd,
      fontSize: pane.fontSize,
      ...(pane.agentId ? { agentId: pane.agentId } : {}),
      ...(pane.resumeSessionId ? { resumeSessionId: pane.resumeSessionId } : {}),
      ...(pane.startupCommand ? { startupCommand: pane.startupCommand } : {}),
      ...(pane.commandKind ? { commandKind: pane.commandKind } : {})
    })),
    activePane: activeIndex === -1 ? null : activeIndex
  }
}

let nextSeq = 1

export function shortenTitle(title: string): string {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : title
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

    launch: async ({
      cwd,
      agentId,
      shellId,
      resumeSessionId,
      startupCommand,
      commandKind,
      title: requestedTitle
    }) => {
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
        : pickDefaultShell(shells, usePrefsStore.getState().defaultShellId)
      if (!shell) {
        pushToast('error', shellId ? strings.terminal.shellGone(shellId) : strings.terminal.noShell)
        return null
      }

      const id = crypto.randomUUID()
      const base = shortenTitle(requestedTitle ?? (agentId ? findAgent(agentId).label : shell.label))
      const title = nextPaneTitle(
        base,
        get().panes.map((pane) => pane.title)
      )

      const managed = terminalRegistry.create(id, windowsBuild)
      managed.onZoom = (step) => {
        if (step === 'reset') get().resetFontSize(id)
        else get().adjustFontSize(id, step)
      }
      set((state) => ({
        panes: [
          ...state.panes,
          {
            id,
            seq: nextSeq++,
            fontSize: usePrefsStore.getState().defaultFontSize,
            title,
            shellId: shell.id,
            shellLabel: shell.label,
            cwd,
            agentId,
            resumeSessionId,
            startupCommand,
            commandKind,
            status: 'starting'
          }
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
        .create({
          id,
          shellId: pane.shellId,
          cwd: pane.cwd,
          agentId: pane.agentId,
          resumeSessionId: pane.resumeSessionId,
          startupCommand: pane.startupCommand,
          requireInstalled: pane.commandKind === 'agent' ? true : undefined,
          cols,
          rows
        })
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
      if (findPane(id)?.status === 'idle') {
        await get().startPane(id)
        managed.focus()
        return
      }
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

    startPane: async (id) => {
      const pane = findPane(id)
      const managed = terminalRegistry.get(id)
      if (!pane || !managed || pane.status !== 'idle') return
      updatePane(id, { status: 'starting' })
      managed.spawnRequested = true
      const size = managed.fit() ?? { cols: managed.term.cols, rows: managed.term.rows }
      await get().spawnPane(id, size.cols, size.rows)
    },

    startAllIdle: async () => {
      const idle = get().panes.filter((pane) => pane.status === 'idle')
      await Promise.all(idle.map((pane) => get().startPane(pane.id)))
    },

    restorePanes: async (saved, activeIndex, autoStart) => {
      let windowsBuild = 0
      try {
        windowsBuild = (await getAppInfo()).osBuild
      } catch {
        windowsBuild = 0
      }
      const restored: Pane[] = saved.map((entry) => {
        const id = crypto.randomUUID()
        const managed = terminalRegistry.create(id, windowsBuild)
        managed.onZoom = (step) => {
          if (step === 'reset') get().resetFontSize(id)
          else get().adjustFontSize(id, step)
        }
        return {
          id,
          seq: nextSeq++,
          fontSize: entry.fontSize,
          title: entry.title,
          shellId: entry.shellId,
          shellLabel: entry.shellLabel,
          cwd: entry.cwd,
          agentId: entry.agentId,
          resumeSessionId: entry.resumeSessionId,
          startupCommand: entry.startupCommand,
          commandKind: entry.commandKind,
          status: 'idle'
        }
      })
      const active = activeIndex === null ? undefined : restored[activeIndex]
      set({ panes: restored, activePaneId: (active ?? restored[0])?.id ?? null })
      if (autoStart) await get().startAllIdle()
    },

    reset: () => {
      for (const pane of get().panes) {
        window.agentgrid.terminal.kill(pane.id)
        terminalRegistry.remove(pane.id)
      }
      set({ panes: [], activePaneId: null })
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
      if (remaining.length === 0) useLayoutStore.getState().setFocusMode(false)
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
    },

    renamePane: (id, title) => {
      const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH)
      if (trimmed.length === 0 || !findPane(id)) return
      updatePane(id, { title: trimmed })
    },

    movePane: (id, direction) => {
      const panes = [...get().panes]
      const index = panes.findIndex((pane) => pane.id === id)
      const target = index + direction
      const current = panes[index]
      const neighbour = panes[target]
      if (index === -1 || !current || !neighbour) return
      panes[index] = neighbour
      panes[target] = current
      set({ panes })
    },

    swapPanes: (firstId, secondId) => {
      if (firstId === secondId) return
      const panes = [...get().panes]
      const first = panes.findIndex((pane) => pane.id === firstId)
      const second = panes.findIndex((pane) => pane.id === secondId)
      const firstPane = panes[first]
      const secondPane = panes[second]
      if (!firstPane || !secondPane) return
      panes[first] = secondPane
      panes[second] = firstPane
      set({ panes })
    },

    setFontSize: (id, size) => {
      if (!findPane(id)) return
      updatePane(id, { fontSize: clampFontSize(size) })
    },

    adjustFontSize: (id, step) => {
      const pane = findPane(id)
      if (pane) updatePane(id, { fontSize: clampFontSize(pane.fontSize + step) })
    },

    resetFontSize: (id) => {
      if (findPane(id)) updatePane(id, { fontSize: usePrefsStore.getState().defaultFontSize })
    },

    toggleFocus: (id) => {
      const layout = useLayoutStore.getState()
      if (layout.focusMode && get().activePaneId === id) {
        layout.setFocusMode(false)
        return
      }
      get().setActive(id)
      layout.setFocusMode(true)
    }
  }
})
