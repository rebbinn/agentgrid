import { describe, expect, it } from 'vitest'
import {
  MAX_COMMAND_LENGTH,
  firstCommandToken,
  hasNoControlCharacters,
  isPathLike,
  isSingleLineCommand
} from '../../src/shared/command-text'

describe('hasNoControlCharacters', () => {
  it('accepts ordinary text, including Azerbaijani letters, quotes and symbols', () => {
    expect(hasNoControlCharacters('git status && echo "salam ə ş ğ"')).toBe(true)
  })

  it.each(['a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u001bb', 'a\u007fb'])('rejects %j', (text) => {
    expect(hasNoControlCharacters(text)).toBe(false)
  })
})

describe('isSingleLineCommand', () => {
  it('accepts a normal one-line command', () => {
    expect(isSingleLineCommand('npm run dev')).toBe(true)
  })

  it('rejects empty, blank, multi-line and over-long commands', () => {
    expect(isSingleLineCommand('')).toBe(false)
    expect(isSingleLineCommand('   ')).toBe(false)
    expect(isSingleLineCommand('echo a\necho b')).toBe(false)
    expect(isSingleLineCommand('x'.repeat(MAX_COMMAND_LENGTH + 1))).toBe(false)
    expect(isSingleLineCommand('x'.repeat(MAX_COMMAND_LENGTH))).toBe(true)
  })
})

describe('firstCommandToken', () => {
  it('returns the program name at the start of a command', () => {
    expect(firstCommandToken('claude --resume abc')).toBe('claude')
    expect(firstCommandToken('   aider   --model x')).toBe('aider')
    expect(firstCommandToken('codex')).toBe('codex')
  })

  it('understands a quoted program path with spaces', () => {
    expect(firstCommandToken('"C:\\Program Files\\Tool\\tool.exe" --flag')).toBe('C:\\Program Files\\Tool\\tool.exe')
    expect(firstCommandToken('"broken')).toBe('broken')
  })

  it('returns an empty string for an empty command', () => {
    expect(firstCommandToken('')).toBe('')
    expect(firstCommandToken('   ')).toBe('')
  })
})

describe('isPathLike', () => {
  it('tells paths from bare program names', () => {
    expect(isPathLike('claude')).toBe(false)
    expect(isPathLike('C:\\tools\\x.exe')).toBe(true)
    expect(isPathLike('.\\x.exe')).toBe(true)
    expect(isPathLike('/usr/bin/x')).toBe(true)
    expect(isPathLike('D:tool')).toBe(true)
  })
})
