import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }))

const { redirectSystemPath, handleLaunchPath } = await import('./native-intent.js')
const { controller } = await import('./runtime.js')

describe('redirectSystemPath', () => {
  it('passes ordinary paths through untouched', () => {
    expect(redirectSystemPath({ path: '/notes/12', initial: true })).toBe('/notes/12')
    expect(redirectSystemPath({ path: 'acme://settings', initial: false })).toBe('acme://settings')
  })

  it('swallows launch links: root on a cold start, stay put on a warm one', () => {
    const offer = vi.spyOn(controller, 'offer')
    expect(redirectSystemPath({ path: '/tapthrough/launch?t=cold', initial: true })).toBe('/')
    expect(redirectSystemPath({ path: '/tapthrough/launch?t=warm', initial: false })).toBeNull()
    expect(offer.mock.calls).toEqual([['/tapthrough/launch?t=cold'], ['/tapthrough/launch?t=warm']])
  })

  it('lets apps with their own native intent check for launch paths first', () => {
    expect(handleLaunchPath('/tapthrough/launch?t=mine')).toBe(true)
    expect(handleLaunchPath('/profile')).toBe(false)
  })
})

describe('pluginConfig', () => {
  it('is disabled when the plugin is missing', async () => {
    const { pluginConfig } = await import('./runtime.js')
    expect(pluginConfig()).toEqual({
      enabled: false,
      seedHookUrl: undefined,
      apiUrl: 'https://tapthrough.dev',
    })
  })
})
