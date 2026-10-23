import { describe, expect, it } from 'vitest'
import type { ClaudeSession } from '../../src/shared/ipc'
import { filterSessions, normalizePath, samePath } from '../../src/renderer/src/lib/sessions'
import { formatRelativeTime } from '../../src/renderer/src/lib/time'

const make = (id: string, title: string, cwd: string, modifiedAt = 0): ClaudeSession => ({
  id: `${id.repeat(8)}-${id.repeat(4)}-4${id.repeat(3)}-8${id.repeat(3)}-${id.repeat(12)}`,
  title,
  cwd,
  modifiedAt
})

const sessions = [
  make('a', 'Fix the login bug', 'C:\\work\\shop'),
  make('b', 'Çətin şəkil problemi', 'C:\\work\\shop'),
  make('c', 'Write release notes', 'C:\\work\\blog'),
  make('d', 'İlk sorğu', 'C:\\Users\\me')
]

describe('paths', () => {
  it('treats slashes, case and a trailing slash as the same folder', () => {
    expect(samePath('C:\\Work\\Shop\\', 'c:/work/shop')).toBe(true)
    expect(samePath('C:\\work\\shop', 'C:\\work\\shop2')).toBe(false)
    expect(normalizePath('C:\\A\\B\\')).toBe('c:/a/b')
  })
})

describe('filterSessions', () => {
  it('shows only the current folder by default', () => {
    const result = filterSessions(sessions, { folder: 'c:/work/shop/', showAll: false, query: '' })
    expect(result.map((session) => session.title)).toEqual(['Fix the login bug', 'Çətin şəkil problemi'])
  })

  it('shows everything when all projects are requested', () => {
    expect(filterSessions(sessions, { folder: 'C:\\work\\shop', showAll: true, query: '' })).toHaveLength(4)
  })

  it('shows nothing for the current-folder view when no folder is known', () => {
    expect(filterSessions(sessions, { folder: null, showAll: false, query: '' })).toEqual([])
    expect(filterSessions(sessions, { folder: null, showAll: true, query: '' })).toHaveLength(4)
  })

  it('searches the title and the folder name, all words must match', () => {
    expect(filterSessions(sessions, { folder: null, showAll: true, query: 'login' })).toHaveLength(1)
    expect(filterSessions(sessions, { folder: null, showAll: true, query: 'blog notes' })).toHaveLength(1)
    expect(filterSessions(sessions, { folder: null, showAll: true, query: 'blog login' })).toHaveLength(0)
  })

  it('matches Azerbaijani letters correctly, including the dotted capital İ', () => {
    expect(filterSessions(sessions, { folder: null, showAll: true, query: 'ilk' }).map((s) => s.title)).toEqual([
      'İlk sorğu'
    ])
    expect(filterSessions(sessions, { folder: null, showAll: true, query: 'ŞƏKİL' }).map((s) => s.title)).toEqual([
      'Çətin şəkil problemi'
    ])
  })

  it('ignores extra spaces in the query', () => {
    expect(filterSessions(sessions, { folder: null, showAll: true, query: '   release   ' })).toHaveLength(1)
  })
})

describe('formatRelativeTime', () => {
  const now = new Date(2026, 9, 23, 15, 0, 0).getTime()
  const ago = (ms: number): number => now - ms

  it('says "indicə" for the last minute', () => {
    expect(formatRelativeTime(ago(20_000), now)).toBe('indicə')
  })

  it('counts minutes and hours within the same day', () => {
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5 dəq əvvəl')
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('3 saat əvvəl')
  })

  it('calls anything from the previous calendar day "dünən", even if less than 24 hours ago', () => {
    expect(formatRelativeTime(new Date(2026, 9, 22, 23, 0, 0).getTime(), now)).toBe('dünən')
    expect(formatRelativeTime(new Date(2026, 9, 22, 8, 0, 0).getTime(), now)).toBe('dünən')
  })

  it('counts days up to a week, then shows the date', () => {
    expect(formatRelativeTime(new Date(2026, 9, 20, 12, 0, 0).getTime(), now)).toBe('3 gün əvvəl')
    expect(formatRelativeTime(new Date(2026, 9, 5, 12, 0, 0).getTime(), now)).toBe('05.10.2026')
  })

  it('never goes negative for timestamps slightly in the future', () => {
    expect(formatRelativeTime(now + 5_000, now)).toBe('indicə')
  })
})
