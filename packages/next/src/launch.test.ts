import type { SeedHookResponse } from '@tapthrough/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createLaunchRoute, type LaunchRouteOptions } from './launch.js'
import { stateFromCookieHeader } from './state.js'

const seeded: SeedHookResponse = {
  apiVersion: 1,
  session: { access_token: 'at', refresh_token: 'rt' },
  refs: { org: { slug: 'acme labs' } },
  route: { path: '/[orgSlug]/settings', params: { orgSlug: '$seed.org.slug' } },
  flags: { newEditor: true },
}

/** An unsigned token; the route only reads claims, the seed hook verifies. */
function token(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'ES256' })}.${part(claims)}.sig`
}

const good = token({ aud: 'app.acme.com', scn: 'scn_1' })
const preview = { VERCEL_ENV: 'preview', VERCEL_URL: 'acme-git-fix.vercel.app' }

function route(overrides: Partial<LaunchRouteOptions> = {}) {
  const seed = vi.fn(async (_request: Request) => Response.json(seeded))
  const handler = createLaunchRoute({ appId: 'app.acme.com', seed, env: preview, ...overrides })
  const open = (query: string, cookie?: string) =>
    handler(
      new Request(`https://acme-git-fix.vercel.app/api/tapthrough/launch${query}`, {
        headers: cookie ? { cookie } : {},
      }),
    )
  return { seed, open }
}

/** `Set-Cookie` headers as name → full header value. */
function setCookies(response: Response) {
  return new Map(response.headers.getSetCookie().map((c) => [c.split('=')[0] as string, c]))
}

describe('createLaunchRoute', () => {
  it('seeds, logs in with cookies and redirects to the scenario page', async () => {
    const { seed, open } = route({
      auth: {
        signIn: async (session, cookies) => {
          cookies.set('sb-auth', String(session.access_token), { httpOnly: true, sameSite: 'lax' })
        },
      },
    })
    const response = await open(`?t=${good}`)

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/acme%20labs/settings')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const sent = seed.mock.calls[0]?.[0] as Request
    expect(sent.method).toBe('POST')
    expect(await sent.json()).toEqual({ token: good })

    const cookies = setCookies(response)
    expect(cookies.get('sb-auth')).toBe('sb-auth=at; Path=/; HttpOnly; SameSite=Lax')
    expect(cookies.get('tapthrough')).toContain('Secure')
    expect(cookies.get('tapthrough')).not.toContain('HttpOnly')
    const state = decodeURIComponent((cookies.get('tapthrough') as string).split(/[=;]/)[1] ?? '')
    expect(stateFromCookieHeader(`tapthrough=${encodeURIComponent(state)}`)).toEqual({
      scenarioId: 'scn_1',
      flags: { newEditor: true },
    })
  })

  it('clears the cookies it was asked to before logging in', async () => {
    const order: string[] = []
    const { open } = route({
      clearCookies: ['workspace'],
      auth: {
        signIn: async (_session, cookies) => {
          order.push(`workspace=${cookies.get('workspace')}`)
        },
      },
    })
    const response = await open(`?t=${good}`, 'workspace=old; theme=dark')
    expect(order).toEqual(['workspace='])
    expect(setCookies(response).get('workspace')).toBe('workspace=; Path=/; Max-Age=0')
  })

  it('calls a seed hook given as a URL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(seeded) as Response)
    const { open } = route({ seed: 'https://hook.test/seed' })
    const response = await open(`?t=${good}`)
    expect(response.status).toBe(303)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://hook.test/seed')
    fetchSpy.mockRestore()
  })

  it('is not there outside preview deployments', async () => {
    for (const env of [{}, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' }]) {
      const { seed, open } = route({ env })
      expect((await open(`?t=${good}`)).status).toBe(404)
      expect(seed).not.toHaveBeenCalled()
    }
  })

  it('stays off in production even when enabled is forced', async () => {
    const { seed, open } = route({ enabled: true, env: { VERCEL_ENV: 'production' } })
    expect((await open(`?t=${good}`)).status).toBe(404)
    expect(seed).not.toHaveBeenCalled()
  })

  it('refuses a link made for another app before seeding', async () => {
    const { seed, open } = route()
    const response = await open(`?t=${token({ aud: 'com.other.app', scn: 'scn_1' })}`)
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('This link is for a different app.')
    expect(seed).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("shows the seed hook's message, escaped, and sets no cookies", async () => {
    const seed = async () =>
      Response.json(
        { error: { code: 'link_used', message: 'This link was <b>already</b> used.' } },
        { status: 409 },
      )
    const { open } = route({ seed })
    const response = await open(`?t=${good}`)
    expect(response.status).toBe(500)
    const html = await response.text()
    expect(html).toContain('This link was &lt;b&gt;already&lt;/b&gt; used.')
    expect(html).toContain('link_used')
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('asks for a token', async () => {
    const { open } = route()
    expect((await open('')).status).toBe(400)
  })

  describe('?status=1', () => {
    it('reports setup facts without seeding or setting cookies', async () => {
      const { seed, open } = route({
        env: { ...preview, TAPTHROUGH_ENV: 'staging' },
        auth: { signIn: async () => {} },
      })
      const response = await open('?status=1')
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.getSetCookie()).toEqual([])
      expect(await response.json()).toEqual({
        tapthrough: {
          status: 1,
          enabled: true,
          appId: 'app.acme.com',
          testData: { configured: true, seed: 'in-app', auth: true },
          seedEnvironment: { valid: true, value: 'staging' },
        },
      })
      expect(seed).not.toHaveBeenCalled()
    })

    it('describes an invalid TAPTHROUGH_ENV by its length, never its value', async () => {
      const secret = 'postgres://user:hunter2@db.internal/app'
      const { open } = route({
        seed: 'https://hook.test/seed?key=hook-secret',
        env: { ...preview, TAPTHROUGH_ENV: secret, DATABASE_URL: secret, AUTH_SECRET: 'shh' },
      })
      const text = await (await open('?status=1')).text()
      expect(JSON.parse(text)).toEqual({
        tapthrough: {
          status: 1,
          enabled: true,
          appId: 'app.acme.com',
          testData: { configured: true, seed: 'url', auth: false },
          seedEnvironment: { valid: false, set: true, length: secret.length },
        },
      })
      for (const leak of ['hunter2', 'postgres', 'hook.test', 'hook-secret', 'shh']) {
        expect(text).not.toContain(leak)
      }
    })

    it('says when TAPTHROUGH_ENV is unset, or set to "true"', async () => {
      const status = async (env: Record<string, string>) =>
        (await (await route({ env: { ...preview, ...env } }).open('?status=1')).json()).tapthrough
          .seedEnvironment
      expect(await status({})).toEqual({ valid: false, set: false, length: 0 })
      expect(await status({ TAPTHROUGH_ENV: 'true' })).toEqual({
        valid: false,
        set: true,
        length: 4,
      })
      expect(await status({ TAPTHROUGH_ENV: 'development' })).toEqual({
        valid: true,
        value: 'development',
      })
    })

    it('is a 404 wherever the route is off, production included', async () => {
      for (const options of [
        { env: {} },
        { env: { VERCEL_ENV: 'production', TAPTHROUGH_ENV: 'staging' } },
        { enabled: true, env: { VERCEL_ENV: 'production', TAPTHROUGH_ENABLED: 'true' } },
      ]) {
        const response = await route(options).open('?status=1')
        expect(response.status).toBe(404)
        expect(await response.text()).toBe('Not found')
      }
    })

    it('only answers to status=1', async () => {
      expect((await route().open('?status=0')).status).toBe(400)
    })
  })

  it('never redirects off the site', async () => {
    for (const path of ['//evil.test/x', '/\\evil.test']) {
      const seed = async () => Response.json({ ...seeded, route: { path, params: {} } })
      const { open } = route({ seed })
      const response = await open(`?t=${good}`)
      expect(response.status).toBe(500)
      expect(response.headers.get('location')).toBeNull()
    }
  })
})
