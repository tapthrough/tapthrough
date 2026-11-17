import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  affectedRoutesByImports,
  aliasesFromTsconfig,
  detectFramework,
  frameworkRoutes,
  routeReach,
  shellFiles,
} from '@tapthrough/cli'
import {
  type Framework,
  MAX_DIFF_LENGTH,
  type Manifest,
  type RunReport,
} from '@tapthrough/protocol'
import { parseEasUpdateJson } from './eas.js'
import { type ExpoInfo, expoInfoFromConfig } from './expo-config.js'
import { ensureNativeBuild, parseProfiles } from './native.js'
import { findPreviewUrl, previewHost, probePreview, probeWarning, type WebInfo } from './web.js'

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
  layouts: string[],
  changedFiles: string[],
): Pick<Manifest, 'affected' | 'reach'> {
  if (routes.length === 0 || changedFiles.length === 0) return { affected: [], reach: {} }
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
  const aliases = aliasesFromTsconfig(tsconfig, appRoot || '.')
  return {
    affected: affectedRoutesByImports({ routes, changedFiles, sources, aliases }),
    reach: routeReach({ routes, layouts, changedFiles, sources, aliases }),
  }
}

function buildManifest(
  workingDir: string,
  framework: Framework,
  baseSha: string,
  headSha: string,
): { manifest: Manifest; diff: string } {
  const root = run('git', ['rev-parse', '--show-toplevel'], workingDir).trim()
  const relative = path.relative(root, workingDir).split(path.sep).join('/')
  const appDir = ['src/app', 'app']
    .map((dir) => (relative ? `${relative}/${dir}` : dir))
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

  // The whole app, not just its router directory: a Next.js proxy sits beside it.
  const files = appDir
    ? run('git', ['ls-files', '--', relative || '.'], root)
        .split('\n')
        .filter(Boolean)
    : []
  const routes = appDir ? frameworkRoutes(framework, appDir, files) : []
  const layouts = appDir ? shellFiles(framework, relative, appDir, files) : []
  return {
    manifest: {
      apiVersion: 1,
      framework,
      routes,
      changedFiles,
      ...traceAffected(root, relative, routes, layouts, changedFiles),
      presets: [],
    },
    diff,
  }
}

interface PullRequestEvent {
  pr: number
  head: string
  base: string
  repo: string
}

function pullRequestEvent(): PullRequestEvent {
  const event = JSON.parse(readFileSync(requiredEnv('GITHUB_EVENT_PATH'), 'utf8')) as {
    pull_request?: { number: number; head: { sha: string }; base: { sha: string } }
  }
  if (!event.pull_request) throw new Error('Tapthrough runs on pull_request events.')
  const { number, head, base } = event.pull_request
  return { pr: number, head: head.sha, base: base.sha, repo: requiredEnv('GITHUB_REPOSITORY') }
}

/** Posts one run and returns its preview links. */
async function reportRun(
  apiUrl: string,
  token: string,
  report: RunReport & { expo?: ExpoInfo; web?: WebInfo },
): Promise<{ key: string; url: string }[]> {
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
      `Tapthrough rejected the ${report.platform} run (${response.status}): ${body.error?.message ?? 'no details'}`,
    )
  }
  return body.links ?? []
}

function publishLinks(links: Map<string, string>) {
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

/** `expo` or `web`, from the `platform` input or the app's package.json. */
function resolvePlatform(workingDir: string): 'expo' | 'web' {
  const asked = input('platform') || 'auto'
  if (asked === 'expo' || asked === 'web') return asked
  if (asked !== 'auto') throw new Error('`platform` must be `auto`, `expo` or `web`.')
  let packageJson: string | null = null
  try {
    packageJson = readFileSync(path.join(workingDir, 'package.json'), 'utf8')
  } catch {
    packageJson = null
  }
  return detectFramework(packageJson) === 'next-app' ? 'web' : 'expo'
}

/** A web app: wait for the host's preview deployment of this commit, then report it. */
async function mainWeb(workingDir: string, apiUrl: string) {
  const appId = input('app-id')
  if (!appId) {
    throw new Error(
      'Set `app-id` to the ID your launch route and seed hook use, e.g. your production hostname.',
    )
  }
  const { pr, head, base, repo } = pullRequestEvent()
  const { manifest, diff } = buildManifest(workingDir, 'next-app', base, head)
  console.log(
    `Found ${manifest.routes.length} routes; ${manifest.affected.length} changed directly.`,
  )

  let url = input('preview-url').replace(/\/$/, '')
  if (!url) {
    const githubToken = input('github-token') || process.env.GITHUB_TOKEN
    if (!githubToken) {
      throw new Error(
        'Pass `github-token` (or `preview-url`) so the preview deployment can be found.',
      )
    }
    const api = process.env.GITHUB_API_URL || 'https://api.github.com'
    console.log('Waiting for the preview deployment of this commit…')
    url = await findPreviewUrl({
      repo,
      sha: head,
      environment: input('preview-environment') || undefined,
      timeoutSeconds: Number(input('preview-timeout')) || 600,
      github: async (apiPath) => {
        const response = await fetch(`${api}${apiPath}`, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${githubToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        })
        if (!response.ok) {
          throw new Error(
            `GitHub refused to list deployments (${response.status}). Add \`permissions: deployments: read\` to the workflow job.`,
          )
        }
        return response.json()
      },
    })
  }
  const host = previewHost(url)
  const probe = await probePreview(url)
  const warning = probeWarning(probe)
  if (warning) console.log(`::warning::${warning}`)

  const token = await oidcToken(apiUrl)
  const links = await reportRun(apiUrl, token, {
    apiVersion: 1,
    repo,
    pr,
    sha: head,
    platform: 'web',
    runtimeVersion: 'web',
    updateGroupId: host,
    manifest,
    diff,
    web: { appId, url, ...probe },
  })
  // The deployment's host stays out of the log: in public repos, logs are public.
  console.log('Reported web.')
  publishLinks(new Map(links.map((link) => [link.key, link.url])))
}

async function main() {
  const workingDir = path.resolve(input('working-directory') || '.')
  const apiUrl = (input('api-url') || 'https://tapthrough-cloud.vercel.app').replace(/\/$/, '')
  if (resolvePlatform(workingDir) === 'web') return mainWeb(workingDir, apiUrl)

  const updateJson = input('update-json')
  if (!updateJson) throw new Error('Set `update-json` to the file `eas update --json` wrote.')

  const updates = parseEasUpdateJson(readFileSync(path.resolve(workingDir, updateJson), 'utf8'))
  const { pr, head, base, repo } = pullRequestEvent()

  const expo: ExpoInfo = expoInfoFromConfig(
    JSON.parse(
      run('npx', ['--no-install', 'expo', 'config', '--type', 'public', '--json'], workingDir),
    ),
  )
  const { manifest, diff } = buildManifest(workingDir, 'expo-router', base, head)
  console.log(
    `Found ${manifest.routes.length} routes; ${manifest.affected.length} changed directly.`,
  )

  const profiles = parseProfiles(input('native-build-profile') || 'development')
  const eas = (args: string[]) =>
    execFileSync('eas', args, {
      cwd: workingDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    })

  const token = await oidcToken(apiUrl)
  const links = new Map<string, string>()
  for (const update of updates) {
    const nativeBuild = ensureNativeBuild(eas, {
      platform: update.platform,
      runtimeVersion: update.runtimeVersion,
      profiles,
    })
    const said = {
      found: 'a development build can run it',
      building: 'its development build is still building on EAS',
      started: 'it changes native code, so a development build was started on EAS',
      failed: `no development build can run it. ${nativeBuild.message ?? ''}`,
      off: 'not checked (native-build-profile: off)',
    }[nativeBuild.state]
    console.log(`${update.platform}: ${said}`)
    if (nativeBuild.state === 'failed') console.log(`::warning::${update.platform}: ${said}`)
    const reported = await reportRun(apiUrl, token, {
      apiVersion: 1,
      repo,
      pr,
      sha: head,
      platform: update.platform,
      runtimeVersion: update.runtimeVersion,
      updateGroupId: update.updateGroupId,
      manifest,
      diff,
      expo,
      nativeBuild,
    })
    for (const link of reported) links.set(link.key, link.url)
    // Update group IDs stay out of the log: in public repos, logs are public.
    console.log(`Reported ${update.platform}.`)
  }
  publishLinks(links)
}

main().catch((error: unknown) => {
  console.log(`::error::${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
