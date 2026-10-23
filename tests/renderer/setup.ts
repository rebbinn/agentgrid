import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

vi.mock('../../src/renderer/src/terminal/registry', async () => {
  const { fakeRegistry } = await import('./fake-registry')
  return { terminalRegistry: fakeRegistry }
})

afterEach(() => {
  cleanup()
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }))
})

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
