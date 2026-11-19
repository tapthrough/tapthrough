import {
  ErrorResponse,
  type Fixtures,
  type Flags,
  RedeemResponse,
  resolveRoute,
  SeedHookResponse,
} from '@tapthrough/protocol'
import { decodeTokenClaims } from './feedback.js'

/** Logs the app in with the session the seed hook created. */
export interface AuthAdapter {
  signIn(session: Record<string, unknown>): Promise<void>
}

/** Clears one piece of local state, e.g. a query cache or a persisted store. */
export type ResetTarget = () => void | Promise<void>

export interface LaunchDeps {
  /**
   * The app's seed hook. Leave it out for an app with no backend to seed: the
   * link is then redeemed with Tapthrough directly, which works for scenarios
   * that use fixtures.
   */
  seedHookUrl?: string
  /** Tapthrough's base URL, used when there is no seed hook. */
  apiUrl?: string
  /**
   * Starts answering the app's requests from these fixtures, or stops when
   * there are none. Called on every launch, so one scenario's fixtures never
   * leak into the next.
   */
  fixtures?: (fixtures: Fixtures | undefined) => void | Promise<void>
  /**
   * The app's own IDs (iOS bundle ID, Android package). A token for any other
   * app is refused before anything changes, so a stray link can't swap accounts.
   */
  expectedAudiences?: string[]
  auth: AuthAdapter
  reset?: ResetTarget[]
  applyFlags?: (flags: Flags) => void
  navigate: (path: string) => void | Promise<void>
  fetch?: typeof fetch
  /** Called as each part of the launch starts, so a UI can show progress. */
  onStage?: (stage: LaunchStage) => void
}

/** The parts of a launch, in order. */
export type LaunchStage = 'seeding' | 'resetting' | 'signing_in' | 'opening'

export interface LaunchError {
  code: string
  /** Shown to the reviewer as is. */
  message: string
}

export type LaunchResult = { ok: true; path: string } | { ok: false; error: LaunchError }

const fail = (code: string, message: string): LaunchResult => ({
  ok: false,
  error: { code, message },
})

/**
 * The launch sequence for one link token: ask the seed hook for a session,
 * clear local state, log in, apply flags, then open the scenario's screen.
 * Never throws; every failure comes back as a reviewer-facing message.
 */
export async function runLaunch(token: string, deps: LaunchDeps): Promise<LaunchResult> {
  const doFetch = deps.fetch ?? fetch

  if (deps.expectedAudiences?.length) {
    const aud = decodeTokenClaims(token)?.aud
    const audiences = Array.isArray(aud) ? aud : [aud]
    if (!audiences.some((a) => typeof a === 'string' && deps.expectedAudiences?.includes(a))) {
      return fail('wrong_app', 'This link is for a different app.')
    }
  }

  const hook = deps.seedHookUrl
  const url = hook ?? (deps.apiUrl ? `${deps.apiUrl.replace(/\/$/, '')}/api/v1/tokens/redeem` : '')
  if (!url) return fail('not_configured', 'This app has no seed hook set up.')
  const source = hook ? 'The seed hook' : 'Tapthrough'

  deps.onStage?.('seeding')
  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  } catch {
    return fail(
      'network',
      `Couldn't reach ${hook ? 'the seed hook' : 'Tapthrough'}. Check your connection and try again.`,
    )
  }

  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = ErrorResponse.safeParse(body)
    if (error.success) return { ok: false, error: error.data.error }
    return fail(
      hook ? 'seed_hook_failed' : 'redeem_failed',
      `${source} returned ${response.status}.`,
    )
  }
  const seeded = hook ? fromHook(body) : fromRedeem(body)
  if (!seeded.success) {
    if (seeded.error) return { ok: false, error: seeded.error }
    return fail('bad_response', `${source} returned a response this app version cannot read.`)
  }
  if (seeded.data.fixtures && !deps.fixtures) {
    return fail(
      'fixtures_unsupported',
      'This scenario uses fixtures, which this app version cannot load.',
    )
  }

  // Resolve before changing anything, so a bad route leaves the app untouched.
  let path: string
  try {
    path = resolveRoute(seeded.data.route, seeded.data.refs)
  } catch (error) {
    return fail('bad_route', error instanceof Error ? error.message : 'Could not resolve the route')
  }

  // Reset before signing in, so clearing persisted keys can't remove the new session.
  deps.onStage?.('resetting')
  try {
    for (const target of deps.reset ?? []) await target()
  } catch (error) {
    return fail('reset_failed', `Couldn't clear local data: ${messageOf(error)}`)
  }

  try {
    await deps.fixtures?.(seeded.data.fixtures)
  } catch (error) {
    return fail('fixtures_failed', `Couldn't load the fixtures: ${messageOf(error)}`)
  }

  deps.onStage?.('signing_in')
  try {
    await deps.auth.signIn(seeded.data.session)
  } catch (error) {
    return fail('sign_in_failed', `Couldn't sign in as the test user: ${messageOf(error)}`)
  }

  deps.onStage?.('opening')
  deps.applyFlags?.(seeded.data.flags)

  try {
    await deps.navigate(path)
  } catch (error) {
    return fail('navigation_failed', `Couldn't open ${path}: ${messageOf(error)}`)
  }
  return { ok: true, path }
}

type Seeded = { success: true; data: SeedHookResponse } | { success: false; error?: LaunchError }

function fromHook(body: unknown): Seeded {
  const parsed = SeedHookResponse.safeParse(body)
  return parsed.success ? { success: true, data: parsed.data } : { success: false }
}

/** With no seed hook the app redeems the link itself; only fixtures can supply its state. */
function fromRedeem(body: unknown): Seeded {
  const redeemed = RedeemResponse.safeParse(body)
  if (!redeemed.success) return { success: false }
  const { fixtures, route, flags } = redeemed.data
  if (!fixtures) {
    return {
      success: false,
      error: {
        code: 'needs_seed_hook',
        message: 'This scenario needs test data from a seed hook, and this app has none set up.',
      },
    }
  }
  return {
    success: true,
    data: { apiVersion: 1, session: fixtures.session ?? {}, refs: {}, route, flags, fixtures },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
