import { describe, expect, it } from 'vitest'
import { parseLibrary, parsePlanFile } from './library.js'

const home = { title: 'Home', route: { path: '/' }, seed: { tier: 0 } }

describe('parseLibrary', () => {
  it('takes keys from file names and reports broken files without failing', () => {
    const result = parseLibrary([
      { name: 'home.json', text: JSON.stringify(home) },
      { name: 'bad.json', text: '{' },
      { name: 'other.json', text: JSON.stringify({ ...home, key: 'home' }) },
      { name: 'Caps.json', text: JSON.stringify(home) },
    ])
    expect(result.scenarios.map((s) => s.key)).toEqual(['home'])
    expect(result.errors.map((e) => e.message)).toEqual([
      'not valid JSON',
      'key "home" doesn\'t match the file name',
      'file names use lowercase letters, digits and dashes',
    ])
  })
})

describe('parsePlanFile', () => {
  it('reads includes and PR-only scenarios, and rejects duplicates', () => {
    expect(parsePlanFile(null)).toEqual({ status: 'missing' })
    expect(parsePlanFile(JSON.stringify({ include: ['home'] })).status).toBe('ok')
    const dup = { ...home, key: 'a' }
    expect(parsePlanFile(JSON.stringify({ scenarios: [dup, dup] }))).toEqual({
      status: 'invalid',
      message: 'duplicate scenario key "a"',
    })
  })
})
