import { useEffect, useState } from 'react'
import type { ShellInfo } from '@shared/ipc'
import { getAppInfo } from '../lib/app-info'
import { getShells } from '../lib/shells'
import { PANE_SHORTCUT_COUNT, SHORTCUT_IDS, formatShortcut, paneShortcutIndex, type ShortcutId } from '../lib/shortcuts'
import { usePrefsStore } from '../state/prefs-store'
import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../terminal/theme'
import { Icon } from './Icon'
import { ModalDialog } from './ModalDialog'

const LISTED_SHORTCUTS = SHORTCUT_IDS.filter((id) => paneShortcutIndex(id) === null)

function shortcutLabel(id: ShortcutId): string {
  const label = strings.shortcutLabels[id as keyof typeof strings.shortcutLabels]
  return typeof label === 'string' ? label : id
}

export function SettingsDialog() {
  const closeDialog = useUiStore((state) => state.closeDialog)
  const fontSize = usePrefsStore((state) => state.defaultFontSize)
  const defaultShellId = usePrefsStore((state) => state.defaultShellId)
  const setFontSize = usePrefsStore((state) => state.setDefaultFontSize)
  const setDefaultShellId = usePrefsStore((state) => state.setDefaultShellId)
  const paneCount = useTerminalStore((state) => state.panes.length)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [version, setVersion] = useState('')

  useEffect(() => {
    getShells()
      .then(setShells)
      .catch(() => setShells([]))
    getAppInfo()
      .then((info) => setVersion(info.version))
      .catch(() => setVersion(''))
  }, [])

  const applyToAll = (): void => {
    for (const pane of useTerminalStore.getState().panes) {
      useTerminalStore.getState().setFontSize(pane.id, fontSize)
    }
  }

  return (
    <ModalDialog title={strings.settings.title} onClose={closeDialog} wide>
      <section className="settings-section" aria-label={strings.settings.terminalSection}>
        <h3 className="settings-section__title">{strings.settings.terminalSection}</h3>

        <div className="settings-row">
          <span className="settings-row__label" id="font-size-label">
            {strings.settings.fontSize}
          </span>
          <div className="stepper" role="group" aria-labelledby="font-size-label">
            <button
              type="button"
              className="icon-button"
              aria-label={strings.settings.fontDecrease}
              disabled={fontSize <= MIN_FONT_SIZE}
              onClick={() => setFontSize(fontSize - 1)}
            >
              −
            </button>
            <output className="stepper__value" aria-live="polite">
              {fontSize}
            </output>
            <button
              type="button"
              className="icon-button"
              aria-label={strings.settings.fontIncrease}
              disabled={fontSize >= MAX_FONT_SIZE}
              onClick={() => setFontSize(fontSize + 1)}
            >
              +
            </button>
          </div>
        </div>
        <p className="settings-note">{strings.settings.fontHint}</p>
        <button type="button" className="btn" disabled={paneCount === 0} onClick={applyToAll}>
          {strings.settings.applyToAll}
        </button>

        <label className="settings-row">
          <span className="settings-row__label">{strings.settings.defaultShell}</span>
          <select
            className="dialog__input"
            aria-label={strings.settings.defaultShell}
            value={defaultShellId ?? ''}
            onChange={(event) => setDefaultShellId(event.target.value === '' ? null : event.target.value)}
          >
            <option value="">{strings.settings.autoShell}</option>
            {shells.map((shell) => (
              <option key={shell.id} value={shell.id}>
                {shell.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="settings-section" aria-label={strings.settings.shortcutsSection}>
        <h3 className="settings-section__title">{strings.settings.shortcutsSection}</h3>
        <ul className="shortcut-list">
          {LISTED_SHORTCUTS.map((id) => (
            <li key={id} className="shortcut-list__item">
              <span>{shortcutLabel(id)}</span>
              <kbd className="palette__key">{formatShortcut(id)}</kbd>
            </li>
          ))}
          <li className="shortcut-list__item">
            <span>{strings.shortcutLabels.focusPane(1)} … {PANE_SHORTCUT_COUNT}</span>
            <kbd className="palette__key">Ctrl+1 … Ctrl+{PANE_SHORTCUT_COUNT}</kbd>
          </li>
        </ul>
        <h4 className="settings-subtitle">{strings.settings.terminalKeysTitle}</h4>
        <ul className="shortcut-list">
          {strings.terminalKeys.map((item) => (
            <li key={item.keys} className="shortcut-list__item">
              <span>{item.label}</span>
              <kbd className="palette__key">{item.keys}</kbd>
            </li>
          ))}
        </ul>
        <p className="settings-note">{strings.settings.shortcutsHint}</p>
      </section>

      <section className="settings-section" aria-label={strings.settings.aboutSection}>
        <h3 className="settings-section__title">{strings.settings.aboutSection}</h3>
        <p className="settings-note">{version ? strings.settings.about(version) : strings.appName}</p>
        <p className="settings-note">{strings.settings.local}</p>
      </section>

      <div className="dialog__actions">
        <button type="button" className="btn btn--primary" data-autofocus onClick={closeDialog}>
          <Icon name="close" size={14} />
          {strings.settings.close}
        </button>
      </div>
    </ModalDialog>
  )
}
