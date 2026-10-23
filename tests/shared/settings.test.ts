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
