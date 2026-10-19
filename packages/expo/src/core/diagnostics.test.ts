import { describe, expect, it, vi } from 'vitest'
import { createDiagnostics, installDiagnostics, redact, requestPath } from './diagnostics.js'

describe('redact', () => {
  it('removes tokens from query strings, headers and JWTs', () => {
    expect(redact('GET /x?access_token=abc&page=2&t=eyJ0.eyJ1.sig')).toBe(
      'GET /x?access_token=[redacted]&page=2&t=[redacted]',
    )
    expect(redact('Authorization: Bearer sk_live_123')).toBe('Authorization: Bearer [redacted]')
    expect(redact('token eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl here')).toBe('token [jwt] here')
  })
})

describe('requestPath', () => {
  it('keeps host and path, drops query and fragment', () => {
    expect(requestPath('https://ref.supabase.co/rest/v1/notes?select=*&apikey=k#x')).toBe(
      'ref.supabase.co/rest/v1/notes',
    )
    expect(requestPath('/api/notes?id=1')).toBe('/api/notes')
    expect(requestPath('https://example.com')).toBe('example.com/')
  })
})

describe('createDiagnostics', () => {
  it('keeps the most recent entries and skips repeated screens', () => {
    let t = 0
    const d = createDiagnostics(() => ++t)
    for (let i = 0; i < 25; i++) d.recordScreen(`/s/${i}`)
    d.recordScreen('/s/24')
    d.recordLog('error', [new TypeError('boom'), { id: 1 }])
    const snap = d.snapshot()
    expect(snap.screens).toHaveLength(20)
    expect(snap.screens[0]?.path).toBe('/s/5')
    expect(snap.screens.at(-1)?.path).toBe('/s/24')
    expect(snap.logs[0]).toMatchObject({ level: 'error', message: 'TypeError: boom {"id":1}' })
  })
})

describe('installDiagnostics', () => {
  it('records console output, uncaught errors and failed requests while calling through', async () => {
    const d = createDiagnostics(() => 1)
    const originalError = vi.fn()
    const originalWarn = vi.fn()
    const target = { error: originalError, warn: originalWarn } as unknown as Pick<
      Console,
      'error' | 'warn'
    >
    let handler: (error: unknown, isFatal?: boolean) => void = vi.fn()
    const previous = handler
    const errorUtils = {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: typeof handler) => {
        handler = next
      },
    }
    const fetchHost = {
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('offline')) throw new TypeError('Network request failed')
        return new Response('', { status: url.includes('missing') ? 404 : 200 })
      }) as unknown as typeof fetch,
    }
    installDiagnostics(d, { console: target, errorUtils, fetchHost }, 'https://tapthrough.test')

    target.error('Save failed', { code: 500 })
    target.warn('Deprecated prop')
    handler(new Error('crash'), true)
    await fetchHost.fetch('https://api.test/ok')
    await fetchHost.fetch('https://api.test/missing?token=abc', { method: 'post' })
    await expect(fetchHost.fetch('https://api.test/offline')).rejects.toThrow(
      'Network request failed',
    )
    await fetchHost.fetch('https://tapthrough.test/api/v1/feedback')

    expect(originalError).toHaveBeenCalledWith('Save failed', { code: 500 })
    expect(originalWarn).toHaveBeenCalledWith('Deprecated prop')
    expect(previous).toHaveBeenCalledWith(expect.any(Error), true)
    const snap = d.snapshot()
    expect(snap.logs.map((l) => `${l.level}: ${l.message}`)).toEqual([
      'error: Save failed {"code":500}',
      'warn: Deprecated prop',
      'error: Uncaught (fatal): Error: crash',
    ])
    expect(snap.requests.map((r) => `${r.status} ${r.method} ${r.path}`)).toEqual([
      '404 POST api.test/missing',
      '0 GET api.test/offline',
    ])
  })
})
