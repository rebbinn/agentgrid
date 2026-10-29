export const MAX_COMMAND_LENGTH = 4096

export function hasNoControlCharacters(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

export function isSingleLineCommand(text: string): boolean {
  return text.trim().length > 0 && text.length <= MAX_COMMAND_LENGTH && hasNoControlCharacters(text)
}

export function firstCommandToken(command: string): string {
  const trimmed = command.trim()
  if (trimmed.startsWith('"')) {
    const closing = trimmed.indexOf('"', 1)
    return closing === -1 ? trimmed.slice(1) : trimmed.slice(1, closing)
  }
  const match = /^\S+/.exec(trimmed)
  return match ? match[0] : ''
}

export function isPathLike(token: string): boolean {
  return /[\\/]/.test(token) || /^[A-Za-z]:/.test(token)
}
