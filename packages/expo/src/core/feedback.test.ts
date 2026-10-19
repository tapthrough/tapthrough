import { describe, expect, it, vi } from 'vitest'
import { previewContextFromManifest, scenarioIdFromToken, sendFeedback } from './feedback.js'

describe('previewContextFromManifest', () => {
  it('reads the update group and branch from an EAS update manifest', () => {
    const manifest = {
      id: 'u1',
      metadata: { updateGroup: '5623cd33-782f-4be7-a00d-f23fa65e3323', branchName: 'pr-1' },
    }
    expect(previewContextFromManifest(manifest)).toEqual({
      updateGroupId: '5623cd33-782f-4be7-a00d-f23fa65e3323',
      branch: 'pr-1',
    })
  })

  it('returns null for embedded, local or missing manifests', () => {
    expect(previewContextFromManifest(null)).toBeNull()
    expect(previewContextFromManifest({ metadata: {} })).toBeNull()
    expect(previewContextFromManifest({ metadata: { updateGroup: '' } })).toBeNull()
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
    preview: { updateGroupId: 'g1', branch: 'pr-1' },
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
