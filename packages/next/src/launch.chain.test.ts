import type { RedeemResponse } from '@tapthrough/protocol'
import {
  generateSigningKey,
  importSigningKey,
  localKeys,
  type SigningKey,
  signLinkToken,
} from '@tapthrough/protocol/tokens'
import { createSeedHandler, definePreset } from '@tapthrough/seed'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { authJsAuth } from './authjs.js'
import { createLaunchRoute } from './launch.js'
import { flagOverride, stateFromCookieHeader } from './state.js'

/**
 * A Tapthrough link, start to finish, with nothing stubbed between the parts
 * a customer installs: a token signed like Tapthrough signs them, the real
 * seed handler verifying and redeeming it, a preset creating the user, and
 * the launch route turning the result into cookies and a redirect.
 */

const issuer = 'https://tapthrough.test'
const appId = 'app.acme.com'
const preview = { VERCEL_ENV: 'preview', VERCEL_URL: 'acme-1.vercel.app' }

let key: SigningKey
let keys: ReturnType<typeof localKeys>

beforeAll(async () => {
  const { privateKeyPem, publicJwk } = await generateSigningKey()
  key = await importSigningKey(privateKeyPem)
  keys = localKeys({ keys: [publicJwk] })
})

async function mint(overrides: Partial<Parameters<typeof signLinkToken>[0]> = {}, now?: Date) {
  const input = {
    issuer,
    appId,
    reviewerId: 'link:abc',
    scenarioId: 'scn-project-settings',
    repo: 'acme/web',
    pr: 12,
    ...overrides,
  }
  return (await signLinkToken(input, key, now ? { now } : {})).token
}

const scenario: RedeemResponse = {
  apiVersion: 1,
  scenarioId: 'scn-project-settings',
  seed: { tier: 2, preset: 'owner-with-project', params: { name: 'Apollo' } },
  route: { path: '/projects/[id]/settings', params: { id: '$seed.project.id' } },
  flags: { newEditor: true },
}

/** Tapthrough's redeem endpoint: each token works once. */
function tapthrough() {
  const used = new Set<string>()
  const doFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { token } = JSON.parse(String(init?.body)) as { token: string }
    if (used.has(token)) {
      return Response.json(
        {
          error: {
            code: 'token_used',
            message: 'This link was already used. Open it again from the PR.',
          },
        },
        { status: 409 },
      )
    }
    used.add(token)
    return Response.json(scenario)
  }) as typeof fetch
  return { fetch: doFetch, used }
}

/** `environment` is what the seed hook is told it runs in; unset is a real case, so no default. */
function app({ environment }: { environment: string | undefined } = { environment: 'staging' }) {
  const cloud = tapthrough()
  const created: { name: string; reviewer: string }[] = []
  const seed = createSeedHandler({
    appId,
    repos: ['acme/web'],
    environment,
    issuer,
    keys,
    fetch: cloud.fetch,
    presets: {
      'owner-with-project': definePreset({
        description: 'An owner with one project',
        params: z.object({ name: z.string().default('Untitled') }),
        async seed({ params, reviewerId }) {
          created.push({ name: params.name, reviewer: reviewerId })
          return {
            session: { sessionToken: `jwe.for.${created.length}` },
            refs: { project: { id: `p_${created.length}` } },
          }
        },
      }),
    },
  })
  const launch = createLaunchRoute({ appId, seed, auth: authJsAuth({ env: {} }), env: preview })
  const open = (token: string) =>
    launch(new Request(`https://acme-1.vercel.app/api/tapthrough/launch?t=${token}`))
  return { open, created }
}

describe('a Tapthrough link on a web preview, end to end', () => {
  it('creates the test user, signs the browser in and lands on the seeded page', async () => {
    const { open, created } = app()
    const response = await open(await mint())

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/projects/p_1/settings')
    expect(created).toEqual([{ name: 'Apollo', reviewer: 'link:abc' }])

    const cookies = response.headers.getSetCookie()
    expect(cookies).toContain(
      '__Secure-authjs.session-token=jwe.for.1; Path=/; HttpOnly; Secure; SameSite=Lax',
    )
    const stateCookie = cookies.find((c) => c.startsWith('tapthrough=')) ?? ''
    const state = stateFromCookieHeader(stateCookie.split(';')[0])
    expect(state?.scenarioId).toBe('scn-project-settings')
    expect(flagOverride(state, 'newEditor')).toBe(true)
  })

  it('works once: opening the same link again creates nothing and says why', async () => {
    const { open, created } = app()
    const token = await mint()
    expect((await open(token)).status).toBe(303)

    const again = await open(token)
    expect(again.status).toBe(410)
    expect(await again.text()).toContain('This link was already used.')
    expect(again.headers.getSetCookie()).toEqual([])
    expect(created).toHaveLength(1)
  })

  it('refuses an expired link', async () => {
    const { open, created } = app()
    const response = await open(await mint({}, new Date(Date.now() - 60 * 60 * 1000)))
    expect(response.status).toBe(410)
    expect(await response.text()).toMatch(/expired/i)
    expect(created).toEqual([])
  })

  it('refuses a link signed by someone else', async () => {
    const { open, created } = app()
    const other = await importSigningKey((await generateSigningKey()).privateKeyPem)
    const forged = (
      await signLinkToken(
        { issuer, appId, reviewerId: 'x', scenarioId: 'scn', repo: 'acme/web', pr: 12 },
        other,
      )
    ).token
    const response = await open(forged)
    expect(response.status).toBe(500)
    expect(response.headers.getSetCookie()).toEqual([])
    expect(created).toEqual([])
  })

  it('refuses a link for another app before the seed hook is asked', async () => {
    const { open, created } = app()
    const response = await open(await mint({ appId: 'com.acme.mobile' }))
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('This link is for a different app.')
    expect(created).toEqual([])
  })

  it('refuses a link from a repo the app does not trust', async () => {
    const { open, created } = app()
    const response = await open(await mint({ repo: 'someone/else' }))
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('a repo this app does not trust')
    expect(created).toEqual([])
  })

  it('creates nothing when the seed hook is not marked as staging', async () => {
    for (const environment of [undefined, 'production']) {
      const { open, created } = app({ environment })
      const response = await open(await mint())
      expect(response.status).toBe(500)
      expect(await response.text()).toContain('Seeding is disabled')
      expect(created).toEqual([])
    }
  })
})
