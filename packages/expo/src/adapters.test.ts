import { describe, expect, it, vi } from 'vitest'
import {
  getFlagOverride,
  getFlagOverrides,
  setFlagOverrides,
  subscribeToFlagOverrides,
} from './core/flags.js'
import { resetQueryClient, resetStorage, resetStores } from './core/reset.js'
import { supabaseAuth } from './supabase.js'

describe('flag overrides', () => {
  it('replaces all overrides and notifies subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToFlagOverrides(listener)
    setFlagOverrides({ newEditor: true, theme: 'dark' })
    setFlagOverrides({ newEditor: false })
    unsubscribe()
    setFlagOverrides({})

    expect(listener).toHaveBeenCalledTimes(2)
    expect(getFlagOverrides()).toEqual({})
  })

  it('returns undefined for unset flags, including inherited object keys', () => {
    setFlagOverrides({ newEditor: false })
    expect(getFlagOverride('newEditor')).toBe(false)
    expect(getFlagOverride('missing')).toBeUndefined()
    expect(getFlagOverride('toString')).toBeUndefined()
  })

  it('cannot be mutated from outside', () => {
    setFlagOverrides({ a: true })
    expect(() => {
      ;(getFlagOverrides() as Record<string, unknown>).a = false
    }).toThrow()
  })
})

describe('reset helpers', () => {
  it('clears a query client', async () => {
    const queryClient = { clear: vi.fn() }
    await resetQueryClient(queryClient)()
    expect(queryClient.clear).toHaveBeenCalledOnce()
  })

  it('removes only the listed storage keys', async () => {
    const storage = { removeItem: vi.fn(async (_key: string) => {}) }
    await resetStorage(storage, ['notes-store', 'drafts'])()
    expect(storage.removeItem.mock.calls).toEqual([['notes-store'], ['drafts']])
  })

  it('replaces each store with its initial state', async () => {
    const store = { getInitialState: () => ({ count: 0 }), setState: vi.fn() }
    await resetStores([store])()
    expect(store.setState).toHaveBeenCalledWith({ count: 0 }, true)
  })
})

describe('supabaseAuth', () => {
  it('sets the session from the seed hook', async () => {
    const setSession = vi.fn(async () => ({ error: null }))
    await supabaseAuth({ auth: { setSession } }).signIn({ access_token: 'at', refresh_token: 'rt' })
    expect(setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' })
  })

  it('rejects a session without tokens and surfaces Supabase errors', async () => {
    const setSession = vi.fn(async () => ({ error: { message: 'Invalid Refresh Token' } }))
    const auth = supabaseAuth({ auth: { setSession } })
    await expect(auth.signIn({ access_token: 'at' })).rejects.toThrow('missing access_token')
    await expect(auth.signIn({ access_token: 'at', refresh_token: 'rt' })).rejects.toThrow(
      'Invalid Refresh Token',
    )
  })
})
