import type { RedeemResponse, SeedHookResponse } from '@tapthrough/protocol'
import {
  generateSigningKey,
  importSigningKey,
  localKeys,
  type SigningKey,
  signLinkToken,
} from '@tapthrough/protocol/tokens'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createSeedHandler, type SeedHandlerOptions } from './handler.js'
import { definePreset } from './presets.js'

const issuer = 'https://tapthrough.test'
const appId = 'com.acme.notes'

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
    reviewerId: 'reviewer-1',
    scenarioId: 'scn-1',
    repo: 'acme/notes',
    pr: 142,
    ...overrides,
  }
  return (await signLinkToken(input, key, now ? { now } : {})).token
}

function redeemed(seed: RedeemResponse['seed']): RedeemResponse {
  return {
    apiVersion: 1,
    scenarioId: 'scn-1',
    seed,
    route: { path: '/notes/[id]/edit', params: { id: '$seed.notes[0].id' } },
    flags: { newEditor: true },
  }
}

/** A fake Tapthrough API that answers redeem with `body` and `status`. */
function api(body: unknown, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json(body, { status }),
  )
}

const userWithNotes = definePreset({
  description: 'A user with some notes',
  params: z.object({ count: z.number().int().min(1).max(20).default(2) }),
  async seed({ params, reviewerId }) {
    return {
      session: { access_token: `at-${reviewerId}`, refresh_token: 'rt' },
      refs: { notes: Array.from({ length: params.count }, (_, i) => ({ id: `note-${i}` })) },
    }
  },
})

function handler(overrides: Partial<SeedHandlerOptions> = {}) {
  return createSeedHandler({
    appId,
    repos: ['acme/notes'],
    environment: 'staging',
    presets: { 'user-with-notes': userWithNotes },
    issuer,
    keys,
    fetch: api(redeemed({ tier: 2, preset: 'user-with-notes', params: { count: 3 } })),
    ...overrides,
  })
}

/** Success and error fields in one shape, so each test reads whichever it expects. */
type Body = Partial<SeedHookResponse> & {
  refs: Record<string, unknown>
  error: { code: string; message: string }
}

async function post(h: (request: Request) => Promise<Response>, body: unknown) {
  const response = await h(
    new Request('https://hook.test/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as Body }
}

describe('createSeedHandler', () => {
  it('verifies, redeems, runs the preset and returns the session', async () => {
    const fetch = api(redeemed({ tier: 2, preset: 'user-with-notes', params: { count: 3 } }))
    const token = await mint()
    const { status, body } = await post(handler({ fetch }), { token })

    expect(status).toBe(200)
    expect(body).toEqual({
      apiVersion: 1,
      session: { access_token: 'at-reviewer-1', refresh_token: 'rt' },
      refs: { notes: [{ id: 'note-0' }, { id: 'note-1' }, { id: 'note-2' }] },
      route: { path: '/notes/[id]/edit', params: { id: '$seed.notes[0].id' } },
      flags: { newEditor: true },
    })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(`${issuer}/api/v1/tokens/redeem`)
    expect(JSON.parse(String(init?.body))).toEqual({ token })
  })

  it('fills preset defaults when the scenario omits params', async () => {
    const fetch = api(redeemed({ tier: 2, preset: 'user-with-notes' }))
    const { body } = await post(handler({ fetch }), { token: await mint() })
    expect(body.refs.notes).toHaveLength(2)
  })

  it.each([
    ['production', 'production'],
    ['unset', undefined],
    ['a typo', 'stagin'],
  ])('refuses to seed when the environment is %s', async (_, environment) => {
    const fetch = api({})
    const { status, body } = await post(handler({ environment, fetch }), { token: await mint() })
    expect(status).toBe(403)
    expect(body.error.code).toBe('not_staging')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an expired token before calling Tapthrough', async () => {
    const fetch = api({})
    const token = await mint({}, new Date(Date.now() - 60 * 60 * 1000))
    const { status, body } = await post(handler({ fetch }), { token })
    expect(status).toBe(401)
    expect(body.error).toEqual({
      code: 'expired',
      message: 'This link has expired. Reopen it from the PR.',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a token for another app before calling Tapthrough', async () => {
    const fetch = api({})
    const { status, body } = await post(handler({ fetch }), {
      token: await mint({ appId: 'com.other' }),
    })
    expect(status).toBe(401)
    expect(body.error.code).toBe('wrong_audience')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a forged token', async () => {
    const { status, body } = await post(handler(), { token: `${await mint()}x` })
    expect(status).toBe(401)
    expect(body.error.code).toBe('invalid')
  })

  it('passes a reused-token error from Tapthrough through to the app', async () => {
    const fetch = api(
      { error: { code: 'token_used', message: 'This link was already opened.' } },
      409,
    )
    const { status, body } = await post(handler({ fetch }), { token: await mint() })
    expect(status).toBe(409)
    expect(body.error.code).toBe('token_used')
  })

  it('reports an unreadable redeem response as a bad gateway', async () => {
    const { status, body } = await post(handler({ fetch: api({ nope: true }) }), {
      token: await mint(),
    })
    expect(status).toBe(502)
    expect(body.error.code).toBe('redeem_failed')
  })

  it('rejects unknown presets, including inherited object keys', async () => {
    for (const preset of ['missing', 'constructor', 'toString']) {
      const fetch = api(redeemed({ tier: 2, preset }))
      const { status, body } = await post(handler({ fetch }), { token: await mint() })
      expect(status).toBe(400)
      expect(body.error.code).toBe('unknown_preset')
    }
  })

  it('rejects params that fail the preset schema, naming the field', async () => {
    const fetch = api(redeemed({ tier: 2, preset: 'user-with-notes', params: { count: 99 } }))
    const { status, body } = await post(handler({ fetch }), { token: await mint() })
    expect(status).toBe(400)
    expect(body.error.code).toBe('invalid_params')
    expect(body.error.message).toContain('at count')
  })

  it('uses the shared account for tier 0 and refuses it when none is configured', async () => {
    const fetch = () => api(redeemed({ tier: 0, role: 'viewer' }))
    const sharedAccount = vi.fn(async () => ({ session: { access_token: 'shared' } }))

    const ok = await post(handler({ fetch: fetch(), sharedAccount }), { token: await mint() })
    expect(ok.status).toBe(200)
    expect(ok.body.session).toEqual({ access_token: 'shared' })
    expect(ok.body.refs).toEqual({})
    expect(sharedAccount).toHaveBeenCalledWith(expect.objectContaining({ role: 'viewer' }))

    const missing = await post(handler({ fetch: fetch() }), { token: await mint() })
    expect(missing.status).toBe(501)
    expect(missing.body.error.code).toBe('tier_unsupported')
  })

  it('hides preset errors from the caller and logs them instead', async () => {
    const broken = definePreset({
      description: 'Fails',
      params: z.object({}),
      async seed() {
        throw new Error('relation "notes" does not exist at 10.0.0.3')
      },
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetch = api(redeemed({ tier: 2, preset: 'broken' }))
    const { status, body } = await post(handler({ fetch, presets: { broken } }), {
      token: await mint(),
    })
    expect(status).toBe(500)
    expect(body.error.code).toBe('seed_failed')
    expect(body.error.message).toMatch(
      /^Seeding failed\. Check the seed hook's logs for error [0-9a-f]{8}\.$/,
    )
    const logged = log.mock.calls[0]?.[1]
    expect(logged).toBeInstanceOf(Error)
    expect((logged as Error).message).toContain('relation "notes" does not exist')
    log.mockRestore()
  })

  it('refuses tokens from repos it does not trust, before redeeming', async () => {
    const fetch = api({})
    const { status, body } = await post(handler({ fetch }), {
      token: await mint({ repo: 'attacker/app' }),
    })
    expect(status).toBe(403)
    expect(body.error.code).toBe('repo_not_allowed')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('needs at least one trusted repo', () => {
    expect(() => handler({ repos: [] })).toThrow('at least one repo')
  })

  it('rejects other methods and malformed bodies', async () => {
    const h = handler()
    expect((await h(new Request('https://hook.test/seed'))).status).toBe(405)
    expect((await post(h, { nope: 1 })).status).toBe(400)
  })
})
