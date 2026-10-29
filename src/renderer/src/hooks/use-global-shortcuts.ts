import { useEffect } from 'react'
import { runShortcut } from '../commands/actions'
import { matchShortcut } from '../lib/shortcuts'
import { useUiStore } from '../state/ui-store'

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      const id = matchShortcut(event)
      if (!id) return
      const ui = useUiStore.getState()
      if (ui.dialog !== null || ui.pendingCloseId !== null) return
      if (ui.paletteOpen && id !== 'palette') return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      runShortcut(id)
    }
    window.addEventListener('keydown', handle, true)
    return () => window.removeEventListener('keydown', handle, true)
  }, [])
}
