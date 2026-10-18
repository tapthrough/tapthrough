import type { AffectedRoute, RouteEntry } from '@tapthrough/protocol'

const SCREEN_FILE = /\.(tsx|ts|jsx|js)$/
const PLATFORM_SUFFIX = /\.(ios|android|native|web)$/

/**
 * Expo Router screens from the files under the app directory (paths relative
 * to the repo root). Layouts, `+` files (not-found, native-intent, html, API
 * routes) and `_` files aren't screens. Groups like `(tabs)` don't appear in
 * the URL, `index` is its folder's path, and platform variants collapse.
 */
export function routesFromFiles(appDir: string, files: string[]): RouteEntry[] {
  const prefix = `${appDir.replace(/\/$/, '')}/`
  const byPath = new Map<string, RouteEntry>()

  for (const file of [...files].sort()) {
    if (!file.startsWith(prefix) || !SCREEN_FILE.test(file)) continue
    const segments = file
      .slice(prefix.length)
      .replace(SCREEN_FILE, '')
      .replace(PLATFORM_SUFFIX, '')
      .split('/')
    const name = segments.at(-1) ?? ''
    if (segments.some((s) => s.startsWith('_') || s.startsWith('+') || s.includes('+api'))) continue
    if (name === '' || name.startsWith('(')) continue

    const urlSegments = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    if (urlSegments.at(-1) === 'index') urlSegments.pop()
    const path = `/${urlSegments.join('/')}`
    if (!byPath.has(path)) byPath.set(path, { path, file })
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Routes whose own file changed (distance 0). Import-graph tracing for shared
 * components comes later; a changed component reaches no route here yet.
 */
export function affectedRoutes(routes: RouteEntry[], changedFiles: string[]): AffectedRoute[] {
  const changed = new Set(changedFiles)
  return routes
    .filter((route) => changed.has(route.file))
    .map((route) => ({ path: route.path, distance: 0, via: route.file }))
}
