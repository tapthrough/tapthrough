import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

export interface CreateTestUserOptions {
  /** Project URL, e.g. `https://<ref>.supabase.co`. */
  url: string
  /** Service role key; creates the user. Keep it in the seed hook's secrets only. */
  serviceRoleKey: string
  /** Anon key; signs the user in, the same way the app would. */
  anonKey: string
  /** Defaults to `tapthrough.test`, a reserved domain that never receives mail. */
  emailDomain?: string
  userMetadata?: Record<string, unknown>
  appMetadata?: Record<string, unknown>
}

export interface TestUser {
  user: User
  /** Pass straight through as the preset's `session`; the SDK's Supabase adapter expects this shape. */
  session: { access_token: string; refresh_token: string }
  /** Service-role client for inserting the preset's data. Bypasses row-level security. */
  admin: SupabaseClient
}

/**
 * Creates a fresh, confirmed user with a random password and signs them in.
 * One user per link open keeps reviewers from seeing each other's changes.
 */
export async function createTestUser(options: CreateTestUserOptions): Promise<TestUser> {
  const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  const admin = createClient(options.url, options.serviceRoleKey, { auth })
  const email = `tt-${crypto.randomUUID()}@${options.emailDomain ?? 'tapthrough.test'}`
  const password = `${crypto.randomUUID()}${crypto.randomUUID()}`

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { ...options.userMetadata, tapthrough: true },
    ...(options.appMetadata ? { app_metadata: options.appMetadata } : {}),
  })
  if (created.error || !created.data.user) {
    throw new Error(`Could not create test user: ${created.error?.message ?? 'no user returned'}`)
  }

  const client = createClient(options.url, options.anonKey, { auth })
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error || !signedIn.data.session) {
    throw new Error(`Could not sign in test user: ${signedIn.error?.message ?? 'no session'}`)
  }

  const { access_token, refresh_token } = signedIn.data.session
  return { user: created.data.user, session: { access_token, refresh_token }, admin }
}
