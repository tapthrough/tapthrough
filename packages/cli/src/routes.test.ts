import { describe, expect, it } from 'vitest'
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
