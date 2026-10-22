import type { RouteEntry, ScenarioSpec } from '@tapthrough/protocol'
import { type Aliases, importSpecifiers, resolveImport } from './imports.js'

/** One Expo Router screen and the scenarios that open it. */
export interface Screen {
  path: string
  file: string
  /** Dynamic segments a scenario has to fill, e.g. `id` for `/notes/[id]`. */
  params: string[]
  /** Library scenario keys whose route is this screen. */
  scenarios: string[]
  /** Repo files the screen imports directly: where to look for what it shows. */
  uses: string[]
}

export interface ScreenMap {
  appDir: string | null
  screens: Screen[]
  /** Seed presets the library already uses, so new scenarios reuse them. */
  presets: string[]
  /** Scenarios whose route isn't a screen in the app. */
  orphans: { key: string; path: string }[]
}

export function routeParams(routePath: string): string[] {
  return [...routePath.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map((match) => match[1] as string)
}

export function buildMap(input: {
  appDir: string | null
  routes: RouteEntry[]
  scenarios: ScenarioSpec[]
  sources: Map<string, string>
  aliases: Aliases
}): ScreenMap {
  const files = new Set(input.sources.keys())
  const known = new Set(input.routes.map((route) => route.path))

  const screens = input.routes.map((route) => {
    const source = input.sources.get(route.file) ?? ''
    const uses = importSpecifiers(source)
      .map((specifier) => resolveImport(specifier, route.file, files, input.aliases))
      .filter((file): file is string => file !== undefined)
    return {
      path: route.path,
      file: route.file,
      params: routeParams(route.path),
      scenarios: input.scenarios.filter((s) => s.route.path === route.path).map((s) => s.key),
      uses: [...new Set(uses)].sort(),
    }
  })

  const presets = new Set<string>()
  for (const scenario of input.scenarios) {
    if (scenario.seed.preset) presets.add(scenario.seed.preset)
  }

  return {
    appDir: input.appDir,
    screens,
    presets: [...presets].sort(),
    orphans: input.scenarios
      .filter((scenario) => !known.has(scenario.route.path))
      .map((scenario) => ({ key: scenario.key, path: scenario.route.path })),
  }
}

const DOCS = 'https://github.com/tapthrough/tapthrough/blob/main/docs/plan-files.md'

function pad(text: string, width: number) {
  return text.length >= width ? `${text}  ` : text.padEnd(width)
}

/** The map as text for a person or a coding agent: what's covered, and what to write next. */
export function formatMap(map: ScreenMap): string {
  if (!map.appDir) {
    return 'No Expo Router app found here (looked for src/app and app). Run this in the app directory, or pass --dir.'
  }
  const covered = map.screens.filter((screen) => screen.scenarios.length > 0)
  const missing = map.screens.filter((screen) => screen.scenarios.length === 0)
  const pathWidth = Math.max(...map.screens.map((s) => s.path.length), 6) + 2
  const fileWidth = Math.max(...map.screens.map((s) => s.file.length), 4) + 2

  const lines = [
    `${map.screens.length} screens in ${map.appDir}, ${covered.length} with scenarios`,
    '',
    ...map.screens.map(
      (screen) =>
        `  ${pad(screen.path, pathWidth)}${pad(screen.file, fileWidth)}${
          screen.scenarios.length > 0 ? screen.scenarios.join(', ') : '(none)'
        }`,
    ),
  ]

  if (missing.length > 0) {
    lines.push('', `Screens without a scenario (${missing.length}):`)
    for (const screen of missing) {
      lines.push('', `  ${screen.path}`, `    file: ${screen.file}`)
      if (screen.params.length > 0) {
        lines.push(
          `    params: ${screen.params.join(', ')} (fill each from seed data, e.g. "$seed.items[0].id")`,
        )
      }
      if (screen.uses.length > 0) lines.push(`    uses: ${screen.uses.join(', ')}`)
    }
  }

  if (map.orphans.length > 0) {
    lines.push('', 'Scenarios that point at no screen:')
    for (const orphan of map.orphans) lines.push(`  ${orphan.key}: ${orphan.path}`)
  }

  lines.push(
    '',
    map.presets.length > 0
      ? `Seed presets in use: ${map.presets.join(', ')}`
      : 'No seed presets in use yet. Use { "tier": 0 } for a shared test account, or add a seed hook.',
  )
  if (missing.length > 0) {
    lines.push(
      '',
      'Next: write .tapthrough/scenarios/<key>.json for each screen above, then run',
      '`npx @tapthrough/cli check`.',
      `Format: ${DOCS}`,
    )
  }
  return lines.join('\n')
}
