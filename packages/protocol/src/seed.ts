import { z } from 'zod'
import { Fixtures } from './fixtures.js'
import { Flags, Route, Seed } from './scenario.js'

/**
 * Body of `POST /api/v1/tokens/redeem`. The seed hook sends it; an app with no
 * seed hook sends it itself, which works for scenarios that use fixtures.
 */
export const RedeemRequest = z.object({
  token: z.string().min(1),
})
export type RedeemRequest = z.infer<typeof RedeemRequest>

/** What we return to the seed hook once a token is redeemed. */
export const RedeemResponse = z.object({
  apiVersion: z.literal(1),
  scenarioId: z.string().min(1),
  seed: Seed,
  route: Route,
  flags: Flags.default({}),
  /** Tier 1 only: the scenario's fixture file, read from the PR's commit. */
  fixtures: Fixtures.optional(),
})
export type RedeemResponse = z.infer<typeof RedeemResponse>

/** Body the SDK sends to the customer's seed hook. */
export const SeedHookRequest = z.object({
  token: z.string().min(1),
})
export type SeedHookRequest = z.infer<typeof SeedHookRequest>

/** What the seed hook returns to the SDK. The session never passes through our servers. */
export const SeedHookResponse = z.object({
  apiVersion: z.literal(1),
  /** Provider-specific, e.g. `{ access_token, refresh_token }` for Supabase. */
  session: z.record(z.string(), z.unknown()),
  /** Seeded records, referenced by `$seed.` paths in the route. */
  refs: z.record(z.string(), z.unknown()),
  route: Route,
  flags: Flags.default({}),
  /** Tier 1 only: canned responses the SDK answers the app's requests with. */
  fixtures: Fixtures.optional(),
})
export type SeedHookResponse = z.infer<typeof SeedHookResponse>

/** Error body returned by the seed hook and our API. */
export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
})
export type ErrorResponse = z.infer<typeof ErrorResponse>
