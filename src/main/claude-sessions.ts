import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClaudeSession } from '@shared/ipc'

export const SESSION_LIMIT = 300
export const CHUNK_BYTES = 128 * 1024
export const MAX_TITLE_CHARS = 120

const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

interface SessionFile {
  id: string
  path: string
  size: number
  modifiedAt: number
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cleanTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > MAX_TITLE_CHARS ? `${collapsed.slice(0, MAX_TITLE_CHARS - 1)}…` : collapsed
}

function promptText(record: JsonRecord): string | null {
  if (record['isMeta'] === true || record['isSidechain'] === true) return null
  const message = record['message']
  if (!isRecord(message)) return null
  const content = message['content']
  let text: string | null = null
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    const block = content.find((item) => isRecord(item) && item['type'] === 'text')
    if (isRecord(block) && typeof block['text'] === 'string') text = block['text']
  }
  const trimmed = text?.trim() ?? ''
  if (trimmed.length === 0 || trimmed.startsWith('<')) return null
  return trimmed
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function extractSessionInfo(records: readonly unknown[]): { cwd: string; title: string } | null {
  let cwd: string | null = null
  let customTitle: string | null = null
  let aiTitle: string | null = null
  let firstPrompt: string | null = null
  let lastPrompt: string | null = null

  for (const record of records) {
    if (!isRecord(record)) continue
    cwd ??= nonEmptyString(record['cwd'])
    switch (record['type']) {
      case 'custom-title':
        customTitle = nonEmptyString(record['customTitle']) ?? customTitle
        break
      case 'ai-title':
        aiTitle = nonEmptyString(record['aiTitle']) ?? aiTitle
        break
      case 'last-prompt':
        lastPrompt = nonEmptyString(record['lastPrompt']) ?? lastPrompt
        break
      case 'user':
        firstPrompt ??= promptText(record)
        break
    }
  }

  const rawTitle = customTitle ?? aiTitle ?? firstPrompt ?? lastPrompt
  if (!cwd || !rawTitle) return null
  const title = cleanTitle(rawTitle)
  return title.length > 0 ? { cwd, title } : null
}

function parseLines(text: string, dropFirst: boolean, dropLast: boolean): unknown[] {
  const lines = text.split('\n')
  if (dropFirst) lines.shift()
  if (dropLast) lines.pop()
  const records: unknown[] = []
  for (const line of lines) {
    if (line.length === 0) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return records
}

async function readRecords(file: SessionFile): Promise<unknown[]> {
  const handle = await open(file.path, 'r')
  try {
    const headLength = Math.min(file.size, CHUNK_BYTES)
    const head = Buffer.alloc(headLength)
    await handle.read(head, 0, headLength, 0)
    const wholeFile = file.size <= CHUNK_BYTES
    const records = parseLines(head.toString('utf8'), false, !wholeFile)
    if (wholeFile) return records

    const tail = Buffer.alloc(CHUNK_BYTES)
    await handle.read(tail, 0, CHUNK_BYTES, file.size - CHUNK_BYTES)
    return [...records, ...parseLines(tail.toString('utf8'), true, false)]
  } finally {
    await handle.close()
  }
}

async function collectSessionFiles(root: string): Promise<SessionFile[]> {
  let projectDirs
  try {
    projectDirs = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const files: SessionFile[] = []
  await Promise.all(
    projectDirs
      .filter((entry) => entry.isDirectory())
      .map(async (directory) => {
        const directoryPath = join(root, directory.name)
        let names: string[]
        try {
          names = await readdir(directoryPath)
        } catch {
          return
        }
        await Promise.all(
          names.map(async (name) => {
            const match = SESSION_FILE.exec(name)
            if (!match?.[1]) return
            const path = join(directoryPath, name)
            try {
              const info = await stat(path)
              if (info.isFile()) {
                files.push({ id: match[1].toLowerCase(), path, size: info.size, modifiedAt: info.mtimeMs })
              }
            } catch {
              return
            }
          })
        )
      })
  )
  return files
}

export async function listClaudeSessions(root: string, limit = SESSION_LIMIT): Promise<ClaudeSession[]> {
  const files = (await collectSessionFiles(root))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, limit)

  const sessions = await Promise.all(
    files.map(async (file): Promise<ClaudeSession | null> => {
      try {
        const info = extractSessionInfo(await readRecords(file))
        if (!info) return null
        return { id: file.id, title: info.title, cwd: info.cwd, modifiedAt: Math.round(file.modifiedAt) }
      } catch {
        return null
      }
    })
  )
  return sessions.filter((session): session is ClaudeSession => session !== null)
}
