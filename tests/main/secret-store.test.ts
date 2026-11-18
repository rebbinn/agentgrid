import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SECRETS_FILE, SecretStore, type SecretCipher } from '../../src/main/secret-store'

const HOST = '11111111-1111-4111-8111-111111111111'

function fakeCipher(available = true): SecretCipher {
  return {
    isAvailable: async () => available,
    encrypt: async (text) => Buffer.from(`enc:${[...text].reverse().join('')}`, 'utf8'),
    decrypt: async (data) => {
      const text = data.toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('not ours')
      return [...text.slice(4)].reverse().join('')
    }
  }
}

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agentgrid-secrets-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('SecretStore', () => {
  it('stores secrets encrypted and reads them back after a restart', async () => {
    const store = new SecretStore(directory, fakeCipher())
    await store.load()
    expect(await store.set(HOST, 'password', 'gizli-Parol1')).toBe(true)
    await store.flush()

    const text = await readFile(join(directory, SECRETS_FILE), 'utf8')
    expect(text).not.toContain('gizli-Parol1')

    const again = new SecretStore(directory, fakeCipher())
    await again.load()
    expect(again.has(HOST, 'password')).toBe(true)
    expect(await again.get(HOST, 'password')).toBe('gizli-Parol1')
    expect(again.has(HOST, 'passphrase')).toBe(false)
  })

  it('refuses to store anything when encryption is not available', async () => {
    const store = new SecretStore(directory, fakeCipher(false))
    await store.load()
    expect(await store.set(HOST, 'password', 'x')).toBe(false)
    expect(store.has(HOST, 'password')).toBe(false)
  })

  it('forgets one secret or the whole host', async () => {
    const store = new SecretStore(directory, fakeCipher())
    await store.load()
    await store.set(HOST, 'password', 'one')
    await store.set(HOST, 'passphrase', 'two')
    await store.set(HOST, 'password', null)
    expect(store.has(HOST, 'password')).toBe(false)
    expect(await store.get(HOST, 'passphrase')).toBe('two')
    await store.removeHost(HOST)
    expect(store.has(HOST, 'passphrase')).toBe(false)
  })

  it('returns nothing for a secret it cannot decrypt', async () => {
    const store = new SecretStore(directory, fakeCipher())
    await store.load()
    await store.set(HOST, 'password', 'one')
    await store.flush()
    const broken = new SecretStore(directory, {
      ...fakeCipher(),
      decrypt: async () => {
        throw new Error('locked')
      }
    })
    await broken.load()
    expect(await broken.get(HOST, 'password')).toBeUndefined()
  })
})
