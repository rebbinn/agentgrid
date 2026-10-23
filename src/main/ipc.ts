import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IpcChannel, type AppInfo, type ProjectPickResult } from '@shared/ipc'
import { isTrustedSender, type TrustedEntry } from './security'

export function registerIpc(getWindow: () => BrowserWindow | null, entry: TrustedEntry): void {
  function guard(event: IpcMainInvokeEvent): void {
    const window = getWindow()
    if (!isTrustedSender(event.senderFrame, window?.webContents ?? null, entry)) {
      throw new Error('Untrusted IPC sender')
    }
  }

  ipcMain.handle(IpcChannel.appInfo, (event): AppInfo => {
    guard(event)
    return { name: app.getName(), version: app.getVersion(), platform: process.platform }
  })

  ipcMain.handle(IpcChannel.projectPick, async (event): Promise<ProjectPickResult> => {
    guard(event)
    const window = getWindow()
    const options = { properties: ['openDirectory' as const] }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const [path] = result.filePaths
    return { path: result.canceled || !path ? null : path }
  })
}
