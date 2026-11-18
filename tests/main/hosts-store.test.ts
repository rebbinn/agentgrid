import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HOSTS_FILE, HostsStore, exportDocument, parseExportDocument, planImport } from '../../src/main/hosts-store'
import { withoutHost } from '../../src/main/known-hosts'
import type { Host } from '../../src/shared/hosts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: A,
    name: 'xl-app-01',
    group: 'Xəzər Logistika',
    address: '10.20.4.11',
    port: 22,
    username: 'deploy',
    auth: 'password',
    keyPath: null,
    environment: 'prod',
    jumpHostId: null,
    note: '',
    lastConnectedAt: null,
    ...overrides
  }
}

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agentgrid-hosts-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function storedHosts(): Promise<Host[]> {
  return JSON.parse(await readFile(join(directory, HOSTS_FILE), 'utf8')).hosts
}

describe('HostsStore', () => {
  it('starts empty without a file and does not create one until something is saved', async () => {
    const store = new HostsStore(directory)
    expect(await store.load()).toEqual({ dropped: 0, preservedAs: null })
    expect(store.list()).toEqual([])
    expect(await readdir(directory)).toEqual([])
  })

  it('saves, updates and reloads hosts', async () => {
    const store = new HostsStore(directory)
    await store.load()
    expect(await store.save(host())).toBeNull()
    expect(await store.save(host({ name: 'xl-app-01 yeni' }))).toBeNull()
    await store.flush()

    const again = new HostsStore(directory)
    await again.load()
    expect(again.list()).toEqual([host({ name: 'xl-app-01 yeni' })])
  })

  it('never writes secrets into the hosts file', async () => {
    const store = new HostsStore(directory)
    await store.load()
    await store.save(host())
    await store.flush()
    const text = await readFile(join(directory, HOSTS_FILE), 'utf8')
    expect(text).not.toMatch(/password"\s*:/i)
  })

  it('keeps an unreadable file aside instead of overwriting it', async () => {
    await writeFile(join(directory, HOSTS_FILE), '{ broken', 'utf8')
    const store = new HostsStore(directory)
    const report = await store.load()
    expect(report.preservedAs).toMatch(/^hosts\.unreadable-.+\.json$/)
    expect(await readdir(directory)).toContain(report.preservedAs)
    expect(store.list()).toEqual([])
  })

  it('drops invalid and duplicate entries and reports how many', async () => {
    await writeFile(
      join(directory, HOSTS_FILE),
      JSON.stringify({ version: 1, hosts: [host(), host(), { id: 'nope' }, host({ id: B, address: 'bad address' })] }),
      'utf8'
    )
    const store = new HostsStore(directory)
    expect((await store.load()).dropped).toBe(3)
    expect(store.list()).toHaveLength(1)
  })

  it('accepts one jump level and refuses missing or nested jump hosts', async () => {
    const store = new HostsStore(directory)
    await store.load()
    await store.save(host({ id: B, name: 'bastion', environment: null }))
    expect(await store.save(host({ jumpHostId: B }))).toBeNull()
    expect(await store.save(host({ id: C, name: 'deep', jumpHostId: A }))).toBe('jump-nested')
    expect(await store.save(host({ id: B, name: 'bastion', jumpHostId: C }))).toBe('jump-missing')
    expect(await store.save(host({ id: C, name: 'other', jumpHostId: '44444444-4444-4444-8444-444444444444' }))).toBe(
      'jump-missing'
    )
  })

  it('removes a host and clears it from hosts that used it as a jump host', async () => {
    const store = new HostsStore(directory)
    await store.load()
    await store.save(host({ id: B, name: 'bastion' }))
    await store.save(host({ jumpHostId: B }))
    expect(await store.remove(B)).toBe(true)
    await store.flush()
    expect(await storedHosts()).toEqual([host()])
  })

  it('records the last connection time', async () => {
    const store = new HostsStore(directory)
    await store.load()
    await store.save(host())
    await store.touch(A, 1234)
    expect(store.get(A)?.lastConnectedAt).toBe(1234)
  })
})

describe('import and export', () => {
  it('exports without connection history and reads its own format back', () => {
    const document = JSON.parse(exportDocument([host({ lastConnectedAt: 99 })]))
    expect(document.format).toBe('agentgrid-hosts')
    expect(document.hosts[0].lastConnectedAt).toBeNull()
    expect(parseExportDocument(document)).toHaveLength(1)
    expect(parseExportDocument({ hosts: [] })).toBeNull()
  })

  it('gives imported hosts new ids, keeps their jump links and skips ones that already exist', () => {
    let next = 0
    const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']
    const existing = [host()]
    const plan = planImport(
      existing,
      [
        host(),
        host({ id: B, name: 'bastion', address: '10.0.0.1', environment: null }),
        host({ id: C, name: 'behind', address: '10.0.0.2', jumpHostId: B }),
        { name: 'broken' }
      ],
      () => ids[next++]!
    )
    expect(plan.skipped).toBe(1)
    expect(plan.invalid).toBe(1)
    expect(plan.added.map((item) => item.id)).toEqual(ids)
    expect(plan.added[1]!.jumpHostId).toBe(ids[0])
  })
})

describe('known_hosts editing', () => {
  it('removes only the lines of the given address', () => {
    const text = ['10.0.0.1 ssh-ed25519 AAAA', '[10.0.0.1]:2222 ssh-ed25519 BBBB', '# comment', 'other,10.0.0.1 ssh-rsa CCCC'].join(
      '\n'
    )
    const result = withoutHost(text, '10.0.0.1')
    expect(result.removed).toBe(2)
    expect(result.text).toBe(['[10.0.0.1]:2222 ssh-ed25519 BBBB', '# comment'].join('\n'))
  })
})
