import type { Checklist } from '@tapthrough/core'
import { describe, expect, it, vi } from 'vitest'
import { createReviewStore } from './store.js'

const checklist: Checklist = {
  pr: 12,
  sha: 'a'.repeat(40),
  open: true,
  scenarios: [
    {
      key: 'settings',
      title: 'Org settings',
      routePath: '/[orgSlug]/settings',
      steps: [
        { index: 0, action: 'Rename the org', expect: 'The header updates', result: null },
        {
          index: 1,
          action: 'Open Members',
          expect: 'Two members are listed',
          result: { result: 'pass', reporter: 'Sam', platform: 'web' },
        },
      ],
    },
  ],
}

type Handler = (body: Record<string, unknown>) => { status?: number; json: unknown }

/** A Tapthrough API stub: path → handler, recording every call. */
function api(handlers: Record<string, Handler>) {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const doFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const query: Record<string, unknown> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : query
    calls.push({ path: url.pathname, body })
    const handler = handlers[url.pathname]
    if (!handler) return Response.json({ error: { message: 'no such route' } }, { status: 404 })
    const { status = 200, json } = handler(body)
    return Response.json(json, { status })
  })
  return { fetch: doFetch as unknown as typeof fetch, calls }
}

function store(handlers: Record<string, Handler>, scenarioId?: string) {
  const stub = api({ '/api/v1/checklist': () => ({ json: checklist }), ...handlers })
  const review = createReviewStore({
    apiUrl: 'https://tapthrough.test',
    host: 'acme-1.vercel.app',
    appId: 'app.acme.com',
    scenarioId,
    fetch: stub.fetch,
    currentPath: () => '/acme/settings',
  })
  return { review, calls: stub.calls }
}

describe('createReviewStore', () => {
  it('loads the checklist as a web build identified by host and app ID', async () => {
    const { review, calls } = store({})
    expect(review.getState().status).toBe('loading')
    await review.load()

    expect(calls[0]).toEqual({
      path: '/api/v1/checklist',
      body: { updateGroupId: 'acme-1.vercel.app', projectId: 'app.acme.com', platform: 'web' },
    })
    const state = review.getState()
    expect(state.status).toBe('ready')
    expect(state.results).toEqual({ 'settings:0': undefined, 'settings:1': 'pass' })
    expect(state.progress).toEqual({ total: 2, passed: 1, failed: 0 })
  })

  it('shows nothing when the deployment is not a Tapthrough PR build', async () => {
    const { review } = store({ '/api/v1/checklist': () => ({ status: 404, json: {} }) })
    await review.load()
    expect(review.getState().status).toBe('none')
  })

  it('records a pass at once and notifies listeners', async () => {
    const { review, calls } = store({ '/api/v1/step-results': () => ({ json: {} }) })
    await review.load()
    const seen: number[] = []
    review.subscribe(() => seen.push(review.getState().progress.passed))

    const done = review.mark('settings', 0, 'pass', 'Ana')
    expect(review.getState().results['settings:0']).toBe('pass')
    expect(review.getState().busy.has('settings:0')).toBe(true)
    expect(await done).toBe(true)

    expect(review.getState().busy.size).toBe(0)
    expect(seen.at(-1)).toBe(2)
    expect(calls.at(-1)).toMatchObject({
      path: '/api/v1/step-results',
      body: { scenarioKey: 'settings', stepIndex: 0, result: 'pass', reporterName: 'Ana' },
    })
  })

  it('rolls a pass back when it could not be saved', async () => {
    const { review } = store({
      '/api/v1/step-results': () => ({ status: 410, json: { error: { message: 'PR is closed' } } }),
    })
    await review.load()
    expect(await review.mark('settings', 0, 'pass')).toBe(false)
    expect(review.getState().results['settings:0']).toBeUndefined()
    expect(review.getState().error).toBe('PR is closed')
    review.dismissError()
    expect(review.getState().error).toBeNull()
  })

  it('fails a step by posting a report, then links the result to it', async () => {
    const { review, calls } = store(
      {
        '/api/v1/feedback': () => ({
          json: { commentUrl: 'https://github.test/c/1', findingId: 'f_1' },
        }),
        '/api/v1/step-results': () => ({ json: {} }),
      },
      '6f1c1d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f',
    )
    await review.load()
    const step = checklist.scenarios[0]?.steps[0]
    if (!step) throw new Error('fixture')
    expect(await review.fail('settings', step, 'Header kept the old name')).toBe(true)

    const [feedback, result] = calls.slice(-2)
    expect(feedback).toMatchObject({
      path: '/api/v1/feedback',
      body: {
        platform: 'web',
        updateGroupId: 'acme-1.vercel.app',
        projectId: 'app.acme.com',
        route: '/acme/settings',
        scenarioId: '6f1c1d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f',
        cause: 'pr',
        body: 'Step failed: Rename the org\nExpected: The header updates\n\nHeader kept the old name',
      },
    })
    expect(result).toMatchObject({ body: { result: 'fail', findingId: 'f_1', stepIndex: 0 } })
    expect(review.getState()).toMatchObject({
      lastReportUrl: 'https://github.test/c/1',
      progress: { total: 2, passed: 1, failed: 1 },
    })
  })

  it('leaves the step unchecked when the report could not be posted', async () => {
    const { review, calls } = store({
      '/api/v1/feedback': () => ({ status: 500, json: { error: { message: 'Try again' } } }),
    })
    await review.load()
    const step = checklist.scenarios[0]?.steps[0]
    if (!step) throw new Error('fixture')
    expect(await review.fail('settings', step, '')).toBe(false)
    expect(review.getState().results['settings:0']).toBeUndefined()
    expect(review.getState().error).toBe('Try again')
    expect(calls.some((c) => c.path === '/api/v1/step-results')).toBe(false)
  })

  it('posts a free report and ignores an empty one', async () => {
    const { review, calls } = store({
      '/api/v1/feedback': () => ({ json: { commentUrl: 'https://github.test/c/2' } }),
    })
    await review.load()
    expect(await review.report('   ')).toBe(false)
    expect(await review.report(' The logo is blurry ', 'Ana')).toBe(true)
    expect(calls.at(-1)?.body).toMatchObject({ body: 'The logo is blurry', reporterName: 'Ana' })
    expect(calls.at(-1)?.body).not.toHaveProperty('cause')
    expect(review.getState().lastReportUrl).toBe('https://github.test/c/2')
  })

  it('asks for a launch link to set a scenario up', async () => {
    const { review, calls } = store({
      '/api/v1/checklist/launch': () => ({
        json: { launchUrl: 'https://acme-1.vercel.app/api/tapthrough/launch?t=tok' },
      }),
    })
    await review.load()
    expect(await review.setUp('settings')).toBe(
      'https://acme-1.vercel.app/api/tapthrough/launch?t=tok',
    )
    expect(calls.at(-1)?.body).toMatchObject({ platform: 'web', scenario: 'settings' })
  })

  it("keeps the reviewer's picks when the checklist is refreshed", async () => {
    const { review } = store({ '/api/v1/step-results': () => ({ json: {} }) })
    await review.load()
    await review.mark('settings', 0, 'pass')
    await review.load()
    expect(review.getState().results['settings:0']).toBe('pass')
  })
})
