import { describe, expect, it } from 'vitest'
import { launchedScenarioId } from './index.js'

describe('launchedScenarioId', () => {
  const state = encodeURIComponent(JSON.stringify({ v: 1, scn: 'scn_1', flags: {} }))

  it('reads the scenario from the launch cookie among others', () => {
    expect(launchedScenarioId(`theme=dark; tapthrough=${state}; other=1`)).toBe('scn_1')
  })

  it('is undefined without the cookie or when it is unreadable', () => {
    expect(launchedScenarioId('theme=dark')).toBeUndefined()
    expect(launchedScenarioId('tapthrough=%7Bnope')).toBeUndefined()
    expect(launchedScenarioId('tapthrough=%7B%22v%22%3A1%7D')).toBeUndefined()
    expect(launchedScenarioId('')).toBeUndefined()
  })
})
