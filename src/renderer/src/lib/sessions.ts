import type { ClaudeSession } from '@shared/ipc'
import { folderName } from './path'

export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}

export function samePath(first: string, second: string): boolean {
  return normalizePath(first) === normalizePath(second)
}

export interface SessionFilter {
  folder: string | null
  showAll: boolean
  query: string
}

function fold(text: string): string {
  return text.toLocaleLowerCase('az')
}

export function filterSessions(
  sessions: readonly ClaudeSession[],
  { folder, showAll, query }: SessionFilter
): ClaudeSession[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  return sessions.filter((session) => {
    if (!showAll && (!folder || !samePath(session.cwd, folder))) return false
    if (terms.length === 0) return true
    const haystack = fold(`${session.title} ${folderName(session.cwd)}`)
    return terms.every((term) => haystack.includes(term))
  })
}
