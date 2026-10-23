import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { terminalRegistry } from '../terminal/registry'
import { ConfirmDialog } from './ConfirmDialog'

export function CloseConfirm() {
  const pendingCloseId = useUiStore((state) => state.pendingCloseId)
  const cancelClose = useUiStore((state) => state.cancelClose)
  const pane = useTerminalStore((state) => state.panes.find((item) => item.id === pendingCloseId))

  if (!pendingCloseId || !pane) return null

  const cancel = (): void => {
    cancelClose()
    terminalRegistry.get(pendingCloseId)?.focus()
  }

  const confirm = (): void => {
    cancelClose()
    useTerminalStore.getState().close(pendingCloseId)
    const nextId = useTerminalStore.getState().activePaneId
    if (nextId) terminalRegistry.get(nextId)?.focus()
  }

  return (
    <ConfirmDialog
      title={strings.confirmClose.title}
      text={strings.confirmClose.text(pane.title)}
      confirmLabel={strings.confirmClose.confirm}
      cancelLabel={strings.confirmClose.cancel}
      onConfirm={confirm}
      onCancel={cancel}
    />
  )
}
