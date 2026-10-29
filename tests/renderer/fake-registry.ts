import { vi } from 'vitest'

export interface FakeManaged {
  id: string
  spawnRequested: boolean
  alive: boolean
  term: { cols: number; rows: number }
  attach: ReturnType<typeof vi.fn>
  detach: ReturnType<typeof vi.fn>
  fit: ReturnType<typeof vi.fn>
  markSpawned: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  markExited: ReturnType<typeof vi.fn>
  setFontSize: ReturnType<typeof vi.fn>
  sendText: ReturnType<typeof vi.fn>
  onZoom: (step: number | 'reset') => void
}

const managed = new Map<string, FakeManaged>()

function createFakeManaged(id: string): FakeManaged {
  return {
    id,
    spawnRequested: false,
    alive: false,
    term: { cols: 100, rows: 30 },
    attach: vi.fn(),
    detach: vi.fn(),
    fit: vi.fn(() => ({ cols: 100, rows: 30 })),
    markSpawned: vi.fn(),
    reset: vi.fn(),
    clear: vi.fn(),
    focus: vi.fn(),
    write: vi.fn(),
    markExited: vi.fn(),
    setFontSize: vi.fn(),
    sendText: vi.fn(() => true),
    onZoom: () => undefined
  }
}

export const fakeRegistry = {
  create: vi.fn((id: string) => {
    const terminal = createFakeManaged(id)
    managed.set(id, terminal)
    return terminal
  }),
  get: (id: string) => managed.get(id),
  remove: vi.fn((id: string) => {
    managed.delete(id)
  }),
  init: vi.fn(),
  dispose: vi.fn(),
  reset(): void {
    managed.clear()
    this.create.mockClear()
    this.remove.mockClear()
    this.init.mockClear()
    this.dispose.mockClear()
  },
  all: () => [...managed.values()]
}
