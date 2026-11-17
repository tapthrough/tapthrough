import type { Checklist } from '@tapthrough/core'
import { describe, expect, it, vi } from 'vitest'
import { createReviewStore, setUpLabel } from './store.js'

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
    expect(await review.fail('settings', step, 'Header kept the old name', { name: 'Ana' })).toBe(
      true,
    )

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
    expect(await review.report(' The logo is blurry ', { name: 'Ana' })).toBe(true)
    expect(calls.at(-1)?.body).toMatchObject({ body: 'The logo is blurry', reporterName: 'Ana' })
    expect(calls.at(-1)?.body).not.toHaveProperty('cause')
    expect(review.getState().lastReportUrl).toBe('https://github.test/c/2')
  })

  it('sends the browser, recent diagnostics and a screenshot with a report', async () => {
    const stub = api({
      '/api/v1/checklist': () => ({ json: checklist }),
      '/api/v1/feedback': () => ({ json: { commentUrl: 'https://github.test/c/3' } }),
    })
    const review = createReviewStore({
      apiUrl: 'https://tapthrough.test',
      host: 'acme-1.vercel.app',
      appId: 'app.acme.com',
      fetch: stub.fetch,
      currentPath: () => '/pricing',
      device: () => ({ os: 'Chrome', osVersion: '142', model: 'macOS' }),
      diagnostics: () => ({
        screens: [{ path: '/pricing', at: 1 }],
        logs: [{ level: 'error', message: 'boom', at: 2 }],
        requests: [],
      }),
    })
    await review.load()
    const screenshot = { contentType: 'image/jpeg' as const, base64: '/9j/4AAQ' }
    expect(await review.report('Broken layout', { screenshot })).toBe(true)
    expect(stub.calls.at(-1)?.body).toMatchObject({
      device: { os: 'Chrome', osVersion: '142', model: 'macOS' },
      diagnostics: { logs: [{ level: 'error', message: 'boom' }] },
      screenshot,
      route: '/pricing',
    })
  })

  it('leaves device out when the browser could not be read', async () => {
    const stub = api({
      '/api/v1/checklist': () => ({ json: checklist }),
      '/api/v1/feedback': () => ({ json: { commentUrl: 'https://github.test/c/4' } }),
    })
    const review = createReviewStore({
      apiUrl: 'https://tapthrough.test',
      host: 'acme-1.vercel.app',
      appId: 'app.acme.com',
      fetch: stub.fetch,
      device: () => ({}),
    })
    await review.load()
    await review.report('x')
    expect(stub.calls.at(-1)?.body).not.toHaveProperty('device')
    expect(stub.calls.at(-1)?.body).not.toHaveProperty('screenshot')
  })

  it('records a re-check of an earlier report', async () => {
    const { review, calls } = store({
      '/api/v1/findings/f_9/check': () => ({ json: {} }),
      '/api/v1/findings/f_bad/check': () => ({
        status: 404,
        json: { error: { message: 'No such report' } },
      }),
    })
    await review.load()
    expect(await review.recheck('f_9', 'fixed', 'Ana')).toBe(true)
    expect(calls.at(-1)).toMatchObject({
      path: '/api/v1/findings/f_9/check',
      body: { result: 'fixed', platform: 'web', reporterName: 'Ana' },
    })
    expect(review.getState().rechecked).toEqual({ f_9: 'fixed' })
    expect(await review.recheck('f_bad', 'still_broken')).toBe(false)
    expect(review.getState().error).toBe('No such report')
    expect(review.getState().rechecked).toEqual({ f_9: 'fixed' })
  })

  it('offers Set up with test data, Open page without it, and nothing for a page that needs a record', () => {
    const off = { ...checklist, web: { access: 'open' as const, launch: 'off' as const } }
    expect(setUpLabel(checklist, '/[orgSlug]/settings')).toBe('Set up')
    expect(setUpLabel({ ...checklist, web: null }, '/pricing')).toBe('Set up')
    expect(setUpLabel(off, '/pricing')).toBe('Open page')
    expect(setUpLabel(off, '/[orgSlug]/settings')).toBeNull()
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

  it('approves the PR as this build, and says what approving did', async () => {
    const { review, calls } = store({
      '/api/v1/pulls/approve': () => ({ json: { pr: 12, result: 'auto_merge' } }),
    })
    await review.load()
    expect(await review.approve('Ana')).toBe(true)
    expect(calls.at(-1)).toEqual({
      path: '/api/v1/pulls/approve',
      body: {
        apiVersion: 1,
        updateGroupId: 'acme-1.vercel.app',
        projectId: 'app.acme.com',
        platform: 'web',
        by: 'Ana',
      },
    })
    expect(review.getState()).toMatchObject({
      approved: true,
      approveNote: 'Approved. It merges once its checks pass.',
      error: null,
    })
  })

  it('says why when the PR could not be approved', async () => {
    const { review } = store({
      '/api/v1/pulls/approve': () => ({
        status: 409,
        json: { error: { message: 'PR #12 is already closed' } },
      }),
    })
    await review.load()
    expect(await review.approve()).toBe(false)
    expect(review.getState()).toMatchObject({ approved: false, error: 'PR #12 is already closed' })
  })

  it("reads the repo's open PRs and whether this one is already approved", async () => {
    const pull = {
      author: null,
      draft: false,
      needsNewBuild: false,
      fromIdea: false,
      updatedAt: '',
    }
    const { review, calls } = store({
      '/api/v1/pulls': () => ({
        json: {
          pulls: [
            {
              ...pull,
              number: 12,
              title: 'This one',
              current: true,
              openUrl: null,
              approved: true,
            },
            {
              ...pull,
              number: 14,
              title: 'Another',
              current: false,
              openUrl: 'https://acme-3.vercel.app',
            },
          ],
        },
      }),
    })
    await review.loadPulls()
    expect(calls.at(-1)?.body).toEqual({
      updateGroupId: 'acme-1.vercel.app',
      projectId: 'app.acme.com',
      platform: 'web',
    })
    expect(review.getState().approved).toBe(true)
    expect(review.getState().pulls).toHaveLength(2)
  })

  it("keeps what it has when the open PRs can't be read", async () => {
    const { review } = store({
      '/api/v1/pulls/approve': () => ({ json: { pr: 12, result: 'review' } }),
    })
    await review.approve()
    await review.loadPulls()
    expect(review.getState()).toMatchObject({ approved: true, pulls: null })
  })
})
