import type { Command } from './commands'

function fold(text: string): string {
  return text.toLocaleLowerCase('az')
}

function scoreCommand(command: Command, terms: readonly string[]): number | null {
  const title = fold(command.title)
  const rest = fold(`${command.group} ${command.keywords}`)
  const words = title.split(/[\s:·\-–—/\\]+/).filter(Boolean)
  let score = 0
  for (const term of terms) {
    if (title.startsWith(term)) score += 4
    else if (words.some((word) => word.startsWith(term))) score += 3
    else if (title.includes(term)) score += 2
    else if (rest.includes(term)) score += 1
    else return null
  }
  return score
}

export function searchCommands(commands: readonly Command[], query: string): Command[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...commands]
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, terms) }))
    .filter((entry): entry is { command: Command; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command)
}
