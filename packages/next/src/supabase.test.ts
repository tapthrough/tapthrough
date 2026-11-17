import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCookieJar } from './cookies.js'
import { supabaseSsrAuth } from './supabase.js'

/** A token Supabase will accept as unexpired; the stubbed fetch stands in for its API. */
function accessToken() {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 3600
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'user-1', exp })}.sig`
}

afterEach(() => vi.restoreAllMocks())

describe('supabaseSsrAuth', () => {
  it('has written the session cookies by the time signIn resolves', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ id: 'user-1', aud: 'authenticated', email: 'tt@tapthrough.test' }),
    )
    const jar = createCookieJar('theme=dark')
    const auth = supabaseSsrAuth({ url: 'https://abc.supabase.co', anonKey: 'anon' })
    await auth.signIn({ access_token: accessToken(), refresh_token: 'rt' }, jar)

    const names = jar.headers().map((header) => header.split('=')[0])
    expect(names.some((name) => name?.startsWith('sb-abc-auth-token'))).toBe(true)
    expect(jar.headers().join('\n')).not.toContain('theme')
  })

  it('refuses a session without both tokens', async () => {
    const auth = supabaseSsrAuth({ url: 'https://abc.supabase.co', anonKey: 'anon' })
    await expect(auth.signIn({ access_token: 'only' }, createCookieJar(null))).rejects.toThrow(
      'missing access_token or refresh_token',
    )
  })
})
