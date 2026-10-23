import { z } from 'zod'
import { AGENT_IDS } from './agents'

export const IpcChannel = {
  appInfo: 'app:info',
  projectPick: 'project:pick',
  shellList: 'shell:list',
  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalAck: 'terminal:ack',
  terminalKill: 'terminal:kill',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  externalOpen: 'external:open'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

export const MAX_WRITE_CHARS = 1_000_000
export const MAX_COLS = 1000
export const MAX_ROWS = 500

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  osBuild: z.number().int().nonnegative(),
  homeDir: z.string().min(1)
})
export type AppInfo = z.infer<typeof AppInfoSchema>

export const ProjectPickResultSchema = z.object({
  path: z.string().nullable()
})
export type ProjectPickResult = z.infer<typeof ProjectPickResultSchema>

export const SHELL_KINDS = ['cmd', 'powershell', 'pwsh', 'gitbash', 'wsl'] as const
export type ShellKind = (typeof SHELL_KINDS)[number]

export const ShellInfoSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string(),
  kind: z.enum(SHELL_KINDS)
})
export type ShellInfo = z.infer<typeof ShellInfoSchema>
export const ShellListSchema = z.array(ShellInfoSchema)

const TerminalIdSchema = z.uuid()
const ColsSchema = z.number().int().min(1).max(MAX_COLS)
const RowsSchema = z.number().int().min(1).max(MAX_ROWS)

export const TerminalCreateRequestSchema = z.object({
  id: TerminalIdSchema,
  shellId: z.string().min(1).max(128),
  cwd: z.string().min(1).max(1024),
  agentId: z.enum(AGENT_IDS).optional(),
  cols: ColsSchema,
  rows: RowsSchema
})
export type TerminalCreateRequest = z.infer<typeof TerminalCreateRequestSchema>

export const TERMINAL_ERROR_CODES = [
  'cwd-missing',
  'shell-missing',
  'agent-missing',
  'duplicate-id',
  'spawn-failed'
] as const
export type TerminalErrorCode = (typeof TERMINAL_ERROR_CODES)[number]

export const TerminalCreateResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), pid: z.number().int(), shell: ShellInfoSchema }),
  z.object({
    ok: z.literal(false),
    code: z.enum(TERMINAL_ERROR_CODES),
    message: z.string()
  })
])
export type TerminalCreateResult = z.infer<typeof TerminalCreateResultSchema>

export const TerminalWriteSchema = z.object({
  id: TerminalIdSchema,
  data: z.string().max(MAX_WRITE_CHARS)
})

export const TerminalResizeSchema = z.object({
  id: TerminalIdSchema,
  cols: ColsSchema,
  rows: RowsSchema
})

export const TerminalAckSchema = z.object({
  id: TerminalIdSchema,
  bytes: z.number().int().positive().max(MAX_WRITE_CHARS * 8)
})

export const TerminalKillSchema = z.object({ id: TerminalIdSchema })

export const TerminalDataEventSchema = z.object({
  id: TerminalIdSchema,
  data: z.string()
})
export type TerminalDataEvent = z.infer<typeof TerminalDataEventSchema>

export const TerminalExitEventSchema = z.object({
  id: TerminalIdSchema,
  exitCode: z.number().int(),
  signal: z.number().int().optional()
})
export type TerminalExitEvent = z.infer<typeof TerminalExitEventSchema>

export const ClipboardWriteSchema = z.object({ text: z.string().max(MAX_WRITE_CHARS) })

export const ExternalOpenSchema = z.object({ url: z.string().max(2048) })

export interface AgentGridApi {
  app: {
    info(): Promise<AppInfo>
  }
  project: {
    pick(): Promise<ProjectPickResult>
  }
  shell: {
    list(): Promise<ShellInfo[]>
  }
  terminal: {
    create(request: TerminalCreateRequest): Promise<TerminalCreateResult>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    ack(id: string, bytes: number): void
    kill(id: string): void
    onData(listener: (event: TerminalDataEvent) => void): () => void
    onExit(listener: (event: TerminalExitEvent) => void): () => void
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }
  external: {
    open(url: string): Promise<boolean>
  }
}
