import { WEB_LAUNCH_PATH } from '@tapthrough/protocol'

/** Sent next to a web run: how links open the preview and what reviewers will hit. */
export interface WebInfo {
  /** The app ID the team chose; the link-token audience. */
  appId: string
  /** This PR's own deployment, e.g. `https://acme-git-fix-title-acme.vercel.app`. */
  url: string
  /**
   * `open`: anyone with the link gets in. `login`: the host asks reviewers to
   * sign in first (Vercel Deployment Protection). `unknown`: couldn't tell.
   */
  access: 'open' | 'login' | 'unknown'
  /**
   * Whether `@tapthrough/next`'s launch route answered on the deployment.
   * `off`: the team runs without test data (`test-data: off`), so there is none.
   */
  launch: 'ready' | 'missing' | 'unknown' | 'off'
}

interface Deployment {
  id: number
  environment: string
}

interface DeploymentStatus {
  state: string
  environment_url?: string | null
  target_url?: string | null
}

/** Calls GitHub's REST API with the workflow's token and returns the parsed JSON. */
export type GitHubGet = (path: string) => Promise<unknown>

export interface FindPreviewInput {
  repo: string
  sha: string
  /**
   * The GitHub deployment environment to wait for, e.g. `Preview – acme-web`.
   * Left out, any environment starting with "Preview" matches, which is what
   * Vercel names them.
   */
  environment?: string
  timeoutSeconds: number
  github: GitHubGet
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const POLL_MS = 10_000
const FAILED = new Set(['failure', 'error'])

/**
 * Waits for the host (Vercel's GitHub integration, or anything else that
 * records GitHub deployments) to finish deploying this commit, and returns the
 * deployment's own URL. The URL is the one unique to the commit, not a branch
 * alias, so reports from the running app can be matched to this push.
 */
export async function findPreviewUrl(input: FindPreviewInput): Promise<string> {
  const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = input.now ?? Date.now
  const deadline = now() + input.timeoutSeconds * 1000
  const wanted = input.environment?.trim().toLowerCase()
  let seen = 'no deployment of this commit yet'

  for (;;) {
    const deployments = (await input.github(
      `/repos/${input.repo}/deployments?sha=${input.sha}&per_page=30`,
    )) as Deployment[]
    const matching = deployments.filter((d) =>
      wanted ? d.environment.toLowerCase() === wanted : /^preview\b/i.test(d.environment),
    )
    const environments = [...new Set(matching.map((d) => d.environment))]
    if (environments.length > 1) {
      throw new Error(
        `This commit has preview deployments in ${environments.length} environments (${environments.join(', ')}). Set \`preview-environment\` to the one reviewers should open.`,
      )
    }
    // Newest first: a redeploy of the same commit replaces the earlier one.
    const deployment = matching[0]
    if (deployment) {
      const statuses = (await input.github(
        `/repos/${input.repo}/deployments/${deployment.id}/statuses?per_page=10`,
      )) as DeploymentStatus[]
      const latest = statuses[0]
      if (latest?.state === 'success') {
        const url = latest.environment_url || latest.target_url
        if (url) return url.replace(/\/$/, '')
      }
      if (latest && FAILED.has(latest.state)) {
        throw new Error(`The preview deployment in "${deployment.environment}" failed.`)
      }
      seen = `"${deployment.environment}" is ${latest?.state ?? 'queued'}`
    } else if (deployments.length > 0) {
      seen = `only found ${[...new Set(deployments.map((d) => d.environment))].join(', ')}`
    }
    if (now() + POLL_MS > deadline) {
      throw new Error(
        `No preview deployment was ready after ${input.timeoutSeconds}s (${seen}). If your host doesn't record GitHub deployments, pass \`preview-url\`.`,
      )
    }
    await sleep(POLL_MS)
  }
}

/** The deployment's host, which is the build's ID on web. */
export function previewHost(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`The preview URL "${url}" isn't a URL.`)
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error(`The preview URL must be https (got ${parsed.protocol}//).`)
  }
  return parsed.host
}

/**
 * Asks the deployment's launch route for nothing, to learn what a reviewer
 * would meet. The route answers 400 to a request without a token, 404 when
 * the SDK isn't installed or is off, and a protected deployment answers 401
 * or sends the browser to the host's login. Never throws.
 */
export async function probePreview(
  url: string,
  doFetch: typeof fetch = fetch,
  testData: 'on' | 'off' = 'on',
): Promise<Pick<WebInfo, 'access' | 'launch'>> {
  const probe = await probeLaunchRoute(url, doFetch)
  // Without test data there's no launch route to find; only who can get in matters.
  return testData === 'off' ? { access: probe.access, launch: 'off' } : probe
}

async function probeLaunchRoute(
  url: string,
  doFetch: typeof fetch,
): Promise<Pick<WebInfo, 'access' | 'launch'>> {
  let response: Response
  try {
    response = await doFetch(`${url.replace(/\/$/, '')}${WEB_LAUNCH_PATH}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { access: 'unknown', launch: 'unknown' }
  }
  if (response.status === 401) return { access: 'login', launch: 'unknown' }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') ?? ''
    let elsewhere = false
    try {
      elsewhere = new URL(location, url).host !== new URL(url).host
    } catch {
      elsewhere = false
    }
    // Sent to another site to sign in (Vercel's SSO), or to the app's own login page.
    return { access: elsewhere ? 'login' : 'open', launch: elsewhere ? 'unknown' : 'missing' }
  }
  if (response.status === 400) return { access: 'open', launch: 'ready' }
  if (response.status === 404) return { access: 'open', launch: 'missing' }
  return { access: 'open', launch: 'unknown' }
}

/** What to tell the workflow log about a probe; null when all is well. */
export function probeWarning(probe: Pick<WebInfo, 'access' | 'launch'>): string | null {
  if (probe.access === 'login') {
    return 'This preview asks visitors to sign in (Vercel Deployment Protection). Reviewers need access to the Vercel team, or a Shareable Link, before the Tapthrough link will open.'
  }
  if (probe.launch === 'missing') {
    return "The preview has no Tapthrough launch route. Add `@tapthrough/next`'s `createLaunchRoute` at `app/api/tapthrough/launch/route.ts`; until then the link opens the preview without test data."
  }
  return null
}
