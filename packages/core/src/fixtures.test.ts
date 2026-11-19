import { Fixtures } from '@tapthrough/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createFixtureFetch, type FixtureCall, installFixtures } from './fixtures.js'

const real = () =>
  vi.fn<typeof fetch>(async () => new Response('real', { status: 200 }))

const fixtures = Fixtures.parse({
  v: 1,
  baseUrl: 'https://api.acme.com/v1',
  routes: [
    { url: '/applications', query: { status: 'applied' }, body: [{ id: 'a1' }] },
    { url: '/applications', body: [{ id: 'a1' }, { id: 'a2' }] },
    { url: '/applications/:id', body: { id: 'a1', title: 'Designer' } },
    { method: 'POST', url: '/applications', status: 201, body: { id: 'a3' } },
    { method: 'DELETE', url: '/applications/:id', status: 204 },
    { method: '*', url: '/files/*', body: { ok: true } },
    { url: 'https://auth.acme.com/me', body: { email: 'reviewer@example.test' } },
  ],
})

describe('createFixtureFetch', () => {
  it('answers a covered request without calling the network', async () => {
    const network = real()
    const response = await createFixtureFetch(fixtures, network)(
      'https://api.acme.com/v1/applications',
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual([{ id: 'a1' }, { id: 'a2' }])
    expect(network).not.toHaveBeenCalled()
  })

  it('matches path parameters, methods and a trailing slash', async () => {
    const doFetch = createFixtureFetch(fixtures, real())
    expect(await (await doFetch('https://api.acme.com/v1/applications/a1/')).json()).toEqual({
      id: 'a1',
      title: 'Designer',
    })
    const created = await doFetch('https://api.acme.com/v1/applications', { method: 'post' })
    expect(created.status).toBe(201)
    const deleted = await doFetch('https://api.acme.com/v1/applications/a1', { method: 'DELETE' })
    expect(deleted.status).toBe(204)
    expect(await deleted.text()).toBe('')
  })

  it('uses the first route whose query matches', async () => {
    const doFetch = createFixtureFetch(fixtures, real())
    const applied = await doFetch('https://api.acme.com/v1/applications?status=applied&page=1')
    expect(await applied.json()).toEqual([{ id: 'a1' }])
    const other = await doFetch('https://api.acme.com/v1/applications?status=offer')
    expect(await other.json()).toHaveLength(2)
  })

  it('matches a wildcard tail and any method', async () => {
    const doFetch = createFixtureFetch(fixtures, real())
    const response = await doFetch('https://api.acme.com/v1/files/a/b.pdf', { method: 'PUT' })
    expect(await response.json()).toEqual({ ok: true })
  })

  it('matches a full URL on another host and reads Request objects', async () => {
    const doFetch = createFixtureFetch(fixtures, real())
    const response = await doFetch(new Request('https://auth.acme.com/me'))
    expect(await response.json()).toEqual({ email: 'reviewer@example.test' })
  })

  it('answers 501 for an uncovered request to the API, and never calls it', async () => {
    const network = real()
    const calls: FixtureCall[] = []
    const doFetch = createFixtureFetch(fixtures, network, { onCall: (call) => calls.push(call) })
    const response = await doFetch('https://api.acme.com/v1/billing')
    expect(response.status).toBe(501)
    expect((await response.json()).error.message).toContain('GET /v1/billing')
    expect(network).not.toHaveBeenCalled()
    expect(calls).toEqual([
      { method: 'GET', url: 'https://api.acme.com/v1/billing', outcome: 'missing', status: 501 },
    ])
  })

  it('passes other hosts through untouched', async () => {
    const network = real()
    const doFetch = createFixtureFetch(fixtures, network)
    const init = { method: 'POST' }
    expect(await (await doFetch('https://cdn.acme.com/logo.png', init)).text()).toBe('real')
    // Same host, outside the base path.
    await doFetch('https://api.acme.com/v2/applications')
    expect(network).toHaveBeenCalledTimes(2)
    expect(network).toHaveBeenNthCalledWith(1, 'https://cdn.acme.com/logo.png', init)
  })

  it('sends uncovered API requests on when asked to', async () => {
    const network = real()
    const doFetch = createFixtureFetch({ ...fixtures, unmatched: 'passthrough' }, network)
    expect(await (await doFetch('https://api.acme.com/v1/billing')).text()).toBe('real')
  })

  it('without a base URL, matches the path on any host and resolves relative URLs', async () => {
    const network = real()
    const anyHost = Fixtures.parse({ v: 1, routes: [{ url: '/api/me', body: { id: 1 } }] })
    const doFetch = createFixtureFetch(anyHost, network, { origin: 'https://preview.acme.dev' })
    expect(await (await doFetch('/api/me')).json()).toEqual({ id: 1 })
    expect(await (await doFetch('https://other.dev/api/me')).json()).toEqual({ id: 1 })
    await doFetch('/api/other')
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('waits before answering when a route has a delay', async () => {
    vi.useFakeTimers()
    const slow = Fixtures.parse({ v: 1, routes: [{ url: '/slow', delayMs: 500, body: 1 }] })
    let done = false
    const pending = createFixtureFetch(slow, real())('https://x.dev/slow').then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(499)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(done).toBe(true)
    vi.useRealTimers()
  })
})

describe('installFixtures', () => {
  it('replaces fetch, and puts it back', async () => {
    const network = real()
    const target = { fetch: network as typeof fetch }
    const uninstall = installFixtures(fixtures, { target })
    expect(await (await target.fetch('https://api.acme.com/v1/applications/a1')).json()).toEqual({
      id: 'a1',
      title: 'Designer',
    })
    uninstall()
    expect(target.fetch).toBe(network)
  })

  it('replaces earlier fixtures instead of stacking on them', async () => {
    const network = real()
    const target = { fetch: network as typeof fetch }
    installFixtures(fixtures, { target })
    const next = Fixtures.parse({ v: 1, routes: [{ url: '/api/me', body: { id: 2 } }] })
    const uninstall = installFixtures(next, { target })
    // The first set's routes are gone: this reaches the network.
    expect(await (await target.fetch('https://api.acme.com/v1/applications')).text()).toBe('real')
    expect(await (await target.fetch('https://x.dev/api/me')).json()).toEqual({ id: 2 })
    uninstall()
    expect(target.fetch).toBe(network)
  })
})
