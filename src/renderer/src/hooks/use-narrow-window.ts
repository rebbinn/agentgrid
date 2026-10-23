import { useEffect } from 'react'
import { useUiStore } from '../state/ui-store'

const NARROW_QUERY = '(max-width: 900px)'

export function useCollapseSidebarWhenNarrow(): void {
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen)

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY)
    if (query.matches) setSidebarOpen(false)
    const onChange = (event: MediaQueryListEvent): void => {
      if (event.matches) setSidebarOpen(false)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [setSidebarOpen])
}
