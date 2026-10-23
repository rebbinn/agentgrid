import { describe, expect, it } from 'vitest'
import { discoverShells, parseWslDistroList, type ShellDiscoveryDeps } from '../../src/main/shells'

function makeDeps(
  files: string[],
  env: Record<string, string>,
  distros: string[] = []
): ShellDiscoveryDeps {
  const known = new Set(files.map((file) => file.toLowerCase()))
  return {
    env,
    platform: 'win32',
    isFile: (path) => known.has(path.toLowerCase()),
    listWslDistros: async () => distros
  }
}

const baseEnv = {
  SystemRoot: 'C:\\Windows',
  ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  Path: 'C:\\Windows\\System32',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local'
}

const systemFiles = [
  'C:\\Windows\\System32\\cmd.exe',
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  'C:\\Windows\\System32\\wsl.exe'
]

describe('discoverShells', () => {
  it('finds cmd and Windows PowerShell on a bare system', async () => {
    const shells = await discoverShells(makeDeps(systemFiles, baseEnv))
    expect(shells.map((shell) => shell.id)).toEqual(['cmd', 'powershell'])
  })

  it('puts cmd first so it can be the default', async () => {
    const shells = await discoverShells(makeDeps(systemFiles, baseEnv))
    expect(shells[0]?.kind).toBe('cmd')
  })

  it('finds PowerShell 7 in Program Files', async () => {
    const shells = await discoverShells(
      makeDeps([...systemFiles, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'], baseEnv)
    )
    expect(shells.map((shell) => shell.id)).toContain('pwsh')
  })

  it('finds Git Bash next to git.exe on PATH even outside Program Files', async () => {
    const env = { ...baseEnv, Path: 'C:\\Windows\\System32;C:\\Users\\me\\Tools\\Git\\cmd' }
    const shells = await discoverShells(
      makeDeps(
        [...systemFiles, 'C:\\Users\\me\\Tools\\Git\\cmd\\git.exe', 'C:\\Users\\me\\Tools\\Git\\bin\\bash.exe'],
        env
      )
    )
    const gitBash = shells.find((shell) => shell.id === 'gitbash')
    expect(gitBash?.executable).toBe('C:\\Users\\me\\Tools\\Git\\bin\\bash.exe')
    expect(gitBash?.args).toEqual(['--login', '-i'])
  })

  it('does not treat the WSL launcher bash.exe in System32 as Git Bash', async () => {
    const shells = await discoverShells(
      makeDeps([...systemFiles, 'C:\\Windows\\System32\\bash.exe'], baseEnv)
    )
    expect(shells.map((shell) => shell.id)).not.toContain('gitbash')
  })

  it('adds one entry per WSL distribution', async () => {
    const shells = await discoverShells(makeDeps(systemFiles, baseEnv, ['Ubuntu', 'Debian']))
    const wsl = shells.filter((shell) => shell.kind === 'wsl')
    expect(wsl.map((shell) => shell.id)).toEqual(['wsl:Ubuntu', 'wsl:Debian'])
    expect(wsl[0]?.args).toEqual(['-d', 'Ubuntu'])
  })

  it('skips WSL when wsl.exe is missing', async () => {
    const withoutWsl = systemFiles.filter((file) => !file.endsWith('wsl.exe'))
    const shells = await discoverShells(makeDeps(withoutWsl, baseEnv, ['Ubuntu']))
    expect(shells.some((shell) => shell.kind === 'wsl')).toBe(false)
  })

  it('returns nothing on non-Windows platforms', async () => {
    const deps = { ...makeDeps(systemFiles, baseEnv), platform: 'linux' as const }
    expect(await discoverShells(deps)).toEqual([])
  })
})

describe('parseWslDistroList', () => {
  it('decodes UTF-16 output and hides the docker-desktop helper distributions', () => {
    const text = '\uFEFFUbuntu\r\ndocker-desktop\r\ndocker-desktop-data\r\nDebian\r\n'
    expect(parseWslDistroList(Buffer.from(text, 'utf16le'))).toEqual(['Ubuntu', 'Debian'])
  })

  it('returns an empty list for empty output', () => {
    expect(parseWslDistroList(Buffer.alloc(0))).toEqual([])
  })
})
