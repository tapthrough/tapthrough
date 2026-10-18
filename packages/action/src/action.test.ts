import { describe, expect, it } from 'vitest'
import { parseEasUpdateJson } from './eas.js'
import { expoInfoFromConfig } from './expo-config.js'
import { affectedRoutes, routesFromFiles } from './routes.js'

describe('routesFromFiles', () => {
  const files = [
    'src/app/_layout.tsx',
    'src/app/index.tsx',
    'src/app/+native-intent.ts',
    'src/app/+not-found.tsx',
    'src/app/settings.tsx',
    'src/app/settings.web.tsx',
    'src/app/(tabs)/_layout.tsx',
    'src/app/(tabs)/archive.tsx',
    'src/app/notes/new.tsx',
    'src/app/notes/[id]/index.tsx',
    'src/app/notes/[id]/edit.tsx',
    'src/app/api/health+api.ts',
    'src/app/_components/card.tsx',
    'src/app/styles.css',
    'src/components/button.tsx',
  ]

  it('maps Expo Router files to URL paths', () => {
    expect(routesFromFiles('src/app', files)).toEqual([
      { path: '/', file: 'src/app/index.tsx' },
      { path: '/archive', file: 'src/app/(tabs)/archive.tsx' },
      { path: '/notes/[id]', file: 'src/app/notes/[id]/index.tsx' },
      { path: '/notes/[id]/edit', file: 'src/app/notes/[id]/edit.tsx' },
      { path: '/notes/new', file: 'src/app/notes/new.tsx' },
      { path: '/settings', file: 'src/app/settings.tsx' },
    ])
  })

  it('handles an app directory inside a monorepo package', () => {
    expect(routesFromFiles('apps/mobile/app/', ['apps/mobile/app/index.tsx'])).toEqual([
      { path: '/', file: 'apps/mobile/app/index.tsx' },
    ])
  })

  it('marks routes whose own file changed', () => {
    const routes = routesFromFiles('src/app', files)
    expect(
      affectedRoutes(routes, ['src/app/notes/[id]/edit.tsx', 'src/components/button.tsx']),
    ).toEqual([{ path: '/notes/[id]/edit', distance: 0, via: 'src/app/notes/[id]/edit.tsx' }])
  })
})

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
