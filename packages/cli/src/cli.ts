#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { FIXTURES_DIR, Platform } from '@tapthrough/protocol'
import {
  DEFAULT_SERVER,
  fetchAgentPlan,
  formatAgentPlan,
  parseLinkRef,
  requestLaunch,
} from './agent.js'
import { detectRepo, formatAppKey, githubToken, requestAppKey } from './app-key.js'
import { checkScenarios, formatIssues, readLibrary, readPlans } from './check.js'
import {
  checkLatest,
  doctorExitCode,
  formatDoctor,
  liveChecks,
  runDoctor,
  withLiveChecks,
} from './doctor.js'
import { buildMap, formatMap } from './map.js'
import { loadProject } from './project.js'

const HELP = `Usage: tapthrough <command> [options]

Commands:
  map     List your app's screens and the scenarios that open each one
  check   Validate .tapthrough/scenarios and .tapthrough/plans against your routes
  doctor  Check your setup before the first PR: the SDK, the workflow, scenarios.
          With --url, also ask a preview deployment or seed hook how it is set up
  plan    <pr-link>  What to check on a PR, for an agent driving a simulator
  launch  <pr-link> --scenario <key>  Print a single-use link that signs in,
          seeds and opens one scenario (expires in 15 minutes)
  app-key Make a key that lets staging and TestFlight builds send reports and
          ideas. Uses your GitHub login (gh auth token) to check write access

Options:
  --dir <path>         The app's directory (default: current directory)
  --platform <p>       ios or android (plan and launch; default: ios)
  --scenario <key>     The scenario to launch
  --server <url>       Tapthrough server for bare link IDs (default: $TAPTHROUGH_URL or ${DEFAULT_SERVER})
  --repo <owner/name>  The GitHub repo (app-key; default: the origin remote)
  --url <url>          A preview deployment or a seed hook to check (doctor)
  --latest             Also ask npm whether the @tapthrough packages are up to date (doctor)
  --json               Print machine-readable output (map, plan, launch, app-key, doctor)
  -h, --help           Show this help

Docs: https://github.com/tapthrough/tapthrough/blob/main/docs/scenario-map.md
      https://github.com/tapthrough/tapthrough/blob/main/docs/doctor.md
      https://github.com/tapthrough/tapthrough/blob/main/docs/agent-review.md`

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: 'string', default: '.' },
      json: { type: 'boolean', default: false },
      platform: { type: 'string', default: 'ios' },
      scenario: { type: 'string' },
      server: { type: 'string' },
      repo: { type: 'string' },
      url: { type: 'string' },
      latest: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const command = positionals[0]
  if (values.help || !command) {
    console.log(HELP)
    return command || values.help ? 0 : 1
  }

  if (command === 'plan' || command === 'launch') {
    const ref = positionals[1]
    if (!ref) {
      console.error(`Pass the PR link from the Tapthrough comment: tapthrough ${command} <pr-link>`)
      return 1
    }
    const platform = Platform.safeParse(values.platform)
    if (!platform.success) {
      console.error(`--platform must be ios or android, not "${values.platform}".`)
      return 1
    }
    const link = parseLinkRef(ref, values.server ?? process.env.TAPTHROUGH_URL ?? DEFAULT_SERVER)

    if (command === 'plan') {
      const plan = await fetchAgentPlan(link)
      console.log(
        values.json ? JSON.stringify(plan, null, 2) : formatAgentPlan(plan, ref, platform.data),
      )
      return plan.expired ? 1 : 0
    }

    if (!values.scenario) {
      console.error('Pass --scenario <key>. `tapthrough plan <pr-link>` lists them.')
      return 1
    }
    const launch = await requestLaunch(link, { platform: platform.data, scenario: values.scenario })
    console.log(values.json ? JSON.stringify(launch, null, 2) : launch.launchUrl)
    return 0
  }

  if (command === 'app-key') {
    const repo = values.repo ?? detectRepo(values.dir)
    if (!repo) {
      console.error('Couldn’t tell which GitHub repo this is. Pass --repo owner/name.')
      return 1
    }
    const token = githubToken(values.dir)
    if (!token) {
      console.error('Sign in to GitHub first (`gh auth login`), or set GITHUB_TOKEN.')
      return 1
    }
    const result = await requestAppKey(
      values.server ?? process.env.TAPTHROUGH_URL ?? DEFAULT_SERVER,
      {
        repo,
        token,
      },
    )
    console.log(values.json ? JSON.stringify(result, null, 2) : formatAppKey(result))
    return 0
  }

  const project = loadProject(values.dir)

  if (command === 'doctor') {
    let report = runDoctor(project)
    // Ten seconds per request: a preview that hangs shouldn't hang the doctor.
    const timedFetch: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(10_000) })
    if (values.latest) {
      report = withLiveChecks(report, await checkLatest(report.versions ?? {}, timedFetch))
    }
    if (values.url) {
      report = withLiveChecks(
        report,
        await liveChecks(values.url, {
          fetch: timedFetch,
          testData: report.testData,
          appId: report.appId,
        }),
      )
    }
    console.log(values.json ? JSON.stringify(report, null, 2) : formatDoctor(report))
    return doctorExitCode(report)
  }

  const library = readLibrary(project)

  if (command === 'map') {
    const map = buildMap({ ...project, scenarios: library.scenarios })
    console.log(values.json ? JSON.stringify(map, null, 2) : formatMap(map))
    return 0
  }

  if (command === 'check') {
    if (!project.appDir) {
      console.error(
        'No Expo Router or Next.js app found here (looked for src/app and app). Pass --dir.',
      )
      return 1
    }
    const plans = readPlans(project)
    const issues = checkScenarios({
      routes: project.routes,
      library,
      plans,
      readFixtures: (name) => project.read(`${FIXTURES_DIR}/${name}.json`),
    })
    const count =
      library.scenarios.length +
      plans.reduce((n, p) => n + (p.result.status === 'ok' ? p.result.plan.scenarios.length : 0), 0)
    console.log(formatIssues(issues, count))
    return issues.length > 0 ? 1 : 0
  }

  console.error(`Unknown command "${command}".\n\n${HELP}`)
  return 1
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  },
)
