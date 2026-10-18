import { beforeEach, describe, expect, it, vi } from 'vitest'

const createUser = vi.fn()
const signInWithPassword = vi.fn()
const createClient = vi.fn((_url: string, key: string) => ({
  key,
  auth: { admin: { createUser }, signInWithPassword },
}))

vi.mock('@supabase/supabase-js', () => ({ createClient }))

const { createTestUser } = await import('./supabase.js')

const options = { url: 'https://ref.supabase.co', serviceRoleKey: 'service', anonKey: 'anon' }

describe('createTestUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createUser.mockImplementation(async (attributes: { email: string }) => ({
      data: { user: { id: 'user-1', email: attributes.email } },
      error: null,
    }))
    signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } },
      error: null,
    })
  })

  it('creates a confirmed user, signs in with the anon key and returns only the tokens', async () => {
    const result = await createTestUser({ ...options, userMetadata: { name: 'Priya' } })

    const [attributes] = createUser.mock.calls[0] ?? []
    expect(attributes).toMatchObject({
      email_confirm: true,
      user_metadata: { name: 'Priya', tapthrough: true },
    })
    expect(attributes.email).toMatch(/^tt-[0-9a-f-]{36}@tapthrough\.test$/)
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: attributes.email,
      password: attributes.password,
    })
    expect(createClient.mock.calls.map(([, key]) => key)).toEqual(['service', 'anon'])
    expect(result.session).toEqual({ access_token: 'at', refresh_token: 'rt' })
    expect(result.user.id).toBe('user-1')
  })

  it('uses a fresh email and password every time', async () => {
    await createTestUser(options)
    await createTestUser(options)
    const [first, second] = createUser.mock.calls.map(([attributes]) => attributes)
    expect(first.email).not.toBe(second.email)
    expect(first.password).not.toBe(second.password)
  })

  it('surfaces Supabase errors', async () => {
    createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'signups disabled' },
    })
    await expect(createTestUser(options)).rejects.toThrow('signups disabled')

    signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'bad creds' },
    })
    await expect(createTestUser(options)).rejects.toThrow('bad creds')
  })
})
