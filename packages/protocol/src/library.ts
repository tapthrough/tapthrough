import { z } from 'zod'
import { Flags, Route, Seed } from './scenario.js'

export const ScenarioKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits and dashes')
  .max(60)

/** Settings the app simulates while a scenario runs. */
export const Toggles = z
  .object({ theme: z.enum(['light', 'dark']).optional() })
  .strict()
  .default({})

const Steps = z
  .array(
    z.object({
      action: z.string().min(1),
      expect: z.string().min(1),
      files: z.array(z.string()).default([]),
    }),
  )
  .max(10)
  .default([])

/**
 * One state of the app, declared as data: where to go, what state to seed,
 * which settings to simulate and what to check. Never a script of taps.
 */
export const ScenarioSpec = z.object({
  /** Stable across pushes, so links and checklist results keep working. */
  key: ScenarioKey,
  title: z.string().min(1).max(80),
  route: Route,
  seed: Seed,
  flags: Flags.optional(),
  toggles: Toggles,
  steps: Steps,
})
export type ScenarioSpec = z.infer<typeof ScenarioSpec>

/**
 * A library scenario in `.tapthrough/scenarios/<key>.json`. The key comes
 * from the file name, so the file doesn't need to repeat it.
 */
export const LibraryScenario = ScenarioSpec.extend({ key: ScenarioKey.optional() })

/**
 * Optional per-PR plan in `.tapthrough/plans/<pr>.json`: library scenarios to
 * include beyond the ones picked automatically, and PR-only scenarios.
 */
export const PlanFile = z
  .object({
    include: z.array(ScenarioKey).max(20).default([]),
    scenarios: z.array(ScenarioSpec).max(5).default([]),
  })
  .refine((plan) => plan.include.length + plan.scenarios.length > 0, {
    message: 'add at least one scenario or an include',
  })
export type PlanFile = z.infer<typeof PlanFile>

export const SCENARIO_DIR = '.tapthrough/scenarios'

export function planFilePath(pr: number) {
  return `.tapthrough/plans/${pr}.json`
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  const where = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
  return `${issue?.message ?? 'invalid'}${where}`
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false }
  }
}

export type PlanFileResult =
  | { status: 'missing' }
  | { status: 'invalid'; message: string }
  | { status: 'ok'; plan: PlanFile }

export function parsePlanFile(raw: string | null): PlanFileResult {
  if (raw === null) return { status: 'missing' }
  const json = parseJson(raw)
  if (!json.ok) return { status: 'invalid', message: 'not valid JSON' }
  const parsed = PlanFile.safeParse(json.value)
  if (!parsed.success) return { status: 'invalid', message: firstIssue(parsed.error) }
  const keys = parsed.data.scenarios.map((scenario) => scenario.key)
  const duplicate = keys.find((key, i) => keys.indexOf(key) !== i)
  if (duplicate) return { status: 'invalid', message: `duplicate scenario key "${duplicate}"` }
  return { status: 'ok', plan: parsed.data }
}

export interface LibraryResult {
  scenarios: ScenarioSpec[]
  /** Files that couldn't be read, so the comment can say which and why. */
  errors: { file: string; message: string }[]
}

/** Parses the repo's scenario library. A broken file is reported, never fatal. */
export function parseLibrary(files: { name: string; text: string }[]): LibraryResult {
  const scenarios: ScenarioSpec[] = []
  const errors: LibraryResult['errors'] = []
  for (const file of files) {
    const fileKey = file.name.replace(/\.json$/, '')
    const json = parseJson(file.text)
    if (!json.ok) {
      errors.push({ file: file.name, message: 'not valid JSON' })
      continue
    }
    const parsed = LibraryScenario.safeParse(json.value)
    if (!parsed.success) {
      errors.push({ file: file.name, message: firstIssue(parsed.error) })
      continue
    }
    if (parsed.data.key && parsed.data.key !== fileKey) {
      errors.push({
        file: file.name,
        message: `key "${parsed.data.key}" doesn't match the file name`,
      })
      continue
    }
    const keyCheck = ScenarioKey.safeParse(fileKey)
    if (!keyCheck.success) {
      errors.push({
        file: file.name,
        message: 'file names use lowercase letters, digits and dashes',
      })
      continue
    }
    scenarios.push({ ...parsed.data, key: fileKey })
  }
  return { scenarios, errors }
}
