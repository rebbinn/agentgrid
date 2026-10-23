export const NEW_CLAUDE_FLAG = '--new-claude'
export const RESUME_FLAG_PREFIX = '--resume-session='

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type LaunchIntent = { kind: 'claude' } | { kind: 'resume'; sessionId: string }

export function resumeArgument(sessionId: string): string {
  return `${RESUME_FLAG_PREFIX}${sessionId}`
}

export function parseLaunchArgs(argv: readonly string[]): LaunchIntent | null {
  for (const argument of argv) {
    if (argument === NEW_CLAUDE_FLAG) return { kind: 'claude' }
    if (argument.startsWith(RESUME_FLAG_PREFIX)) {
      const sessionId = argument.slice(RESUME_FLAG_PREFIX.length)
      if (SESSION_ID.test(sessionId)) return { kind: 'resume', sessionId: sessionId.toLowerCase() }
    }
  }
  return null
}
