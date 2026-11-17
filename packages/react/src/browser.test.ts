import { createDiagnostics } from '@tapthrough/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browserInfo, installBrowserDiagnostics, resetBrowserDiagnostics } from './browser.js'

describe('browserInfo', () => {
  const cases: [string, string, object][] = [
    [
      'Chrome on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      { os: 'Chrome', osVersion: '142', model: 'macOS' },
    ],
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      { os: 'Safari', osVersion: '18', model: 'macOS' },
    ],
    [
      'Edge on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      { os: 'Edge', osVersion: '141', model: 'Windows' },
    ],
    [
      'Firefox on Linux',
      'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
      { os: 'Firefox', osVersion: '132', model: 'Linux' },
    ],
    [
      'Safari on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      { os: 'Safari', osVersion: '18', model: 'iOS' },
    ],
    [
      'Chrome on Android',
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
      { os: 'Chrome', osVersion: '142', model: 'Android' },
    ],
  ]
  for (const [name, userAgent, expected] of cases) {
    it(`reads ${name}`, () => expect(browserInfo(userAgent)).toEqual(expected))
  }

  it('returns nothing it is unsure of', () => {
    expect(browserInfo('')).toEqual({})
    expect(browserInfo('curl/8.4.0')).toEqual({})
  })
})

describe('installBrowserDiagnostics', () => {
  beforeEach(() => resetBrowserDiagnostics())

  function fakeWindow() {
    const listeners = new Map<string, (event: never) => void>()
    const calls: string[] = []
    const win = {
      console: { error: vi.fn(), warn: vi.fn() },
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes('/missing')
          ? new Response(null, { status: 404 })
          : new Response('ok'),
      ) as unknown as typeof fetch,
      location: { pathname: '/pricing' },
      history: {
        pushState: (_data: unknown, _unused: string, url?: string | URL | null) => {
          calls.push(`push:${String(url)}`)
          win.location.pathname = String(url)
        },
        replaceState: () => {},
      },
      addEventListener: (type: string, listener: (event: never) => void) => {
        listeners.set(type, listener)
      },
    }
    return { win, listeners, calls }
  }

  it('records pages, console errors, uncaught errors and failed requests, and calls through', async () => {
    const recorder = createDiagnostics(() => 5)
    const { win, listeners, calls } = fakeWindow()
    const originalError = win.console.error
    installBrowserDiagnostics(recorder, win, 'https://tapthrough.test')

    win.history.pushState({}, '', '/checkout')
    win.console.error('Payment failed', { token: 'abc' })
    listeners.get('error')?.({ message: 'x is not a function' } as never)
    listeners.get('unhandledrejection')?.({ reason: new Error('nope') } as never)
    await win.fetch('https://api.acme.test/missing?secret=1')
    await win.fetch('https://api.acme.test/fine')
    await win.fetch('https://tapthrough.test/missing')

    const snapshot = recorder.snapshot()
    expect(snapshot.screens.map((s) => s.path)).toEqual(['/pricing', '/checkout'])
    expect(snapshot.logs.map((l) => l.message)).toEqual([
      expect.stringContaining('Payment failed'),
      'Uncaught: x is not a function',
      expect.stringContaining('Unhandled rejection:'),
    ])
    // Only the app's failed request: not the successful one, not Tapthrough's own.
    expect(snapshot.requests).toEqual([
      { method: 'GET', path: expect.not.stringContaining('secret'), status: 404, at: 5 },
    ])
    expect(originalError).toHaveBeenCalledWith('Payment failed', { token: 'abc' })
    expect(calls).toEqual(['push:/checkout'])
  })

  it('installs once, however often the panel mounts', () => {
    const recorder = createDiagnostics()
    const { win } = fakeWindow()
    installBrowserDiagnostics(recorder, win, 'https://tapthrough.test')
    const wrapped = win.console.error
    installBrowserDiagnostics(recorder, win, 'https://tapthrough.test')
    expect(win.console.error).toBe(wrapped)
  })
})
