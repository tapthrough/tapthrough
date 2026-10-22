import { LibraryScenario, type ScenarioSpec } from '@tapthrough/protocol'
import { describe, expect, it } from 'vitest'
import { buildMap, formatMap, routeParams } from './map.js'
import { routesFromFiles } from './routes.js'

const routes = routesFromFiles('src/app', [
  'src/app/_layout.tsx',
  'src/app/index.tsx',
  'src/app/notes/[id]/edit.tsx',
  'src/app/settings.tsx',
])

const sources = new Map([
  [
    'src/app/index.tsx',
    "import { NoteRow } from '@/components/note-row'\nimport React from 'react'",
  ],
  ['src/app/notes/[id]/edit.tsx', "import { NoteForm } from '../../../components/note-form'"],
  ['src/app/settings.tsx', ''],
  ['src/components/note-row.tsx', ''],
  ['src/components/note-form.tsx', ''],
])
const aliases = [{ prefix: '@/', target: 'src/' }]

function scenario(key: string, path: string, preset?: string): ScenarioSpec {
  return {
    ...LibraryScenario.parse({
      title: key,
      route: { path },
      seed: preset ? { tier: 2, preset } : { tier: 0 },
    }),
    key,
  }
}

describe('routeParams', () => {
  it('names dynamic and catch-all segments', () => {
    expect(routeParams('/notes/[id]/edit')).toEqual(['id'])
    expect(routeParams('/docs/[...slug]')).toEqual(['slug'])
    expect(routeParams('/')).toEqual([])
  })
})

describe('buildMap', () => {
  const map = buildMap({
    appDir: 'src/app',
    routes,
    sources,
    aliases,
    scenarios: [
      scenario('notes-list', '/', 'user-with-notes'),
      scenario('empty-list', '/', 'empty-account'),
      scenario('old', '/archive'),
    ],
  })

  it('lists every screen with its scenarios, params and direct imports', () => {
    expect(map.screens).toEqual([
      {
        path: '/',
        file: 'src/app/index.tsx',
        params: [],
        scenarios: ['notes-list', 'empty-list'],
        uses: ['src/components/note-row.tsx'],
      },
      {
        path: '/notes/[id]/edit',
        file: 'src/app/notes/[id]/edit.tsx',
        params: ['id'],
        scenarios: [],
        uses: ['src/components/note-form.tsx'],
      },
      { path: '/settings', file: 'src/app/settings.tsx', params: [], scenarios: [], uses: [] },
    ])
  })

  it('collects presets in use and scenarios that point nowhere', () => {
    expect(map.presets).toEqual(['empty-account', 'user-with-notes'])
    expect(map.orphans).toEqual([{ key: 'old', path: '/archive' }])
  })

  it('tells the reader what to write next', () => {
    const text = formatMap(map)
    expect(text).toContain('3 screens in src/app, 1 with scenarios')
    expect(text).toContain('Screens without a scenario (2):')
    expect(text).toContain('params: id')
    expect(text).toContain('old: /archive')
    expect(text).toContain('npx @tapthrough/cli check')
  })

  it('explains when there is no Expo Router app', () => {
    const empty = buildMap({ appDir: null, routes: [], sources, aliases, scenarios: [] })
    expect(formatMap(empty)).toContain('No Expo Router app found')
  })
})
