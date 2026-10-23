import { MAX_WORKSPACE_NAME } from '@shared/settings'
import { useUiStore } from '../state/ui-store'
import {
  createWorkspace,
  deleteWorkspace,
  nextWorkspaceName,
  renameWorkspace,
  runningPaneCount,
  switchWorkspace
} from '../state/workspace-actions'
import { useWorkspaceStore } from '../state/workspace-store'
import { strings } from '../strings'
import { ConfirmDialog } from './ConfirmDialog'
import { PromptDialog } from './PromptDialog'

function validateName(value: string): string | null {
  return value.trim().length === 0 ? strings.workspace.dialogs.nameRequired : null
}

export function WorkspaceDialogs() {
  const dialog = useUiStore((state) => state.dialog)
  const closeDialog = useUiStore((state) => state.closeDialog)
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeId = useWorkspaceStore((state) => state.activeId)
  const texts = strings.workspace.dialogs

  if (!dialog) return null

  if (dialog.kind === 'new-workspace') {
    return (
      <PromptDialog
        title={texts.createTitle}
        label={texts.nameLabel}
        initialValue={nextWorkspaceName()}
        confirmLabel={texts.create}
        cancelLabel={texts.cancel}
        maxLength={MAX_WORKSPACE_NAME}
        validate={validateName}
        onCancel={closeDialog}
        onSubmit={(name) => {
          closeDialog()
          void createWorkspace(name)
        }}
      />
    )
  }

  const target = workspaces.find((item) => item.id === dialog.id)
  if (!target) return null

  if (dialog.kind === 'rename-workspace') {
    return (
      <PromptDialog
        title={texts.renameTitle}
        label={texts.nameLabel}
        initialValue={target.name}
        confirmLabel={texts.save}
        cancelLabel={texts.cancel}
        maxLength={MAX_WORKSPACE_NAME}
        validate={validateName}
        onCancel={closeDialog}
        onSubmit={(name) => {
          closeDialog()
          renameWorkspace(target.id, name)
        }}
      />
    )
  }

  if (dialog.kind === 'delete-workspace') {
    const running = target.id === activeId ? runningPaneCount() : 0
    return (
      <ConfirmDialog
        title={texts.deleteTitle}
        text={texts.deleteText(target.name) + (running > 0 ? texts.deleteRunning(running) : '')}
        confirmLabel={texts.delete}
        cancelLabel={texts.cancel}
        onCancel={closeDialog}
        onConfirm={() => {
          closeDialog()
          void deleteWorkspace(target.id)
        }}
      />
    )
  }

  return (
    <ConfirmDialog
      title={texts.switchTitle}
      text={texts.switchText(runningPaneCount(), target.name)}
      confirmLabel={texts.switch}
      cancelLabel={texts.cancel}
      confirmTone="primary"
      onCancel={closeDialog}
      onConfirm={() => {
        closeDialog()
        void switchWorkspace(target.id)
      }}
    />
  )
}
