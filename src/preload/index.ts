import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  AgentStatusSchema,
  AppInfoSchema,
  ClaudeSessionListSchema,
  IpcChannel,
  LaunchRequestListSchema,
  LaunchRequestSchema,
  ProjectPickResultSchema,
  ShellListSchema,
  TerminalCreateResultSchema,
  TerminalDataEventSchema,
  TerminalExitEventSchema,
  type AgentGridApi
} from '../shared/ipc'
import {
  HostSaveResultSchema,
  HostViewListSchema,
  HostsTransferResultSchema,
  KeyPickResultSchema
} from '../shared/hosts'
import { LoadedSettingsSchema } from '../shared/settings'
import { SshEventSchema, SshResultSchema } from '../shared/ssh'

function subscribe<T>(
  channel: string,
  parse: (payload: unknown) => T,
  listener: (event: T) => void
): () => void {
  const handler = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(parse(payload))
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: AgentGridApi = {
  app: {
    info: async () => AppInfoSchema.parse(await ipcRenderer.invoke(IpcChannel.appInfo))
  },
  project: {
    pick: async () =>
      ProjectPickResultSchema.parse(await ipcRenderer.invoke(IpcChannel.projectPick))
  },
  shell: {
    list: async () => ShellListSchema.parse(await ipcRenderer.invoke(IpcChannel.shellList))
  },
  terminal: {
    create: async (request) =>
      TerminalCreateResultSchema.parse(await ipcRenderer.invoke(IpcChannel.terminalCreate, request)),
    write: (id, data) => ipcRenderer.send(IpcChannel.terminalWrite, { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send(IpcChannel.terminalResize, { id, cols, rows }),
    ack: (id, bytes) => ipcRenderer.send(IpcChannel.terminalAck, { id, bytes }),
    kill: (id) => ipcRenderer.send(IpcChannel.terminalKill, { id }),
    onData: (listener) =>
      subscribe(IpcChannel.terminalData, (payload) => TerminalDataEventSchema.parse(payload), listener),
    onExit: (listener) =>
      subscribe(IpcChannel.terminalExit, (payload) => TerminalExitEventSchema.parse(payload), listener)
  },
  sessions: {
    list: async () => ClaudeSessionListSchema.parse(await ipcRenderer.invoke(IpcChannel.sessionsList))
  },
  agents: {
    status: async () => AgentStatusSchema.parse(await ipcRenderer.invoke(IpcChannel.agentsStatus))
  },
  launcher: {
    takePending: async () =>
      LaunchRequestListSchema.parse(await ipcRenderer.invoke(IpcChannel.launchTakePending)),
    onRequest: (listener) =>
      subscribe(IpcChannel.launchRequest, (payload) => LaunchRequestSchema.parse(payload), listener)
  },
  settings: {
    load: async () => LoadedSettingsSchema.parse(await ipcRenderer.invoke(IpcChannel.settingsLoad)),
    save: (state) => ipcRenderer.send(IpcChannel.settingsSave, state),
    onFlushRequest: (listener) => subscribe(IpcChannel.settingsFlushRequest, () => undefined, listener),
    flushDone: () => ipcRenderer.send(IpcChannel.settingsFlushDone)
  },
  clipboard: {
    readText: async () => String(await ipcRenderer.invoke(IpcChannel.clipboardRead)),
    writeText: async (text) => {
      await ipcRenderer.invoke(IpcChannel.clipboardWrite, { text })
    }
  },
  external: {
    open: async (url) => Boolean(await ipcRenderer.invoke(IpcChannel.externalOpen, { url }))
  },
  hosts: {
    list: async () => HostViewListSchema.parse(await ipcRenderer.invoke(IpcChannel.hostsList)),
    save: async (request) => HostSaveResultSchema.parse(await ipcRenderer.invoke(IpcChannel.hostsSave, request)),
    remove: async (id) => {
      await ipcRenderer.invoke(IpcChannel.hostsDelete, { id })
    },
    exportAll: async () => HostsTransferResultSchema.parse(await ipcRenderer.invoke(IpcChannel.hostsExport)),
    importFile: async () => HostsTransferResultSchema.parse(await ipcRenderer.invoke(IpcChannel.hostsImport)),
    pickKey: async () => KeyPickResultSchema.parse(await ipcRenderer.invoke(IpcChannel.hostsPickKey)),
    forgetHostKey: async (id) => Boolean(await ipcRenderer.invoke(IpcChannel.hostsForgetKey, { id }))
  },
  ssh: {
    open: async (request) => SshResultSchema.parse(await ipcRenderer.invoke(IpcChannel.sshOpen, request)),
    test: async (request) => SshResultSchema.parse(await ipcRenderer.invoke(IpcChannel.sshTest, request)),
    answer: (answer) => ipcRenderer.send(IpcChannel.sshAnswer, answer),
    cancel: (sessionId) => ipcRenderer.send(IpcChannel.sshCancel, { sessionId }),
    onEvent: (listener) => subscribe(IpcChannel.sshEvent, (payload) => SshEventSchema.parse(payload), listener)
  }
}

contextBridge.exposeInMainWorld('agentgrid', api)
