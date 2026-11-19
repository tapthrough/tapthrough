import type { DoctorCheck } from './doctor.js'

const LAUNCH_PATH = '/api/tapthrough/launch'
const SEED_PATH = '/api/tapthrough/seed'
/** Not a token: the hook refuses it, and how it refuses says how far the request got. */
const PLACEHOLDER_TOKEN = 'doctor'

export type LiveTarget =
  | { kind: 'preview'; origin: string }
  | { kind: 'hook'; url: string }
  | { kind: 'invalid'; message: string }

/**
 * What `--url` points at. A bare host (or the launch route itself) is a
 * preview deployment; a URL with any other path is a seed hook.
 */
export function liveTarget(input: string): LiveTarget {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { kind: 'invalid', message: `"${input}" isn't a URL. Pass one starting with https://.` }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { kind: 'invalid', message: '--url must start with https:// or http://.' }
  }
  if (url.username || url.password) {
    return {
      kind: 'invalid',
      message: '--url has a username or password in it. The doctor sends no credentials.',
    }
  }
  const path = url.pathname.replace(/\/+$/, '')
  if (path === '' || path === LAUNCH_PATH) return { kind: 'preview', origin: url.origin }
  return { kind: 'hook', url: url.href }
}

/** Text from a server, made safe to print on one line. */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function printable(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()
  return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function request(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ status: number; text: string } | { failed: string }> {
  try {
    // Redirects aren't followed: a login page elsewhere says nothing about this route.
    const response = await doFetch(url, { ...init, redirect: 'manual', credentials: 'omit' })
    return { status: response.status, text: await response.text().catch(() => '') }
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
    return { failed: printable(cause instanceof Error ? cause.message : String(cause)) }
  }
}

interface LaunchStatus {
  /** Absent from the first @tapthrough/next that had a status. */
  appId?: string
  seed: 'in-app' | 'url'
  auth: boolean
  seedEnvironment: { valid: true; value: string } | { valid: false; set: boolean; length: number }
}

/** The launch route's `?status=1` answer, or null when the body isn't one. */
function parseLaunchStatus(text: string): LaunchStatus | null {
  const json = parseJson(text)
  const body = isObject(json) ? json.tapthrough : undefined
  if (!isObject(body) || body.enabled !== true) return null
  const testData = body.testData
  const environment = body.seedEnvironment
  if (!isObject(testData) || !isObject(environment)) return null
  const seed = testData.seed === 'url' ? 'url' : 'in-app'
  const auth = testData.auth === true
  const appId = typeof body.appId === 'string' ? { appId: printable(body.appId) } : {}
  if (environment.valid === true && typeof environment.value === 'string') {
    return { ...appId, seed, auth, seedEnvironment: { valid: true, value: environment.value } }
  }
  return {
    ...appId,
    seed,
    auth,
    seedEnvironment: {
      valid: false,
      set: environment.set === true,
      length: typeof environment.length === 'number' ? environment.length : 0,
    },
  }
}

function seedEnvironmentCheck(status: LaunchStatus): DoctorCheck {
  const id = 'live-seed-env'
  const environment = status.seedEnvironment
  if (status.seed === 'url') {
    return {
      id,
      status: 'warn',
      message:
        'The seed hook runs at another URL, so its own environment decides whether it seeds. Run the doctor again with --url <the seed hook URL>.',
    }
  }
  if (environment.valid) {
    return {
      id,
      status: 'pass',
      message: `TAPTHROUGH_ENV is \`${printable(environment.value)}\` in this deployment.`,
    }
  }
  const fix =
    'Set it to exactly `staging` on the preview environment only, then deploy again. The seed hook refuses to run otherwise.'
  return {
    id,
    status: 'fail',
    message: environment.set
      ? `TAPTHROUGH_ENV is set in this deployment, but its ${environment.length}-character value isn't \`staging\` or \`development\`. ${fix}`
      : `TAPTHROUGH_ENV isn't set in this deployment. ${fix}`,
  }
}

/**
 * Posts a placeholder token to a seed hook. The hook checks its environment
 * before it reads the token, so the error it answers with says which of the
 * two stopped it. Nothing is seeded.
 */
export async function checkSeedHook(
  url: string,
  doFetch: typeof fetch,
  options: { optional?: boolean } = {},
): Promise<DoctorCheck[]> {
  const id = 'live-seed-hook'
  const answer = await request(doFetch, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token: PLACEHOLDER_TOKEN }),
  })
  if ('failed' in answer) {
    return [
      {
        id,
        status: 'fail',
        message: `Couldn't reach the seed hook at ${url} (${answer.failed}). Check the URL and that the hook is deployed.`,
      },
    ]
  }

  const json = parseJson(answer.text)
  const error = isObject(json) && isObject(json.error) ? json.error : undefined
  const code = typeof error?.code === 'string' ? error.code : undefined
  const said =
    typeof error?.message === 'string' && error.message !== ''
      ? ` It said: ${printable(error.message)}.`
      : ''

  if (code === 'not_staging') {
    return [
      {
        id,
        status: 'fail',
        message: `The seed hook is reachable but refuses to seed: its environment isn't \`staging\` or \`development\`.${said} Set TAPTHROUGH_ENV to exactly \`staging\` where the hook runs, and only where its database is safe for test data.`,
      },
    ]
  }
  if (code === 'keys_unavailable') {
    return [
      {
        id,
        status: 'warn',
        message:
          "The seed hook is reachable and its environment check passed, but it couldn't reach Tapthrough to check a link. Try again; if it keeps happening, check the hook's `issuer` and its network access.",
      },
    ]
  }
  if (code !== undefined && (answer.status === 401 || answer.status === 400)) {
    return [
      {
        id,
        status: 'pass',
        message:
          'The seed hook is reachable and its environment check passed. It refused the placeholder token, as it should.',
      },
    ]
  }
  if (answer.status === 404) {
    // An in-app hook may live at a path of the app's choosing.
    if (options.optional) return []
    return [
      {
        id,
        status: 'fail',
        message: `Nothing answers at ${url} (404). Check the seed hook's URL and that it is deployed.`,
      },
    ]
  }
  if (code === undefined && (answer.status === 401 || answer.status === 403)) {
    return [
      {
        id,
        status: 'warn',
        message: `Couldn't tell: ${url} answered ${answer.status} before the seed hook ran, so something in front of it wants credentials. The app sends none, so launch links will get the same answer.`,
      },
    ]
  }
  return [
    {
      id,
      status: 'warn',
      message: `Couldn't tell: the seed hook answered ${answer.status}${code ? ` (${printable(code)})` : ''}.${said}`,
    },
  ]
}

/**
 * Asks a preview deployment's launch route how it is set up. `testData` is
 * the workflow's `test-data` input, when the static checks could read it.
 */
export async function checkPreview(
  origin: string,
  doFetch: typeof fetch,
  testData?: string,
  expectedAppId?: string,
): Promise<DoctorCheck[]> {
  const id = 'live-launch'
  const url = `${origin}${LAUNCH_PATH}`
  const answer = await request(doFetch, `${url}?status=1`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if ('failed' in answer) {
    return [
      {
        id,
        status: 'fail',
        message: `Couldn't reach ${origin} (${answer.failed}). Check the URL and that the deployment finished.`,
      },
    ]
  }

  if (answer.status === 200) {
    const status = parseLaunchStatus(answer.text)
    if (!status) {
      return [
        {
          id,
          status: 'warn',
          message: `Couldn't tell: ${url} answered 200 but not with a Tapthrough status. Something else may be answering at that path.`,
        },
      ]
    }
    const checks: DoctorCheck[] = [
      {
        id,
        status: 'pass',
        message: `The launch route is on in this deployment${status.auth ? '' : ', with no auth adapter (fine if the app has no login)'}.`,
      },
      seedEnvironmentCheck(status),
    ]
    if (status.appId && expectedAppId) {
      checks.push(
        status.appId === expectedAppId
          ? {
              id: 'live-app-id',
              status: 'pass',
              message: `The deployed app ID matches the workflow's: ${status.appId}.`,
            }
          : {
              id: 'live-app-id',
              status: 'fail',
              message: `This deployment's launch route uses app ID "${status.appId}", but the workflow sends "${printable(expectedAppId)}". Links are made for the workflow's ID, so the app refuses them as "for a different app". Make the two the same, then deploy again.`,
            },
      )
    }
    if (status.seed === 'in-app') {
      checks.push(...(await checkSeedHook(`${origin}${SEED_PATH}`, doFetch, { optional: true })))
    }
    return checks
  }

  // What the route answered before it had `?status=1`: it asks for a token.
  if (answer.status === 400 && answer.text.includes('missing_token')) {
    return [
      {
        id,
        status: 'warn',
        message:
          'The launch route is on in this deployment, but its @tapthrough/next is too old to report more. Upgrade @tapthrough/next and deploy again to check TAPTHROUGH_ENV.',
      },
    ]
  }

  if (answer.status === 404) {
    // The route's own 404 is this exact body; a framework's 404 is a page.
    if (answer.text.trim() === 'Not found') {
      return [
        {
          id,
          status: 'warn',
          message:
            'The launch route is deployed but says Tapthrough is off here. It is on only when VERCEL_ENV is `preview` or TAPTHROUGH_ENABLED is `true`, and never on a Vercel production deployment. That is right for production and wrong for a preview.',
        },
      ]
    }
    if (testData === 'off') {
      return [
        {
          id,
          status: 'pass',
          message:
            'This deployment has no launch route (404), which is expected: the workflow has `test-data: "off"`.',
        },
      ]
    }
    return [
      {
        id,
        status: 'fail',
        message: `This deployment has no launch route: ${url} answered 404. Add app${LAUNCH_PATH}/route.ts and deploy again, or set \`test-data: "off"\` in the workflow.`,
      },
    ]
  }

  if (
    answer.status === 401 ||
    answer.status === 403 ||
    (answer.status >= 300 && answer.status < 400)
  ) {
    return [
      {
        id,
        status: 'warn',
        message: `Couldn't tell: ${url} answered ${answer.status} before the launch route ran. The preview may be behind a login (Vercel Deployment Protection), or a middleware may be redirecting /api/tapthrough/.`,
      },
    ]
  }
  return [
    {
      id,
      status: 'warn',
      message: `Couldn't tell: ${url} answered ${answer.status}.`,
    },
  ]
}

/**
 * The checks behind `--url`. They only ever send a GET to the launch route and
 * a POST with a placeholder token to the seed hook: no credentials, no real token.
 */
export async function liveChecks(
  url: string,
  options: { fetch: typeof fetch; testData?: string; appId?: string },
): Promise<DoctorCheck[]> {
  const target = liveTarget(url)
  if (target.kind === 'invalid')
    return [{ id: 'live-url', status: 'fail', message: target.message }]
  if (target.kind === 'hook') return checkSeedHook(target.url, options.fetch)
  return checkPreview(target.origin, options.fetch, options.testData, options.appId)
}

const REGISTRY = 'https://registry.npmjs.org'

/** `1.2.3` → [1, 2, 3]; null for anything else, such as a prerelease. */
function versionParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function isOlder(installed: string, latest: string): boolean {
  const a = versionParts(installed)
  const b = versionParts(latest)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number)
  }
  return false
}

/**
 * Asks the npm registry for the newest version of each installed @tapthrough
 * package. Only the package names are sent; they are public.
 */
export async function checkLatest(
  installed: Record<string, string[]>,
  doFetch: typeof fetch,
): Promise<DoctorCheck[]> {
  const id = 'sdk-latest'
  const names = Object.keys(installed).filter((name) => name.startsWith('@tapthrough/'))
  if (names.length === 0) {
    return [
      {
        id,
        status: 'warn',
        message: "Couldn't tell: no @tapthrough versions were found in a lockfile to compare.",
      },
    ]
  }
  const answers = await Promise.all(
    names.map(async (name) => {
      const answer = await request(doFetch, `${REGISTRY}/${name.replace('/', '%2f')}/latest`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      const json = 'failed' in answer || answer.status !== 200 ? undefined : parseJson(answer.text)
      const latest = isObject(json) && typeof json.version === 'string' ? json.version : undefined
      return { name, latest }
    }),
  )
  const unknown = answers.filter((answer) => !answer.latest).map((answer) => answer.name)
  const behind = answers.flatMap(({ name, latest }) => {
    if (!latest) return []
    const old = (installed[name] ?? []).filter((version) => isOlder(version, latest))
    return old.length > 0 ? [`${name} ${old.join(' and ')} → ${printable(latest)}`] : []
  })
  if (behind.length > 0) {
    return [
      {
        id,
        status: 'warn',
        message: `${plural(behind.length, 'package')} behind the newest release. Upgrade the @tapthrough packages together.`,
        details: behind,
      },
    ]
  }
  if (unknown.length > 0) {
    return [
      {
        id,
        status: 'warn',
        message: `Couldn't tell: the npm registry gave no version for ${unknown.join(', ')}.`,
      },
    ]
  }
  return [{ id, status: 'pass', message: 'Every @tapthrough package is on its newest release.' }]
}
