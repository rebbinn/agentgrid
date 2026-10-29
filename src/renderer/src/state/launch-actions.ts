import type { AgentId } from '@shared/agents'
import type { ClaudeSession } from '@shared/ipc'
import type { Preset, PresetKind } from '@shared/settings'
import { getAppInfo } from '../lib/app-info'
import { folderName } from '../lib/path'
import { strings } from '../strings'
import { useProjectStore } from './project-store'
import { useTerminalStore } from './terminal-store'
import { useUiStore } from './ui-store'

export interface LaunchRequest {
  agentId?: AgentId
  shellId?: string
  cwd?: string
  resumeSessionId?: string
  startupCommand?: string
  commandKind?: PresetKind
  title?: string
}

export async function launchTerminal(request: LaunchRequest = {}): Promise<void> {
  let cwd = request.cwd ?? useProjectStore.getState().projectPath
  if (!cwd) {
    try {
      cwd = (await getAppInfo()).homeDir
    } catch {
      useUiStore.getState().pushToast('error', strings.terminal.launchFailed)
      return
    }
  }
  await useTerminalStore.getState().launch({ ...request, cwd })
}

export async function launchPreset(
  preset: Preset,
  overrides: { cwd?: string; shellId?: string } = {}
): Promise<void> {
  const command = preset.command.trim()
  await launchTerminal({
    title: preset.name,
    shellId: overrides.shellId ?? preset.shellId ?? undefined,
    cwd: overrides.cwd ?? preset.cwd ?? undefined,
    ...(command ? { startupCommand: command, commandKind: preset.kind } : {})
  })
}

export async function openClaudeSession(session: ClaudeSession): Promise<void> {
  const store = useTerminalStore.getState()
  const alreadyOpen = store.panes.find(
    (pane) =>
      pane.resumeSessionId === session.id &&
      (pane.status === 'running' || pane.status === 'starting' || pane.status === 'idle')
  )
  if (alreadyOpen) {
    store.setActive(alreadyOpen.id)
    useUiStore.getState().pushToast('warning', strings.sessions.alreadyOpen)
    return
  }
  await launchTerminal({
    agentId: 'claude',
    cwd: session.cwd,
    resumeSessionId: session.id,
    title: strings.sessions.paneTitle(session.title)
  })
}

export function requestClosePane(id: string): void {
  const pane = useTerminalStore.getState().panes.find((candidate) => candidate.id === id)
  if (!pane) return
  if (pane.status === 'running' || pane.status === 'starting') {
    useUiStore.getState().askToClose(id)
    return
  }
  useTerminalStore.getState().close(id)
}

export async function pickProjectFolder(): Promise<void> {
  try {
    const { path } = await window.agentgrid.project.pick()
    if (!path) return
    useProjectStore.getState().openProject(path)
    useUiStore.getState().pushToast('success', strings.toast.projectOpened(folderName(path)))
  } catch {
    useUiStore.getState().pushToast('error', strings.toast.projectPickFailed)
  }
}
