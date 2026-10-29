import { useEffect, useState } from 'react'
import type { ShellInfo } from '@shared/ipc'
import { useLaunch } from '../hooks/use-launch'
import { getShells } from '../lib/shells'
import { withShortcut } from '../lib/shortcuts'
import { strings } from '../strings'
import { Dropdown, type DropdownItem } from './Dropdown'
import { Icon } from './Icon'

export function NewTerminalButton() {
  const launch = useLaunch()
  const [shells, setShells] = useState<ShellInfo[]>([])

  useEffect(() => {
    getShells()
      .then(setShells)
      .catch(() => setShells([]))
  }, [])

  const items: DropdownItem[] = shells.map((shell) => ({
    id: shell.id,
    label: shell.label,
    onSelect: () => void launch({ shellId: shell.id })
  }))

  return (
    <div className="split-button">
      <button
        type="button"
        className="btn btn--primary split-button__main"
        data-tip={withShortcut(strings.header.newTerminal, 'newTerminal')}
        onClick={() => void launch()}
      >
        <Icon name="plus" />
        {strings.header.newTerminal}
      </button>
      <Dropdown
        label={strings.header.chooseShell}
        items={items}
        buttonClassName="btn btn--primary split-button__toggle"
      >
        <Icon name="chevron" size={14} />
      </Dropdown>
    </div>
  )
}
