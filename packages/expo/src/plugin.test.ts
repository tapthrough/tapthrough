import { describe, expect, it } from 'vitest'
import withTapthrough from '../app.plugin.js'

const base = {
  name: 'Notes',
  slug: 'notes',
  scheme: 'acmenotes',
  extra: { eas: { projectId: 'p' } },
}
const seedHookUrl = 'https://ref.supabase.co/functions/v1/tapthrough-seed'
const appKey = 'eyJ.example.key'

describe('config plugin', () => {
  it('writes the settings into extra.tapthrough and keeps other extra keys', () => {
    const config = withTapthrough(base, { seedHookUrl })
    expect(config.extra).toEqual({
      eas: { projectId: 'p' },
      tapthrough: { enabled: true, seedHookUrl, apiUrl: 'https://tapthrough-cloud.vercel.app' },
    })
  })

  it('drops the URLs and key when off, so store builds carry nothing', () => {
    const config = withTapthrough(base, { enabled: false, seedHookUrl, appKey })
    expect(config.extra?.tapthrough).toEqual({ enabled: false, seedHookUrl: undefined })
  })

  it('works without a seed hook, and requires a scheme when enabled', () => {
    expect(() => withTapthrough(base, {})).not.toThrow()
    expect(() => withTapthrough({ ...base, scheme: undefined }, { seedHookUrl })).toThrow(
      'Set `scheme`',
    )
  })

  it('allows plain http only for local development hosts', () => {
    for (const url of ['http://localhost:54321/functions/v1/seed', 'http://10.0.2.2:54321/seed']) {
      expect(() => withTapthrough(base, { seedHookUrl: url })).not.toThrow()
    }
    for (const url of ['http://staging.acme.com/seed', 'not a url', 'ftp://x/seed']) {
      expect(() => withTapthrough(base, { seedHookUrl: url })).toThrow('must be https')
    }
  })

  it('writes the app key only for staff builds, and requires one', () => {
    const config = withTapthrough(base, { enabled: false, staff: true, appKey })
    expect(config.extra?.tapthrough).toEqual({
      enabled: false,
      seedHookUrl: undefined,
      apiUrl: 'https://tapthrough-cloud.vercel.app',
      staff: true,
      appKey,
    })
    expect(() => withTapthrough(base, { enabled: false, staff: true })).toThrow('needs an `appKey`')
  })
})
