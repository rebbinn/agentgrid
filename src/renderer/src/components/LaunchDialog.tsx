import { useEffect, useState, type FormEvent } from 'react'
import { KNOWN_AGENTS, type AgentId } from '@shared/agents'
import type { ShellInfo } from '@shared/ipc'
import { getShells } from '../lib/shells'
import { useAgentsStore } from '../state/agents-store'
import { launchPreset, launchTerminal } from '../state/launch-actions'
import { usePresetsStore } from '../state/presets-store'
import { useProjectStore } from '../state/project-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { Icon } from './Icon'
import { ModalDialog } from './ModalDialog'

const PLAIN = 'plain'

export function LaunchDialog() {
  const texts = strings.presets.launchDialog
  const closeDialog = useUiStore((state) => state.closeDialog)
  const pushToast = useUiStore((state) => state.pushToast)
  const presets = usePresetsStore((state) => state.presets)
  const agents = useAgentsStore((state) => state.status)
  const projectPath = useProjectStore((state) => state.projectPath)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [program, setProgram] = useState(`agent:${KNOWN_AGENTS[0]?.id ?? PLAIN}`)
  const [shellId, setShellId] = useState('')
  const [chosenFolder, setChosenFolder] = useState<string | null>(null)

  useEffect(() => {
    getShells()
      .then(setShells)
      .catch(() => setShells([]))
    void useAgentsStore.getState().load()
  }, [])

  const chooseFolder = async (): Promise<void> => {
    try {
      const { path } = await window.agentgrid.project.pick()
      if (path) setChosenFolder(path)
    } catch {
      pushToast('error', strings.toast.projectPickFailed)
    }
  }

  const selectedAgent = program.startsWith('agent:')
    ? KNOWN_AGENTS.find((agent) => agent.id === program.slice('agent:'.length))
    : undefined
  const missing = selectedAgent && agents ? agents[selectedAgent.id] === false : false

  const start = (event: FormEvent): void => {
    event.preventDefault()
    const overrides = {
      ...(chosenFolder ? { cwd: chosenFolder } : {}),
      ...(shellId ? { shellId } : {})
    }
    closeDialog()
    if (program === PLAIN) {
      void launchTerminal(overrides)
    } else if (selectedAgent) {
      void launchTerminal({ agentId: selectedAgent.id as AgentId, ...overrides })
    } else {
      const preset = presets.find((item) => `preset:${item.id}` === program)
      if (preset) void launchPreset(preset, overrides)
    }
  }

  return (
    <ModalDialog title={texts.title} onClose={closeDialog}>
      <form onSubmit={start}>
        <label className="dialog__field">
          <span className="dialog__label">{texts.program}</span>
          <select className="dialog__input" value={program} onChange={(event) => setProgram(event.target.value)}>
            {KNOWN_AGENTS.map((agent) => (
              <option key={agent.id} value={`agent:${agent.id}`}>
                {agent.label}
                {agents && agents[agent.id] === false ? ` (${strings.presets.notInstalled})` : ''}
              </option>
            ))}
            <option value={PLAIN}>{texts.plain}</option>
            {presets.map((preset) => (
              <option key={preset.id} value={`preset:${preset.id}`}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>

        <label className="dialog__field">
          <span className="dialog__label">{texts.shell}</span>
          <select className="dialog__input" value={shellId} onChange={(event) => setShellId(event.target.value)}>
            <option value="">{strings.presets.editor.shellAuto}</option>
            {shells.map((shell) => (
              <option key={shell.id} value={shell.id}>
                {shell.label}
              </option>
            ))}
          </select>
        </label>

        <div className="dialog__field">
          <span className="dialog__label">{texts.folder}</span>
          <div className="dialog__path">
            <span className="dialog__path-text" title={chosenFolder ?? projectPath ?? ''}>
              {chosenFolder ?? projectPath ?? texts.folderProject}
            </span>
            <button type="button" className="btn" onClick={() => void chooseFolder()}>
              <Icon name="folder" size={14} />
              {strings.presets.editor.choose}
            </button>
          </div>
        </div>

        {missing && (
          <p className="dialog__warning" role="note">
            {texts.notInstalledNote}
          </p>
        )}

        <div className="dialog__actions">
          <button type="button" className="btn" onClick={closeDialog}>
            {texts.cancel}
          </button>
          <button type="submit" className="btn btn--primary">
            <Icon name="play" size={14} />
            {texts.start}
          </button>
        </div>
      </form>
    </ModalDialog>
  )
}
