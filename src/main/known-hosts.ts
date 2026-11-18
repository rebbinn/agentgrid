import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { isMissingFile, writeFileAtomically } from './atomic-write'

export function withoutHost(text: string, address: string): { text: string; removed: number } {
  const lines = text.split(/\r?\n/)
  const kept = lines.filter((line) => {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) return true
    const [patterns] = trimmed.split(/\s+/, 1)
    return !(patterns ?? '').split(',').includes(address)
  })
  return { text: kept.join('\n'), removed: lines.length - kept.length }
}

export async function forgetKnownHost(path: string, address: string): Promise<boolean> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return false
    throw error
  }
  const result = withoutHost(text, address)
  if (result.removed === 0) return false
  await writeFileAtomically(dirname(path), basename(path), result.text)
  return true
}
