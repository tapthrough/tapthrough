import { describe, expect, it } from 'vitest'
import {
  affectedRoutes,
  detectFramework,
  nextRoutesFromFiles,
  routesFromFiles,
  shellFiles,
} from './routes.js'

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

describe('nextRoutesFromFiles', () => {
  const files = [
    'src/proxy.ts',
    'src/app/layout.tsx',
    'src/app/page.tsx',
    'src/app/globals.css',
    'src/app/(auth)/login/page.tsx',
    'src/app/(marketplace)/layout.tsx',
    'src/app/(marketplace)/templates/[slug]/page.tsx',
    'src/app/[orgSlug]/page.tsx',
    'src/app/[orgSlug]/loading.tsx',
    'src/app/[orgSlug]/settings/page.tsx',
    'src/app/[orgSlug]/@modal/(.)invite/page.tsx',
    'src/app/[orgSlug]/@panel/page.tsx',
    'src/app/docs/[[...slug]]/page.mdx',
    'src/app/api/health/route.ts',
    'src/app/_components/card.tsx',
    'src/app/_private/page.tsx',
    'src/components/page.tsx',
  ]

  it('maps App Router pages to URL paths', () => {
    expect(nextRoutesFromFiles('src/app', files)).toEqual([
      { path: '/', file: 'src/app/page.tsx' },
      { path: '/[orgSlug]', file: 'src/app/[orgSlug]/page.tsx' },
      { path: '/[orgSlug]/settings', file: 'src/app/[orgSlug]/settings/page.tsx' },
      { path: '/docs/[...slug]', file: 'src/app/docs/[[...slug]]/page.mdx' },
      { path: '/login', file: 'src/app/(auth)/login/page.tsx' },
      { path: '/templates/[slug]', file: 'src/app/(marketplace)/templates/[slug]/page.tsx' },
    ])
  })

  it('lists a slot page when no plain page has its URL', () => {
    expect(nextRoutesFromFiles('app', ['app/@feed/latest/page.tsx'])).toEqual([
      { path: '/latest', file: 'app/@feed/latest/page.tsx' },
    ])
  })

  it('finds layouts and the request proxy', () => {
    expect(shellFiles('next-app', '', 'src/app', files)).toEqual([
      'src/proxy.ts',
      'src/app/layout.tsx',
      'src/app/(marketplace)/layout.tsx',
      'src/app/[orgSlug]/loading.tsx',
    ])
    expect(
      shellFiles('next-app', 'apps/web', 'apps/web/app', [
        'middleware.ts',
        'apps/web/middleware.ts',
        'apps/web/app/layout.tsx',
        'apps/web/lib/layout.tsx',
      ]),
    ).toEqual(['apps/web/middleware.ts', 'apps/web/app/layout.tsx'])
  })

  it('finds Expo Router layouts', () => {
    expect(
      shellFiles('expo-router', '', 'src/app', [
        'src/app/_layout.tsx',
        'src/app/+native-intent.ts',
        'src/app/layout.tsx',
        'src/components/_layout.tsx',
      ]),
    ).toEqual(['src/app/_layout.tsx', 'src/app/+native-intent.ts'])
  })
})

describe('detectFramework', () => {
  it('reads the router from package.json', () => {
    expect(detectFramework('{"dependencies":{"next":"16.2.6","react":"19"}}')).toBe('next-app')
    expect(detectFramework('{"dependencies":{"expo":"58","expo-router":"58"}}')).toBe('expo-router')
    // An Expo app with a Next.js site in the same package is still an Expo app.
    expect(detectFramework('{"dependencies":{"expo":"58","next":"16"}}')).toBe('expo-router')
    expect(detectFramework('{"dependencies":{"react":"19"}}')).toBeNull()
    expect(detectFramework('not json')).toBeNull()
    expect(detectFramework(null)).toBeNull()
  })
})
