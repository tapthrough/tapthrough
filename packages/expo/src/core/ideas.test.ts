import { describe, expect, it, vi } from 'vitest'
import {
  approveMessage,
  fetchIdeas,
  fetchOpenPrs,
  type Idea,
  ideaAction,
  ideasNeedingYou,
  isMoving,
  stepTime,
  submitIdea,
} from './ideas.js'

const preview = { updateGroupId: 'g1', projectId: 'p1', branch: 'pr-3' }
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
        preview,
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
        { preview, platform: 'ios', draft: { body: 'x' } },
        {
          apiUrl,
          fetch: respond(403, { error: { message: 'Ideas are turned off for this app.' } }),
        },
      ),
    ).toEqual({ ok: false, message: 'Ideas are turned off for this app.' })
    expect(
      await submitIdea(
        { preview, platform: 'ios', draft: { body: 'x' } },
        { apiUrl, fetch: respond(404, {}) },
      ),
    ).toEqual({ ok: false, message: 'This version of Tapthrough doesn’t take ideas yet.' })
  })

  it('never throws offline', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Network request failed')
    })
    const result = await submitIdea(
      { preview, platform: 'ios', draft: { body: 'x' } },
      { apiUrl, fetch },
    )
    expect(result.ok).toBe(false)
  })
})

describe('lists', () => {
  it('reads ideas, and an empty list when it cannot', async () => {
    expect(
      await fetchIdeas(preview, 'ios', { apiUrl, fetch: respond(200, { ideas: [idea] }) }),
    ).toEqual([idea])
    expect(await fetchIdeas(preview, 'ios', { apiUrl, fetch: respond(500, {}) })).toEqual([])
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

describe('ideaAction', () => {
  it('reports what Approve did', async () => {
    const result = await ideaAction(
      { preview, platform: 'ios', id: 'i1', action: 'approve', by: 'Jane' },
      { apiUrl, fetch: respond(200, { idea, result: 'auto_merge' }) },
    )
    expect(result).toEqual({ ok: true, idea, approve: 'auto_merge' })
    expect(approveMessage('auto_merge')).toBe('Approved. It merges once its checks pass.')
    expect(approveMessage(null)).toBe('Approved. An engineer reviews and merges it.')
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
