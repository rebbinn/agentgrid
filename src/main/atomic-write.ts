import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const RENAME_ATTEMPTS = 6
const RENAME_RETRY_MS = 60

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
}

export async function writeFileAtomically(directory: string, fileName: string, text: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `${fileName}.${process.pid}.tmp`)
  await writeFile(temporary, text, 'utf8')
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(temporary, join(directory, fileName))
      return
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS) {
        await rm(temporary, { force: true })
        throw error
      }
      await pause(RENAME_RETRY_MS * attempt)
    }
  }
}

export type JsonReadOutcome = { kind: 'missing' } | { kind: 'invalid' } | { kind: 'ok'; value: unknown }

export async function readJsonFile(path: string): Promise<JsonReadOutcome> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    return isMissingFile(error) ? { kind: 'missing' } : { kind: 'invalid' }
  }
  try {
    return { kind: 'ok', value: JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) }
  } catch {
    return { kind: 'invalid' }
  }
}

export class SerialWriter {
  private pending: string | null = null
  private writing: Promise<void> | null = null

  constructor(
    private readonly directory: string,
    private readonly fileName: string
  ) {}

  write(text: string): Promise<void> {
    this.pending = text
    this.writing ??= this.drain().finally(() => {
      this.writing = null
    })
    return this.writing
  }

  async flush(): Promise<void> {
    while (this.writing) await this.writing
  }

  private async drain(): Promise<void> {
    while (this.pending !== null) {
      const text = this.pending
      this.pending = null
      await writeFileAtomically(this.directory, this.fileName, text)
    }
  }
}
