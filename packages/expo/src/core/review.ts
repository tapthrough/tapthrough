import { type Bounds, BUBBLE_SIZE, EDGE_MARGIN, type Point } from './bubble.js'
import type {
  Checklist,
  ChecklistScenario,
  LibraryEntry,
  SetupLine,
  StepResultValue,
} from './feedback.js'
import type { LaunchStage } from './launch.js'

/** Step results keyed `scenario:index`, with the reviewer's own taps applied on top. */
export type Results = Record<string, StepResultValue | undefined>

export const stepId = (scenarioKey: string, index: number) => `${scenarioKey}:${index}`

/** The results the server already has for each step. */
export function resultsFrom(checklist: Checklist | null): Results {
  if (!checklist) return {}
  return Object.fromEntries(
    checklist.scenarios.flatMap((scenario) =>
      scenario.steps.map((step) => [stepId(scenario.key, step.index), step.result?.result]),
    ),
  )
}

export interface ScenarioProgress {
  total: number
  /** Steps with any result, skips included. */
  checked: number
  passed: number
  failed: number
  state: 'new' | 'partial' | 'passed' | 'failed'
}

export function scenarioProgress(scenario: ChecklistScenario, results: Results): ScenarioProgress {
  const values = scenario.steps.map((step) => results[stepId(scenario.key, step.index)])
  const checked = values.filter(Boolean).length
  const passed = values.filter((v) => v === 'pass').length
  const failed = values.filter((v) => v === 'fail').length
  const total = values.length
  const state =
    checked === 0 ? 'new' : checked < total ? 'partial' : failed > 0 ? 'failed' : 'passed'
  return { total, checked, passed, failed, state }
}

/**
 * Position in `scenario.steps` of the first step without a result, starting at
 * `from` and wrapping round. -1 when every step has one.
 */
export function nextOpenStep(scenario: ChecklistScenario, results: Results, from = 0): number {
  const n = scenario.steps.length
  for (let k = 0; k < n; k++) {
    const i = (((from + k) % n) + n) % n
    const step = scenario.steps[i]
    if (step && !results[stepId(scenario.key, step.index)]) return i
  }
  return -1
}

/** The next scenario with a step left, after `afterKey` and wrapping round. */
export function nextOpenScenario(
  checklist: Checklist,
  results: Results,
  afterKey?: string,
): ChecklistScenario | undefined {
  const list = checklist.scenarios
  const start = afterKey ? list.findIndex((s) => s.key === afterKey) + 1 : 0
  for (let k = 0; k < list.length; k++) {
    const scenario = list[(start + k) % list.length]
    if (scenario && nextOpenStep(scenario, results) >= 0) return scenario
  }
  return undefined
}

/** Scenarios in the run that aren't in the PR's plan, for "Other states". */
export function otherStates(checklist: Checklist): LibraryEntry[] {
  const planned = new Set(checklist.scenarios.map((s) => s.key))
  return (checklist.library ?? []).filter((entry) => !entry.picked && !planned.has(entry.key))
}

export interface Placement {
  side: 'left' | 'right'
  /** Distance from the screen's `side` edge. */
  inset: number
  width: number
  vertical: 'above' | 'below'
  /** Distance from the screen's bottom (above the button) or top (below it). */
  offset: number
  maxHeight: number
}

/**
 * Where the popover goes for a button resting at `anchor`: on the button's
 * side of the screen, and above or below it, whichever has more room.
 */
export function popoverPlacement(
  anchor: Point,
  bounds: Bounds,
  preferred: { width: number; maxHeight: number } = { width: 320, maxHeight: 560 },
  size = BUBBLE_SIZE,
  gap = 10,
): Placement {
  const side = anchor.x + size / 2 < bounds.width / 2 ? 'left' : 'right'
  const width = Math.min(preferred.width, bounds.width - EDGE_MARGIN * 2)
  const above = anchor.y - gap - bounds.insetTop
  const below = bounds.height - bounds.insetBottom - (anchor.y + size + gap)
  const vertical = above >= below ? 'above' : 'below'
  const room = Math.max(vertical === 'above' ? above : below, 0)
  return {
    side,
    inset: EDGE_MARGIN,
    width,
    vertical,
    offset: vertical === 'above' ? bounds.height - anchor.y + gap : anchor.y + size + gap,
    maxHeight: Math.min(preferred.maxHeight, room),
  }
}

export type SetupProgress = 'requesting' | LaunchStage | 'done'
export type LineState = 'waiting' | 'active' | 'done'

const RANK: Record<SetupProgress, number> = {
  requesting: 0,
  seeding: 1,
  resetting: 2,
  signing_in: 3,
  opening: 4,
  done: 5,
}
// The seed hook makes the account and data; sign-in uses the account; flags and
// navigation come last. Each line is done once the launch is past its part.
const ACTIVE_AT: Record<SetupLine['kind'], number> = { data: 1, account: 3, flag: 4, screen: 4 }
const DONE_AT: Record<SetupLine['kind'], number> = { data: 2, account: 4, flag: 4, screen: 5 }

/** How far along each setup line is, for ticking them off while a launch runs. */
export function setupLineStates(lines: SetupLine[], progress: SetupProgress): LineState[] {
  const rank = RANK[progress]
  const states = lines.map(
    (line): LineState =>
      rank >= DONE_AT[line.kind] ? 'done' : rank >= ACTIVE_AT[line.kind] ? 'active' : 'waiting',
  )
  // Something is always visibly happening until the end.
  if (!states.includes('active')) {
    const first = states.indexOf('waiting')
    if (first >= 0) states[first] = 'active'
  }
  return states
}
