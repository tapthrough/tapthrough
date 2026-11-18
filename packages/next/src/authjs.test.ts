import { describe, expect, it } from 'vitest'
import { authJsAuth, authJsCookieName } from './authjs.js'
import { createCookieJar } from './cookies.js'

const https = new Request('https://acme-git-fix.vercel.app/api/tapthrough/launch')
const http = new Request('http://localhost:3000/api/tapthrough/launch')

describe('authJsCookieName', () => {
  it('follows AUTH_URL, then NEXTAUTH_URL, then the request', () => {
    expect(authJsCookieName('https:')).toBe('__Secure-authjs.session-token')
    expect(authJsCookieName('http:')).toBe('authjs.session-token')
    expect(authJsCookieName('http:', { AUTH_URL: 'https://app.acme.com' })).toBe(
      '__Secure-authjs.session-token',
    )
    expect(authJsCookieName('https:', { NEXTAUTH_URL: 'http://localhost:3000' })).toBe(
      'authjs.session-token',
    )
    expect(authJsCookieName('https:', { AUTH_URL: 'not a url' })).toBe(
      '__Secure-authjs.session-token',
    )
  })
})

describe('authJsAuth', () => {
  it('sets the secure session cookie on https', async () => {
    const jar = createCookieJar(null)
    await authJsAuth({ env: {} }).signIn({ accessToken: 'a.b.c', refreshToken: 'r' }, jar, https)
    expect(jar.headers()).toEqual([
      '__Secure-authjs.session-token=a.b.c; Path=/; HttpOnly; Secure; SameSite=Lax',
    ])
  })

  it('sets the plain cookie on http and honours maxAge', async () => {
    const jar = createCookieJar(null)
    await authJsAuth({ env: {}, maxAge: 3600 }).signIn({ sessionToken: 'tok' }, jar, http)
    expect(jar.headers()).toEqual([
      'authjs.session-token=tok; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax',
    ])
  })

  it("removes the chunks of the reviewer's own session", async () => {
    const jar = createCookieJar(
      '__Secure-authjs.session-token.0=aaa; __Secure-authjs.session-token.1=bbb; theme=dark',
    )
    await authJsAuth({ env: {} }).signIn({ token: 'new' }, jar, https)
    expect(jar.headers()).toEqual([
      '__Secure-authjs.session-token.0=; Path=/; Max-Age=0; Secure',
      '__Secure-authjs.session-token.1=; Path=/; Max-Age=0; Secure',
      '__Secure-authjs.session-token=new; Path=/; HttpOnly; Secure; SameSite=Lax',
    ])
  })

  it('takes a custom token picker and cookie name', async () => {
    const jar = createCookieJar(null)
    await authJsAuth({
      cookieName: 'acme.session',
      token: (session) => (session.web as { jwt: string }).jwt,
    }).signIn({ web: { jwt: 'x.y' } }, jar, https)
    expect(jar.headers()).toEqual(['acme.session=x.y; Path=/; HttpOnly; SameSite=Lax'])
  })

  it('refuses a session without a usable token', async () => {
    const auth = authJsAuth({ env: {} })
    for (const session of [{}, { accessToken: '' }, { accessToken: 'a; b' }, { token: 42 }]) {
      await expect(auth.signIn(session, createCookieJar(null), https)).rejects.toThrow(
        'no session token',
      )
    }
  })
})
