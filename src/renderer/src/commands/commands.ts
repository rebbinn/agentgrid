import { KNOWN_AGENTS } from '@shared/agents'
import type { AgentStatus, ClaudeSession, ShellInfo } from '@shared/ipc'
import type { Preset, Workspace } from '@shared/settings'
import { folderName } from '../lib/path'
import { LAYOUT_PRESETS, type LayoutPresetId } from '../lib/layout'
import { focusPaneShortcut, type ShortcutId } from '../lib/shortcuts'
import { launchPreset, launchTerminal, openClaudeSession, pickProjectFolder } from '../state/launch-actions'
import { useLayoutStore } from '../state/layout-store'
import { useTerminalStore, type Pane } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { switchWorkspace } from '../state/workspace-actions'
import { strings } from '../strings'
import {
  closeActivePane,
  newClaude,
  newTerminal,
  openSettings,
  toggleFocusOnActivePane,
  toggleSendPanel,
  toggleSessionsTab,
  toggleSidebar
} from './actions'

export const MAX_CHAT_COMMANDS = 20

export interface Command {
  id: string
  title: string
  group: string
  keywords: string
  shortcut?: ShortcutId
  run: () => void | Promise<void>
}

export interface CommandContext {
  panes: readonly Pane[]
  activePaneId: string | null
  workspaces: readonly Workspace[]
  activeWorkspaceId: string | null
  shells: readonly ShellInfo[]
  presets: readonly Preset[]
  agents: AgentStatus | null
  sessions: readonly ClaudeSession[]
  focusMode: boolean
}

const group = strings.commands.groups

export function buildCommands(context: CommandContext): Command[] {
  const commands: Command[] = []
  const add = (command: Command): void => {
    commands.push(command)
  }
  const activeId = context.activePaneId
  const store = useTerminalStore.getState

  add({
    id: 'terminal.new',
    title: strings.commands.newTerminal,
    group: group.terminal,
    keywords: 'create new terminal cmd yarat aç',
    shortcut: 'newTerminal',
    run: newTerminal
  })

  if (context.shells.length > 1) {
    for (const shell of context.shells) {
      add({
        id: `terminal.new.${shell.id}`,
        title: strings.commands.newTerminalIn(shell.label),
        group: group.terminal,
        keywords: `shell ${shell.kind}`,
        run: () => launchTerminal({ shellId: shell.id })
      })
    }
  }

  if (activeId) {
    add({
      id: 'terminal.close',
      title: strings.commands.closeActive,
      group: group.terminal,
      keywords: 'close bağla sil',
      shortcut: 'closePane',
      run: closeActivePane
    })
    add({
      id: 'terminal.restart',
      title: strings.commands.restartActive,
      group: group.terminal,
      keywords: 'restart yenidən başlat',
      run: () => store().restart(activeId)
    })
    add({
      id: 'terminal.clear',
      title: strings.commands.clearActive,
      group: group.terminal,
      keywords: 'clear ekran təmizlə',
      run: () => store().clear(activeId)
    })
    add({
      id: 'terminal.rename',
      title: strings.commands.renameActive,
      group: group.terminal,
      keywords: 'rename ad dəyiş',
      run: () => useUiStore.getState().requestRename(activeId)
    })
    add({
      id: 'terminal.maximize',
      title: context.focusMode ? strings.commands.restore : strings.commands.maximize,
      group: group.terminal,
      keywords: 'maximize restore böyüt bərpa fokus',
      shortcut: 'toggleFocus',
      run: toggleFocusOnActivePane
    })
    add({
      id: 'terminal.fontUp',
      title: strings.commands.fontUp,
      group: group.terminal,
      keywords: 'font şrift böyüt',
      run: () => store().adjustFontSize(activeId, 1)
    })
    add({
      id: 'terminal.fontDown',
      title: strings.commands.fontDown,
      group: group.terminal,
      keywords: 'font şrift kiçilt',
      run: () => store().adjustFontSize(activeId, -1)
    })
    add({
      id: 'terminal.fontReset',
      title: strings.commands.fontReset,
      group: group.terminal,
      keywords: 'font şrift sıfırla',
      run: () => store().resetFontSize(activeId)
    })
  }

  if (context.panes.length > 0) {
    add({
      id: 'terminal.send',
      title: strings.commands.send,
      group: group.terminal,
      keywords: 'send paste komanda göndər yapışdır ai',
      shortcut: 'toggleSend',
      run: toggleSendPanel
    })
  }

  for (const agent of KNOWN_AGENTS) {
    const installed = context.agents ? context.agents[agent.id] : null
    add({
      id: `agent.${agent.id}`,
      title: strings.commands.launchAgent(agent.label, installed),
      group: group.agent,
      keywords: `${agent.command} ai agent`,
      ...(agent.id === 'claude' ? { shortcut: 'newClaude' as const } : {}),
      run: agent.id === 'claude' ? newClaude : () => launchTerminal({ agentId: agent.id })
    })
  }
  add({
    id: 'agent.choose',
    title: strings.commands.chooseAgent,
    group: group.agent,
    keywords: 'agent qovluq shell seç',
    run: () => useUiStore.getState().openDialog({ kind: 'launch' })
  })

  for (const preset of context.presets) {
    add({
      id: `preset.${preset.id}`,
      title: strings.commands.preset(preset.name),
      group: group.preset,
      keywords: `${preset.command} ${preset.kind}`,
      run: () => launchPreset(preset)
    })
  }
  add({
    id: 'preset.new',
    title: strings.commands.newPreset,
    group: group.preset,
    keywords: 'preset şablon yarat əlavə et',
    run: () => useUiStore.getState().openDialog({ kind: 'preset-editor', id: null })
  })

  for (const layout of LAYOUT_PRESETS) {
    add({
      id: `layout.${layout.id}`,
      title: strings.commands.layout(strings.layout.presets[layout.id]),
      group: group.layout,
      keywords: `layout grid ${strings.layout.hints[layout.id]}`,
      run: () => useLayoutStore.getState().setPreset(layout.id as LayoutPresetId)
    })
  }
  if (context.panes.length > 0) {
    add({
      id: 'layout.focus',
      title: strings.commands.focusMode,
      group: group.layout,
      keywords: 'focus fokus maximize böyüt',
      shortcut: 'toggleFocus',
      run: toggleFocusOnActivePane
    })
  }

  for (const workspace of context.workspaces) {
    if (workspace.id === context.activeWorkspaceId) continue
    add({
      id: `workspace.switch.${workspace.id}`,
      title: strings.commands.switchWorkspace(workspace.name),
      group: group.workspace,
      keywords: `workspace ${workspace.projectPath ?? ''}`,
      run: () => void switchWorkspace(workspace.id)
    })
  }
  add({
    id: 'workspace.new',
    title: strings.commands.newWorkspace,
    group: group.workspace,
    keywords: 'workspace yarat',
    run: () => useUiStore.getState().openDialog({ kind: 'new-workspace' })
  })
  if (context.activeWorkspaceId) {
    const workspaceId = context.activeWorkspaceId
    add({
      id: 'workspace.rename',
      title: strings.commands.renameWorkspace,
      group: group.workspace,
      keywords: 'workspace ad dəyiş',
      run: () => useUiStore.getState().openDialog({ kind: 'rename-workspace', id: workspaceId })
    })
    add({
      id: 'workspace.delete',
      title: strings.commands.deleteWorkspace,
      group: group.workspace,
      keywords: 'workspace sil',
      run: () => useUiStore.getState().openDialog({ kind: 'delete-workspace', id: workspaceId })
    })
  }
  add({
    id: 'workspace.project',
    title: strings.commands.pickProject,
    group: group.workspace,
    keywords: 'project folder layihə qovluq',
    run: pickProjectFolder
  })

  context.panes.forEach((pane, index) => {
    const shortcut = focusPaneShortcut(index)
    add({
      id: `goto.${pane.id}`,
      title: strings.commands.goto(pane.title),
      group: group.goto,
      keywords: `${pane.shellLabel} ${folderName(pane.cwd)}`,
      ...(shortcut ? { shortcut } : {}),
      run: () => store().setActive(pane.id)
    })
  })

  add({
    id: 'chat.toggle',
    title: strings.commands.toggleChats,
    group: group.chat,
    keywords: 'sessions history söhbət tarixçə resume',
    shortcut: 'toggleSessions',
    run: toggleSessionsTab
  })
  for (const session of context.sessions.slice(0, MAX_CHAT_COMMANDS)) {
    add({
      id: `chat.${session.id}`,
      title: strings.commands.openChat(session.title),
      group: group.chat,
      keywords: `claude resume ${folderName(session.cwd)}`,
      run: () => openClaudeSession(session)
    })
  }

  add({
    id: 'view.sidebar',
    title: strings.commands.toggleSidebar,
    group: group.view,
    keywords: 'sidebar yan panel',
    shortcut: 'toggleSidebar',
    run: toggleSidebar
  })
  add({
    id: 'settings.open',
    title: strings.commands.openSettings,
    group: group.settings,
    keywords: 'settings preferences ayarlar şrift font',
    shortcut: 'openSettings',
    run: openSettings
  })

  return commands
}
