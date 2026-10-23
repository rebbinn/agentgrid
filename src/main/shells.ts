import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ShellInfo } from '@shared/ipc'
import { findOnPath, readEnv, type ExecutableLookupDeps } from './executables'

export interface ShellDefinition extends ShellInfo {
  executable: string
  args: string[]
}

export interface ShellDiscoveryDeps extends ExecutableLookupDeps {
  listWslDistros(): Promise<string[]>
}

const HIDDEN_WSL_DISTROS = /^docker-desktop/i
const MAX_GIT_PARENT_LEVELS = 3

function gitBashCandidates(deps: ShellDiscoveryDeps): string[] {
  const candidates: string[] = []
  const gitExecutable = findOnPath('git', deps)
  if (gitExecutable) {
    let directory = dirname(gitExecutable)
    for (let level = 0; level < MAX_GIT_PARENT_LEVELS; level++) {
      candidates.push(join(directory, 'bin', 'bash.exe'))
      directory = dirname(directory)
    }
  }
  for (const variable of ['ProgramFiles', 'ProgramFiles(x86)']) {
    const root = readEnv(deps.env, variable)
    if (root) candidates.push(join(root, 'Git', 'bin', 'bash.exe'))
  }
  const localAppData = readEnv(deps.env, 'LOCALAPPDATA')
  if (localAppData) candidates.push(join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'))
  return candidates
}

export async function discoverShells(deps: ShellDiscoveryDeps): Promise<ShellDefinition[]> {
  if (deps.platform !== 'win32') return []

  const shells: ShellDefinition[] = []
  const systemRoot = readEnv(deps.env, 'SystemRoot') ?? 'C:\\Windows'

  const comSpec = readEnv(deps.env, 'ComSpec')
  const cmdPath =
    comSpec && deps.isFile(comSpec) ? comSpec : join(systemRoot, 'System32', 'cmd.exe')
  if (deps.isFile(cmdPath)) {
    shells.push({ id: 'cmd', label: 'Command Prompt', kind: 'cmd', executable: cmdPath, args: [] })
  }

  const windowsPowerShell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (deps.isFile(windowsPowerShell)) {
    shells.push({
      id: 'powershell',
      label: 'Windows PowerShell',
      kind: 'powershell',
      executable: windowsPowerShell,
      args: ['-NoLogo']
    })
  }

  const programFiles = readEnv(deps.env, 'ProgramFiles')
  const pwshCandidates = [
    findOnPath('pwsh', deps),
    programFiles ? join(programFiles, 'PowerShell', '7', 'pwsh.exe') : null
  ]
  const pwshPath = pwshCandidates.find((candidate) => candidate && deps.isFile(candidate))
  if (pwshPath) {
    shells.push({
      id: 'pwsh',
      label: 'PowerShell 7',
      kind: 'pwsh',
      executable: pwshPath,
      args: ['-NoLogo']
    })
  }

  const gitBashPath = gitBashCandidates(deps).find((candidate) => deps.isFile(candidate))
  if (gitBashPath) {
    shells.push({
      id: 'gitbash',
      label: 'Git Bash',
      kind: 'gitbash',
      executable: gitBashPath,
      args: ['--login', '-i']
    })
  }

  const wslPath = join(systemRoot, 'System32', 'wsl.exe')
  if (deps.isFile(wslPath)) {
    const distros = await deps.listWslDistros()
    for (const distro of distros) {
      shells.push({
        id: `wsl:${distro}`,
        label: `WSL: ${distro}`,
        kind: 'wsl',
        executable: wslPath,
        args: ['-d', distro]
      })
    }
  }

  return shells
}

export function parseWslDistroList(output: Buffer): string[] {
  return output
    .toString('utf16le')
    .replaceAll('\u0000', '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !HIDDEN_WSL_DISTROS.test(line))
}

function listWslDistros(env: NodeJS.ProcessEnv): Promise<string[]> {
  const systemRoot = readEnv(env, 'SystemRoot') ?? 'C:\\Windows'
  return new Promise((resolve) => {
    execFile(
      join(systemRoot, 'System32', 'wsl.exe'),
      ['-l', '-q'],
      { encoding: 'buffer', timeout: 4000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve([])
        resolve(parseWslDistroList(stdout))
      }
    )
  })
}

export function createShellDiscoveryDeps(env: NodeJS.ProcessEnv = process.env): ShellDiscoveryDeps {
  return {
    env,
    platform: process.platform,
    isFile: (path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    },
    listWslDistros: () => listWslDistros(env)
  }
}
