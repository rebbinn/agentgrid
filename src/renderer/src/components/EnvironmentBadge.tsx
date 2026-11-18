import type { HostEnvironment } from '@shared/hosts'
import { strings } from '../strings'

export function EnvironmentBadge({ environment }: { environment: HostEnvironment }) {
  return (
    <span className="env-badge" data-env={environment}>
      {strings.servers.environments[environment]}
    </span>
  )
}
