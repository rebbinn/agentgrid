import { z } from 'zod'
import { HostSchema, MAX_SECRET } from './hosts'

const ColsSchema = z.number().int().min(1).max(1000)
const RowsSchema = z.number().int().min(1).max(500)

export const SSH_ERROR_CODES = [
  'host-missing',
  'helper-missing',
  'duplicate-id',
  'dns',
  'refused',
  'timeout',
  'unreachable',
  'auth',
  'hostkey-changed',
  'hostkey-rejected',
  'cancelled',
  'key-file',
  'agent-unavailable',
  'jump',
  'other'
] as const
export type SshErrorCode = (typeof SSH_ERROR_CODES)[number]

export const SshFailureSchema = z.object({
  code: z.enum(SSH_ERROR_CODES),
  message: z.string().max(2000),
  hostName: z.string().max(200).optional(),
  fingerprint: z.string().max(200).optional(),
  knownHostsFile: z.string().max(1024).optional()
})
export type SshFailure = z.infer<typeof SshFailureSchema>

export const SshResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), failure: SshFailureSchema })
])
export type SshResult = z.infer<typeof SshResultSchema>

export const SshOpenRequestSchema = z.object({
  id: z.uuid(),
  hostId: z.uuid(),
  cols: ColsSchema,
  rows: RowsSchema
})
export type SshOpenRequest = z.infer<typeof SshOpenRequestSchema>

export const SshTestRequestSchema = z.object({
  sessionId: z.uuid(),
  host: HostSchema,
  password: z.string().min(1).max(MAX_SECRET).optional(),
  passphrase: z.string().min(1).max(MAX_SECRET).optional()
})
export type SshTestRequest = z.infer<typeof SshTestRequestSchema>

export const SshAnswerSchema = z.object({
  sessionId: z.uuid(),
  requestId: z.string().min(1).max(100),
  accept: z.boolean().optional(),
  answers: z.array(z.string().max(MAX_SECRET)).max(10).optional(),
  cancel: z.boolean().optional(),
  remember: z.boolean().optional()
})
export type SshAnswer = z.infer<typeof SshAnswerSchema>

export const SshCancelSchema = z.object({ sessionId: z.uuid() })

export const SSH_PROMPT_KINDS = ['password', 'passphrase', 'keyboard-interactive'] as const
export type SshPromptKind = (typeof SSH_PROMPT_KINDS)[number]

export const SshQuestionSchema = z.object({ text: z.string().max(500), echo: z.boolean() })

export const SshEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('phase'),
    sessionId: z.uuid(),
    phase: z.enum(['connecting', 'authenticating']),
    hostName: z.string().max(200)
  }),
  z.object({
    kind: z.literal('hostkey'),
    sessionId: z.uuid(),
    requestId: z.string().max(100),
    hostName: z.string().max(200),
    address: z.string().max(300),
    keyType: z.string().max(100),
    fingerprint: z.string().max(200)
  }),
  z.object({
    kind: z.literal('prompt'),
    sessionId: z.uuid(),
    requestId: z.string().max(100),
    hostName: z.string().max(200),
    promptKind: z.enum(SSH_PROMPT_KINDS),
    name: z.string().max(500),
    instruction: z.string().max(2000),
    questions: z.array(SshQuestionSchema).max(10),
    canRemember: z.boolean()
  }),
  z.object({ kind: z.literal('latency'), sessionId: z.uuid(), ms: z.number().int().nonnegative() })
])
export type SshEvent = z.infer<typeof SshEventSchema>
export type SshHostKeyEvent = Extract<SshEvent, { kind: 'hostkey' }>
export type SshPromptEvent = Extract<SshEvent, { kind: 'prompt' }>
export type SshRequestEvent = SshHostKeyEvent | SshPromptEvent

export const SSH_SHELL_ID = 'ssh'
export const SSH_SHELL_LABEL = 'SSH'
export const SSH_PANE_CWD = '~'
