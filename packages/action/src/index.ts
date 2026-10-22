import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { affectedRoutesByImports, aliasesFromTsconfig, routesFromFiles } from '@tapthrough/cli'
import { MAX_DIFF_LENGTH, type Manifest, type RunReport } from '@tapthrough/protocol'
import { parseEasUpdateJson } from './eas.js'
import { type ExpoInfo, expoInfoFromConfig } from './expo-config.js'

function input(name: string): string {
  return (process.env[`INPUT_${name.toUpperCase()}`] ?? '').trim()
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Is this running inside GitHub Actions?`)
  return value
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** A GitHub Actions OIDC token for our API. Needs `permissions: id-token: write`. */
async function oidcToken(audience: string): Promise<string> {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !bearer) {
    throw new Error(
      'No OIDC token available. Add `permissions: id-token: write` to the workflow job.',
    )
  }
  const response = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  })
  if (!response.ok) throw new Error(`GitHub refused an OIDC token (${response.status}).`)
  const { value } = (await response.json()) as { value?: string }
  if (!value) throw new Error('GitHub returned an empty OIDC token.')
  return value
}

const MAX_SOURCE_FILES = 5000
const MAX_SOURCE_BYTES = 512 * 1024

/** Routes the changed files reach through imports, read from the app's tracked source files. */
function traceAffected(
  root: string,
  appRoot: string,
  routes: Manifest['routes'],
  changedFiles: string[],
): Manifest['affected'] {
  if (routes.length === 0 || changedFiles.length === 0) return []
  const listed = run('git', ['ls-files', '--', appRoot || '.'], root)
    .split('\n')
    .filter((file) => /\.(tsx?|jsx?|mjs|cjs)$/.test(file) && !file.includes('node_modules/'))
    .slice(0, MAX_SOURCE_FILES)
  const sources = new Map<string, string>()
  for (const file of listed) {
    try {
      const text = readFileSync(path.join(root, file), 'utf8')
      if (text.length <= MAX_SOURCE_BYTES) sources.set(file, text)
    } catch {
      // Deleted in this PR or unreadable; it can't import anything now.
    }
  }
  let tsconfig: string | null = null
  try {
    tsconfig = readFileSync(path.join(root, appRoot, 'tsconfig.json'), 'utf8')
  } catch {
    tsconfig = null
  }
  return affectedRoutesByImports({
    routes,
    changedFiles,
    sources,
    aliases: aliasesFromTsconfig(tsconfig, appRoot || '.'),
  })
}

function buildManifest(
  workingDir: string,
  baseSha: string,
  headSha: string,
): { manifest: Manifest; diff: string } {
  const root = run('git', ['rev-parse', '--show-toplevel'], workingDir).trim()
  const relative = path.relative(root, workingDir)
  const appDir = ['src/app', 'app']
    .map((dir) => path.join(relative, dir))
    .find((dir) => existsSync(path.join(root, dir)))

  let changedFiles: string[] = []
  let diff = ''
  try {
    changedFiles = run('git', ['diff', '--name-only', `${baseSha}...${headSha}`], root)
      .split('\n')
      .filter(Boolean)
    diff = run('git', ['diff', `${baseSha}...${headSha}`], root).slice(0, MAX_DIFF_LENGTH)
  } catch {
    console.log(
      '::warning::Could not diff against the base branch. Check out with `fetch-depth: 0`.',
    )
  }

  const files = appDir ? run('git', ['ls-files', appDir], root).split('\n').filter(Boolean) : []
  const routes = appDir ? routesFromFiles(appDir, files) : []
  return {
    manifest: {
      apiVersion: 1,
      framework: 'expo-router',
      routes,
      changedFiles,
      affected: traceAffected(root, relative, routes, changedFiles),
      presets: [],
    },
    diff,
  }
}

async function main() {
  const workingDir = path.resolve(input('working-directory') || '.')
  const apiUrl = (input('api-url') || 'https://tapthrough.dev').replace(/\/$/, '')
  const updateJson = input('update-json')
  if (!updateJson) throw new Error('Set `update-json` to the file `eas update --json` wrote.')

  const updates = parseEasUpdateJson(readFileSync(path.resolve(workingDir, updateJson), 'utf8'))
  const event = JSON.parse(readFileSync(requiredEnv('GITHUB_EVENT_PATH'), 'utf8')) as {
    pull_request?: { number: number; head: { sha: string }; base: { sha: string } }
  }
  if (!event.pull_request) throw new Error('Tapthrough runs on pull_request events.')
  const { number: pr, head, base } = event.pull_request
  const repo = requiredEnv('GITHUB_REPOSITORY')

  const expo: ExpoInfo = expoInfoFromConfig(
    JSON.parse(
      run('npx', ['--no-install', 'expo', 'config', '--type', 'public', '--json'], workingDir),
    ),
  )
  const { manifest, diff } = buildManifest(workingDir, base.sha, head.sha)
  console.log(
    `Found ${manifest.routes.length} routes; ${manifest.affected.length} changed directly.`,
  )

  const token = await oidcToken(apiUrl)
  const links = new Map<string, string>()
  for (const update of updates) {
    const report: RunReport & { expo: ExpoInfo } = {
      apiVersion: 1,
      repo,
      pr,
      sha: head.sha,
      platform: update.platform,
      runtimeVersion: update.runtimeVersion,
      updateGroupId: update.updateGroupId,
      manifest,
      diff,
      expo,
    }
    const response = await fetch(`${apiUrl}/api/v1/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(report),
    })
    const body = (await response.json().catch(() => ({}))) as {
      links?: { key: string; url: string }[]
      error?: { message: string }
    }
    if (!response.ok) {
      throw new Error(
        `Tapthrough rejected the ${update.platform} run (${response.status}): ${body.error?.message ?? 'no details'}`,
      )
    }
    for (const link of body.links ?? []) links.set(link.key, link.url)
    // Update group IDs stay out of the log: in public repos, logs are public.
    console.log(`Reported ${update.platform}.`)
  }

  const list = [...links].map(([key, url]) => `- ${key || 'This PR'}: ${url}`).join('\n')
  console.log(`Preview links:\n${list}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Tapthrough\n\n${list}\n`)
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `links=${JSON.stringify(Object.fromEntries(links))}\n`,
    )
  }
}

main().catch((error: unknown) => {
  console.log(`::error::${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
