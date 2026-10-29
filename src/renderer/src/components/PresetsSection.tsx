import { useEffect } from 'react'
import { KNOWN_AGENTS } from '@shared/agents'
import { useAgentsStore } from '../state/agents-store'
import { launchPreset, launchTerminal } from '../state/launch-actions'
import { usePresetsStore } from '../state/presets-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { ClaudeLogo } from './ClaudeLogo'
import { Icon } from './Icon'

export function PresetsSection() {
  const presets = usePresetsStore((state) => state.presets)
  const agents = useAgentsStore((state) => state.status)
  const openDialog = useUiStore((state) => state.openDialog)

  useEffect(() => {
    void useAgentsStore.getState().load()
  }, [])

  return (
    <section className="sidebar__section" aria-label={strings.presets.title}>
      <h2 className="sidebar__title">{strings.presets.title}</h2>

      <ul className="preset-list" aria-label={strings.presets.builtIn}>
        {KNOWN_AGENTS.map((agent) => {
          const installed = agents ? agents[agent.id] : null
          return (
            <li key={agent.id} className="preset-row">
              <span className="preset-row__icon">
                {agent.id === 'claude' ? <ClaudeLogo size={14} /> : <Icon name="terminal" size={14} />}
              </span>
              <span className="preset-row__text">
                <span className="preset-row__name">{agent.label}</span>
                <span className="preset-row__command">
                  {agent.command}
                  {installed === false ? ` · ${strings.presets.notInstalled}` : ''}
                </span>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={strings.presets.startLabel(agent.label)}
                data-tip={strings.presets.start}
                onClick={() => void launchTerminal({ agentId: agent.id })}
              >
                <Icon name="play" size={13} />
              </button>
            </li>
          )
        })}
      </ul>

      {presets.length === 0 ? (
        <p className="sidebar__empty">{strings.presets.empty}</p>
      ) : (
        <ul className="preset-list" aria-label={strings.presets.mine}>
          {presets.map((preset) => (
            <li key={preset.id} className="preset-row">
              <span className="preset-row__icon">
                <Icon name="terminal" size={14} />
              </span>
              <span className="preset-row__text">
                <span className="preset-row__name">{preset.name}</span>
                <span className="preset-row__command" title={preset.command}>
                  {preset.command || strings.presets.plainTerminal}
                </span>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={strings.presets.startLabel(preset.name)}
                data-tip={strings.presets.start}
                onClick={() => void launchPreset(preset)}
              >
                <Icon name="play" size={13} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={strings.presets.editLabel(preset.name)}
                data-tip={strings.presets.edit}
                onClick={() => openDialog({ kind: 'preset-editor', id: preset.id })}
              >
                <Icon name="edit" size={13} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={strings.presets.deleteLabel(preset.name)}
                data-tip={strings.presets.delete}
                onClick={() => openDialog({ kind: 'delete-preset', id: preset.id })}
              >
                <Icon name="trash" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="preset-actions">
        <button
          type="button"
          className="btn btn--ghost sidebar__action"
          onClick={() => openDialog({ kind: 'preset-editor', id: null })}
        >
          <Icon name="plus" size={14} />
          {strings.presets.new}
        </button>
        <button
          type="button"
          className="btn btn--ghost sidebar__action"
          onClick={() => openDialog({ kind: 'launch' })}
        >
          <Icon name="play" size={14} />
          {strings.presets.startWith}
        </button>
      </div>
    </section>
  )
}
