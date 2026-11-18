import { create } from 'zustand'
import type { SshEvent, SshRequestEvent } from '@shared/ssh'

export interface SshPhase {
  phase: 'connecting' | 'authenticating'
  hostName: string
}

interface SshState {
  requests: Record<string, SshRequestEvent>
  phases: Record<string, SshPhase>
  latency: Record<string, number>
  cwd: Record<string, string>
  setCwd: (sessionId: string, path: string) => void
  handleEvent: (event: SshEvent) => void
  resolveRequest: (sessionId: string) => void
  forget: (sessionId: string) => void
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

export const useSshStore = create<SshState>((set) => ({
  requests: {},
  phases: {},
  latency: {},
  cwd: {},

  setCwd: (sessionId, path) =>
    set((state) => (state.cwd[sessionId] === path ? state : { cwd: { ...state.cwd, [sessionId]: path } })),

  handleEvent: (event) => {
    switch (event.kind) {
      case 'phase':
        set((state) => ({
          phases: { ...state.phases, [event.sessionId]: { phase: event.phase, hostName: event.hostName } }
        }))
        return
      case 'hostkey':
      case 'prompt':
        set((state) => ({ requests: { ...state.requests, [event.sessionId]: event } }))
        return
      case 'latency':
        set((state) => ({ latency: { ...state.latency, [event.sessionId]: event.ms } }))
        return
    }
  },

  resolveRequest: (sessionId) => set((state) => ({ requests: without(state.requests, sessionId) })),

  forget: (sessionId) =>
    set((state) => ({
      requests: without(state.requests, sessionId),
      phases: without(state.phases, sessionId),
      latency: without(state.latency, sessionId),
      cwd: without(state.cwd, sessionId)
    }))
}))

let unsubscribe: (() => void) | null = null

export function startSshEvents(): void {
  unsubscribe?.()
  unsubscribe = window.agentgrid.ssh.onEvent((event) => useSshStore.getState().handleEvent(event))
}

export function stopSshEvents(): void {
  unsubscribe?.()
  unsubscribe = null
}
