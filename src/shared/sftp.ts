import { z } from 'zod'
import { hasNoControlCharacters } from './command-text'
import { SshFailureSchema } from './ssh'

export const MAX_REMOTE_PATH = 4096
export const MAX_LOCAL_PATH = 1024
export const MAX_FILE_NAME = 255

const RemotePathSchema = z
  .string()
  .min(1)
  .max(MAX_REMOTE_PATH)
  .refine((path) => !path.includes('\0'))
const LocalPathSchema = z
  .string()
  .min(1)
  .max(MAX_LOCAL_PATH)
  .refine((path) => /^(?:[A-Za-z]:\\|\\\\)/.test(path) && !path.includes('\0'))

export const ENTRY_KINDS = ['file', 'dir', 'link', 'other'] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]

export const RemoteEntrySchema = z.object({
  name: z.string().min(1).max(MAX_FILE_NAME * 4),
  kind: z.enum(ENTRY_KINDS),
  size: z.number().nonnegative(),
  mtime: z.number().nonnegative(),
  mode: z.number().int().nonnegative(),
  target: z.string().max(MAX_REMOTE_PATH).optional(),
  targetKind: z.enum(['file', 'dir', 'other']).optional()
})
export type RemoteEntry = z.infer<typeof RemoteEntrySchema>

export const LocalEntrySchema = z.object({
  name: z.string().min(1).max(MAX_FILE_NAME * 4),
  kind: z.enum(ENTRY_KINDS),
  size: z.number().nonnegative(),
  mtime: z.number().nonnegative()
})
export type LocalEntry = z.infer<typeof LocalEntrySchema>

export const SFTP_ERROR_CODES = [
  'not-found',
  'permission',
  'exists',
  'not-empty',
  'connection',
  'failure',
  'cancelled'
] as const
export type SftpErrorCode = (typeof SFTP_ERROR_CODES)[number]

export const SftpErrorSchema = z.object({
  code: z.enum(SFTP_ERROR_CODES),
  message: z.string().max(2000)
})
export type SftpError = z.infer<typeof SftpErrorSchema>

export const SftpOpenRequestSchema = z.object({
  id: z.uuid(),
  hostId: z.uuid(),
  viaId: z.uuid().optional()
})
export type SftpOpenRequest = z.infer<typeof SftpOpenRequestSchema>

export const SftpOpenResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), home: z.string().max(MAX_REMOTE_PATH) }),
  z.object({ ok: z.literal(false), failure: SshFailureSchema })
])
export type SftpOpenResult = z.infer<typeof SftpOpenResultSchema>

export const SftpRequestSchema = z.discriminatedUnion('op', [
  z.object({ sessionId: z.uuid(), op: z.literal('list'), path: RemotePathSchema }),
  z.object({ sessionId: z.uuid(), op: z.literal('realpath'), path: RemotePathSchema }),
  z.object({ sessionId: z.uuid(), op: z.literal('mkdir'), path: RemotePathSchema }),
  z.object({ sessionId: z.uuid(), op: z.literal('rename'), from: RemotePathSchema, to: RemotePathSchema }),
  z.object({ sessionId: z.uuid(), op: z.literal('remove'), path: RemotePathSchema, recursive: z.boolean() }),
  z.object({
    sessionId: z.uuid(),
    op: z.literal('chmod'),
    path: RemotePathSchema,
    mode: z.number().int().min(0).max(0o7777)
  })
])
export type SftpRequest = z.infer<typeof SftpRequestSchema>

export const SftpReplySchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    path: z.string().max(MAX_REMOTE_PATH).optional(),
    entries: z.array(RemoteEntrySchema).optional()
  }),
  z.object({ ok: z.literal(false), error: SftpErrorSchema })
])
export type SftpReply = z.infer<typeof SftpReplySchema>

export const TransferRequestSchema = z.object({
  sessionId: z.uuid(),
  transferId: z.uuid(),
  direction: z.enum(['upload', 'download']),
  localPath: LocalPathSchema,
  remotePath: RemotePathSchema,
  overwrite: z.boolean(),
  resume: z.boolean().optional()
})
export type TransferRequest = z.infer<typeof TransferRequestSchema>

export const TransferCancelSchema = z.object({ sessionId: z.uuid(), transferId: z.uuid() })
export const SftpCloseSchema = z.object({ sessionId: z.uuid() })

export const LocalListRequestSchema = z.object({ path: LocalPathSchema })
export const LocalListResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), path: z.string().max(MAX_LOCAL_PATH), entries: z.array(LocalEntrySchema) }),
  z.object({ ok: z.literal(false), error: SftpErrorSchema })
])
export type LocalListResult = z.infer<typeof LocalListResultSchema>

export const LocalPlacesSchema = z.object({
  home: z.string().max(MAX_LOCAL_PATH),
  downloads: z.string().max(MAX_LOCAL_PATH),
  drives: z.array(z.string().max(4)).max(26)
})
export type LocalPlaces = z.infer<typeof LocalPlacesSchema>

export const LocalPathRequestSchema = z.object({ path: LocalPathSchema })
export const EditPathRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_FILE_NAME)
    .refine((name) => hasNoControlCharacters(name) && !/[<>:"/\\|?*]/.test(name) && name !== '.' && name !== '..')
})
export const EditPathResultSchema = z.object({ path: z.string().max(MAX_LOCAL_PATH) })
export const LocalChangedEventSchema = z.object({ path: z.string().max(MAX_LOCAL_PATH) })
export type LocalChangedEvent = z.infer<typeof LocalChangedEventSchema>
export const LocalPickResultSchema = z.object({ paths: z.array(z.string().max(MAX_LOCAL_PATH)).max(1000) })
export type LocalPickResult = z.infer<typeof LocalPickResultSchema>

export const SftpEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('transfer'),
    sessionId: z.uuid(),
    transferId: z.uuid(),
    bytes: z.number().nonnegative(),
    total: z.number().nonnegative(),
    files: z.number().int().nonnegative(),
    filesTotal: z.number().int().nonnegative(),
    current: z.string().max(MAX_REMOTE_PATH)
  }),
  z.object({
    kind: z.literal('transfer-done'),
    sessionId: z.uuid(),
    transferId: z.uuid(),
    error: SftpErrorSchema.optional()
  }),
  z.object({
    kind: z.literal('sftp-closed'),
    sessionId: z.uuid(),
    reason: z.enum(['exit', 'lost', 'closed'])
  })
])
export type SftpEvent = z.infer<typeof SftpEventSchema>

export function joinRemote(directory: string, name: string): string {
  if (name.startsWith('/')) return name
  return directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`
}

export function remoteParent(path: string): string {
  if (path === '/' || !path.includes('/')) return '/'
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

export function joinLocal(directory: string, name: string): string {
  return directory.endsWith('\\') ? `${directory}${name}` : `${directory}\\${name}`
}

export function localParent(path: string): string | null {
  const trimmed = path.replace(/\\+$/, '')
  if (/^[A-Za-z]:$/.test(trimmed)) return null
  const index = trimmed.lastIndexOf('\\')
  if (index === -1) return null
  const parent = trimmed.slice(0, index)
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent
}

export function isValidFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_FILE_NAME &&
    name !== '.' &&
    name !== '..' &&
    !/[\\/\0]/.test(name)
  )
}

export function formatMode(mode: number): string {
  const bits = ['r', 'w', 'x']
  let text = ''
  for (let shift = 6; shift >= 0; shift -= 3) {
    for (let index = 0; index < 3; index++) {
      text += mode & (1 << (shift + 2 - index)) ? bits[index] : '-'
    }
  }
  return text
}
