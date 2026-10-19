import { ErrorResponse, type Flags, resolveRoute, SeedHookResponse } from '@tapthrough/protocol'
import { decodeTokenClaims } from './feedback.js'

/** Logs the app in with the session the seed hook created. */
export interface AuthAdapter {
  signIn(session: Record<string, unknown>): Promise<void>
}

/** Clears one piece of local state, e.g. a query cache or a persisted store. */
export type ResetTarget = () => void | Promise<void>

export interface LaunchDeps {
  seedHookUrl: string
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
}

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

  let response: Response
  try {
    response = await doFetch(deps.seedHookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  } catch {
    return fail('network', "Couldn't reach the seed hook. Check your connection and try again.")
  }

  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = ErrorResponse.safeParse(body)
    if (error.success) return { ok: false, error: error.data.error }
    return fail('seed_hook_failed', `The seed hook returned ${response.status}.`)
  }
  const seeded = SeedHookResponse.safeParse(body)
  if (!seeded.success) {
    return fail('bad_response', 'The seed hook returned a response this app version cannot read.')
  }

  // Resolve before changing anything, so a bad route leaves the app untouched.
  let path: string
  try {
    path = resolveRoute(seeded.data.route, seeded.data.refs)
  } catch (error) {
    return fail('bad_route', error instanceof Error ? error.message : 'Could not resolve the route')
  }

  // Reset before signing in, so clearing persisted keys can't remove the new session.
  try {
    for (const target of deps.reset ?? []) await target()
  } catch (error) {
    return fail('reset_failed', `Couldn't clear local data: ${messageOf(error)}`)
  }

  try {
    await deps.auth.signIn(seeded.data.session)
  } catch (error) {
    return fail('sign_in_failed', `Couldn't sign in as the test user: ${messageOf(error)}`)
  }

  deps.applyFlags?.(seeded.data.flags)

  try {
    await deps.navigate(path)
  } catch (error) {
    return fail('navigation_failed', `Couldn't open ${path}: ${messageOf(error)}`)
  }
  return { ok: true, path }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
