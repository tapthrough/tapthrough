import { z } from 'zod'

/** A reference into the seed hook's output, e.g. `$seed.notes[0].id`. */
export const SEED_REF_PREFIX = '$seed.'

export const Platform = z.enum(['ios', 'android'])
export type Platform = z.infer<typeof Platform>

export const TestStep = z.object({
  /** What the reviewer does: "Clear the title and tap Save". */
  action: z.string().min(1),
  /** What they should see: "Inline error 'Title required' under the field". */
  expect: z.string().min(1),
  source: z.enum(['diff', 'ticket', 'inferred']),
  confidence: z.enum(['high', 'medium', 'low']),
  /** Changed files this step covers. */
  files: z.array(z.string()),
})
export type TestStep = z.infer<typeof TestStep>

/**
 * How the reviewer's starting state is produced.
 * - tier 0: a shared test account, no seeding
 * - tier 1: network mocks (not in v1)
 * - tier 2: a customer-defined preset run by their seed hook
 */
export const Seed = z
  .object({
    tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    preset: z.string().min(1).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    role: z.string().min(1).optional(),
  })
  .refine((seed) => seed.tier !== 2 || seed.preset !== undefined, {
    message: 'tier 2 requires a preset',
    path: ['preset'],
  })
export type Seed = z.infer<typeof Seed>

export const Route = z.object({
  /** Expo Router path, e.g. `/notes/[id]/edit`. */
  path: z.string().startsWith('/'),
  /** Values may reference seed output with `$seed.` paths. */
  params: z.record(z.string(), z.string()).default({}),
})
export type Route = z.infer<typeof Route>

export const Flags = z.record(z.string(), z.union([z.boolean(), z.string()]))
export type Flags = z.infer<typeof Flags>

export const Scenario = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  pr: z.number().int().positive(),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  build: z.object({
    platform: Platform,
    runtimeVersion: z.string().min(1),
    updateGroupId: z.string().min(1),
  }),
  seed: Seed,
  flags: Flags.optional(),
  route: Route,
  plan: z.array(TestStep).max(10),
})
export type Scenario = z.infer<typeof Scenario>

/**
 * Resolves a `$seed.` reference against the seed hook's `refs`.
 * Supports dotted keys and `[n]` indexes: `$seed.notes[0].id`.
 * Values that are not references are returned unchanged.
 */
export function resolveSeedRef(value: string, refs: Record<string, unknown>): string {
  if (!value.startsWith(SEED_REF_PREFIX)) return value
  const path = value.slice(SEED_REF_PREFIX.length)
  const segments = path.split('.').flatMap((part) => {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part)
    if (!match?.[1]) throw new Error(`Invalid seed reference: ${value}`)
    const indexes = [...(match[2] ?? '').matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))
    return [match[1], ...indexes]
  })
  let current: unknown = refs
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      throw new Error(`Seed reference not found: ${value}`)
    }
    current = (current as Record<string | number, unknown>)[segment]
  }
  if (typeof current !== 'string' && typeof current !== 'number') {
    throw new Error(`Seed reference not found: ${value}`)
  }
  return String(current)
}

/** Resolves every param and substitutes them into the path's `[name]` segments. */
export function resolveRoute(route: Route, refs: Record<string, unknown>): string {
  const params = Object.fromEntries(
    Object.entries(route.params).map(([key, value]) => [key, resolveSeedRef(value, refs)]),
  )
  return route.path.replace(
    /\[(\.\.\.)?([^\]]+)\]/g,
    (_, _rest: string | undefined, name: string) => {
      const value = params[name]
      if (value === undefined) throw new Error(`Missing route param: ${name}`)
      return encodeURIComponent(value)
    },
  )
}
