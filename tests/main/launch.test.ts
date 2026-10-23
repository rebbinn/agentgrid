import type { JumpListCategory, JumpListItem } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { buildJumpList, JUMP_LIST_SESSION_LIMIT } from '../../src/main/jump-list'
import { parseLaunchArgs, resumeArgument } from '../../src/main/launch-args'
import { LaunchRouter } from '../../src/main/launch-router'
import type { ClaudeSession, LaunchRequest } from '../../src/shared/ipc'

const ID = '3975237b-df03-44fe-b8e1-be208c6646d1'
const EXE = 'C:\\Users\\me\\AppData\\Local\\Programs\\AgentGrid\\AgentGrid.exe'

const session = (id: string, title: string, cwd = 'C:\\work\\shop'): ClaudeSession => ({
  id,
  title,
  cwd,
  modifiedAt: 1790000000000
})

describe('parseLaunchArgs', () => {
  it('recognizes the new-Claude request', () => {
    expect(parseLaunchArgs(['AgentGrid.exe', '--new-claude'])).toEqual({ kind: 'claude' })
  })

  it('recognizes a resume request and normalizes the id', () => {
    expect(parseLaunchArgs(['x', resumeArgument(ID.toUpperCase())])).toEqual({ kind: 'resume', sessionId: ID })
  })

  it('ignores everything else', () => {
    expect(parseLaunchArgs([])).toBeNull()
    expect(parseLaunchArgs(['AgentGrid.exe', '.', '--inspect=0'])).toBeNull()
  })

  it.each(['--resume-session=', '--resume-session=abc', '--resume-session=x; calc', `--resume-session=${ID} && del *`, `--resume-session=..\\${ID}`])(
    'rejects an invalid session id: %s',
    (argument) => {
      expect(parseLaunchArgs(['x', argument])).toBeNull()
    }
  )

  it('uses the first recognized request', () => {
    expect(parseLaunchArgs(['--new-claude', resumeArgument(ID)])).toEqual({ kind: 'claude' })
  })
})

describe('LaunchRouter', () => {
  function router(sessions: ClaudeSession[] = [session(ID, 'Fix login')]) {
    const send = vi.fn<(request: LaunchRequest) => void>()
    const listSessions = vi.fn(async () => sessions)
    return { send, listSessions, router: new LaunchRouter({ listSessions, send }) }
  }

  it('holds requests until the window asks for them, then hands them over once', async () => {
    const { router: target, send } = router()
    await target.handle({ kind: 'claude' })
    await target.handle({ kind: 'resume', sessionId: ID })
    expect(send).not.toHaveBeenCalled()
    expect(target.takePending()).toEqual([
      { kind: 'claude' },
      { kind: 'resume', session: session(ID, 'Fix login') }
    ])
    expect(target.takePending()).toEqual([])
  })

  it('sends requests straight away once the window is ready', async () => {
    const { router: target, send } = router()
    target.takePending()
    await target.handle({ kind: 'claude' })
    expect(send).toHaveBeenCalledWith({ kind: 'claude' })
  })

  it('goes back to holding requests when the window reloads', async () => {
    const { router: target, send } = router()
    target.takePending()
    target.rendererReloaded()
    await target.handle({ kind: 'claude' })
    expect(send).not.toHaveBeenCalled()
    expect(target.takePending()).toEqual([{ kind: 'claude' }])
  })

  it('only resumes chats that really exist on this computer', async () => {
    const { router: target } = router([])
    await target.handle({ kind: 'resume', sessionId: ID })
    expect(target.takePending()).toEqual([{ kind: 'session-missing' }])
  })

  it('reports a missing chat when the history cannot be read', async () => {
    const { router: target, listSessions } = router()
    listSessions.mockRejectedValueOnce(new Error('disk'))
    await target.handle({ kind: 'resume', sessionId: ID })
    expect(target.takePending()).toEqual([{ kind: 'session-missing' }])
  })

  it('does nothing for an empty request', async () => {
    const { router: target, send } = router()
    target.takePending()
    await target.handle(null)
    expect(send).not.toHaveBeenCalled()
  })

  it('does not even read the history for a plain new-Claude request', async () => {
    const { router: target, listSessions } = router()
    await target.handle({ kind: 'claude' })
    expect(listSessions).not.toHaveBeenCalled()
  })
})

function itemsOf(category: JumpListCategory | undefined): JumpListItem[] {
  return category?.items ?? []
}

describe('buildJumpList', () => {
  it('always offers a new Claude task that starts the app with the right argument', () => {
    const [tasks] = buildJumpList([], EXE)
    expect(tasks).toMatchObject({ type: 'tasks' })
    expect(itemsOf(tasks)[0]).toMatchObject({
      title: 'Yeni Claude',
      program: EXE,
      args: '--new-claude',
      iconPath: EXE
    })
  })

  it('has no recent-chats section when there are no chats', () => {
    expect(buildJumpList([], EXE)).toHaveLength(1)
  })

  it('lists recent chats newest first, each resuming its own id', () => {
    const [, recent] = buildJumpList([session(ID, 'Fix login', 'C:\\work\\shop'), session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Notes', 'C:\\work\\blog\\')], EXE)
    expect(recent).toMatchObject({ type: 'custom', name: 'Son Claude söhbətləri' })
    const items = itemsOf(recent)
    expect(items.map((item) => item.title)).toEqual(['Fix login', 'Notes'])
    expect(items.map((item) => item.description)).toEqual(['shop', 'blog'])
    expect(items[0]).toMatchObject({ program: EXE, args: `--resume-session=${ID}` })
  })

  it('shows at most eight chats', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      session(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, `Chat ${index}`)
    )
    const [, recent] = buildJumpList(many, EXE)
    expect(itemsOf(recent)).toHaveLength(JUMP_LIST_SESSION_LIMIT)
  })

  it('shortens very long titles with an ellipsis', () => {
    const [, recent] = buildJumpList([session(ID, 'x'.repeat(300))], EXE)
    const title = itemsOf(recent)[0]?.title ?? ''
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.endsWith('…')).toBe(true)
  })

  it('passes arguments that can never contain spaces or quotes', () => {
    const [tasks, recent] = buildJumpList([session(ID, 'say "hi" && calc')], EXE)
    const all = [...itemsOf(tasks), ...itemsOf(recent)]
    for (const item of all) expect(item.args).toMatch(/^--[a-z-]+(=[0-9a-f-]{36})?$/)
  })
})
