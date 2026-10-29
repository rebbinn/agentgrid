import { useEffect, useState, type FormEvent } from 'react'
import { MAX_COMMAND_LENGTH, hasNoControlCharacters } from '@shared/command-text'
import type { ShellInfo } from '@shared/ipc'
import {
  MAX_PRESET_NAME,
  PresetSchema,
  type Preset,
  type PresetKind
} from '@shared/settings'
import { getShells } from '../lib/shells'
import { usePresetsStore } from '../state/presets-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { Icon } from './Icon'
import { ModalDialog } from './ModalDialog'

interface PresetEditorDialogProps {
  presetId: string | null
}

type FolderMode = 'workspace' | 'fixed'

export function PresetEditorDialog({ presetId }: PresetEditorDialogProps) {
  const texts = strings.presets.editor
  const closeDialog = useUiStore((state) => state.closeDialog)
  const pushToast = useUiStore((state) => state.pushToast)
  const existing = usePresetsStore((state) => state.presets.find((item) => item.id === presetId))
  const savePreset = usePresetsStore((state) => state.savePreset)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [name, setName] = useState(existing?.name ?? '')
  const [kind, setKind] = useState<PresetKind>(existing?.kind ?? 'command')
  const [command, setCommand] = useState(existing?.command ?? '')
  const [shellId, setShellId] = useState(existing?.shellId ?? '')
  const [folderMode, setFolderMode] = useState<FolderMode>(existing?.cwd ? 'fixed' : 'workspace')
  const [folderPath, setFolderPath] = useState(existing?.cwd ?? '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getShells()
      .then(setShells)
      .catch(() => setShells([]))
  }, [])

  const chooseFolder = async (): Promise<void> => {
    try {
      const { path } = await window.agentgrid.project.pick()
      if (path) {
        setFolderPath(path)
        setFolderMode('fixed')
        setError(null)
      }
    } catch {
      pushToast('error', strings.toast.projectPickFailed)
    }
  }

  const validate = (): string | null => {
    if (name.trim().length === 0) return texts.nameRequired
    if (!hasNoControlCharacters(command) || command.length > MAX_COMMAND_LENGTH) return texts.commandInvalid
    if (kind === 'agent' && command.trim().length === 0) return texts.commandRequired
    if (folderMode === 'fixed' && folderPath.trim().length === 0) return texts.folderRequired
    return null
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    const preset: Preset = {
      id: existing?.id ?? crypto.randomUUID(),
      name: name.trim(),
      kind,
      command: command.trim(),
      shellId: shellId === '' ? null : shellId,
      cwd: folderMode === 'fixed' ? folderPath.trim() : null
    }
    const checked = PresetSchema.safeParse(preset)
    if (!checked.success) {
      setError(texts.commandInvalid)
      return
    }
    if (!savePreset(checked.data)) {
      setError(texts.tooMany)
      return
    }
    pushToast('success', texts.saved(checked.data.name))
    closeDialog()
  }

  return (
    <ModalDialog title={existing ? texts.editTitle : texts.createTitle} onClose={closeDialog} wide>
      <form onSubmit={submit} noValidate>
        <label className="dialog__field">
          <span className="dialog__label">{texts.name}</span>
          <input
            className="dialog__input"
            value={name}
            maxLength={MAX_PRESET_NAME}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
          />
        </label>

        <fieldset className="dialog__fieldset">
          <legend className="dialog__label">{texts.kind}</legend>
          <label className="dialog__radio">
            <input
              type="radio"
              name="preset-kind"
              checked={kind === 'command'}
              onChange={() => setKind('command')}
            />
            {texts.kindCommand}
          </label>
          <label className="dialog__radio">
            <input type="radio" name="preset-kind" checked={kind === 'agent'} onChange={() => setKind('agent')} />
            {texts.kindAgent}
          </label>
        </fieldset>

        <label className="dialog__field">
          <span className="dialog__label">{texts.command}</span>
          <input
            className="dialog__input dialog__input--mono"
            value={command}
            maxLength={MAX_COMMAND_LENGTH}
            spellCheck={false}
            placeholder={kind === 'agent' ? 'aider --model sonnet' : 'npm run dev'}
            onChange={(event) => {
              setCommand(event.target.value)
              setError(null)
            }}
          />
          <span className="dialog__hint">{texts.commandHint}</span>
        </label>

        <label className="dialog__field">
          <span className="dialog__label">{texts.shell}</span>
          <select className="dialog__input" value={shellId} onChange={(event) => setShellId(event.target.value)}>
            <option value="">{texts.shellAuto}</option>
            {shells.map((shell) => (
              <option key={shell.id} value={shell.id}>
                {shell.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="dialog__fieldset">
          <legend className="dialog__label">{texts.folder}</legend>
          <label className="dialog__radio">
            <input
              type="radio"
              name="preset-folder"
              checked={folderMode === 'workspace'}
              onChange={() => setFolderMode('workspace')}
            />
            {texts.folderWorkspace}
          </label>
          <label className="dialog__radio">
            <input
              type="radio"
              name="preset-folder"
              checked={folderMode === 'fixed'}
              onChange={() => setFolderMode('fixed')}
            />
            {texts.folderFixed}
          </label>
          {folderMode === 'fixed' && (
            <div className="dialog__path">
              <span className="dialog__path-text" title={folderPath}>
                {folderPath || texts.noFolder}
              </span>
              <button type="button" className="btn" onClick={() => void chooseFolder()}>
                <Icon name="folder" size={14} />
                {texts.choose}
              </button>
            </div>
          )}
        </fieldset>

        <p className="dialog__safety">{texts.safety}</p>
        {error && (
          <p className="dialog__error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog__actions">
          <button type="button" className="btn" onClick={closeDialog}>
            {texts.cancel}
          </button>
          <button type="submit" className="btn btn--primary">
            {texts.save}
          </button>
        </div>
      </form>
    </ModalDialog>
  )
}
