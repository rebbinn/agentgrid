import { requestClosePane } from '../state/launch-actions'

export function useClosePane(): (id: string) => void {
  return requestClosePane
}
