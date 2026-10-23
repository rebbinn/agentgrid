import { describe, expect, it } from 'vitest'
import { AppInfoSchema, ProjectPickResultSchema } from '../../src/shared/ipc'

describe('IPC schemas', () => {
  it('accepts a valid app info payload', () => {
    expect(AppInfoSchema.parse({ name: 'AgentGrid', version: '0.1.0', platform: 'win32' })).toEqual({
      name: 'AgentGrid',
      version: '0.1.0',
      platform: 'win32'
    })
  })

  it('rejects an app info payload with a wrong type', () => {
    expect(() => AppInfoSchema.parse({ name: 'AgentGrid', version: 1, platform: 'win32' })).toThrow()
  })

  it('accepts a null or string project path and rejects anything else', () => {
    expect(ProjectPickResultSchema.parse({ path: null })).toEqual({ path: null })
    expect(ProjectPickResultSchema.parse({ path: 'C:\\work' })).toEqual({ path: 'C:\\work' })
    expect(() => ProjectPickResultSchema.parse({ path: 5 })).toThrow()
    expect(() => ProjectPickResultSchema.parse({})).toThrow()
  })
})
