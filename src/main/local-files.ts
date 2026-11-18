import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { EntryKind, LocalEntry, LocalListResult, SftpErrorCode } from '@shared/sftp'

export const MAX_LOCAL_ENTRIES = 20_000
const DRIVE_LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'

function errorCode(error: unknown): SftpErrorCode {
  const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'not-found'
  if (code === 'EACCES' || code === 'EPERM') return 'permission'
  return 'failure'
}

export async function listLocalDirectory(path: string): Promise<LocalListResult> {
  try {
    const items = await readdir(path, { withFileTypes: true })
    const entries = await Promise.all(
      items.slice(0, MAX_LOCAL_ENTRIES).map(async (item): Promise<LocalEntry> => {
        let kind: EntryKind = item.isDirectory() ? 'dir' : item.isFile() ? 'file' : item.isSymbolicLink() ? 'link' : 'other'
        try {
          const info = await stat(join(path, item.name))
          if (kind === 'link' || kind === 'other') kind = info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other'
          return { name: item.name, kind, size: info.isFile() ? info.size : 0, mtime: Math.max(0, info.mtimeMs) }
        } catch {
          return { name: item.name, kind, size: 0, mtime: 0 }
        }
      })
    )
    return { ok: true, path, entries }
  } catch (error) {
    return { ok: false, error: { code: errorCode(error), message: error instanceof Error ? error.message : '' } }
  }
}

export function listDrives(exists: (path: string) => boolean = existsSync): string[] {
  return [...DRIVE_LETTERS].map((letter) => `${letter}:\\`).filter((drive) => exists(drive))
}
