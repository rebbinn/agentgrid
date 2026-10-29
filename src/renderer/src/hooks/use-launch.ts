import { launchTerminal, type LaunchRequest } from '../state/launch-actions'

export type { LaunchRequest }

export function useLaunch(): (request?: LaunchRequest) => Promise<void> {
  return launchTerminal
}
