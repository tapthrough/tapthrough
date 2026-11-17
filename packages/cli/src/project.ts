import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Framework, RouteEntry } from '@tapthrough/protocol'
import { type Aliases, aliasesFromTsconfig } from './imports.js'
import { detectFramework, frameworkRoutes, shellFiles } from './routes.js'

const SOURCE = /\.(tsx?|jsx?|mjs|cjs)$/
const MAX_SOURCE_FILES = 5000
const MAX_SOURCE_BYTES = 512 * 1024
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.expo',
  '.next',
  'ios',
  'android',
])

/** An Expo Router or Next.js app as the CLI sees it. Paths are relative to the repo root. */
export interface Project {
  root: string
  /** The app's directory, relative to the root ('' when it's the root). */
  appRoot: string
  /** From package.json; Expo Router when it names neither. */
  framework: Framework
  /** `src/app` or `app` under appRoot, or null when there's no router directory. */
  appDir: string | null
  routes: RouteEntry[]
  /** Layouts and other files that shape every screen below them. */
  shells: string[]
  sources: Map<string, string>
  aliases: Aliases
  /** Reads a file under appRoot, or null if it's missing. */
  read(relative: string): string | null
  /** File names in a directory under appRoot, or [] if it's missing. */
  list(relative: string): string[]
}

function gitRoot(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/** Tracked and untracked (not ignored) files, so scenarios an agent just wrote count. */
function gitFiles(root: string, under: string): string[] {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', under || '.'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
    .split('\n')
    .filter(Boolean)
}

function walk(root: string, under: string): string[] {
  const out: string[] = []
  const visit = (relative: string) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const next = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) visit(next)
      } else {
        out.push(next)
      }
      if (out.length > MAX_SOURCE_FILES * 4) return
    }
  }
  visit(under)
  return out
}

export function loadProject(dir: string): Project {
  const appPath = path.resolve(dir)
  const root = gitRoot(appPath) ?? appPath
  const appRoot = path.relative(root, appPath).split(path.sep).join('/')
  const files = gitRoot(appPath) ? gitFiles(root, appRoot) : walk(root, appRoot)

  const appDir =
    ['src/app', 'app']
      .map((sub) => (appRoot ? `${appRoot}/${sub}` : sub))
      .find((candidate) => existsSync(path.join(root, candidate))) ?? null
  let packageJson: string | null = null
  try {
    packageJson = readFileSync(path.join(appPath, 'package.json'), 'utf8')
  } catch {
    packageJson = null
  }
  const framework = detectFramework(packageJson) ?? 'expo-router'
  const routes = appDir ? frameworkRoutes(framework, appDir, files) : []
  const shells = appDir ? shellFiles(framework, appRoot, appDir, files) : []

  const sources = new Map<string, string>()
  for (const file of files.filter((f) => SOURCE.test(f) && !f.includes('node_modules/'))) {
    if (sources.size >= MAX_SOURCE_FILES) break
    try {
      const text = readFileSync(path.join(root, file), 'utf8')
      if (text.length <= MAX_SOURCE_BYTES) sources.set(file, text)
    } catch {
      // Listed by git but deleted on disk.
    }
  }

  const read = (relative: string) => {
    try {
      return readFileSync(path.join(appPath, relative), 'utf8')
    } catch {
      return null
    }
  }
  const list = (relative: string) => {
    try {
      return readdirSync(path.join(appPath, relative)).sort()
    } catch {
      return []
    }
  }

  return {
    root,
    appRoot,
    framework,
    appDir,
    routes,
    shells,
    sources,
    aliases: aliasesFromTsconfig(read('tsconfig.json'), appRoot || '.'),
    read,
    list,
  }
}
