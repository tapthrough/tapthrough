import { describe, expect, it } from 'vitest'
import { createCookieJar, parseCookies, serializeCookie } from './cookies.js'
import { previewEnv } from './env.js'
import { decodeState, flagOverride } from './state.js'

describe('previewEnv', () => {
  it('is on in Vercel previews only', () => {
    expect(previewEnv({ VERCEL_ENV: 'preview', VERCEL_URL: 'a.vercel.app' })).toEqual({
      enabled: true,
      host: 'a.vercel.app',
    })
    expect(previewEnv({ VERCEL_ENV: 'production', VERCEL_URL: 'a.vercel.app' }).enabled).toBe(false)
    expect(previewEnv({ VERCEL_ENV: 'development' }).enabled).toBe(false)
    expect(previewEnv({}).enabled).toBe(false)
  })

  it('can be turned on elsewhere, but never in Vercel production', () => {
    expect(
      previewEnv({ TAPTHROUGH_ENABLED: 'true', TAPTHROUGH_PREVIEW_HOST: 'pr-7.acme.dev' }),
    ).toEqual({ enabled: true, host: 'pr-7.acme.dev' })
    expect(previewEnv({ TAPTHROUGH_ENABLED: 'true', VERCEL_ENV: 'production' }).enabled).toBe(false)
    expect(previewEnv({ TAPTHROUGH_ENABLED: 'false', VERCEL_ENV: 'preview' }).enabled).toBe(false)
  })
})

describe('cookies', () => {
  it('parses a Cookie header', () => {
    expect(parseCookies('a=1; b=hello%20there; bad; c=%E0%A4%A')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'hello there' },
      { name: 'c', value: '%E0%A4%A' },
    ])
    expect(parseCookies(null)).toEqual([])
  })

  it('serializes options', () => {
    expect(
      serializeCookie({
        name: 's',
        value: 'a b',
        options: { maxAge: 60.9, httpOnly: true, secure: true, sameSite: 'none', domain: 'x.test' },
      }),
    ).toBe('s=a%20b; Path=/; Domain=x.test; Max-Age=60; HttpOnly; Secure; SameSite=None')
    expect(() => serializeCookie({ name: 'a b', value: '' })).toThrow('Invalid cookie name')
  })

  it('reads back what was set and keeps the last write per name', () => {
    const jar = createCookieJar('a=1')
    jar.set('a', '2')
    jar.set('a', '3', { path: '/x' })
    expect(jar.get('a')).toBe('3')
    expect(jar.getAll()).toEqual([{ name: 'a', value: '3' }])
    expect(jar.headers()).toEqual(['a=3; Path=/x'])
  })
})

describe('launch state', () => {
  it('ignores anything it did not write', () => {
    expect(decodeState(undefined)).toBeNull()
    expect(decodeState('nope')).toBeNull()
    expect(decodeState('{"v":2}')).toBeNull()
    expect(decodeState('{"v":1,"flags":{"a":{"nested":true}}}')).toEqual({
      scenarioId: undefined,
      flags: {},
    })
  })

  it('looks up flag overrides', () => {
    const state = decodeState('{"v":1,"scn":"s","flags":{"newEditor":false}}')
    expect(flagOverride(state, 'newEditor')).toBe(false)
    expect(flagOverride(state, 'other')).toBeUndefined()
    expect(flagOverride(null, 'newEditor')).toBeUndefined()
  })
})
