import type { AppInfo } from '@shared/ipc'

let cached: Promise<AppInfo> | null = null

export function getAppInfo(): Promise<AppInfo> {
  cached ??= window.agentgrid.app.info().catch((error: unknown) => {
    cached = null
    throw error
  })
  return cached
}

export function resetAppInfoCache(): void {
  cached = null
}
