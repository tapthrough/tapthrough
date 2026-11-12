import { AgentLaunch, AgentPlan, type Platform } from '@tapthrough/protocol'

/** Where links point until Tapthrough has its own domain. Override with --server or TAPTHROUGH_URL. */
export const DEFAULT_SERVER = 'https://tapthrough-cloud.vercel.app'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export interface LinkRef {
  server: string
  linkId: string
}

/**
 * Accepts the PR link from the Tapthrough comment (`https://…/l/<id>`) or a
 * bare link ID. A full URL's own host wins over `server`.
 */
export function parseLinkRef(ref: string, server: string = DEFAULT_SERVER): LinkRef {
  const trimmed = ref.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed)
    const match = url.pathname.match(/\/l\/([^/]+)/)
    if (!match?.[1] || !UUID.test(match[1])) {
      throw new Error(`"${ref}" isn't a Tapthrough PR link (expected …/l/<id>).`)
    }
    return { server: url.origin, linkId: match[1] }
  }
  if (!UUID.test(trimmed) || trimmed.length !== 36) {
    throw new Error(`"${ref}" isn't a Tapthrough PR link or link ID.`)
  }
  return { server: server.replace(/\/$/, ''), linkId: trimmed }
}

type Fetch = typeof fetch

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { message?: string } }
    | undefined
  return body?.error?.message ?? `HTTP ${response.status}`
}

export async function fetchAgentPlan(link: LinkRef, fetchImpl: Fetch = fetch): Promise<AgentPlan> {
  const response = await fetchImpl(`${link.server}/api/v1/links/${link.linkId}/agent`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Couldn't load the PR's plan: ${await readError(response)}`)
  const plan = AgentPlan.safeParse(await response.json())
  if (!plan.success) {
    throw new Error("The server's plan didn't match this CLI. Update @tapthrough/cli.")
  }
  return plan.data
}

/** Mints a single-use, 15-minute link that signs in, seeds and opens the scenario's screen. */
export async function requestLaunch(
  link: LinkRef,
  input: { platform: Platform; scenario: string },
  fetchImpl: Fetch = fetch,
): Promise<AgentLaunch> {
  const response = await fetchImpl(`${link.server}/api/v1/links/${link.linkId}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...input, from: 'agent' }),
  })
  if (!response.ok)
    throw new Error(`Couldn't start "${input.scenario}": ${await readError(response)}`)
  const launch = AgentLaunch.safeParse(await response.json())
  if (!launch.success) throw new Error("The server's launch response didn't match this CLI.")
  return launch.data
}

const PLATFORM_NAME: Record<Platform, string> = { ios: 'iOS', android: 'Android' }

/** The plan as instructions an agent can follow, one scenario at a time. */
export function formatAgentPlan(plan: AgentPlan, link: string, platform: Platform): string {
  const title = `${plan.repo} PR #${plan.pr}`
  if (plan.expired) return `${title} is closed. There's nothing to check.`
  const build = plan.builds.find((b) => b.platform === platform)
  if (!build) {
    const others = plan.builds.map((b) => PLATFORM_NAME[b.platform]).join(' or ')
    return `${title} has no ${PLATFORM_NAME[platform]} build yet.${others ? ` Try ${others}.` : ''}`
  }
  const scenarios = plan.scenarios.filter((s) => s.platforms.includes(platform))
  const lines = [
    `# ${title}: ${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'} to check on ${PLATFORM_NAME[platform]}`,
    '',
    `Commit ${build.sha.slice(0, 7)}, runtime ${build.runtimeVersion}.`,
    '',
    "1. Open this PR's build in the app's development build:",
    `   ${build.buildUrl}`,
    '2. For each scenario, get a fresh launch link and open it in the running app.',
    '   It signs in, adds test data and opens the screen. Links are single-use and expire in 15 minutes.',
    '3. Do each step, then compare what you see with "Expect". Capture a screenshot per step.',
  ]
  if (scenarios.length === 0) {
    lines.push('', 'This PR has no scenarios for this platform. Check the build opens and stop.')
  }
  for (const [i, scenario] of scenarios.entries()) {
    lines.push(
      '',
      `## ${i + 1}. ${scenario.title} (\`${scenario.key}\`)`,
      '',
      `Launch link: \`npx @tapthrough/cli launch ${link} --scenario ${scenario.key} --platform ${platform}\``,
      '',
      'Setup the launch link does:',
      ...scenario.setup.map((line) => `- ${line}`),
      '',
    )
    if (scenario.steps.length === 0) {
      lines.push('No steps written yet: check the screen opens with the data above.')
    }
    for (const step of scenario.steps) {
      const unsure = step.confidence === 'low' ? ' (low confidence: say if it does not apply)' : ''
      lines.push(`${step.index + 1}. ${step.action}${unsure}`, `   Expect: ${step.expect}`)
    }
  }
  return lines.join('\n')
}
