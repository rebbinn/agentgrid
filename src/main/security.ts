import type { WebContents, WebFrameMain } from 'electron'

const BASE_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
]

export const META_CONTENT_SECURITY_POLICY = BASE_DIRECTIVES.join('; ')

export const CONTENT_SECURITY_POLICY = [...BASE_DIRECTIVES, "frame-ancestors 'none'"].join('; ')

export const DEV_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

export function isOpenableExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export interface TrustedEntry {
  devServerUrl: string | undefined
  fileUrl: string
}

export function isTrustedUrl(url: string, entry: TrustedEntry): boolean {
  try {
    if (entry.devServerUrl) {
      return new URL(url).origin === new URL(entry.devServerUrl).origin
    }
    const parsed = new URL(url)
    return parsed.protocol === 'file:' && parsed.pathname === new URL(entry.fileUrl).pathname
  } catch {
    return false
  }
}

export function isTrustedSender(
  frame: WebFrameMain | null,
  mainContents: WebContents | null,
  entry: TrustedEntry
): boolean {
  if (!frame || !mainContents) return false
  if (frame.parent !== null) return false
  if (frame.processId !== mainContents.mainFrame.processId) return false
  if (frame.routingId !== mainContents.mainFrame.routingId) return false
  return isTrustedUrl(frame.url, entry)
}
