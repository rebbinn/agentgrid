import { z } from 'zod'
import { AGENT_IDS } from './agents'
import { MAX_COMMAND_LENGTH, hasNoControlCharacters } from './command-text'
import { LAYOUT_PRESET_IDS } from './layout-presets'

export const SETTINGS_VERSION = 1
export const MAX_WORKSPACES = 50
export const MAX_PANES_PER_WORKSPACE = 64
export const MAX_RECENT_PROJECTS = 20
export const MAX_WORKSPACE_NAME = 60
export const MAX_PRESETS = 100
export const MAX_PRESET_NAME = 60

export const PRESET_KINDS = ['command', 'agent'] as const
export type PresetKind = (typeof PRESET_KINDS)[number]

export const CommandLineSchema = z
  .string()
  .min(1)
  .max(MAX_COMMAND_LENGTH)
  .refine((text) => text.trim().length > 0 && hasNoControlCharacters(text))

export const SavedPaneSchema = z
  .object({
    title: z.string().min(1).max(40),
    shellId: z.string().min(1).max(128),
    shellLabel: z.string().max(128),
    cwd: z.string().min(1).max(1024),
    agentId: z.enum(AGENT_IDS).optional(),
    resumeSessionId: z.uuid().optional(),
    startupCommand: CommandLineSchema.optional(),
    commandKind: z.enum(PRESET_KINDS).optional(),
    sshHostId: z.uuid().optional(),
    sftpHostId: z.uuid().optional(),
    fontSize: z.number().int().min(9).max(28)
  })
  .refine((pane) => pane.resumeSessionId === undefined || pane.agentId === 'claude')
  .refine((pane) => pane.startupCommand === undefined || pane.agentId === undefined)
  .refine(
    (pane) => pane.sshHostId === undefined || (pane.agentId === undefined && pane.startupCommand === undefined)
  )
  .refine((pane) => pane.sftpHostId === undefined || (pane.sshHostId === undefined && pane.agentId === undefined))
export type SavedPane = z.infer<typeof SavedPaneSchema>

export const PresetSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(MAX_PRESET_NAME),
    kind: z.enum(PRESET_KINDS),
    command: z.string().max(MAX_COMMAND_LENGTH).refine(hasNoControlCharacters),
    shellId: z.string().min(1).max(128).nullable(),
    cwd: z.string().min(1).max(1024).nullable()
  })
  .refine((preset) => preset.kind === 'command' || preset.command.trim().length > 0)
export type Preset = z.infer<typeof PresetSchema>

const FractionsSchema = z.array(z.number().positive().max(1)).max(12)

export const SavedLayoutSchema = z.object({
  preset: z.enum(LAYOUT_PRESET_IDS),
  columnSizes: FractionsSchema,
  rowSizes: FractionsSchema,
  focusMode: z.boolean()
})
export type SavedLayout = z.infer<typeof SavedLayoutSchema>

export const WorkspaceSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(MAX_WORKSPACE_NAME),
  projectPath: z.string().min(1).max(1024).nullable(),
  layout: SavedLayoutSchema,
  panes: z.array(SavedPaneSchema).max(MAX_PANES_PER_WORKSPACE),
  activePane: z.number().int().min(0).nullable(),
  autoStart: z.boolean()
})
export type Workspace = z.infer<typeof WorkspaceSchema>

export const DEFAULT_TERMINAL_FONT_SIZE = 13

export const PreferencesSchema = z.object({
  sidebarOpen: z.boolean(),
  sidebarTab: z.enum(['projects', 'sessions', 'servers']),
  sessionsTabOpen: z.boolean(),
  serversTabOpen: z.boolean().default(false),
  sessionsShowAll: z.boolean(),
  defaultFontSize: z.number().int().min(9).max(28).default(DEFAULT_TERMINAL_FONT_SIZE),
  defaultShellId: z.string().min(1).max(128).nullable().default(null)
})
export type Preferences = z.infer<typeof PreferencesSchema>

export const WindowStateSchema = z.object({
  width: z.number().int().min(400).max(20000),
  height: z.number().int().min(300).max(20000),
  x: z.number().int().min(-20000).max(20000).optional(),
  y: z.number().int().min(-20000).max(20000).optional(),
  maximized: z.boolean()
})
export type WindowState = z.infer<typeof WindowStateSchema>

export const AppStateSchema = z.object({
  activeWorkspaceId: z.uuid().nullable(),
  workspaces: z.array(WorkspaceSchema).max(MAX_WORKSPACES),
  recentProjects: z.array(z.string().min(1).max(1024)).max(MAX_RECENT_PROJECTS),
  presets: z.array(PresetSchema).max(MAX_PRESETS),
  preferences: PreferencesSchema
})
export type AppState = z.infer<typeof AppStateSchema>

export const SettingsSchema = AppStateSchema.extend({
  version: z.literal(SETTINGS_VERSION),
  window: WindowStateSchema.optional()
})
export type Settings = z.infer<typeof SettingsSchema>

export const SETTINGS_NOTICE_KINDS = [
  'dropped-workspaces',
  'dropped-presets',
  'reset-corrupt',
  'recovered-from-backup',
  'newer-version',
  'hosts-unreadable',
  'dropped-hosts'
] as const

export const SettingsNoticeSchema = z.object({
  kind: z.enum(SETTINGS_NOTICE_KINDS),
  count: z.number().int().nonnegative().optional(),
  backupFile: z.string().max(260).optional()
})
export type SettingsNotice = z.infer<typeof SettingsNoticeSchema>

export const LoadedSettingsSchema = z.object({
  state: AppStateSchema,
  notices: z.array(SettingsNoticeSchema)
})
export type LoadedSettings = z.infer<typeof LoadedSettingsSchema>

export type Migration = (previous: Record<string, unknown>) => Record<string, unknown>

export const MIGRATIONS: Readonly<Record<number, Migration>> = {}

export const DEFAULT_PREFERENCES: Preferences = {
  sidebarOpen: true,
  sidebarTab: 'projects',
  sessionsTabOpen: false,
  serversTabOpen: false,
  sessionsShowAll: false,
  defaultFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  defaultShellId: null
}

export function defaultAppState(): AppState {
  return {
    activeWorkspaceId: null,
    workspaces: [],
    recentProjects: [],
    presets: [],
    preferences: { ...DEFAULT_PREFERENCES }
  }
}

export function defaultSettings(): Settings {
  return { version: SETTINGS_VERSION, ...defaultAppState() }
}

export type ParseOutcome =
  | { ok: true; settings: Settings; notices: SettingsNotice[] }
  | { ok: false; reason: 'invalid' | 'newer' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function migrateSettings(
  raw: Record<string, unknown>,
  migrations: Readonly<Record<number, Migration>>,
  target: number = SETTINGS_VERSION
): Record<string, unknown> | null {
  let current = raw
  let version = current['version']
  while (typeof version === 'number' && version < target) {
    const step = migrations[version]
    if (!step) return null
    current = { ...step(current), version: version + 1 }
    version = current['version']
  }
  return current
}

export function parseSettings(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS
): ParseOutcome {
  if (!isRecord(raw)) return { ok: false, reason: 'invalid' }
  const version = raw['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'invalid' }
  }
  if (version > SETTINGS_VERSION) return { ok: false, reason: 'newer' }

  let migrated: Record<string, unknown> | null
  try {
    migrated = migrateSettings(raw, migrations)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!migrated) return { ok: false, reason: 'invalid' }

  const notices: SettingsNotice[] = []
  const rawWorkspaces = Array.isArray(migrated['workspaces']) ? migrated['workspaces'] : []
  const workspaces: Workspace[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const candidate of rawWorkspaces.slice(0, MAX_WORKSPACES)) {
    const parsed = WorkspaceSchema.safeParse(candidate)
    if (parsed.success && !seen.has(parsed.data.id)) {
      seen.add(parsed.data.id)
      workspaces.push(parsed.data)
    } else {
      dropped++
    }
  }
  dropped += Math.max(0, rawWorkspaces.length - MAX_WORKSPACES)
  if (dropped > 0) notices.push({ kind: 'dropped-workspaces', count: dropped })

  const activeCandidate = z.uuid().safeParse(migrated['activeWorkspaceId'])
  const activeWorkspaceId =
    activeCandidate.success && seen.has(activeCandidate.data)
      ? activeCandidate.data
      : (workspaces[0]?.id ?? null)

  const recentProjects = (Array.isArray(migrated['recentProjects']) ? migrated['recentProjects'] : [])
    .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 1024)
    .slice(0, MAX_RECENT_PROJECTS)

  const rawPresets = Array.isArray(migrated['presets']) ? migrated['presets'] : []
  const presets: Preset[] = []
  const seenPresets = new Set<string>()
  let droppedPresets = Math.max(0, rawPresets.length - MAX_PRESETS)
  for (const candidate of rawPresets.slice(0, MAX_PRESETS)) {
    const parsed = PresetSchema.safeParse(candidate)
    if (parsed.success && !seenPresets.has(parsed.data.id)) {
      seenPresets.add(parsed.data.id)
      presets.push(parsed.data)
    } else {
      droppedPresets++
    }
  }
  if (droppedPresets > 0) notices.push({ kind: 'dropped-presets', count: droppedPresets })

  const preferences = PreferencesSchema.safeParse(migrated['preferences'])
  const windowState = WindowStateSchema.safeParse(migrated['window'])

  return {
    ok: true,
    notices,
    settings: {
      version: SETTINGS_VERSION,
      activeWorkspaceId,
      workspaces,
      recentProjects,
      presets,
      preferences: preferences.success ? preferences.data : { ...DEFAULT_PREFERENCES },
      ...(windowState.success ? { window: windowState.data } : {})
    }
  }
}

export function toAppState(settings: Settings): AppState {
  return {
    activeWorkspaceId: settings.activeWorkspaceId,
    workspaces: settings.workspaces,
    recentProjects: settings.recentProjects,
    presets: settings.presets,
    preferences: settings.preferences
  }
}
