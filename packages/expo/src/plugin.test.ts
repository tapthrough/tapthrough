import { describe, expect, it } from 'vitest'
import withTapthrough from '../app.plugin.js'

const base = {
  name: 'Notes',
  slug: 'notes',
  scheme: 'acmenotes',
  extra: { eas: { projectId: 'p' } },
}
const seedHookUrl = 'https://ref.supabase.co/functions/v1/tapthrough-seed'

describe('config plugin', () => {
  it('writes the settings into extra.tapthrough and keeps other extra keys', () => {
    const config = withTapthrough(base, { seedHookUrl })
    expect(config.extra).toEqual({
      eas: { projectId: 'p' },
      tapthrough: { enabled: true, seedHookUrl, apiUrl: 'https://tapthrough.dev' },
    })
  })

  it('drops the URL when disabled, so store builds carry nothing', () => {
    const config = withTapthrough(base, { enabled: false, seedHookUrl })
    expect(config.extra?.tapthrough).toEqual({ enabled: false, seedHookUrl: undefined })
  })

  it('requires a seed hook URL and a scheme when enabled', () => {
    expect(() => withTapthrough(base, {})).toThrow('`seedHookUrl` is required')
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
})
