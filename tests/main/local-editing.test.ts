import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalEditing } from '../../src/main/local-editing'

let directory: string
let launched: Array<[string, string[]]>
let changed: string[]

function create(findCode: string | null = null): LocalEditing {
  return new LocalEditing({
    tempDir: directory,
    windowsDir: 'C:\\Windows',
    findOnPath: () => findCode,
    emitChanged: (path) => changed.push(path),
    newId: () => 'fixed-id',
    launch: (executable, args) => launched.push([executable, args])
  })
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agentgrid-edit-'))
  launched = []
  changed = []
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('LocalEditing', () => {
  it('keeps edited copies in their own folder under the temp directory', async () => {
    const editing = create()
    const path = await editing.editPath('nginx.conf')
    expect(path).toBe(join(directory, 'AgentGrid', 'edit', 'fixed-id', 'nginx.conf'))
  })

  it('opens only its own files and never runs them, it hands them to an editor', async () => {
    const editing = create()
    const path = await editing.editPath('deploy.sh')
    await writeFile(path, 'echo hi')
    expect(await editing.openInEditor(path)).toBe(true)
    expect(launched).toEqual([[join('C:\\Windows', 'System32', 'notepad.exe'), [path]]])

    const outside = join(directory, 'elsewhere.txt')
    await writeFile(outside, 'x')
    expect(await editing.openInEditor(outside)).toBe(false)
    expect(await editing.openInEditor(join(directory, 'AgentGrid', 'edit', '..', '..', 'elsewhere.txt'))).toBe(false)
  })

  it('prefers Visual Studio Code when it is installed', async () => {
    const bin = join(directory, 'VSCode', 'bin')
    await mkdir(bin, { recursive: true })
    await writeFile(join(directory, 'VSCode', 'Code.exe'), '')
    const editing = create(join(bin, 'code.cmd'))
    expect(editing.editor()).toBe(join(directory, 'VSCode', 'Code.exe'))
  })

  it('reports a saved file once the writes settle and stops after unwatch', async () => {
    const editing = create()
    const path = await editing.editPath('app.env')
    await writeFile(path, 'A=1')
    editing.watch(path)
    await new Promise((resolve) => setTimeout(resolve, 300))
    await writeFile(path, 'A=2 and more')
    await vi.waitFor(() => expect(changed).toEqual([path]), { timeout: 5000, interval: 100 })
    editing.unwatch(path)
    await writeFile(path, 'A=3, longer again')
    await new Promise((resolve) => setTimeout(resolve, 1800))
    expect(changed).toEqual([path])
  })
})
