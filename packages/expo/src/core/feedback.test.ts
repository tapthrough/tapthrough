import { describe, expect, it, vi } from 'vitest'
import {
  failedStepBody,
  fetchChecklist,
  hasReviewItems,
  previewContextFromManifest,
  scenarioIdFromToken,
  sendFeedback,
  sendRecheck,
  sendStepResult,
} from './feedback.js'

describe('previewContextFromManifest', () => {
  it('reads the update group and branch from an EAS update manifest', () => {
    const manifest = {
      id: 'u1',
      metadata: { updateGroup: '5623cd33-782f-4be7-a00d-f23fa65e3323', branchName: 'pr-1' },
      extra: { eas: { projectId: 'bbab6a7b-d4b1-476d-8f5b-f2c763581788' } },
    }
    expect(previewContextFromManifest(manifest)).toEqual({
      updateGroupId: '5623cd33-782f-4be7-a00d-f23fa65e3323',
      projectId: 'bbab6a7b-d4b1-476d-8f5b-f2c763581788',
      branch: 'pr-1',
    })
  })

  it('returns null for embedded, local or missing manifests', () => {
    expect(previewContextFromManifest(null)).toBeNull()
    expect(previewContextFromManifest({ metadata: {} })).toBeNull()
    expect(previewContextFromManifest({ metadata: { updateGroup: '' } })).toBeNull()
    expect(previewContextFromManifest({ metadata: { updateGroup: 'g' } })).toBeNull()
  })
})

describe('scenarioIdFromToken', () => {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  it('reads scn from the token payload', () => {
    const token = `${encode({ alg: 'ES256' })}.${encode({ scn: 'scenario-1', pr: 1 })}.sig`
    expect(scenarioIdFromToken(token)).toBe('scenario-1')
  })

  it('returns undefined for anything else', () => {
    expect(scenarioIdFromToken('not-a-token')).toBeUndefined()
    expect(scenarioIdFromToken('a.!!!.c')).toBeUndefined()
    expect(scenarioIdFromToken(`a.${encode({ pr: 1 })}.c`)).toBeUndefined()
  })
})

describe('sendFeedback', () => {
  const input = {
    preview: { updateGroupId: 'g1', projectId: 'p1', branch: 'pr-1' },
    platform: 'ios' as const,
    body: 'Counter overlaps the error',
    route: '/notes/n1/edit',
  }

  it('posts the report and returns the comment URL', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ commentUrl: 'https://github.com/a/b/pull/1#c' }, { status: 201 }),
    )
    const result = await sendFeedback(input, { apiUrl: 'https://tapthrough.test/', fetch })
    expect(result).toEqual({ ok: true, commentUrl: 'https://github.com/a/b/pull/1#c' })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://tapthrough.test/api/v1/feedback')
    expect(JSON.parse(String(init?.body))).toEqual({
      apiVersion: 1,
      updateGroupId: 'g1',
      projectId: 'p1',
      platform: 'ios',
      body: 'Counter overlaps the error',
      route: '/notes/n1/edit',
    })
  })

  it("shows the server's message, or a fallback when it has none", async () => {
    const closed = vi.fn(async () =>
      Response.json({ error: { message: 'This pull request is closed' } }, { status: 410 }),
    )
    expect(await sendFeedback(input, { apiUrl: 'https://t', fetch: closed })).toEqual({
      ok: false,
      message: 'This pull request is closed',
    })
    const html = vi.fn(async () => new Response('<h1>502</h1>', { status: 502 }))
    expect(await sendFeedback(input, { apiUrl: 'https://t', fetch: html })).toEqual({
      ok: false,
      message: 'Tapthrough returned 502.',
    })
  })

  it('reports a network failure', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Network request failed')
    })
    expect(await sendFeedback(input, { apiUrl: 'https://t', fetch: offline })).toMatchObject({
      ok: false,
      message: expect.stringContaining("Couldn't reach Tapthrough"),
    })
  })
})

describe('checklist', () => {
  const preview = { updateGroupId: 'g1', projectId: 'p1', branch: 'pr-1' }

  it('fetches the checklist for the running build, or null when there is none', async () => {
    const checklist = { pr: 1, sha: 'abc', open: true, scenarios: [] }
    const ok = vi.fn(async (_url: string | URL | Request) => Response.json(checklist))
    expect(await fetchChecklist(preview, 'ios', { apiUrl: 'https://t/', fetch: ok })).toEqual(
      checklist,
    )
    expect(String(ok.mock.calls[0]?.[0])).toBe(
      'https://t/api/v1/checklist?updateGroupId=g1&projectId=p1&platform=ios',
    )
    const missing = vi.fn(async () => new Response('', { status: 404 }))
    expect(await fetchChecklist(preview, 'ios', { apiUrl: 'https://t', fetch: missing })).toBeNull()
  })

  it('posts a step result with the finding it links to', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    )
    const result = await sendStepResult(
      {
        preview,
        platform: 'android',
        scenarioKey: 'edit',
        stepIndex: 1,
        result: 'fail',
        findingId: 'f1',
      },
      { apiUrl: 'https://t', fetch },
    )
    expect(result).toEqual({ ok: true })
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      apiVersion: 1,
      updateGroupId: 'g1',
      projectId: 'p1',
      platform: 'android',
      scenarioKey: 'edit',
      stepIndex: 1,
      result: 'fail',
      findingId: 'f1',
    })
  })

  it('writes the failed step and expectation above the note', () => {
    expect(
      failedStepBody({ action: 'Tap Save', expect: 'Error shows' }, '  Nothing happens '),
    ).toBe('Step failed: Tap Save\nExpected: Error shows\n\nNothing happens')
    expect(failedStepBody({ action: 'Tap Save', expect: 'Error shows' }, '')).toBe(
      'Step failed: Tap Save\nExpected: Error shows',
    )
  })
})

describe('re-check', () => {
  const preview = { updateGroupId: 'g1', projectId: 'p1', branch: 'pr-1' }

  it('posts a re-check for one report', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    )
    expect(
      await sendRecheck(
        { preview, platform: 'ios', findingId: 'f-1', result: 'still_broken', reporterName: 'Sam' },
        { apiUrl: 'https://t', fetch },
      ),
    ).toEqual({ ok: true })
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://t/api/v1/findings/f-1/check')
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      result: 'still_broken',
      reporterName: 'Sam',
      projectId: 'p1',
    })
  })

  it('opens the sheet for steps or reports to re-check, not for an empty plan', () => {
    const empty = { pr: 1, sha: 's', open: true, scenarios: [] }
    expect(hasReviewItems(null)).toBe(false)
    expect(hasReviewItems(empty)).toBe(false)
    expect(
      hasReviewItems({
        ...empty,
        recheck: [
          {
            id: 'f',
            excerpt: 'x',
            reporter: null,
            sha: 'a',
            platform: 'ios',
            stillBrokenHere: false,
          },
        ],
      }),
    ).toBe(true)
  })
})
