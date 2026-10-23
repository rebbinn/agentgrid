import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CHUNK_BYTES,
  MAX_TITLE_CHARS,
  cleanTitle,
  extractSessionInfo,
  listClaudeSessions
} from '../../src/main/claude-sessions'

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const userRecord = (text: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  cwd: 'C:\\work\\shop',
  message: { role: 'user', content: text },
  ...extra
})

describe('extractSessionInfo', () => {
  it('prefers the custom title over everything else', () => {
    const info = extractSessionInfo([
      userRecord('first question'),
      { type: 'ai-title', aiTitle: 'AI title' },
      { type: 'custom-title', customTitle: 'My title' },
      { type: 'last-prompt', lastPrompt: 'last question' }
    ])
    expect(info).toEqual({ cwd: 'C:\\work\\shop', title: 'My title' })
  })

  it('uses the newest custom title when it was changed several times', () => {
    const info = extractSessionInfo([
      userRecord('q'),
      { type: 'custom-title', customTitle: 'Old' },
      { type: 'custom-title', customTitle: 'New' }
    ])
    expect(info?.title).toBe('New')
  })

  it('falls back to the AI title, then the first real prompt, then the last prompt', () => {
    expect(extractSessionInfo([userRecord('q'), { type: 'ai-title', aiTitle: 'AI' }])?.title).toBe('AI')
    expect(extractSessionInfo([userRecord('How do I deploy?')])?.title).toBe('How do I deploy?')
    expect(
      extractSessionInfo([{ type: 'user', cwd: 'C:\\x', message: { content: [] } }, { type: 'last-prompt', lastPrompt: 'tail' }])
        ?.title
    ).toBe('tail')
  })

  it('reads the first text block of a prompt that also carries an image', () => {
    const info = extractSessionInfo([
      userRecord([
        { type: 'image', source: {} },
        { type: 'text', text: 'what is in this picture?' }
      ])
    ])
    expect(info?.title).toBe('what is in this picture?')
  })

  it('does not treat tool results, meta messages, side chains or command tags as the prompt', () => {
    const info = extractSessionInfo([
      userRecord([{ type: 'tool_result', content: 'x' }]),
      userRecord('hidden', { isMeta: true }),
      userRecord('agent chatter', { isSidechain: true }),
      userRecord('<command-name>/clear</command-name>'),
      userRecord('   '),
      userRecord('the real question')
    ])
    expect(info?.title).toBe('the real question')
  })

  it('takes the folder from the first record that has one', () => {
    const info = extractSessionInfo([
      { type: 'mode' },
      { type: 'user', cwd: 'D:\\first', message: { content: 'q' } },
      { type: 'user', cwd: 'D:\\second', message: { content: 'q2' } }
    ])
    expect(info?.cwd).toBe('D:\\first')
  })

  it('gives nothing back when there is no folder or no title', () => {
    expect(extractSessionInfo([{ type: 'custom-title', customTitle: 'T' }])).toBeNull()
    expect(extractSessionInfo([{ type: 'user', cwd: 'C:\\x', message: { content: [] } }])).toBeNull()
    expect(extractSessionInfo([])).toBeNull()
  })

  it('survives records of the wrong shape', () => {
    expect(extractSessionInfo([null, 5, 'text', [], { type: 'user', cwd: 'C:\\x', message: 'nope' }])).toBeNull()
  })
})

describe('cleanTitle', () => {
  it('collapses line breaks and extra spaces', () => {
    expect(cleanTitle('  fix\n\n the   bug\t now ')).toBe('fix the bug now')
  })

  it('cuts very long titles with an ellipsis', () => {
    const cut = cleanTitle('x'.repeat(500))
    expect(cut).toHaveLength(MAX_TITLE_CHARS)
    expect(cut.endsWith('…')).toBe(true)
  })

  it('keeps Azerbaijani letters intact', () => {
    expect(cleanTitle('Çətin şəkil ğ ı İ ö ü ə')).toBe('Çətin şəkil ğ ı İ ö ü ə')
  })
})

describe('listClaudeSessions', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentgrid-sessions-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function writeSession(
    project: string,
    id: string,
    records: unknown[],
    modified: Date,
    rawSuffix = ''
  ): Promise<string> {
    const directory = join(root, project)
    await mkdir(directory, { recursive: true })
    const path = join(directory, `${id}.jsonl`)
    await writeFile(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n' + rawSuffix)
    await utimes(path, modified, modified)
    return path
  }

  it('lists sessions from every project, newest first', async () => {
    await writeSession('proj-a', ID_A, [userRecord('older')], new Date('2026-01-01T10:00:00Z'))
    await writeSession('proj-b', ID_B, [{ ...userRecord('newer'), cwd: 'C:\\other' }], new Date('2026-02-01T10:00:00Z'))
    const sessions = await listClaudeSessions(root)
    expect(sessions.map((session) => session.id)).toEqual([ID_B, ID_A])
    expect(sessions[0]).toMatchObject({ title: 'newer', cwd: 'C:\\other' })
    expect(sessions[0]!.modifiedAt).toBe(new Date('2026-02-01T10:00:00Z').getTime())
  })

  it('ignores files that are not session files', async () => {
    await writeSession('proj', ID_A, [userRecord('ok')], new Date())
    await writeFile(join(root, 'proj', 'notes.jsonl'), '{}\n')
    await writeFile(join(root, 'proj', `${ID_B}.txt`), '{}\n')
    await writeFile(join(root, 'proj', 'agent-1234.jsonl'), '{}\n')
    await writeFile(join(root, 'stray.jsonl'), '{}\n')
    expect((await listClaudeSessions(root)).map((session) => session.id)).toEqual([ID_A])
  })

  it('skips sessions that have no title or no folder', async () => {
    await writeSession('proj', ID_A, [{ type: 'mode' }], new Date())
    await writeSession('proj', ID_B, [{ type: 'custom-title', customTitle: 'no folder' }], new Date())
    await writeSession('proj', ID_C, [userRecord('fine')], new Date())
    expect((await listClaudeSessions(root)).map((session) => session.id)).toEqual([ID_C])
  })

  it('tolerates broken lines inside a file', async () => {
    const directory = join(root, 'proj')
    await mkdir(directory)
    await writeFile(
      join(directory, `${ID_A}.jsonl`),
      `{not json\n${JSON.stringify(userRecord('survivor'))}\n{"type":"user","mess`
    )
    expect((await listClaudeSessions(root))[0]?.title).toBe('survivor')
  })

  it('finds a title that was written near the end of a very large file', async () => {
    const filler = { type: 'assistant', text: 'x'.repeat(2000) }
    const middle = Array.from({ length: Math.ceil((CHUNK_BYTES * 3) / 2000) }, () => filler)
    await writeSession(
      'proj',
      ID_A,
      [userRecord('first prompt'), ...middle, { type: 'custom-title', customTitle: 'Renamed late' }],
      new Date()
    )
    expect((await listClaudeSessions(root))[0]?.title).toBe('Renamed late')
  })

  it('does not choke on a record that is bigger than the part it reads', async () => {
    const giant = { type: 'attachment', blob: 'y'.repeat(CHUNK_BYTES * 2) }
    await writeSession('proj', ID_A, [userRecord('before'), giant, userRecord('after')], new Date())
    expect((await listClaudeSessions(root))[0]?.title).toBe('before')
  })

  it('returns an empty list when the Claude folder does not exist', async () => {
    expect(await listClaudeSessions(join(root, 'missing'))).toEqual([])
  })

  it('reads only the newest files up to the limit', async () => {
    await writeSession('proj', ID_A, [userRecord('oldest')], new Date('2026-01-01T00:00:00Z'))
    await writeSession('proj', ID_B, [userRecord('middle')], new Date('2026-02-01T00:00:00Z'))
    await writeSession('proj', ID_C, [userRecord('newest')], new Date('2026-03-01T00:00:00Z'))
    const sessions = await listClaudeSessions(root, 2)
    expect(sessions.map((session) => session.title)).toEqual(['newest', 'middle'])
  })

  it('handles upper-case ids in file names by normalizing them', async () => {
    await writeSession('proj', ID_A.toUpperCase(), [userRecord('caps')], new Date())
    expect((await listClaudeSessions(root))[0]?.id).toBe(ID_A)
  })
})
