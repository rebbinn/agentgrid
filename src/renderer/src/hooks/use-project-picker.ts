import { pickProjectFolder } from '../state/launch-actions'

export function useProjectPicker(): () => Promise<void> {
  return pickProjectFolder
}
