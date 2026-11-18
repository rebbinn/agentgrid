import { useHostsStore } from '../state/hosts-store'
import { usePresetsStore } from '../state/presets-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { ConfirmDialog } from './ConfirmDialog'
import { HostEditorDialog } from './HostEditorDialog'
import { LaunchDialog } from './LaunchDialog'
import { PresetEditorDialog } from './PresetEditorDialog'
import { SettingsDialog } from './SettingsDialog'

export function ToolDialogs() {
  const dialog = useUiStore((state) => state.dialog)
  const closeDialog = useUiStore((state) => state.closeDialog)
  const presets = usePresetsStore((state) => state.presets)
  const removePreset = usePresetsStore((state) => state.removePreset)
  const hostViews = useHostsStore((state) => state.views)
  const removeHost = useHostsStore((state) => state.remove)
  const pushToast = useUiStore((state) => state.pushToast)

  if (!dialog) return null

  switch (dialog.kind) {
    case 'settings':
      return <SettingsDialog />
    case 'launch':
      return <LaunchDialog />
    case 'preset-editor':
      return <PresetEditorDialog key={dialog.id ?? 'new'} presetId={dialog.id} />
    case 'delete-preset': {
      const preset = presets.find((item) => item.id === dialog.id)
      if (!preset) return null
      const texts = strings.presets.deleteDialog
      return (
        <ConfirmDialog
          title={texts.title}
          text={texts.text(preset.name)}
          confirmLabel={texts.confirm}
          cancelLabel={strings.workspace.dialogs.cancel}
          onCancel={closeDialog}
          onConfirm={() => {
            closeDialog()
            removePreset(preset.id)
          }}
        />
      )
    }
    case 'host-editor':
      return <HostEditorDialog key={dialog.id ?? `new-${dialog.copyOf ?? ''}`} hostId={dialog.id} copyOf={dialog.copyOf} />
    case 'delete-host': {
      const view = hostViews.find((item) => item.host.id === dialog.id)
      if (!view) return null
      const texts = strings.servers.deleteDialog
      const dependents = hostViews.filter((item) => item.host.jumpHostId === view.host.id).length
      return (
        <ConfirmDialog
          title={texts.title}
          text={texts.text(view.host.name) + (dependents > 0 ? texts.usedAsJump(dependents) : '')}
          confirmLabel={texts.confirm}
          cancelLabel={strings.workspace.dialogs.cancel}
          onCancel={closeDialog}
          onConfirm={() => {
            closeDialog()
            removeHost(view.host.id).catch(() => pushToast('error', strings.servers.editor.errors.saveFailed))
          }}
        />
      )
    }
    default:
      return null
  }
}
