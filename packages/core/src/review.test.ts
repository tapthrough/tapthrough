import { describe, expect, it } from 'vitest'
import type { Checklist, ChecklistScenario, SetupLine } from './feedback.js'
import {
  afterScenario,
  nextOpenScenario,
  nextOpenStep,
  openableRoute,
  otherStates,
  popoverPlacement,
  resultsFrom,
  scenarioProgress,
  screenPosition,
  setupLineStates,
} from './review.js'

const step = (index: number, result: 'pass' | 'fail' | 'skip' | null = null) => ({
  index,
  action: `Do ${index}`,
  expect: `See ${index}`,
  result: result ? { result, reporter: null, platform: 'ios' as const } : null,
})

const pin: ChecklistScenario = {
  key: 'pin',
  title: 'Pin a note',
  routePath: '/',
  steps: [step(0, 'pass'), step(1), step(2)],
}
const archive: ChecklistScenario = {
  key: 'archive',
  title: 'Archive',
  routePath: '/',
  steps: [step(0), step(1)],
}
const checklist: Checklist = {
  pr: 8,
  sha: 'abc',
  open: true,
  scenarios: [pin, archive],
  library: [
    { key: 'pin', title: 'Pin a note', routePath: '/', picked: true },
    { key: 'empty', title: 'No notes', routePath: '/', picked: false },
  ],
}

describe('progress', () => {
  it('reads server results and counts them per scenario', () => {
    const results = resultsFrom(checklist)
    expect(results).toMatchObject({ 'pin:0': 'pass', 'pin:1': undefined })
    expect(scenarioProgress(pin, results)).toEqual({
      total: 3,
      checked: 1,
      passed: 1,
      failed: 0,
      state: 'partial',
    })
    expect(scenarioProgress(archive, results).state).toBe('new')
    expect(scenarioProgress(pin, { 'pin:0': 'pass', 'pin:1': 'fail', 'pin:2': 'pass' }).state).toBe(
      'failed',
    )
    expect(resultsFrom(null)).toEqual({})
  })
})

describe('next step and scenario', () => {
  it('finds the next open step, wrapping round', () => {
    const results = resultsFrom(checklist)
    expect(nextOpenStep(pin, results)).toBe(1)
    expect(nextOpenStep(pin, { ...results, 'pin:1': 'pass' }, 2)).toBe(2)
    expect(nextOpenStep(pin, { ...results, 'pin:2': 'pass' }, 2)).toBe(1)
    expect(nextOpenStep(pin, { 'pin:0': 'pass', 'pin:1': 'skip', 'pin:2': 'fail' })).toBe(-1)
  })

  it('moves on to the next scenario with steps left', () => {
    const done = { 'pin:0': 'pass', 'pin:1': 'pass', 'pin:2': 'pass' } as const
    expect(nextOpenScenario(checklist, done, 'pin')?.key).toBe('archive')
    expect(nextOpenScenario(checklist, resultsFrom(checklist), 'archive')?.key).toBe('pin')
    expect(
      nextOpenScenario(checklist, { ...done, 'archive:0': 'pass', 'archive:1': 'fail' }),
    ).toBeUndefined()
  })

  it('lists only library scenarios outside the plan', () => {
    expect(otherStates(checklist).map((e) => e.key)).toEqual(['empty'])
    expect(otherStates({ ...checklist, library: undefined })).toEqual([])
  })
})

describe('walkthrough', () => {
  const screen = (key: string, result: 'pass' | 'fail' | null = null): ChecklistScenario => ({
    key,
    title: key,
    routePath: `/${key}`,
    steps: [step(0, result)],
  })
  const tour: Checklist = {
    pr: 21,
    sha: 'abc',
    open: true,
    walkthrough: { intro: 'Blue background. Let’s check these 3 screens.' },
    scenarios: [screen('today', 'pass'), screen('jobs'), screen('more')],
  }

  it('goes straight on to the next unchecked screen', () => {
    const results = { ...resultsFrom(tour), 'jobs:0': 'pass' as const }
    expect(afterScenario(tour, results, 'jobs')).toEqual({ view: 'brief', key: 'more' })
  })

  it('goes back to the list once every screen is checked', () => {
    const results = { 'today:0': 'pass', 'jobs:0': 'fail', 'more:0': 'pass' } as const
    expect(afterScenario(tour, results, 'more')).toEqual({ view: 'list' })
  })

  it('keeps the per-scenario summary for a normal checklist', () => {
    const results = { ...resultsFrom(checklist), 'pin:1': 'pass', 'pin:2': 'pass' } as const
    expect(afterScenario(checklist, results, 'pin')).toEqual({ view: 'done', key: 'pin' })
  })

  it('numbers screens', () => {
    expect(screenPosition(tour, 'jobs')).toBe('Screen 2 of 3')
  })
})

describe('popoverPlacement', () => {
  const bounds = { width: 393, height: 852, insetTop: 60, insetBottom: 34 }

  it('opens above a button low on the right, sized to the room', () => {
    const p = popoverPlacement({ x: 337, y: 650 }, bounds)
    expect(p).toMatchObject({ side: 'right', vertical: 'above', width: 320, inset: 8 })
    expect(p.offset).toBe(852 - 650 + 10)
    expect(p.maxHeight).toBe(560)
  })

  it('opens below a button high on the left, and never wider than the screen', () => {
    const p = popoverPlacement({ x: 8, y: 80 }, { ...bounds, width: 320 })
    expect(p).toMatchObject({ side: 'left', vertical: 'below', width: 304 })
    expect(p.offset).toBe(80 + 48 + 10)
    expect(p.maxHeight).toBe(560)
    expect(popoverPlacement({ x: 8, y: 80 }, { ...bounds, height: 600 }).maxHeight).toBe(
      600 - 34 - (80 + 48 + 10),
    )
  })

  it('caps the height to the space above the button', () => {
    const p = popoverPlacement({ x: 337, y: 400 }, bounds)
    expect(p.vertical).toBe('below')
    expect(popoverPlacement({ x: 337, y: 500 }, bounds).maxHeight).toBe(500 - 10 - 60)
  })
})

describe('setupLineStates', () => {
  const lines: SetupLine[] = [
    { kind: 'account', auto: 'a', manual: 'a' },
    { kind: 'data', auto: 'd', manual: 'd' },
    { kind: 'flag', auto: 'f', manual: 'f' },
    { kind: 'screen', auto: 's', manual: 's' },
  ]

  it('ticks lines off as the launch moves through its stages', () => {
    expect(setupLineStates(lines, 'requesting')).toEqual([
      'active',
      'waiting',
      'waiting',
      'waiting',
    ])
    expect(setupLineStates(lines, 'seeding')).toEqual(['waiting', 'active', 'waiting', 'waiting'])
    expect(setupLineStates(lines, 'signing_in')).toEqual(['active', 'done', 'waiting', 'waiting'])
    expect(setupLineStates(lines, 'opening')).toEqual(['done', 'done', 'done', 'active'])
    expect(setupLineStates(lines, 'done')).toEqual(['done', 'done', 'done', 'done'])
  })
})

describe('openableRoute', () => {
  it('opens plain routes and drops Expo Router groups', () => {
    expect(openableRoute('/jobs')).toBe('/jobs')
    expect(openableRoute('/(employer)/jobs/new')).toBe('/jobs/new')
    expect(openableRoute('/')).toBe('/')
  })

  it('skips routes that need an ID from seeded data', () => {
    expect(openableRoute('/jobs/[jobId]')).toBeNull()
  })
})
