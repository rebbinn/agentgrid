import { useLaunch } from '../hooks/use-launch'
import { strings } from '../strings'
import { ClaudeLogo } from './ClaudeLogo'
import { Icon } from './Icon'

interface EmptySlotProps {
  column: number
  row: number
}

export function EmptySlot({ column, row }: EmptySlotProps) {
  const launch = useLaunch()

  return (
    <div
      className="empty-slot"
      style={{ gridColumn: column, gridRow: row }}
      role="group"
      aria-label={strings.layout.emptySlot}
    >
      <button type="button" className="btn btn--primary" onClick={() => void launch({ agentId: 'claude' })}>
        <ClaudeLogo />
        {strings.empty.startClaude}
      </button>
      <button type="button" className="btn" onClick={() => void launch()}>
        <Icon name="terminal" />
        {strings.empty.plainTerminal}
      </button>
    </div>
  )
}
