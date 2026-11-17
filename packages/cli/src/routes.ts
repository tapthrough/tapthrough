import type { AffectedRoute, Framework, RouteEntry } from '@tapthrough/protocol'

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

const NEXT_PAGE = /(^|\/)page\.(tsx|ts|jsx|js|mdx|md)$/
/** `(.)photo`, `(..)photo`, `(...)photo`: a route shown inside another route's layout. */
const INTERCEPTING = /^\(\.{1,3}\)/

/**
 * Next.js App Router screens from the files under the app directory (paths
 * relative to the repo root). Only `page` files are screens. Groups like
 * `(marketing)` and slots like `@modal` don't appear in the URL, `_private`
 * folders and intercepting routes are skipped, and an optional catch-all
 * `[[...slug]]` is listed as `[...slug]`.
 */
export function nextRoutesFromFiles(appDir: string, files: string[]): RouteEntry[] {
  const prefix = `${appDir.replace(/\/$/, '')}/`
  const byPath = new Map<string, RouteEntry>()

  for (const file of [...files].sort()) {
    if (!file.startsWith(prefix) || !NEXT_PAGE.test(file)) continue
    const segments = file.slice(prefix.length).split('/').slice(0, -1)
    if (segments.some((s) => s.startsWith('_') || INTERCEPTING.test(s))) continue

    const urlSegments = segments
      .filter((s) => !(s.startsWith('(') && s.endsWith(')')) && !s.startsWith('@'))
      .map((s) => s.replace(/^\[\[(\.\.\.[^\]]+)\]\]$/, '[$1]'))
    const path = `/${urlSegments.join('/')}`
    // A slot's page shares its URL with the page beside it; the plain page wins.
    const inSlot = segments.some((s) => s.startsWith('@'))
    if (!byPath.has(path) || !inSlot) byPath.set(path, { path, file })
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** The file router an app uses, from its package.json; null when it's neither. */
export function detectFramework(packageJson: string | null): Framework | null {
  if (!packageJson) return null
  let deps: Record<string, unknown>
  try {
    const json = JSON.parse(packageJson) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
    }
    deps = { ...json.devDependencies, ...json.dependencies }
  } catch {
    return null
  }
  if ('expo-router' in deps || 'expo' in deps) return 'expo-router'
  if ('next' in deps) return 'next-app'
  return null
}

export function frameworkRoutes(
  framework: Framework,
  appDir: string,
  files: string[],
): RouteEntry[] {
  return framework === 'next-app'
    ? nextRoutesFromFiles(appDir, files)
    : routesFromFiles(appDir, files)
}

/** Expo Router: layouts, and the deep-link handler every launch passes through. */
const EXPO_SHELL = /(^|\/)(_layout|\+native-intent)\.[cm]?[jt]sx?$/
/** Next.js: files that wrap or stand in for every page below them. */
const NEXT_SHELL = /(^|\/)(layout|template|loading|error|not-found|default)\.[cm]?[jt]sx?$/
/** Next.js: runs before every request, so it sits above every page. */
const NEXT_REQUEST_SHELL = /^(src\/)?(proxy|middleware)\.[cm]?[jt]s$/

/**
 * Files that shape screens besides the screens' own files: layouts in the app
 * directory, and on Next.js the request proxy next to it. `files` and the
 * result are relative to the repo root; `appRoot` is the app's own directory.
 */
export function shellFiles(
  framework: Framework,
  appRoot: string,
  appDir: string,
  files: string[],
): string[] {
  const inApp = `${appDir.replace(/\/$/, '')}/`
  if (framework === 'expo-router') {
    return files.filter((file) => file.startsWith(inApp) && EXPO_SHELL.test(file))
  }
  const root = appRoot ? `${appRoot.replace(/\/$/, '')}/` : ''
  return files.filter(
    (file) =>
      (file.startsWith(inApp) && NEXT_SHELL.test(file)) ||
      (file.startsWith(root) && NEXT_REQUEST_SHELL.test(file.slice(root.length))),
  )
}
