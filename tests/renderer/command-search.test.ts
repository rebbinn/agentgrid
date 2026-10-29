import { describe, expect, it } from 'vitest'
import type { Command } from '../../src/renderer/src/commands/commands'
import { searchCommands } from '../../src/renderer/src/commands/search'

function command(id: string, title: string, group = 'Terminal', keywords = ''): Command {
  return { id, title, group, keywords, run: () => undefined }
}

const commands = [
  command('a', 'Yeni terminal'),
  command('b', 'Claude başlat', 'Agent', 'claude ai agent'),
  command('c', 'Düzülüş: 2 × 2', 'Düzülüş', 'layout grid'),
  command('d', 'İş sahəsinə keç: Mağaza', 'İş sahəsi', 'workspace'),
  command('e', 'Aktiv terminalı bağla', 'Terminal', 'close sil'),
  command('f', 'Şablon: Dev server', 'Şablon', 'npm run dev command')
]

const ids = (found: Command[]): string[] => found.map((item) => item.id)

describe('searchCommands', () => {
  it('returns everything in the original order for an empty query', () => {
    expect(ids(searchCommands(commands, ''))).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(ids(searchCommands(commands, '   '))).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('finds by a part of the title', () => {
    expect(ids(searchCommands(commands, 'claude'))).toEqual(['b'])
    expect(ids(searchCommands(commands, 'terminal'))).toEqual(['a', 'e'])
  })

  it('puts commands that start with the typed word before the ones that only contain it', () => {
    expect(ids(searchCommands(commands, 'yeni'))[0]).toBe('a')
    const list = [command('x', 'Sil: terminal'), command('y', 'Terminal sil')]
    expect(ids(searchCommands(list, 'terminal'))).toEqual(['y', 'x'])
  })

  it('needs every typed word to match somewhere', () => {
    expect(ids(searchCommands(commands, 'aktiv bağla'))).toEqual(['e'])
    expect(searchCommands(commands, 'aktiv claude')).toEqual([])
  })

  it('also looks in the group and the hidden keywords, in any order', () => {
    expect(ids(searchCommands(commands, 'workspace'))).toEqual(['d'])
    expect(ids(searchCommands(commands, 'npm'))).toEqual(['f'])
    expect(ids(searchCommands(commands, 'agent'))).toEqual(['b'])
    expect(ids(searchCommands(commands, 'grid layout'))).toEqual(['c'])
  })

  it('understands Azerbaijani capital letters, including the dotted İ and Ş, Ə', () => {
    expect(ids(searchCommands(commands, 'İŞ SAHƏSİ'))).toEqual(['d'])
    expect(ids(searchCommands(commands, 'MAĞAZA'))).toEqual(['d'])
    expect(ids(searchCommands(commands, 'ŞABLON'))).toEqual(['f'])
    expect(ids(searchCommands(commands, 'düzülüş'))).toEqual(['c'])
  })

  it('finds a word after a colon or a dash', () => {
    expect(ids(searchCommands(commands, 'mağaza'))).toEqual(['d'])
    expect(ids(searchCommands(commands, '2'))).toEqual(['c'])
  })

  it('keeps the original order between equally good matches', () => {
    const list = [command('1', 'Terminal bir'), command('2', 'Terminal iki'), command('3', 'Terminal üç')]
    expect(ids(searchCommands(list, 'terminal'))).toEqual(['1', '2', '3'])
  })

  it('does not change the list it was given', () => {
    const copy = [...commands]
    searchCommands(commands, 'claude')
    expect(commands).toEqual(copy)
  })

  it('returns nothing for gibberish', () => {
    expect(searchCommands(commands, 'zzzzqq')).toEqual([])
  })
})
