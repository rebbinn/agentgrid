import { vi } from 'vitest'
import type { AgentGridApi, ShellInfo } from '../../src/shared/ipc'
import { defaultAppState } from '../../src/shared/settings'

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
    agents: { status: vi.fn().mockResolvedValue({ claude: true, codex: false, gemini: false }) },
    settings: {
      load: vi.fn().mockResolvedValue({ state: defaultAppState(), notices: [] }),
      save: vi.fn(),
      onFlushRequest: vi.fn<AgentGridApi['settings']['onFlushRequest']>(() => () => undefined),
      flushDone: vi.fn()
    },
    launcher: {
      takePending: vi.fn().mockResolvedValue([]),
      onRequest: vi.fn<AgentGridApi['launcher']['onRequest']>(() => () => undefined)
    },
    clipboard: {
      readText: vi.fn().mockResolvedValue(''),
      writeText: vi.fn().mockResolvedValue(undefined)
    },
    external: { open: vi.fn().mockResolvedValue(true) },
    hosts: {
      list: vi.fn<AgentGridApi['hosts']['list']>().mockResolvedValue([]),
      save: vi.fn<AgentGridApi['hosts']['save']>(),
      remove: vi.fn<AgentGridApi['hosts']['remove']>().mockResolvedValue(undefined),
      exportAll: vi.fn<AgentGridApi['hosts']['exportAll']>().mockResolvedValue({ status: 'cancelled' }),
      importFile: vi.fn<AgentGridApi['hosts']['importFile']>().mockResolvedValue({ status: 'cancelled' }),
      pickKey: vi.fn<AgentGridApi['hosts']['pickKey']>().mockResolvedValue({ path: null }),
      forgetHostKey: vi.fn<AgentGridApi['hosts']['forgetHostKey']>().mockResolvedValue(false)
    },
    ssh: {
      open: vi.fn<AgentGridApi['ssh']['open']>().mockResolvedValue({ ok: true }),
      test: vi.fn<AgentGridApi['ssh']['test']>().mockResolvedValue({ ok: true }),
      answer: vi.fn<AgentGridApi['ssh']['answer']>(),
      cancel: vi.fn<AgentGridApi['ssh']['cancel']>(),
      onEvent: vi.fn<AgentGridApi['ssh']['onEvent']>(() => () => undefined)
    },
    sftp: {
      open: vi.fn<AgentGridApi['sftp']['open']>().mockResolvedValue({ ok: true, home: '/home/me' }),
      request: vi.fn<AgentGridApi['sftp']['request']>().mockResolvedValue({ ok: true, path: '/home/me', entries: [] }),
      transfer: vi.fn<AgentGridApi['sftp']['transfer']>(),
      cancelTransfer: vi.fn<AgentGridApi['sftp']['cancelTransfer']>(),
      close: vi.fn<AgentGridApi['sftp']['close']>(),
      onEvent: vi.fn<AgentGridApi['sftp']['onEvent']>(() => () => undefined)
    },
    local: {
      list: vi.fn<AgentGridApi['local']['list']>().mockResolvedValue({ ok: true, path: 'C:\\Users\\me\\Downloads', entries: [] }),
      places: vi
        .fn<AgentGridApi['local']['places']>()
        .mockResolvedValue({ home: 'C:\\Users\\me', downloads: 'C:\\Users\\me\\Downloads', drives: ['C:\\'] }),
      pickFiles: vi.fn<AgentGridApi['local']['pickFiles']>().mockResolvedValue({ paths: [] }),
      reveal: vi.fn<AgentGridApi['local']['reveal']>().mockResolvedValue(undefined),
      pathForFile: vi.fn<AgentGridApi['local']['pathForFile']>(() => '')
    }
  } satisfies AgentGridApi
}

export type AgentGridMock = ReturnType<typeof createAgentGridMock>
