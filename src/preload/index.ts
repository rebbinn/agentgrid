import { contextBridge, ipcRenderer } from 'electron'
import {
  AppInfoSchema,
  IpcChannel,
  ProjectPickResultSchema,
  type AgentGridApi
} from '../shared/ipc'

const api: AgentGridApi = {
  app: {
    info: async () => AppInfoSchema.parse(await ipcRenderer.invoke(IpcChannel.appInfo))
  },
  project: {
    pick: async () =>
      ProjectPickResultSchema.parse(await ipcRenderer.invoke(IpcChannel.projectPick))
  }
}

contextBridge.exposeInMainWorld('agentgrid', api)
