import { parseLibrary, parsePlanFile } from '@tapthrough/protocol'
import { describe, expect, it } from 'vitest'
import { checkScenarios, formatIssues } from './check.js'
import { routesFromFiles } from './routes.js'

const routes = routesFromFiles('app', [
  'app/index.tsx',
  'app/(tabs)/archive.tsx',
  'app/notes/[id].tsx',
])

function file(name: string, value: unknown) {
  return { name, text: typeof value === 'string' ? value : JSON.stringify(value) }
}

describe('checkScenarios', () => {
  it('passes scenarios that open real screens with every param filled', () => {
    const library = parseLibrary([
      file('home.json', { title: 'Home', route: { path: '/' }, seed: { tier: 0 } }),
      file('note.json', {
        title: 'Note',
        route: { path: '/notes/[id]', params: { id: '$seed.notes[0].id' } },
        seed: { tier: 2, preset: 'user-with-notes' },
      }),
    ])
    expect(checkScenarios({ routes, library, plans: [] })).toEqual([])
    expect(formatIssues([], 2)).toBe('2 scenarios checked, no problems.')
  })

  it('reports bad files, unknown routes, groups and missing params', () => {
    const library = parseLibrary([
      file('broken.json', '{ nope'),
      file('tabs.json', {
        title: 'Archive',
        route: { path: '/(tabs)/archive' },
        seed: { tier: 0 },
      }),
      file('note.json', { title: 'Note', route: { path: '/notes/[id]' }, seed: { tier: 0 } }),
    ])
    const issues = checkScenarios({ routes, library, plans: [] })
    expect(issues).toEqual([
      { file: '.tapthrough/scenarios/broken.json', message: 'not valid JSON' },
      {
        file: '.tapthrough/scenarios/tabs.json',
        message:
          'route "/(tabs)/archive" isn\'t a screen in the app. Leave out groups like (tabs).',
      },
      { file: '.tapthrough/scenarios/note.json', message: 'route.params is missing "id"' },
    ])
    expect(formatIssues(issues, 2)).toMatch(/^3 problems:/)
  })

  it('checks plan files, including library keys they include', () => {
    const library = parseLibrary([
      file('home.json', { title: 'Home', route: { path: '/' }, seed: { tier: 0 } }),
    ])
    const plans = [
      {
        file: '.tapthrough/plans/12.json',
        result: parsePlanFile(
          JSON.stringify({
            include: ['home', 'gone'],
            scenarios: [{ key: 'x', title: 'X', route: { path: '/nope' }, seed: { tier: 0 } }],
          }),
        ),
      },
      { file: '.tapthrough/plans/13.json', result: parsePlanFile('{}') },
    ]
    expect(checkScenarios({ routes, library, plans }).map((i) => i.message)).toEqual([
      'include "gone" isn\'t in the library',
      'x: route "/nope" isn\'t a screen in the app. Run `npx @tapthrough/cli map` to list the screens.',
      'add at least one scenario or an include',
    ])
  })
})
