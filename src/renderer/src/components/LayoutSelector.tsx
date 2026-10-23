import { LAYOUT_PRESETS, resolveGrid, type LayoutPresetId } from '../lib/layout'
import { useLayoutStore } from '../state/layout-store'
import { useTerminalStore } from '../state/terminal-store'
import { strings } from '../strings'
import { Dropdown, type DropdownItem } from './Dropdown'
import { LayoutGlyph } from './LayoutGlyph'

export function LayoutSelector() {
  const preset = useLayoutStore((state) => state.preset)
  const focusMode = useLayoutStore((state) => state.focusMode)
  const setPreset = useLayoutStore((state) => state.setPreset)
  const paneCount = useTerminalStore((state) => state.panes.length)
  const activePaneId = useTerminalStore((state) => state.activePaneId)
  const grid = resolveGrid(preset, paneCount)

  const items: DropdownItem[] = [
    ...LAYOUT_PRESETS.map(
      (candidate): DropdownItem => ({
        id: candidate.id,
        label: strings.layout.presets[candidate.id],
        hint: strings.layout.hints[candidate.id],
        icon: <LayoutGlyph preset={candidate.id} />,
        role: 'menuitemradio',
        checked: !focusMode && candidate.id === preset,
        onSelect: () => setPreset(candidate.id)
      })
    ),
    {
      id: 'focus',
      label: strings.layout.focus,
      hint: strings.layout.focusHint,
      role: 'menuitemcheckbox',
      checked: focusMode,
      disabled: paneCount === 0,
      separatorBefore: true,
      onSelect: () => {
        if (activePaneId) useTerminalStore.getState().toggleFocus(activePaneId)
      }
    }
  ]

  const shownPreset: LayoutPresetId = preset
  const overflowTip = grid.overflowed && !focusMode ? strings.layout.overflow : undefined

  return (
    <Dropdown
      label={strings.header.layout}
      items={items}
      buttonClassName="btn"
      tip={overflowTip}
    >
      <LayoutGlyph preset={shownPreset} />
      {focusMode ? strings.layout.focus : strings.layout.presets[shownPreset]}
    </Dropdown>
  )
}
