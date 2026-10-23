import { vi } from 'vitest'
import type { AgentGridApi, ShellInfo } from '../../src/shared/ipc'

export const CMD_SHELL: ShellInfo = { id: 'cmd', label: 'Command Prompt', kind: 'cmd' }
export const POWERSHELL_SHELL: ShellInfo = {
  id: 'powershell',
  label: 'Windows PowerShell',
  kind: 'powershell'
}

export function createAgentGridMock() {
  return {
    app: {
      info: vi
        .fn()
        .mockResolvedValue({
          name: 'AgentGrid',
          version: '0.1.0',
          platform: 'win32',
          osBuild: 26200,
          homeDir: 'C:\\Users\\me'
        })
    },
    project: { pick: vi.fn() },
    shell: { list: vi.fn().mockResolvedValue([CMD_SHELL, POWERSHELL_SHELL]) },
    terminal: {
      create: vi.fn().mockResolvedValue({ ok: true, pid: 1, shell: CMD_SHELL }),
      write: vi.fn(),
      resize: vi.fn(),
      ack: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined)
    },
    sessions: { list: vi.fn().mockResolvedValue([]) },
    launcher: {
      takePending: vi.fn().mockResolvedValue([]),
      onRequest: vi.fn<AgentGridApi['launcher']['onRequest']>(() => () => undefined)
    },
    clipboard: {
      readText: vi.fn().mockResolvedValue(''),
      writeText: vi.fn().mockResolvedValue(undefined)
    },
    external: { open: vi.fn().mockResolvedValue(true) }
  } satisfies AgentGridApi
}

export type AgentGridMock = ReturnType<typeof createAgentGridMock>
