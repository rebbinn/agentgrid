import { usePresetsStore } from '../state/presets-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { ConfirmDialog } from './ConfirmDialog'
import { LaunchDialog } from './LaunchDialog'
import { PresetEditorDialog } from './PresetEditorDialog'
import { SettingsDialog } from './SettingsDialog'

export function ToolDialogs() {
  const dialog = useUiStore((state) => state.dialog)
  const closeDialog = useUiStore((state) => state.closeDialog)
  const presets = usePresetsStore((state) => state.presets)
  const removePreset = usePresetsStore((state) => state.removePreset)

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
    default:
      return null
  }
}
