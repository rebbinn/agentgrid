import type { ShellInfo } from '@shared/ipc'

const DEFAULT_SHELL_ID = 'cmd'

let cached: Promise<ShellInfo[]> | null = null

export function getShells(): Promise<ShellInfo[]> {
  cached ??= window.agentgrid.shell.list().catch((error: unknown) => {
    cached = null
    throw error
  })
  return cached
}

export function resetShellsCache(): void {
  cached = null
}

export function pickDefaultShell(
  shells: readonly ShellInfo[],
  preferredId: string | null = null
): ShellInfo | null {
  const preferred = preferredId ? shells.find((shell) => shell.id === preferredId) : undefined
  return preferred ?? shells.find((shell) => shell.id === DEFAULT_SHELL_ID) ?? shells[0] ?? null
}
