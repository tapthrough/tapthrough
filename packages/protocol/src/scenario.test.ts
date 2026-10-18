import { describe, expect, it } from 'vitest'
import { resolveRoute, resolveSeedRef, Scenario, Seed } from './scenario.js'

const refs = { notes: [{ id: 'n_1', title: 'Groceries' }], user: { id: 42 } }

describe('resolveSeedRef', () => {
  it('returns plain values unchanged', () => {
    expect(resolveSeedRef('abc', refs)).toBe('abc')
  })

  it('follows keys and indexes', () => {
    expect(resolveSeedRef('$seed.notes[0].id', refs)).toBe('n_1')
    expect(resolveSeedRef('$seed.user.id', refs)).toBe('42')
  })

  it('throws on a missing reference', () => {
    expect(() => resolveSeedRef('$seed.notes[3].id', refs)).toThrow('not found')
    expect(() => resolveSeedRef('$seed.user', refs)).toThrow('not found')
  })
})

describe('resolveRoute', () => {
  it('substitutes dynamic segments', () => {
    expect(
      resolveRoute({ path: '/notes/[id]/edit', params: { id: '$seed.notes[0].id' } }, refs),
    ).toBe('/notes/n_1/edit')
  })

  it('encodes values', () => {
    expect(resolveRoute({ path: '/search/[q]', params: { q: 'a b/c' } }, refs)).toBe(
      '/search/a%20b%2Fc',
    )
  })

  it('throws when a param is missing', () => {
    expect(() => resolveRoute({ path: '/notes/[id]', params: {} }, refs)).toThrow('Missing')
  })
})

describe('schemas', () => {
  it('requires a preset for tier 2', () => {
    expect(Seed.safeParse({ tier: 2 }).success).toBe(false)
    expect(Seed.safeParse({ tier: 2, preset: 'user-with-notes' }).success).toBe(true)
    expect(Seed.safeParse({ tier: 0 }).success).toBe(true)
  })

  it('accepts a full scenario', () => {
    const scenario = Scenario.parse({
      v: 1,
      id: 'scn_abc',
      repo: 'acme/notes',
      pr: 142,
      headSha: 'a'.repeat(40),
      build: { platform: 'ios', runtimeVersion: '1.0.0', updateGroupId: 'grp_1' },
      seed: { tier: 2, preset: 'user-with-notes', params: { count: 1 } },
      route: { path: '/notes/[id]/edit', params: { id: '$seed.notes[0].id' } },
      plan: [
        {
          action: 'Clear the title and tap Save',
          expect: "Inline error 'Title required' under the field",
          source: 'ticket',
          confidence: 'high',
          files: ['app/notes/[id]/edit.tsx'],
        },
      ],
    })
    expect(scenario.route.params.id).toBe('$seed.notes[0].id')
  })
})
