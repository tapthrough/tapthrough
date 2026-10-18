import type { AuthAdapter } from './core/launch.js'

interface SupabaseAuthClient {
  auth: {
    setSession(session: {
      access_token: string
      refresh_token: string
    }): Promise<{ error: { message: string } | null }>
  }
}

/**
 * Logs in with the `{ access_token, refresh_token }` session that
 * `createTestUser` from `@tapthrough/seed/supabase` returns.
 */
export function supabaseAuth(client: SupabaseAuthClient): AuthAdapter {
  return {
    async signIn(session) {
      const { access_token, refresh_token } = session
      if (typeof access_token !== 'string' || typeof refresh_token !== 'string') {
        throw new Error('Seed hook session is missing access_token or refresh_token')
      }
      const { error } = await client.auth.setSession({ access_token, refresh_token })
      if (error) throw new Error(error.message)
    },
  }
}
