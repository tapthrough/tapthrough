import { Flags } from '@tapthrough/protocol'
import { parseCookies } from './cookies.js'

/** Readable by the page's scripts: it holds no secret, and the Review panel needs it. */
export const STATE_COOKIE = 'tapthrough'
/** A working day; a reviewer who comes back tomorrow opens the link again. */
export const STATE_MAX_AGE_SECONDS = 12 * 60 * 60

/** What the launch left behind for the pages that follow it. */
export interface LaunchedState {
  /** The scenario the reviewer was set up in; reports are attributed to it. */
  scenarioId: string | undefined
  /** Feature flags the scenario forces on or off. */
  flags: Flags
}

export function encodeState(state: LaunchedState): string {
  return JSON.stringify({ v: 1, scn: state.scenarioId, flags: state.flags })
}

export function decodeState(value: string | undefined): LaunchedState | null {
  if (!value) return null
  try {
    const json = JSON.parse(value) as { v?: unknown; scn?: unknown; flags?: unknown }
    if (json.v !== 1) return null
    const flags = Flags.safeParse(json.flags ?? {})
    return {
      scenarioId: typeof json.scn === 'string' ? json.scn : undefined,
      flags: flags.success ? flags.data : {},
    }
  } catch {
    return null
  }
}

/** The launch state from a request's `Cookie` header, or null outside a review. */
export function stateFromCookieHeader(header: string | null | undefined): LaunchedState | null {
  return decodeState(parseCookies(header).find((c) => c.name === STATE_COOKIE)?.value)
}

/**
 * The scenario's value for a flag, or undefined when it doesn't set one. Your
 * flag lookup should check it first, on the server as well as in the browser:
 *
 * ```ts
 * const state = stateFromCookieHeader((await headers()).get('cookie'))
 * const on = flagOverride(state, 'newEditor') ?? flags.newEditor
 * ```
 */
export function flagOverride(
  state: LaunchedState | null,
  name: string,
): boolean | string | undefined {
  return state && Object.hasOwn(state.flags, name) ? state.flags[name] : undefined
}
