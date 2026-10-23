import { z } from 'zod'

export const IpcChannel = {
  appInfo: 'app:info',
  projectPick: 'project:pick'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string()
})
export type AppInfo = z.infer<typeof AppInfoSchema>

export const ProjectPickResultSchema = z.object({
  path: z.string().nullable()
})
export type ProjectPickResult = z.infer<typeof ProjectPickResultSchema>

export interface AgentGridApi {
  app: {
    info(): Promise<AppInfo>
  }
  project: {
    pick(): Promise<ProjectPickResult>
  }
}
