/** The versions each `@tapthrough/*` package resolves to in a lockfile. */
export type ResolvedVersions = Map<string, string[]>

export const LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'] as const
export type LockfileName = (typeof LOCKFILES)[number]

const NAME = '@tapthrough\\/[a-z0-9-]+'
const VERSION = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?'

function collector() {
  const found = new Map<string, Set<string>>()
  return {
    add(name: string, version: string) {
      const versions = found.get(name) ?? new Set<string>()
      versions.add(version)
      found.set(name, versions)
    },
    result(): ResolvedVersions {
      return new Map(
        [...found.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, versions]) => [name, [...versions].sort()]),
      )
    },
  }
}

/** pnpm: package keys such as `'@tapthrough/next@0.1.2(react@19.0.0)':` or `/@tapthrough/next/0.1.2:`. */
function fromPnpm(text: string): ResolvedVersions {
  const out = collector()
  const key = new RegExp(`^ {2}['"]?/?(${NAME})[@/](${VERSION})[^:]*:`)
  for (const line of text.split(/\r?\n/)) {
    const match = key.exec(line)
    if (match?.[1] && match[2]) out.add(match[1], match[2])
  }
  return out.result()
}

/** Yarn: an entry's header names the package, a `version` line below gives what it resolved to. */
function fromYarn(text: string): ResolvedVersions {
  const out = collector()
  const header = new RegExp(`^"?(${NAME})@`)
  let name: string | null = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(' ')) {
      name = header.exec(line)?.[1] ?? null
      continue
    }
    const version = /^\s+version:?\s+"?([^"\s]+)"?/.exec(line)?.[1]
    if (name && version) {
      out.add(name, version)
      name = null
    }
  }
  return out.result()
}

/** npm: `packages` keyed by install path (lockfile v2 and v3), or nested `dependencies` (v1). */
function fromNpm(text: string): ResolvedVersions | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const out = collector()
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null
  if (!isObject(json)) return null

  const installed = new RegExp(`(?:^|/)node_modules/(${NAME})$`)
  if (isObject(json.packages)) {
    for (const [path, entry] of Object.entries(json.packages)) {
      const name = installed.exec(path)?.[1]
      if (name && isObject(entry) && typeof entry.version === 'string' && entry.link !== true) {
        out.add(name, entry.version)
      }
    }
  }
  const walk = (dependencies: unknown) => {
    if (!isObject(dependencies)) return
    for (const [name, entry] of Object.entries(dependencies)) {
      if (!isObject(entry)) continue
      if (new RegExp(`^${NAME}$`).test(name) && typeof entry.version === 'string') {
        out.add(name, entry.version)
      }
      walk(entry.dependencies)
    }
  }
  walk(json.dependencies)
  return out.result()
}

/** Null when the lockfile couldn't be read at all. */
export function resolvedVersions(name: LockfileName, text: string): ResolvedVersions | null {
  if (name === 'pnpm-lock.yaml') return fromPnpm(text)
  if (name === 'yarn.lock') return fromYarn(text)
  return fromNpm(text)
}
