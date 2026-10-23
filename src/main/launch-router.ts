import type { ClaudeSession, LaunchRequest } from '@shared/ipc'
import type { LaunchIntent } from './launch-args'

export interface LaunchRouterDeps {
  listSessions(): Promise<ClaudeSession[]>
  send(request: LaunchRequest): void
}

export class LaunchRouter {
  private queue: LaunchRequest[] = []
  private rendererReady = false

  constructor(private readonly deps: LaunchRouterDeps) {}

  async handle(intent: LaunchIntent | null): Promise<void> {
    if (!intent) return
    const request = await this.resolve(intent)
    if (this.rendererReady) this.deps.send(request)
    else this.queue.push(request)
  }

  takePending(): LaunchRequest[] {
    this.rendererReady = true
    const pending = this.queue
    this.queue = []
    return pending
  }

  rendererReloaded(): void {
    this.rendererReady = false
  }

  private async resolve(intent: LaunchIntent): Promise<LaunchRequest> {
    if (intent.kind === 'claude') return { kind: 'claude' }
    try {
      const session = (await this.deps.listSessions()).find((item) => item.id === intent.sessionId)
      return session ? { kind: 'resume', session } : { kind: 'session-missing' }
    } catch {
      return { kind: 'session-missing' }
    }
  }
}
