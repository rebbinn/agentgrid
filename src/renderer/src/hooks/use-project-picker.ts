import { useCallback } from 'react'
import { folderName } from '../lib/path'
import { strings } from '../strings'
import { useProjectStore } from '../state/project-store'
import { useUiStore } from '../state/ui-store'

export function useProjectPicker(): () => Promise<void> {
  const openProject = useProjectStore((state) => state.openProject)
  const pushToast = useUiStore((state) => state.pushToast)

  return useCallback(async () => {
    try {
      const { path } = await window.agentgrid.project.pick()
      if (!path) return
      openProject(path)
      pushToast('success', strings.toast.projectOpened(folderName(path)))
    } catch {
      pushToast('error', strings.toast.projectPickFailed)
    }
  }, [openProject, pushToast])
}
