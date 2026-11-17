import { type LaunchError, runLaunch, scenarioIdFromToken } from '@tapthrough/core'
import type { Flags } from '@tapthrough/protocol'
import { type CookieJar, createCookieJar } from './cookies.js'
import { type Env, previewEnv } from './env.js'
import { encodeState, STATE_COOKIE, STATE_MAX_AGE_SECONDS } from './state.js'

/** Logs the browser in with the session the seed hook created, by setting cookies. */
export interface ServerAuthAdapter {
  signIn(session: Record<string, unknown>, cookies: CookieJar): Promise<void>
}

export interface LaunchRouteOptions {
  /** The app ID registered with Tapthrough. Links made for any other app are refused. */
  appId: string
  /**
   * The seed hook: its URL, or the handler itself (`createSeedHandler(...)` from
   * `@tapthrough/seed`) when it lives in this app, which saves a network hop.
   */
  seed: string | ((request: Request) => Promise<Response>)
  /**
   * How to log in with the seeded session, e.g. `supabaseSsrAuth(...)` from
   * `@tapthrough/next/supabase`. Leave it out if the app has no login.
   */
  auth?: ServerAuthAdapter
  /** Cookies to remove before logging in, e.g. a saved workspace or a dismissed banner. */
  clearCookies?: string[]
  /** Overrides where the route is on. Defaults to preview deployments only; see `previewEnv`. */
  enabled?: boolean
  /** Defaults to `process.env`. */
  env?: Env
}

const NO_STORE = { 'Cache-Control': 'no-store' }

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

function errorPage(error: LaunchError, status: number): Response {
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Couldn't open this preview</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; background: #111; color: #fff; }
  main { max-width: 28rem; padding: 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0 0 .5rem; color: #d4d4d4; }
  code { color: #8ab4ff; }
</style>
<main>
  <h1>Couldn't open this preview</h1>
  <p>${escapeHtml(error.message)}</p>
  <p>Go back to the pull request and open the link again. <code>${escapeHtml(error.code)}</code></p>
</main>
</html>`
  return new Response(html, {
    status,
    headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

const STATUS: Record<string, number> = {
  missing_token: 400,
  wrong_app: 403,
  network: 502,
  seed_hook_failed: 502,
  bad_response: 502,
}

/**
 * The route a Tapthrough link opens. It asks the seed hook for a test user,
 * logs the browser in with cookies, remembers the scenario's flags, and
 * redirects to the scenario's page. Use it as `app/api/tapthrough/launch/route.ts`:
 *
 * ```ts
 * export const GET = createLaunchRoute({ appId: 'app.acme.com', seed, auth })
 * ```
 *
 * Outside preview deployments it answers 404, as if it weren't there.
 */
export function createLaunchRoute(
  options: LaunchRouteOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const env = options.env ?? (globalThis as { process?: { env: Env } }).process?.env ?? {}
    const enabled = options.enabled ?? previewEnv(env).enabled
    // A Vercel production deployment stays off even when `enabled` is passed by mistake.
    if (!enabled || env.VERCEL_ENV === 'production') {
      return new Response('Not found', { status: 404, headers: NO_STORE })
    }

    const url = new URL(request.url)
    const token = url.searchParams.get('t')
    if (!token) {
      return errorPage({ code: 'missing_token', message: 'This link is incomplete.' }, 400)
    }

    const jar = createCookieJar(request.headers.get('cookie'))
    let flags: Flags = {}
    const { seed } = options
    const result = await runLaunch(token, {
      seedHookUrl: typeof seed === 'string' ? seed : new URL('/api/tapthrough/seed', url).href,
      ...(typeof seed === 'function'
        ? { fetch: (input, init) => seed(new Request(input as string | URL, init)) }
        : {}),
      expectedAudiences: [options.appId],
      reset: [
        () => {
          for (const name of options.clearCookies ?? []) jar.set(name, '', { maxAge: 0 })
        },
      ],
      auth: { signIn: (session) => options.auth?.signIn(session, jar) ?? Promise.resolve() },
      applyFlags: (next) => {
        flags = next
      },
      // The redirect below does the navigating.
      navigate: () => {},
    })
    if (!result.ok) return errorPage(result.error, STATUS[result.error.code] ?? 500)

    // `//host` and `/\host` leave the site in some browsers; a scenario's page never starts that way.
    if (!result.path.startsWith('/') || /^\/[/\\]/.test(result.path)) {
      return errorPage(
        { code: 'bad_route', message: `"${result.path}" isn't a page in this app.` },
        500,
      )
    }

    jar.set(STATE_COOKIE, encodeState({ scenarioId: scenarioIdFromToken(token), flags }), {
      maxAge: STATE_MAX_AGE_SECONDS,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
    })
    const headers = new Headers({ ...NO_STORE, Location: result.path })
    for (const cookie of jar.headers()) headers.append('Set-Cookie', cookie)
    // 303: the browser follows with a GET, whatever opened the link.
    return new Response(null, { status: 303, headers })
  }
}
