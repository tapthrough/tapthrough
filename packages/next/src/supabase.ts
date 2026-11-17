import { createServerClient } from '@supabase/ssr'
import type { ServerAuthAdapter } from './launch.js'

export interface SupabaseSsrAuthOptions {
  /** Project URL, e.g. `process.env.NEXT_PUBLIC_SUPABASE_URL`. */
  url: string
  /** The anon (publishable) key the app's own Supabase clients use. */
  anonKey: string
}

/**
 * Logs in with the `{ access_token, refresh_token }` session that
 * `createTestUser` from `@tapthrough/seed/supabase` returns, by writing the
 * same cookies `@supabase/ssr` writes when a person signs in.
 */
export function supabaseSsrAuth(options: SupabaseSsrAuthOptions): ServerAuthAdapter {
  return {
    async signIn(session, cookies) {
      const { access_token, refresh_token } = session
      if (typeof access_token !== 'string' || typeof refresh_token !== 'string') {
        throw new Error('Seed hook session is missing access_token or refresh_token')
      }
      const client = createServerClient(options.url, options.anonKey, {
        cookies: {
          getAll: () => cookies.getAll(),
          setAll(toSet) {
            for (const { name, value, options: cookieOptions } of toSet) {
              cookies.set(name, value, cookieOptions)
            }
          },
        },
      })
      const { error } = await client.auth.setSession({ access_token, refresh_token })
      if (error) throw new Error(error.message)
    },
  }
}
