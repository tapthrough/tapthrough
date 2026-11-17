import { describe, expect, it } from 'vitest'
import { routeMatches } from './route.js'

describe('routeMatches', () => {
  it('matches a plain page, with or without a trailing slash', () => {
    expect(routeMatches('/pricing', '/pricing')).toBe(true)
    expect(routeMatches('/pricing', '/pricing/')).toBe(true)
    expect(routeMatches('/', '/')).toBe(true)
    expect(routeMatches('/pricing', '/pricing/plans')).toBe(false)
    expect(routeMatches('/', '/pricing')).toBe(false)
    expect(routeMatches('/pricing', undefined)).toBe(false)
  })

  it('matches a page with parameters to any value in their place', () => {
    expect(routeMatches('/jobs/[id]', '/jobs/42')).toBe(true)
    expect(routeMatches('/jobs/[id]', '/jobs')).toBe(false)
    expect(routeMatches('/jobs/[id]', '/jobs/42/edit')).toBe(false)
    expect(routeMatches('/jobs/[id]/matches/[matchId]', '/jobs/42/matches/m_1')).toBe(true)
    expect(routeMatches('/docs/[...slug]', '/docs/a/b')).toBe(true)
    expect(routeMatches('/docs/[...slug]', '/docs')).toBe(false)
  })

  it("doesn't treat a dot in the route as a wildcard", () => {
    expect(routeMatches('/feed.xml', '/feedAxml')).toBe(false)
  })
})
