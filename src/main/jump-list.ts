import type { JumpListCategory } from 'electron'
import type { ClaudeSession } from '@shared/ipc'
import { NEW_CLAUDE_FLAG, resumeArgument } from './launch-args'

export const JUMP_LIST_SESSION_LIMIT = 8
const TITLE_LIMIT = 60

const NEW_CLAUDE_TITLE = 'Yeni Claude'
const NEW_CLAUDE_DESCRIPTION = 'Yeni CMD-də Claude işə sal'
const RECENT_CATEGORY = 'Son Claude söhbətləri'

function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

function shorten(text: string): string {
  return text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : text
}

export function buildJumpList(sessions: readonly ClaudeSession[], executable: string): JumpListCategory[] {
  const categories: JumpListCategory[] = [
    {
      type: 'tasks',
      items: [
        {
          type: 'task',
          title: NEW_CLAUDE_TITLE,
          description: NEW_CLAUDE_DESCRIPTION,
          program: executable,
          args: NEW_CLAUDE_FLAG,
          iconPath: executable,
          iconIndex: 0
        }
      ]
    }
  ]

  const recent = sessions.slice(0, JUMP_LIST_SESSION_LIMIT)
  if (recent.length > 0) {
    categories.push({
      type: 'custom',
      name: RECENT_CATEGORY,
      items: recent.map((session) => ({
        type: 'task' as const,
        title: shorten(session.title),
        description: folderName(session.cwd),
        program: executable,
        args: resumeArgument(session.id),
        iconPath: executable,
        iconIndex: 0
      }))
    })
  }
  return categories
}
