import type { AgentPlan } from '@tapthrough/protocol'
import { describe, expect, it, vi } from 'vitest'
import { fetchAgentPlan, formatAgentPlan, parseLinkRef, requestLaunch } from './agent.js'

const ID = '0b6c3c1e-8a4d-4f7e-9a51-3f2b8e1d7c90'

const plan: AgentPlan = {
  apiVersion: 1,
  repo: 'acme/notes',
  pr: 8,
  expired: false,
  app: { scheme: 'notes', expoProjectId: 'p' },
  builds: [
    {
      platform: 'ios',
      sha: 'abcdef1234567890',
      updateGroupId: 'g',
      runtimeVersion: '1.0.0',
      buildUrl: 'exp+notes://expo-development-client/?url=x',
    },
  ],
  scenarios: [
    {
      key: 'pin-note',
      title: 'Pin a note',
      route: { path: '/notes/[id]', params: {} },
      setup: ['Signs you in as a new test user', 'Opens /notes/…'],
      platforms: ['ios'],
      steps: [
        { index: 0, action: 'Tap Pin', expect: 'The note moves to the top', confidence: 'high' },
        { index: 1, action: 'Unpin it', expect: 'It moves back', confidence: 'low' },
      ],
    },
  ],
  launchEndpoint: `https://t.dev/api/v1/links/${ID}/token`,
}

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

describe('parseLinkRef', () => {
  it('takes the server from a PR link', () => {
    expect(parseLinkRef(`https://t.dev/l/${ID}?s=pin-note`)).toEqual({
      server: 'https://t.dev',
      linkId: ID,
    })
  })

  it('uses the given server for a bare ID', () => {
    expect(parseLinkRef(ID, 'http://localhost:3000/')).toEqual({
      server: 'http://localhost:3000',
      linkId: ID,
    })
  })

  it('rejects anything else', () => {
    expect(() => parseLinkRef('https://github.com/acme/notes/pull/8')).toThrow(/PR link/)
    expect(() => parseLinkRef('pin-note')).toThrow(/PR link/)
  })
})

describe('fetchAgentPlan', () => {
  it('loads and validates the plan', async () => {
    const fetchImpl = respond(plan)
    await expect(
      fetchAgentPlan({ server: 'https://t.dev', linkId: ID }, fetchImpl),
    ).resolves.toEqual(plan)
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://t.dev/api/v1/links/${ID}/agent`,
      expect.anything(),
    )
  })

  it("passes on the server's error", async () => {
    const fetchImpl = respond(
      { error: { code: 'not_found', message: 'This link does not exist' } },
      404,
    )
    await expect(
      fetchAgentPlan({ server: 'https://t.dev', linkId: ID }, fetchImpl),
    ).rejects.toThrow('This link does not exist')
  })

  it('says to update when the shape is unknown', async () => {
    await expect(
      fetchAgentPlan({ server: 'https://t.dev', linkId: ID }, respond({ apiVersion: 2 })),
    ).rejects.toThrow(/Update @tapthrough\/cli/)
  })
})

describe('requestLaunch', () => {
  it('asks as an agent and returns the launch URL', async () => {
    const fetchImpl = respond({
      launchUrl: 'notes://tapthrough/launch?t=x',
      expiresAt: '2026-11-12',
    })
    const launch = await requestLaunch(
      { server: 'https://t.dev', linkId: ID },
      { platform: 'ios', scenario: 'pin-note' },
      fetchImpl,
    )
    expect(launch.launchUrl).toBe('notes://tapthrough/launch?t=x')
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      platform: 'ios',
      scenario: 'pin-note',
      from: 'agent',
    })
  })
})

describe('formatAgentPlan', () => {
  const link = `https://t.dev/l/${ID}`

  it('lists the build, each launch command and the steps', () => {
    const text = formatAgentPlan(plan, link, 'ios')
    expect(text).toContain('# acme/notes PR #8: 1 scenario to check on iOS')
    expect(text).toContain('exp+notes://expo-development-client/?url=x')
    expect(text).toContain(`npx @tapthrough/cli launch ${link} --scenario pin-note --platform ios`)
    expect(text).toContain('1. Tap Pin\n   Expect: The note moves to the top')
    expect(text).toContain('2. Unpin it (low confidence')
  })

  it('says when the platform has no build', () => {
    expect(formatAgentPlan(plan, link, 'android')).toBe(
      'acme/notes PR #8 has no Android build yet. Try iOS.',
    )
  })

  it('says when the PR is closed', () => {
    expect(formatAgentPlan({ ...plan, expired: true }, link, 'ios')).toMatch(/is closed/)
  })
})
