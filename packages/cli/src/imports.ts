import path from 'node:path'
import type { AffectedRoute, RouteEntry } from '@tapthrough/protocol'

const SOURCE = /\.(tsx?|jsx?|mjs|cjs)$/
const EXTENSIONS = [
  '',
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.ios.tsx',
  '.android.tsx',
  '.native.tsx',
  '.web.tsx',
]
const INDEX = ['/index.tsx', '/index.ts', '/index.jsx', '/index.js']

/** Import specifiers in a file: static imports, re-exports, dynamic import() and require(). */
export function importSpecifiers(source: string): string[] {
  const specifiers = new Set<string>()
  const patterns = [
    /\b(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1])
    }
  }
  return [...specifiers]
}

/** Path aliases from tsconfig `paths`, e.g. `@/*` → `src/*`, relative to the repo root. */
export type Aliases = { prefix: string; target: string }[]

/** Removes line and block comments outside strings, and trailing commas, so JSON.parse accepts tsconfig. */
export function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (inString) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i++
      } else if (char === '"') {
        inString = false
      }
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (char === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else {
      out += char
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

export function aliasesFromTsconfig(tsconfig: string | null, dir: string): Aliases {
  if (!tsconfig) return []
  try {
    const json = JSON.parse(stripJsonComments(tsconfig))
    const paths = (json?.compilerOptions?.paths ?? {}) as Record<string, string[]>
    const baseUrl = String(json?.compilerOptions?.baseUrl ?? '.')
    return Object.entries(paths).flatMap(([alias, targets]) => {
      const target = targets[0]
      if (!alias.endsWith('/*') || !target?.endsWith('/*')) return []
      return [
        { prefix: alias.slice(0, -1), target: path.posix.join(dir, baseUrl, target.slice(0, -1)) },
      ]
    })
  } catch {
    return []
  }
}

/** The repo file an import specifier points at, or undefined for packages and missing files. */
export function resolveImport(
  specifier: string,
  from: string,
  files: Set<string>,
  aliases: Aliases,
): string | undefined {
  let base: string
  if (specifier.startsWith('.')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
  } else {
    const alias = aliases.find((a) => specifier.startsWith(a.prefix))
    if (!alias) return undefined // a package, not a repo file
    base = path.posix.normalize(alias.target + specifier.slice(alias.prefix.length))
  }
  for (const candidate of [
    ...EXTENSIONS.map((ext) => base + ext),
    ...INDEX.map((ext) => base + ext),
  ]) {
    if (files.has(candidate)) return candidate
  }
  return undefined
}

/**
 * Routes reached from the changed files by following imports backwards: a
 * changed component reaches every screen that uses it, directly or through
 * other components. Distance is the number of import hops (0 = the route file
 * itself changed); the closest path wins.
 */
export function affectedRoutesByImports(input: {
  routes: RouteEntry[]
  changedFiles: string[]
  sources: Map<string, string>
  aliases: Aliases
  maxDistance?: number
}): AffectedRoute[] {
  const files = new Set([...input.sources.keys()].filter((file) => SOURCE.test(file)))
  const importedBy = new Map<string, Set<string>>()
  for (const [file, source] of input.sources) {
    if (!SOURCE.test(file)) continue
    for (const specifier of importSpecifiers(source)) {
      const target = resolveImport(specifier, file, files, input.aliases)
      if (!target) continue
      if (!importedBy.has(target)) importedBy.set(target, new Set())
      importedBy.get(target)?.add(file)
    }
  }

  const routeByFile = new Map(input.routes.map((route) => [route.file, route]))
  const best = new Map<string, AffectedRoute>()
  const maxDistance = input.maxDistance ?? 6

  for (const changed of input.changedFiles) {
    const seen = new Set([changed])
    let frontier = [changed]
    for (let distance = 0; distance <= maxDistance && frontier.length > 0; distance++) {
      const next: string[] = []
      for (const file of frontier) {
        const route = routeByFile.get(file)
        if (route && (best.get(route.path)?.distance ?? Number.POSITIVE_INFINITY) > distance) {
          best.set(route.path, { path: route.path, distance, via: changed })
        }
        for (const parent of importedBy.get(file) ?? []) {
          if (!seen.has(parent)) {
            seen.add(parent)
            next.push(parent)
          }
        }
      }
      frontier = next
    }
  }
  return [...best.values()].sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path))
}
