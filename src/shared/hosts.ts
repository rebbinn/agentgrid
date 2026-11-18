import { z } from 'zod'

export const HOST_ENVIRONMENTS = ['prod', 'preprod', 'dev'] as const
export type HostEnvironment = (typeof HOST_ENVIRONMENTS)[number]

export const HOST_AUTH_METHODS = ['password', 'key', 'agent'] as const
export type HostAuthMethod = (typeof HOST_AUTH_METHODS)[number]

export const HOSTS_FILE_VERSION = 1
export const HOSTS_EXPORT_FORMAT = 'agentgrid-hosts'
export const MAX_HOSTS = 500
export const MAX_HOST_NAME = 60
export const MAX_GROUP_NAME = 60
export const MAX_HOST_NOTE = 500
export const MAX_ADDRESS = 253
export const MAX_USERNAME = 64
export const MAX_SECRET = 1024
export const DEFAULT_SSH_PORT = 22

const ADDRESS_PATTERN = /^[A-Za-z0-9._:%-]+$/
const USERNAME_PATTERN = /^[A-Za-z0-9._@\\$-]+$/

export const HostAddressSchema = z.string().min(1).max(MAX_ADDRESS).regex(ADDRESS_PATTERN)
export const HostUsernameSchema = z.string().min(1).max(MAX_USERNAME).regex(USERNAME_PATTERN)
export const HostPortSchema = z.number().int().min(1).max(65535)

export const HostSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(MAX_HOST_NAME),
    group: z.string().trim().max(MAX_GROUP_NAME),
    address: HostAddressSchema,
    port: HostPortSchema,
    username: HostUsernameSchema,
    auth: z.enum(HOST_AUTH_METHODS),
    keyPath: z.string().min(1).max(1024).nullable(),
    environment: z.enum(HOST_ENVIRONMENTS).nullable(),
    jumpHostId: z.uuid().nullable(),
    note: z.string().max(MAX_HOST_NOTE),
    lastConnectedAt: z.number().int().nonnegative().nullable()
  })
  .refine((host) => host.auth !== 'key' || host.keyPath !== null, { message: 'A key file is required' })
  .refine((host) => host.jumpHostId !== host.id, { message: 'A host cannot jump through itself' })
export type Host = z.infer<typeof HostSchema>

export const HostViewSchema = z.object({
  host: HostSchema,
  hasPassword: z.boolean(),
  hasPassphrase: z.boolean()
})
export type HostView = z.infer<typeof HostViewSchema>
export const HostViewListSchema = z.array(HostViewSchema)

const SecretChangeSchema = z.string().min(1).max(MAX_SECRET).nullable().optional()

export const HostSaveRequestSchema = z.object({
  host: HostSchema,
  password: SecretChangeSchema,
  passphrase: SecretChangeSchema
})
export type HostSaveRequest = z.infer<typeof HostSaveRequestSchema>

export const HOST_SAVE_ERRORS = ['too-many', 'jump-missing', 'jump-nested', 'invalid'] as const
export type HostSaveError = (typeof HOST_SAVE_ERRORS)[number]

export const HostSaveResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), view: HostViewSchema }),
  z.object({ ok: z.literal(false), code: z.enum(HOST_SAVE_ERRORS) })
])
export type HostSaveResult = z.infer<typeof HostSaveResultSchema>

export const HostIdSchema = z.object({ id: z.uuid() })

export const HostsFileSchema = z.object({
  version: z.literal(HOSTS_FILE_VERSION),
  hosts: z.array(z.unknown())
})

export const HostsExportFileSchema = z.object({
  format: z.literal(HOSTS_EXPORT_FORMAT),
  version: z.literal(HOSTS_FILE_VERSION),
  hosts: z.array(z.unknown()).max(MAX_HOSTS)
})

export const HostsTransferResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('exported'), count: z.number().int().nonnegative() }),
  z.object({
    status: z.literal('imported'),
    added: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative()
  }),
  z.object({ status: z.literal('failed'), reason: z.enum(['read', 'write', 'format', 'too-many']) })
])
export type HostsTransferResult = z.infer<typeof HostsTransferResultSchema>

export const KeyPickResultSchema = z.object({ path: z.string().nullable() })
export type KeyPickResult = z.infer<typeof KeyPickResultSchema>

export function isSameEndpoint(first: Host, second: Host): boolean {
  return (
    first.address.toLowerCase() === second.address.toLowerCase() &&
    first.port === second.port &&
    first.username === second.username
  )
}

export function endpointLabel(host: Pick<Host, 'username' | 'address' | 'port'>): string {
  const address = host.address.includes(':') ? `[${host.address}]` : host.address
  return host.port === DEFAULT_SSH_PORT
    ? `${host.username}@${address}`
    : `${host.username}@${address}:${host.port}`
}

export function knownHostsAddress(host: Pick<Host, 'address' | 'port'>): string {
  return host.port === DEFAULT_SSH_PORT ? host.address : `[${host.address}]:${host.port}`
}

export function checkJumpHost(hosts: readonly Host[], candidate: Host): HostSaveError | null {
  if (candidate.jumpHostId === null) return null
  const jump = hosts.find((host) => host.id === candidate.jumpHostId)
  if (!jump) return 'jump-missing'
  if (jump.jumpHostId !== null) return 'jump-nested'
  if (hosts.some((host) => host.id !== candidate.id && host.jumpHostId === candidate.id)) return 'jump-nested'
  return null
}
