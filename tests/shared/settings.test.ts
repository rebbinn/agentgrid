import { describe, expect, it } from 'vitest'
import {
  AppStateSchema,
  MAX_WORKSPACES,
  SETTINGS_VERSION,
  defaultSettings,
  migrateSettings,
  parseSettings,
  toAppState,
  type Migration,
  type Workspace
} from '../../src/shared/settings'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const SESSION = '3975237b-df03-44fe-b8e1-be208c6646d1'
const PRESET_ID = '44444444-4444-4444-8444-444444444444'

const preset = {
  id: PRESET_ID,
  name: 'Dev server',
  kind: 'command' as const,
  command: 'npm run dev',
  shellId: 'cmd',
  cwd: null
}

function workspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name: `Workspace ${id.slice(0, 2)}`,
    projectPath: 'C:\\work\\shop',
    layout: { preset: 'grid-2x2', columnSizes: [0.6, 0.4], rowSizes: [], focusMode: false },
    panes: [
      {
        title: 'Claude',
        shellId: 'cmd',
        shellLabel: 'Command Prompt',
        cwd: 'C:\\work\\shop',
        agentId: 'claude',
        resumeSessionId: SESSION,
        fontSize: 14
      }
    ],
    activePane: 0,
    autoStart: false,
    ...overrides
  }
}

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: SETTINGS_VERSION,
    activeWorkspaceId: ID_A,
    workspaces: [workspace(ID_A)],
    recentProjects: ['C:\\work\\shop'],
    preferences: { sidebarOpen: false, sidebarTab: 'sessions', sessionsTabOpen: true, sessionsShowAll: true },
    window: { width: 1200, height: 800, x: 10, y: 20, maximized: false },
    ...overrides
  }
}

describe('parseSettings', () => {
  it('reads a complete settings object as it is', () => {
    const outcome = parseSettings(raw())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.notices).toEqual([])
    expect(outcome.settings.workspaces[0]).toEqual(workspace(ID_A))
    expect(outcome.settings.preferences.sessionsShowAll).toBe(true)
    expect(outcome.settings.window).toEqual({ width: 1200, height: 800, x: 10, y: 20, maximized: false })
  })

  it('has sane defaults', () => {
    const settings = defaultSettings()
    expect(settings).toMatchObject({ version: 1, workspaces: [], activeWorkspaceId: null, recentProjects: [] })
    expect(AppStateSchema.safeParse(toAppState(settings)).success).toBe(true)
  })

  it.each([null, undefined, 5, 'text', [], {}, { version: 'one' }, { version: 0 }, { version: 1.5 }, { version: -3 }])(
    'treats %j as unreadable',
    (value) => {
      expect(parseSettings(value)).toEqual({ ok: false, reason: 'invalid' })
    }
  )

  it('refuses files written by a newer version instead of guessing', () => {
    expect(parseSettings({ ...raw(), version: SETTINGS_VERSION + 1 })).toEqual({ ok: false, reason: 'newer' })
  })

  it('keeps good workspaces and drops broken ones, reporting how many', () => {
    const outcome = parseSettings(
      raw({
        workspaces: [
          workspace(ID_A),
          { id: 'not-a-uuid', name: 'x' },
          workspace(ID_B, { name: '' }),
          'garbage',
          workspace('33333333-3333-4333-8333-333333333333', { panes: [{ title: 'x' } as never] })
        ]
      })
    )
    expect(outcome.ok && outcome.settings.workspaces.map((item) => item.id)).toEqual([ID_A])
    expect(outcome.ok && outcome.notices).toEqual([{ kind: 'dropped-workspaces', count: 4 }])
  })

  it('drops a duplicated workspace id', () => {
    const outcome = parseSettings(raw({ workspaces: [workspace(ID_A), workspace(ID_A, { name: 'Copy' })] }))
    expect(outcome.ok && outcome.settings.workspaces).toHaveLength(1)
    expect(outcome.ok && outcome.notices).toEqual([{ kind: 'dropped-workspaces', count: 1 }])
  })

  it('falls back to the first workspace when the active one is unknown or missing', () => {
    const first = parseSettings(raw({ activeWorkspaceId: ID_B }))
    expect(first.ok && first.settings.activeWorkspaceId).toBe(ID_A)
    const second = parseSettings(raw({ activeWorkspaceId: 'nope' }))
    expect(second.ok && second.settings.activeWorkspaceId).toBe(ID_A)
    const none = parseSettings(raw({ workspaces: [], activeWorkspaceId: ID_A }))
    expect(none.ok && none.settings.activeWorkspaceId).toBeNull()
  })

  it('uses default preferences when they are damaged and keeps the rest', () => {
    const outcome = parseSettings(raw({ preferences: { sidebarOpen: 'yes' } }))
    expect(outcome.ok && outcome.settings.preferences).toEqual(defaultSettings().preferences)
    expect(outcome.ok && outcome.settings.workspaces).toHaveLength(1)
  })

  it('ignores a damaged window state', () => {
    const outcome = parseSettings(raw({ window: { width: 5, height: 5, maximized: 'no' } }))
    expect(outcome.ok && outcome.settings.window).toBeUndefined()
  })

  it('keeps only valid recent project strings', () => {
    const outcome = parseSettings(raw({ recentProjects: ['C:\\a', 5, '', null, 'C:\\b'] }))
    expect(outcome.ok && outcome.settings.recentProjects).toEqual(['C:\\a', 'C:\\b'])
  })

  it('does not accept more workspaces than the limit', () => {
    const many = Array.from({ length: MAX_WORKSPACES + 5 }, (_, index) =>
      workspace(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
    )
    const outcome = parseSettings(raw({ workspaces: many, activeWorkspaceId: null }))
    expect(outcome.ok && outcome.settings.workspaces).toHaveLength(MAX_WORKSPACES)
    expect(outcome.ok && outcome.notices).toEqual([{ kind: 'dropped-workspaces', count: 5 }])
  })

  it('refuses a saved Codex pane that claims to resume a chat', () => {
    const bad = workspace(ID_A, {
      panes: [{ title: 'x', shellId: 'cmd', shellLabel: 'c', cwd: 'C:\\x', agentId: 'codex', resumeSessionId: SESSION, fontSize: 13 }]
    })
    const outcome = parseSettings(raw({ workspaces: [bad] }))
    expect(outcome.ok && outcome.settings.workspaces).toHaveLength(0)
  })
})

describe('presets and the newer preferences', () => {
  it('reads saved presets', () => {
    const outcome = parseSettings(raw({ presets: [preset] }))
    expect(outcome.ok && outcome.settings.presets).toEqual([preset])
  })

  it('gives an older file without presets an empty list instead of failing', () => {
    const outcome = parseSettings(raw())
    expect(outcome.ok && outcome.settings.presets).toEqual([])
  })

  it('keeps the existing preferences of an older file and fills in the new ones', () => {
    const outcome = parseSettings(raw())
    expect(outcome.ok && outcome.settings.preferences).toEqual({
      sidebarOpen: false,
      sidebarTab: 'sessions',
      sessionsTabOpen: true,
      serversTabOpen: false,
      sessionsShowAll: true,
      defaultFontSize: 13,
      defaultShellId: null
    })
  })

  it('keeps saved font size and default shell', () => {
    const outcome = parseSettings(
      raw({
        preferences: {
          sidebarOpen: true,
          sidebarTab: 'projects',
          sessionsTabOpen: false,
          sessionsShowAll: false,
          defaultFontSize: 16,
          defaultShellId: 'powershell'
        }
      })
    )
    expect(outcome.ok && outcome.settings.preferences).toMatchObject({ defaultFontSize: 16, defaultShellId: 'powershell' })
  })

  it('drops broken presets, duplicates and presets with a multi-line command, and says so', () => {
    const outcome = parseSettings(
      raw({
        presets: [
          preset,
          { ...preset, id: 'nope' },
          { ...preset, id: '55555555-5555-4555-8555-555555555555', command: 'a\nb' },
          { ...preset, name: 'Copy' },
          { ...preset, id: '66666666-6666-4666-8666-666666666666', kind: 'agent', command: '   ' }
        ]
      })
    )
    expect(outcome.ok && outcome.settings.presets.map((item) => item.id)).toEqual([PRESET_ID])
    expect(outcome.ok && outcome.notices).toContainEqual({ kind: 'dropped-presets', count: 4 })
  })

  it('allows a plain-terminal preset with no command, but not an agent preset without one', () => {
    expect(PresetSchemaCheck({ ...preset, command: '' })).toBe(true)
    expect(PresetSchemaCheck({ ...preset, kind: 'agent', command: '' })).toBe(false)
    expect(PresetSchemaCheck({ ...preset, kind: 'agent', command: 'aider' })).toBe(true)
  })

  it('refuses a saved pane that has both a built-in agent and a custom command', () => {
    const bad = workspace(ID_A, {
      panes: [
        {
          title: 'x',
          shellId: 'cmd',
          shellLabel: 'c',
          cwd: 'C:\\x',
          agentId: 'claude',
          startupCommand: 'calc',
          fontSize: 13
        }
      ]
    })
    const outcome = parseSettings(raw({ workspaces: [bad] }))
    expect(outcome.ok && outcome.settings.workspaces).toHaveLength(0)
  })

  it('keeps a saved pane that remembers its custom command', () => {
    const good = workspace(ID_A, {
      panes: [
        { title: 'Dev', shellId: 'cmd', shellLabel: 'c', cwd: 'C:\\x', startupCommand: 'npm run dev', commandKind: 'command', fontSize: 13 }
      ]
    })
    const outcome = parseSettings(raw({ workspaces: [good] }))
    expect(outcome.ok && outcome.settings.workspaces[0]!.panes[0]!.startupCommand).toBe('npm run dev')
  })

  it('does not accept more presets than the limit', () => {
    const many = Array.from({ length: 105 }, (_, index) => ({
      ...preset,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    }))
    const outcome = parseSettings(raw({ presets: many }))
    expect(outcome.ok && outcome.settings.presets).toHaveLength(100)
    expect(outcome.ok && outcome.notices).toContainEqual({ kind: 'dropped-presets', count: 5 })
  })
})

function PresetSchemaCheck(value: unknown): boolean {
  return AppStateSchema.safeParse({
    activeWorkspaceId: null,
    workspaces: [],
    recentProjects: [],
    presets: [value],
    preferences: defaultSettings().preferences
  }).success
}

describe('migrateSettings', () => {
  it('leaves a file that is already current untouched', () => {
    const file = { version: 3, keep: 'me' }
    expect(migrateSettings(file, {}, 3)).toBe(file)
  })

  it('runs every step in order and stamps the new version after each one', () => {
    const order: string[] = []
    const migrations: Record<number, Migration> = {
      1: (previous) => {
        order.push(`1->2 sees v${String(previous['version'])}`)
        return { ...previous, renamed: previous['old'], old: undefined }
      },
      2: (previous) => {
        order.push(`2->3 sees v${String(previous['version'])}`)
        return { ...previous, extra: true }
      }
    }
    const result = migrateSettings({ version: 1, old: 'value' }, migrations, 3)
    expect(order).toEqual(['1->2 sees v1', '2->3 sees v2'])
    expect(result).toMatchObject({ version: 3, renamed: 'value', extra: true })
  })

  it('gives up when a step in the chain is missing', () => {
    expect(migrateSettings({ version: 1 }, { 2: (previous) => previous }, 3)).toBeNull()
  })

  it('lets a failing step surface so the caller can treat the file as unreadable', () => {
    expect(() =>
      migrateSettings(
        { version: 1 },
        {
          1: () => {
            throw new Error('boom')
          }
        },
        2
      )
    ).toThrow('boom')
  })

  it('is a no-op for the current real version', () => {
    expect(parseSettings(raw()).ok).toBe(true)
  })
})

describe('AppStateSchema (what the window is allowed to save)', () => {
  const valid = {
    activeWorkspaceId: ID_A,
    workspaces: [workspace(ID_A)],
    recentProjects: [],
    presets: [],
    preferences: defaultSettings().preferences
  }

  it('accepts a valid state', () => {
    expect(AppStateSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    ['an oversized pane title', { workspaces: [workspace(ID_A, { panes: [{ ...workspace(ID_A).panes[0]!, title: 'x'.repeat(41) }] })] }],
    ['an absurd font size', { workspaces: [workspace(ID_A, { panes: [{ ...workspace(ID_A).panes[0]!, fontSize: 500 }] })] }],
    ['a fraction above one', { workspaces: [workspace(ID_A, { layout: { preset: 'auto', columnSizes: [5], rowSizes: [], focusMode: false } })] }],
    ['an unknown layout preset', { workspaces: [workspace(ID_A, { layout: { preset: 'diagonal' as never, columnSizes: [], rowSizes: [], focusMode: false } })] }],
    ['a non-uuid workspace id', { workspaces: [workspace('abc')] }],
    ['too many recent projects', { recentProjects: Array.from({ length: 21 }, (_, index) => `C:\\p${index}`) }]
  ])('rejects %s', (_name, patch) => {
    expect(AppStateSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })

  it('does not accept extra secrets smuggled into a pane', () => {
    const state = JSON.parse(JSON.stringify(valid))
    state.workspaces[0].panes[0].token = 'secret'
    const parsed = AppStateSchema.safeParse(state)
    expect(parsed.success && Object.keys(parsed.data.workspaces[0]!.panes[0]!)).not.toContain('token')
  })
})
