let pauseDepth = 0
const resumeListeners = new Set<() => void>()

export function isPersistencePaused(): boolean {
  return pauseDepth > 0
}

export function onPersistenceResumed(listener: () => void): () => void {
  resumeListeners.add(listener)
  return () => resumeListeners.delete(listener)
}

export async function withPersistencePaused<T>(work: () => Promise<T>): Promise<T> {
  pauseDepth++
  try {
    return await work()
  } finally {
    pauseDepth--
    if (pauseDepth === 0) for (const listener of resumeListeners) listener()
  }
}
