import type { Env } from './env.js'
import type { ServerAuthAdapter } from './launch.js'

export interface AuthJsAuthOptions {
  /**
   * Picks the encoded session token out of the seed hook's session. Defaults to
   * its `sessionToken`, `accessToken` or `token`, whichever is a string first.
   */
  token?: (session: Record<string, unknown>) => unknown
  /**
   * The session cookie's name, if the app's Auth.js config changes it. By
   * default it's what Auth.js v5 uses: `authjs.session-token`, with the
   * `__Secure-` prefix on https.
   */
  cookieName?: string
  /** How long the browser keeps the cookie, in seconds. Defaults to a session cookie. */
  maxAge?: number
  /** Defaults to `process.env`; `AUTH_URL` and `NEXTAUTH_URL` are read from it. */
  env?: Env
}

/**
 * Auth.js names its session cookie after the protocol of `AUTH_URL` (or
 * `NEXTAUTH_URL`) when one is set, else the request's. The name is also the
 * salt the token is encrypted with, so the seed hook must encode the token for
 * the same name.
 */
export function authJsCookieName(requestProtocol: string, env: Env = {}): string {
  let protocol = requestProtocol
  const configured = env.AUTH_URL ?? env.NEXTAUTH_URL
  if (configured) {
    try {
      protocol = new URL(configured).protocol
    } catch {
      // Not a URL; Auth.js falls back to the request too.
    }
  }
  return protocol === 'https:' ? '__Secure-authjs.session-token' : 'authjs.session-token'
}

/**
 * Logs in an app that uses Auth.js (NextAuth v5) with JWT sessions, by setting
 * the session cookie to a token the seed hook encoded with the app's own
 * `AUTH_SECRET`, e.g. with `encode` from `next-auth/jwt`.
 */
export function authJsAuth(options: AuthJsAuthOptions = {}): ServerAuthAdapter {
  return {
    async signIn(session, cookies, request) {
      const picked = options.token
        ? options.token(session)
        : [session.sessionToken, session.accessToken, session.token].find(
            (value) => typeof value === 'string',
          )
      // A token with these in it would be cut short or split into two cookies.
      if (typeof picked !== 'string' || picked === '' || /[\s;,]/.test(picked)) {
        throw new Error('Seed hook session has no session token')
      }
      const env = options.env ?? (globalThis as { process?: { env: Env } }).process?.env ?? {}
      const name = options.cookieName ?? authJsCookieName(new URL(request.url).protocol, env)
      // A session left over from the reviewer's own login may be split into `.0`, `.1` chunks.
      for (const cookie of cookies.getAll()) {
        if (cookie.name.startsWith(`${name}.`)) {
          // A browser ignores a `__Secure-` cookie set without `Secure`, deletions included.
          cookies.set(cookie.name, '', { maxAge: 0, secure: name.startsWith('__Secure-') })
        }
      }
      cookies.set(name, picked, {
        httpOnly: true,
        sameSite: 'lax',
        secure: name.startsWith('__Secure-'),
        ...(options.maxAge !== undefined ? { maxAge: options.maxAge } : {}),
      })
    },
  }
}
