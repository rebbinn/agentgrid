import { describe, expect, it } from 'vitest'
import { findOnPath } from '../../src/main/executables'

function normalize(path: string): string {
  return path.toLowerCase().replaceAll('\\', '/')
}

function deps(files: string[], env: Record<string, string>, platform: NodeJS.Platform = 'win32') {
  const known = new Set(files.map(normalize))
  return { env, platform, isFile: (path: string) => known.has(normalize(path)) }
}

function found(name: string, lookup: ReturnType<typeof deps>): string | null {
  const result = findOnPath(name, lookup)
  return result === null ? null : normalize(result)
}

describe('findOnPath', () => {
  it('finds an executable by trying every PATHEXT extension', () => {
    const lookup = deps(['C:\\tools\\claude.cmd'], { Path: 'C:\\bin;C:\\tools', PATHEXT: '.EXE;.CMD' })
    expect(found('claude', lookup)).toBe('c:/tools/claude.cmd')
  })

  it('returns the first match in PATH order', () => {
    const lookup = deps(['C:\\a\\x.exe', 'C:\\b\\x.exe'], { PATH: 'C:\\a;C:\\b' })
    expect(found('x', lookup)).toBe('c:/a/x.exe')
  })

  it('reads PATH regardless of key casing', () => {
    const lookup = deps(['C:\\z\\tool.exe'], { pAtH: 'C:\\z' })
    expect(found('tool', lookup)).toBe('c:/z/tool.exe')
  })

  it('uses a name that already has a known extension as it is', () => {
    const lookup = deps(['C:\\z\\tool.exe'], { PATH: 'C:\\z' })
    expect(found('tool.exe', lookup)).toBe('c:/z/tool.exe')
  })

  it('returns null when nothing matches or PATH is empty', () => {
    expect(found('nothing', deps([], { PATH: 'C:\\z' }))).toBeNull()
    expect(found('nothing', deps([], {}))).toBeNull()
  })

  it('does not append extensions outside Windows', () => {
    const lookup = deps(['/usr/bin/claude', '/usr/bin/claude.exe'], { PATH: '/usr/bin' }, 'linux')
    expect(found('claude', lookup)).toBe('/usr/bin/claude')
    expect(found('other', lookup)).toBeNull()
  })
})
