import { describe, expect, it } from 'vitest'
import { parseEasUpdateJson } from './eas.js'
import { expoInfoFromConfig } from './expo-config.js'

describe('parseEasUpdateJson', () => {
  it('reads one update per platform, iOS first', () => {
    const json = JSON.stringify([
      { platform: 'android', group: 'g1', runtimeVersion: 'fp-a', id: 'u1' },
      { platform: 'ios', group: 'g1', runtimeVersion: 'fp-i', id: 'u2' },
    ])
    expect(parseEasUpdateJson(json)).toEqual([
      { platform: 'ios', updateGroupId: 'g1', runtimeVersion: 'fp-i' },
      { platform: 'android', updateGroupId: 'g1', runtimeVersion: 'fp-a' },
    ])
  })

  it('rejects empty, malformed and incomplete output', () => {
    expect(() => parseEasUpdateJson('not json')).toThrow('not valid JSON')
    expect(() => parseEasUpdateJson('[]')).toThrow('no updates')
    expect(() => parseEasUpdateJson('[{"platform":"web","group":"g"}]')).toThrow(
      'no iOS or Android',
    )
    expect(() => parseEasUpdateJson('[{"platform":"ios"}]')).toThrow('missing its group')
  })
})

describe('expoInfoFromConfig', () => {
  const config = {
    slug: 'notes',
    scheme: ['acmenotes', 'acme'],
    extra: { eas: { projectId: 'p-1' } },
    ios: { bundleIdentifier: 'com.acme.notes' },
  }

  it('takes the first scheme and the bundle ID', () => {
    expect(expoInfoFromConfig(config)).toEqual({
      projectId: 'p-1',
      slug: 'notes',
      scheme: 'acmenotes',
      appId: 'com.acme.notes',
    })
  })

  it('explains what is missing', () => {
    expect(() => expoInfoFromConfig({ ...config, extra: {} })).toThrow('eas init')
    expect(() => expoInfoFromConfig({ ...config, scheme: undefined })).toThrow('Set `scheme`')
  })
})
