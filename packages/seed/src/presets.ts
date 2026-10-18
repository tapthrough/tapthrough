import type { z } from 'zod'

/** Who opened the link and what for. Passed to every preset and to the shared account. */
export interface SeedContext {
  /** Tapthrough's ID for the reviewer. Stable across opens, so it can tag seeded data. */
  reviewerId: string
  scenarioId: string
  repo: string
  pr: number
  /** The role the scenario asks for, e.g. `viewer` for a role-gated screen. */
  role: string | undefined
}

export interface SeedResult {
  /** Provider-specific session the SDK logs in with, e.g. `{ access_token, refresh_token }`. */
  session: Record<string, unknown>
  /** Seeded records, referenced from the route as `$seed.<path>`, e.g. `$seed.notes[0].id`. */
  refs?: Record<string, unknown>
}

export interface Preset<Schema extends z.ZodType = z.ZodType> {
  /** Shown to the plan generator so it can pick the right preset. */
  description: string
  /** Checks the scenario's `seed.params`; defaults fill in anything omitted. */
  params: Schema
  seed(input: SeedContext & { params: z.output<Schema> }): Promise<SeedResult>
}

/** Typed helper so `seed` sees the parsed params. */
export function definePreset<Schema extends z.ZodType>(preset: Preset<Schema>): Preset<Schema> {
  return preset
}

export type Presets = Record<string, Preset>
