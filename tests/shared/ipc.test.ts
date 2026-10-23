import { describe, expect, it } from 'vitest'
import {
  AppInfoSchema,
  ClipboardWriteSchema,
  MAX_WRITE_CHARS,
  ProjectPickResultSchema,
  TerminalAckSchema,
  TerminalCreateRequestSchema,
  TerminalCreateResultSchema,
  TerminalKillSchema,
  TerminalResizeSchema,
  TerminalWriteSchema
} from '../../src/shared/ipc'

const ID = '11111111-1111-4111-8111-111111111111'
const validCreate = { id: ID, shellId: 'cmd', cwd: 'C:\\work', cols: 120, rows: 30 }

describe('IPC schemas', () => {
  it('accepts a valid app info payload', () => {
    const info = { name: 'AgentGrid', version: '0.1.0', platform: 'win32', osBuild: 26200 }
    expect(AppInfoSchema.parse(info)).toEqual(info)
  })

  it('rejects an app info payload with a wrong type', () => {
    expect(() =>
      AppInfoSchema.parse({ name: 'AgentGrid', version: 1, platform: 'win32', osBuild: 1 })
    ).toThrow()
  })

  it('accepts a null or string project path and rejects anything else', () => {
    expect(ProjectPickResultSchema.parse({ path: null })).toEqual({ path: null })
    expect(ProjectPickResultSchema.parse({ path: 'C:\\work' })).toEqual({ path: 'C:\\work' })
    expect(() => ProjectPickResultSchema.parse({ path: 5 })).toThrow()
    expect(() => ProjectPickResultSchema.parse({})).toThrow()
  })
})

describe('terminal request validation', () => {
  it('accepts a well-formed create request, with or without an agent', () => {
    expect(TerminalCreateRequestSchema.safeParse(validCreate).success).toBe(true)
    expect(TerminalCreateRequestSchema.safeParse({ ...validCreate, agentId: 'claude' }).success).toBe(true)
  })

  it.each([
    ['id is not a uuid', { id: 'abc' }],
    ['shell id is empty', { shellId: '' }],
    ['folder is empty', { cwd: '' }],
    ['folder is absurdly long', { cwd: 'C'.repeat(5000) }],
    ['agent is not a known one', { agentId: 'rm -rf /' }],
    ['columns are zero', { cols: 0 }],
    ['rows are not an integer', { rows: 10.5 }],
    ['columns are enormous', { cols: 100000 }],
    ['a command string is smuggled in as a property type', { shellId: ['cmd'] }]
  ])('rejects a create request when %s', (_name, patch) => {
    expect(TerminalCreateRequestSchema.safeParse({ ...validCreate, ...patch }).success).toBe(false)
  })

  it('limits how much text one write can carry', () => {
    expect(TerminalWriteSchema.safeParse({ id: ID, data: 'a'.repeat(MAX_WRITE_CHARS) }).success).toBe(true)
    expect(TerminalWriteSchema.safeParse({ id: ID, data: 'a'.repeat(MAX_WRITE_CHARS + 1) }).success).toBe(false)
    expect(TerminalWriteSchema.safeParse({ id: ID, data: 5 }).success).toBe(false)
  })

  it('validates resize, ack and kill payloads', () => {
    expect(TerminalResizeSchema.safeParse({ id: ID, cols: 80, rows: 24 }).success).toBe(true)
    expect(TerminalResizeSchema.safeParse({ id: ID, cols: -1, rows: 24 }).success).toBe(false)
    expect(TerminalAckSchema.safeParse({ id: ID, bytes: 100 }).success).toBe(true)
    expect(TerminalAckSchema.safeParse({ id: ID, bytes: 0 }).success).toBe(false)
    expect(TerminalKillSchema.safeParse({ id: 'nope' }).success).toBe(false)
  })

  it('validates clipboard writes', () => {
    expect(ClipboardWriteSchema.safeParse({ text: 'hello' }).success).toBe(true)
    expect(ClipboardWriteSchema.safeParse({ text: 1 }).success).toBe(false)
  })

  it('accepts both success and failure create results and rejects unknown error codes', () => {
    const shell = { id: 'cmd', label: 'Command Prompt', kind: 'cmd' }
    expect(TerminalCreateResultSchema.safeParse({ ok: true, pid: 1, shell }).success).toBe(true)
    expect(
      TerminalCreateResultSchema.safeParse({ ok: false, code: 'agent-missing', message: 'claude' }).success
    ).toBe(true)
    expect(
      TerminalCreateResultSchema.safeParse({ ok: false, code: 'weird', message: 'x' }).success
    ).toBe(false)
  })
})
