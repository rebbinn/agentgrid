import { describe, expect, it } from 'vitest'
import {
  CONTENT_SECURITY_POLICY,
  isOpenableExternalUrl,
  isTrustedSender,
  isTrustedUrl
} from '../../src/main/security'

describe('isOpenableExternalUrl', () => {
  it('allows only http and https links to be handed to the operating system', () => {
    expect(isOpenableExternalUrl('https://example.com/page')).toBe(true)
    expect(isOpenableExternalUrl('http://localhost:3000')).toBe(true)
  })

  it.each(['file:///C:/Windows/System32/cmd.exe', 'javascript:alert(1)', 'ms-msdt:/id', 'not a url', ''])(
    'blocks %s',
    (value) => {
      expect(isOpenableExternalUrl(value)).toBe(false)
    }
  )
})

const productionEntry = {
  devServerUrl: undefined,
  fileUrl: 'file:///C:/app/out/renderer/index.html'
}
const devEntry = { devServerUrl: 'http://localhost:5173', fileUrl: productionEntry.fileUrl }

describe('isTrustedUrl', () => {
  it('accepts the bundled index.html in production', () => {
    expect(isTrustedUrl('file:///C:/app/out/renderer/index.html', productionEntry)).toBe(true)
  })

  it('rejects any other file in production', () => {
    expect(isTrustedUrl('file:///C:/Users/evil.html', productionEntry)).toBe(false)
  })

  it('rejects remote pages in production', () => {
    expect(isTrustedUrl('https://example.com/', productionEntry)).toBe(false)
  })

  it('accepts only the dev server origin in development', () => {
    expect(isTrustedUrl('http://localhost:5173/', devEntry)).toBe(true)
    expect(isTrustedUrl('http://localhost:9999/', devEntry)).toBe(false)
    expect(isTrustedUrl('file:///C:/app/out/renderer/index.html', devEntry)).toBe(false)
  })

  it('rejects malformed urls', () => {
    expect(isTrustedUrl('not a url', productionEntry)).toBe(false)
  })
})

describe('isTrustedSender', () => {
  const mainFrame = { processId: 7, routingId: 3 }
  const contents = { mainFrame } as never

  function frame(overrides: Record<string, unknown>) {
    return {
      parent: null,
      processId: 7,
      routingId: 3,
      url: 'file:///C:/app/out/renderer/index.html',
      ...overrides
    } as never
  }

  it('accepts the top frame of the main window', () => {
    expect(isTrustedSender(frame({}), contents, productionEntry)).toBe(true)
  })

  it('rejects a missing frame or window', () => {
    expect(isTrustedSender(null, contents, productionEntry)).toBe(false)
    expect(isTrustedSender(frame({}), null, productionEntry)).toBe(false)
  })

  it('rejects subframes', () => {
    expect(isTrustedSender(frame({ parent: {} }), contents, productionEntry)).toBe(false)
  })

  it('rejects a frame from a different process', () => {
    expect(isTrustedSender(frame({ processId: 8 }), contents, productionEntry)).toBe(false)
  })

  it('rejects a frame with an untrusted url', () => {
    expect(isTrustedSender(frame({ url: 'https://example.com/' }), contents, productionEntry)).toBe(false)
  })
})

describe('CONTENT_SECURITY_POLICY', () => {
  it('forbids inline scripts and remote connections', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'")
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'")
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'")
  })
})
