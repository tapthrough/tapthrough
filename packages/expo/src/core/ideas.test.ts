import { describe, expect, it, vi } from 'vitest'
import {
  approveMessage,
  approvePr,
  fetchFeed,
  fetchIdeas,
  fetchOpenPrs,
  fixReport,
  type Idea,
  ideaAction,
  ideasNeedingYou,
  isMoving,
  newlyWaiting,
  type OpenPr,
  prsToReview,
  type Report,
  replyToIdea,
  reportsNeedingYou,
  sendStaffReport,
  stepTime,
  submitIdea,
} from './ideas.js'

const preview = { updateGroupId: 'g1', projectId: 'p1', branch: 'pr-3' }
const caller = { kind: 'build' as const, preview }
const apiUrl = 'https://t.dev/'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

const idea = { id: 'i1', status: 'grooming', statusLine: 'Claude is writing it up' } as Idea

describe('submitIdea', () => {
  it('posts the draft with the build credential', async () => {
    const fetch = respond(201, { idea })
    const result = await submitIdea(
      {
        caller,
        platform: 'ios',
        draft: { body: 'Pin notes', authorEmail: 'jane@acme.com', route: '/notes' },
      },
      { apiUrl, fetch },
    )
    expect(result).toEqual({ ok: true, idea })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://t.dev/api/v1/ideas')
    expect(JSON.parse(String(init.body))).toEqual({
      apiVersion: 1,
      updateGroupId: 'g1',
      projectId: 'p1',
      platform: 'ios',
      body: 'Pin notes',
      authorEmail: 'jane@acme.com',
      route: '/notes',
    })
  })

  it('says why when Tapthrough refuses, and when it is too old', async () => {
    expect(
      await submitIdea(
        { caller, platform: 'ios', draft: { body: 'x' } },
        {
          apiUrl,
          fetch: respond(403, { error: { message: 'Ideas are turned off for this app.' } }),
        },
      ),
    ).toEqual({ ok: false, message: 'Ideas are turned off for this app.' })
    expect(
      await submitIdea(
        { caller, platform: 'ios', draft: { body: 'x' } },
        { apiUrl, fetch: respond(404, {}) },
      ),
    ).toEqual({ ok: false, message: 'This version of Tapthrough doesn’t take ideas yet.' })
  })

  it('never throws offline', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Network request failed')
    })
    const result = await submitIdea(
      { caller, platform: 'ios', draft: { body: 'x' } },
      { apiUrl, fetch },
    )
    expect(result.ok).toBe(false)
  })
})

describe('lists', () => {
  it('reads ideas, and an empty list when it cannot', async () => {
    expect(
      await fetchIdeas(caller, 'ios', { apiUrl, fetch: respond(200, { ideas: [idea] }) }),
    ).toEqual([idea])
    expect(await fetchIdeas(caller, 'ios', { apiUrl, fetch: respond(500, {}) })).toEqual([])
  })

  it('reads open PRs, and null when it cannot', async () => {
    const fetch = respond(200, { pulls: [{ number: 4 }] })
    expect(await fetchOpenPrs(preview, 'android', { apiUrl, fetch })).toEqual([{ number: 4 }])
    expect(String((fetch.mock.calls[0] as unknown as [string])[0])).toContain(
      '/api/v1/pulls?updateGroupId=g1&projectId=p1&platform=android',
    )
    expect(await fetchOpenPrs(preview, 'ios', { apiUrl, fetch: respond(404, {}) })).toBeNull()
  })
})

describe('replyToIdea', () => {
  it('sends the reply with the caller', async () => {
    const fetch = respond(200, { idea })
    const result = await replyToIdea(
      { caller, platform: 'ios', id: 'i1', reply: 'Smaller first version', by: 'Jane' },
      { apiUrl, fetch },
    )
    expect(result).toEqual({ ok: true, idea })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toBe('https://t.dev/api/v1/ideas/i1/reply')
    expect(JSON.parse(init.body)).toMatchObject({ reply: 'Smaller first version', by: 'Jane' })
  })
})

describe('ideaAction', () => {
  it('reports what Approve did', async () => {
    const result = await ideaAction(
      { caller, platform: 'ios', id: 'i1', action: 'approve', by: 'Jane' },
      { apiUrl, fetch: respond(200, { idea, result: 'auto_merge' }) },
    )
    expect(result).toEqual({ ok: true, idea, approve: 'auto_merge' })
    expect(approveMessage('auto_merge')).toBe('Approved. It merges once its checks pass.')
    expect(approveMessage(null)).toBe('Approved. An engineer reviews and merges it.')
  })
})

describe('newlyWaiting', () => {
  it('announces each idea once per round of questions', () => {
    const seen = new Set<string>()
    const asking = { ...idea, id: 'a', status: 'needs_answers' as const, questions: ['Draft?'] }
    const moving = { ...idea, id: 'b', status: 'building' as const }
    expect(newlyWaiting([moving, asking], seen)?.id).toBe('a')
    expect(newlyWaiting([moving, asking], seen)).toBeNull()
    expect(newlyWaiting([{ ...asking, questions: ['Which salary range?'] }], seen)?.id).toBe('a')
    expect(newlyWaiting([{ ...asking, status: 'ready_to_test' as const }], seen)?.id).toBe('a')
  })
})

describe('ideasNeedingYou', () => {
  it('counts questions and builds to test', () => {
    const at = (status: Idea['status']) => ({ ...idea, status })
    expect(ideasNeedingYou([at('needs_answers'), at('ready_to_test'), at('building')])).toBe(2)
  })
})

describe('watching an idea', () => {
  it('refreshes often only while it moves', () => {
    expect(isMoving({ ...idea, status: 'building' })).toBe(true)
    expect(isMoving({ ...idea, status: 'built' })).toBe(true)
    expect(isMoving({ ...idea, status: 'needs_answers' })).toBe(false)
  })

  it('shows a time today and a date before', () => {
    const now = new Date('2026-11-12T15:00:00')
    expect(stepTime('2026-11-12T14:41:00', now)).toMatch(/2:41/)
    expect(stepTime('2026-11-10T09:00:00', now)).toMatch(/10/)
    expect(stepTime(null, now)).toBeNull()
  })
})

describe('app key callers', () => {
  const key = { kind: 'key' as const, appKey: 'k'.repeat(40) }

  it('send the key instead of the build, in bodies and queries', async () => {
    const post = respond(201, { idea })
    await submitIdea(
      { caller: key, platform: 'ios', draft: { body: 'Pin notes' } },
      { apiUrl, fetch: post },
    )
    const [, init] = post.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      apiVersion: 1,
      appKey: 'k'.repeat(40),
      platform: 'ios',
      body: 'Pin notes',
    })
    const get = respond(200, { ideas: [] })
    await fetchIdeas(key, 'android', { apiUrl, fetch: get })
    expect(String((get.mock.calls[0] as unknown as [string])[0])).toBe(
      `https://t.dev/api/v1/ideas?appKey=${'k'.repeat(40)}&platform=android`,
    )
  })

  it('file staff reports as issues', async () => {
    const fetch = respond(201, { issueNumber: 12, issueUrl: 'https://github.com/a/b/issues/12' })
    const result = await sendStaffReport(
      { appKey: key.appKey, platform: 'ios', report: { body: 'Broken', app: { build: '311' } } },
      { apiUrl, fetch },
    )
    expect(result).toEqual({
      ok: true,
      issueNumber: 12,
      issueUrl: 'https://github.com/a/b/issues/12',
      fixing: false,
    })
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('https://t.dev/api/v1/reports')
  })
})

const report = {
  id: 'r1',
  title: 'Header is not a header',
  statusLine: 'Claude is fixing it',
  fix: { status: 'fixing' },
  canFix: false,
} as Report

describe('bug reports', () => {
  it('reads reports alongside ideas, and none from an older server', async () => {
    expect(
      await fetchFeed(caller, 'ios', {
        apiUrl,
        fetch: respond(200, { ideas: [idea], reports: [report] }),
      }),
    ).toEqual({ ideas: [idea], reports: [report] })
    expect(
      await fetchFeed(caller, 'ios', { apiUrl, fetch: respond(200, { ideas: [idea] }) }),
    ).toEqual({
      ideas: [idea],
      reports: [],
    })
    expect(await fetchIdeas(caller, 'ios', { apiUrl, fetch: respond(500, {}) })).toEqual([])
  })

  it('starts Fix with Claude on a report', async () => {
    const fetch = respond(200, { report, fix: 'started' })
    const result = await fixReport(
      { caller: { kind: 'key', appKey: 'k'.repeat(30) }, platform: 'ios', id: 'r1', by: 'Sam' },
      { apiUrl, fetch },
    )
    expect(result).toEqual({ ok: true, report })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://t.dev/api/v1/reports/r1/fix')
    expect(JSON.parse(String(init.body))).toEqual({
      apiVersion: 1,
      appKey: 'k'.repeat(30),
      platform: 'ios',
      by: 'Sam',
    })
  })

  it('counts fixes ready to test', () => {
    const ready = { ...report, id: 'r2', fix: { ...report.fix, status: 'ready' } } as Report
    expect(reportsNeedingYou([report, ready])).toBe(1)
  })

  it('says when Claude started on a filed report', async () => {
    const result = await sendStaffReport(
      { appKey: 'k'.repeat(30), platform: 'ios', report: { body: 'Broken' } },
      { apiUrl, fetch: respond(201, { issueNumber: 9, issueUrl: 'u', fix: 'started' }) },
    )
    expect(result).toEqual({ ok: true, issueNumber: 9, issueUrl: 'u', fixing: true })
  })
})

describe('approving a PR', () => {
  it('posts the build credential and who approved, and says what happened', async () => {
    const fetch = respond(200, { pr: 7, result: 'review' })
    const result = await approvePr({ caller, platform: 'ios', by: 'Jo' }, { apiUrl, fetch })
    expect(result).toEqual({ ok: true, approve: 'review' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain('/api/v1/pulls/approve')
    expect(JSON.parse(String(init.body))).toMatchObject({ updateGroupId: 'g1', by: 'Jo' })
    expect(
      (await approvePr({ caller, platform: 'ios' }, { apiUrl, fetch: respond(409, {}) })).ok,
    ).toBe(false)
  })

  it('lists only other PRs nobody has approved yet', () => {
    const pr = (number: number, extra: Partial<OpenPr> = {}) =>
      ({ number, current: false, ...extra }) as OpenPr
    expect(
      prsToReview([pr(1, { current: true }), pr(2, { approved: true }), pr(3)]).map(
        (p) => p.number,
      ),
    ).toEqual([3])
    expect(prsToReview(null)).toEqual([])
  })
})
