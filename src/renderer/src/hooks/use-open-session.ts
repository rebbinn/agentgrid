import type { ClaudeSession } from '@shared/ipc'
import { openClaudeSession } from '../state/launch-actions'

export function useOpenSession(): (session: ClaudeSession) => Promise<void> {
  return openClaudeSession
}
