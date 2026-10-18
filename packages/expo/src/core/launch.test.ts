import type { SeedHookResponse } from '@tapthrough/protocol'
import { describe, expect, it, vi } from 'vitest'
import { type LaunchDeps, runLaunch } from './launch.js'

const seeded: SeedHookResponse = {
  apiVersion: 1,
  session: { access_token: 'at', refresh_token: 'rt' },
  refs: { notes: [{ id: 'n 1' }] },
  route: { path: '/notes/[id]/edit', params: { id: '$seed.notes[0].id' } },
  flags: { newEditor: true },
}

function hook(body: unknown, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json(body, { status }),
  )
}

function deps(overrides: Partial<LaunchDeps> = {}) {
  const calls: string[] = []
  const base: LaunchDeps = {
    seedHookUrl: 'https://hook.test/seed',
    fetch: hook(seeded),
    auth: {
      signIn: vi.fn(async () => {
        calls.push('signIn')
      }),
    },
    reset: [
      () => {
        calls.push('reset:query')
      },
      async () => {
        calls.push('reset:storage')
      },
    ],
    applyFlags: vi.fn(() => {
      calls.push('flags')
    }),
    navigate: vi.fn(async (path: string) => {
      calls.push(`navigate:${path}`)
    }),
    ...overrides,
  }
  return { deps: base, calls }
}

describe('runLaunch', () => {
  it('seeds, resets, signs in, applies flags and navigates, in that order', async () => {
    const { deps: d, calls } = deps()
    const result = await runLaunch('tok', d)

    expect(result).toEqual({ ok: true, path: '/notes/n%201/edit' })
    expect(calls).toEqual([
      'reset:query',
      'reset:storage',
      'signIn',
      'flags',
      'navigate:/notes/n%201/edit',
    ])
    expect(d.auth.signIn).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' })
    expect(d.applyFlags).toHaveBeenCalledWith({ newEditor: true })
    const [url, init] = vi.mocked(d.fetch as ReturnType<typeof hook>).mock.calls[0] ?? []
    expect(url).toBe('https://hook.test/seed')
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ token: 'tok' }) })
  })

  it("shows the seed hook's own error message", async () => {
    const { deps: d, calls } = deps({
      fetch: hook({ error: { code: 'token_used', message: 'This link was already opened.' } }, 409),
    })
    expect(await runLaunch('tok', d)).toEqual({
      ok: false,
      error: { code: 'token_used', message: 'This link was already opened.' },
    })
    expect(calls).toEqual([])
  })

  it('reports an unreachable seed hook', async () => {
    const { deps: d } = deps({
      fetch: vi.fn(async () => {
        throw new TypeError('Network request failed')
      }),
    })
    expect(await runLaunch('tok', d)).toMatchObject({ ok: false, error: { code: 'network' } })
  })

  it('reports a non-JSON error and an unreadable success body', async () => {
    const html = deps({ fetch: vi.fn(async () => new Response('<h1>502</h1>', { status: 502 })) })
    expect(await runLaunch('tok', html.deps)).toMatchObject({
      ok: false,
      error: { code: 'seed_hook_failed', message: 'The seed hook returned 502.' },
    })

    const odd = deps({ fetch: hook({ apiVersion: 2 }) })
    expect(await runLaunch('tok', odd.deps)).toMatchObject({
      ok: false,
      error: { code: 'bad_response' },
    })
  })

  it('leaves the app untouched when the route references missing seed data', async () => {
    const { deps: d, calls } = deps({ fetch: hook({ ...seeded, refs: {} }) })
    expect(await runLaunch('tok', d)).toMatchObject({
      ok: false,
      error: { code: 'bad_route', message: 'Seed reference not found: $seed.notes[0].id' },
    })
    expect(calls).toEqual([])
  })

  it('stops before navigating when sign-in fails', async () => {
    const { deps: d, calls } = deps({
      auth: {
        signIn: async () => {
          throw new Error('Invalid Refresh Token')
        },
      },
    })
    expect(await runLaunch('tok', d)).toEqual({
      ok: false,
      error: {
        code: 'sign_in_failed',
        message: "Couldn't sign in as the test user: Invalid Refresh Token",
      },
    })
    expect(calls).toEqual(['reset:query', 'reset:storage'])
  })

  it('stops before signing in when a reset fails', async () => {
    const { deps: d, calls } = deps({
      reset: [
        () => {
          throw new Error('disk full')
        },
      ],
    })
    expect(await runLaunch('tok', d)).toMatchObject({
      ok: false,
      error: { code: 'reset_failed' },
    })
    expect(calls).toEqual([])
  })

  it('reports a navigation failure', async () => {
    const { deps: d } = deps({
      navigate: async () => {
        throw new Error('no such route')
      },
    })
    expect(await runLaunch('tok', d)).toMatchObject({
      ok: false,
      error: { code: 'navigation_failed' },
    })
  })

  it('works without reset targets or a flag handler', async () => {
    const { deps: d } = deps({ reset: undefined, applyFlags: undefined })
    expect(await runLaunch('tok', d)).toMatchObject({ ok: true })
  })
})
