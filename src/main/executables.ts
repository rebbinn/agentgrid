import { delimiter, extname, join } from 'node:path'

export interface ExecutableLookupDeps {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  isFile(path: string): boolean
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key ? env[key] : undefined
}

export function findOnPath(name: string, deps: ExecutableLookupDeps): string | null {
  const directories = (readEnv(deps.env, 'PATH') ?? '').split(delimiter).filter(Boolean)
  const extensions =
    deps.platform === 'win32'
      ? (readEnv(deps.env, 'PATHEXT') ?? DEFAULT_PATHEXT).split(';').filter(Boolean)
      : ['']
  const hasKnownExtension =
    deps.platform === 'win32' &&
    extensions.some((extension) => extension.toLowerCase() === extname(name).toLowerCase())
  const candidates = hasKnownExtension ? [name] : extensions.map((extension) => name + extension)

  for (const directory of directories) {
    for (const candidate of candidates) {
      const fullPath = join(directory, candidate)
      if (deps.isFile(fullPath)) return fullPath
    }
  }
  return null
}

export { readEnv }
