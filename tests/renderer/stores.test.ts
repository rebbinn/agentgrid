import { beforeEach, describe, expect, it } from 'vitest'
import { folderName } from '../../src/renderer/src/lib/path'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'

describe('project store', () => {
  beforeEach(() => {
    useProjectStore.setState({ projectPath: null, recentPaths: [] })
  })

  it('sets the active project and records it as recent', () => {
    useProjectStore.getState().openProject('C:\\work\\a')
    expect(useProjectStore.getState().projectPath).toBe('C:\\work\\a')
    expect(useProjectStore.getState().recentPaths).toEqual(['C:\\work\\a'])
  })

  it('moves a reopened project to the front without duplicating it', () => {
    const { openProject } = useProjectStore.getState()
    openProject('C:\\work\\a')
    openProject('C:\\work\\b')
    openProject('C:\\work\\a')
    expect(useProjectStore.getState().recentPaths).toEqual(['C:\\work\\a', 'C:\\work\\b'])
  })

  it('keeps at most twenty recent projects, newest first', () => {
    const { openProject } = useProjectStore.getState()
    for (let index = 0; index < 25; index++) openProject(`C:\\work\\p${index}`)
    expect(useProjectStore.getState().recentPaths).toHaveLength(20)
    expect(useProjectStore.getState().recentPaths[0]).toBe('C:\\work\\p24')
  })

  it('can replace the list and set the project without touching recents', () => {
    useProjectStore.getState().setRecentPaths(['C:\\a', 'C:\\b'])
    useProjectStore.getState().setProject('C:\\c')
    expect(useProjectStore.getState().recentPaths).toEqual(['C:\\a', 'C:\\b'])
    expect(useProjectStore.getState().projectPath).toBe('C:\\c')
    useProjectStore.getState().setProject(null)
    expect(useProjectStore.getState().projectPath).toBeNull()
  })
})

describe('ui store', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarOpen: true, toasts: [] })
  })

  it('toggles the sidebar', () => {
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarOpen).toBe(false)
  })

  it('adds and dismisses toasts by id', () => {
    const first = useUiStore.getState().pushToast('success', 'one')
    const second = useUiStore.getState().pushToast('error', 'two')
    expect(useUiStore.getState().toasts.map((toast) => toast.message)).toEqual(['one', 'two'])
    useUiStore.getState().dismissToast(first)
    expect(useUiStore.getState().toasts.map((toast) => toast.id)).toEqual([second])
  })
})

describe('folderName', () => {
  it('returns the last folder of windows and posix paths', () => {
    expect(folderName('C:\\Users\\me\\project')).toBe('project')
    expect(folderName('/home/me/project/')).toBe('project')
    expect(folderName('C:\\')).toBe('C:')
  })
})
