import { useEffect, useRef } from 'react'
import type { LaunchRequest } from '@shared/ipc'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { useLaunch } from './use-launch'
import { useOpenSession } from './use-open-session'

export function useLaunchRequests(): void {
  const launch = useLaunch()
  const openSession = useOpenSession()
  const handlers = useRef({ launch, openSession })
  handlers.current = { launch, openSession }

  useEffect(() => {
    const handle = (request: LaunchRequest): void => {
      if (request.kind === 'claude') void handlers.current.launch({ agentId: 'claude' })
      else if (request.kind === 'resume') void handlers.current.openSession(request.session)
      else useUiStore.getState().pushToast('warning', strings.sessions.missing)
    }

    const unsubscribe = window.agentgrid.launcher.onRequest(handle)
    window.agentgrid.launcher
      .takePending()
      .then((pending) => pending.forEach(handle))
      .catch(() => undefined)
    return unsubscribe
  }, [])
}
