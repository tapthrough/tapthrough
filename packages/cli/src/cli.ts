#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { Platform, parseLibrary, parsePlanFile, SCENARIO_DIR } from '@tapthrough/protocol'
import {
  DEFAULT_SERVER,
  fetchAgentPlan,
  formatAgentPlan,
  parseLinkRef,
  requestLaunch,
} from './agent.js'
import { checkScenarios, formatIssues } from './check.js'
import { buildMap, formatMap } from './map.js'
import { loadProject, type Project } from './project.js'

const HELP = `Usage: tapthrough <command> [options]

Commands:
  map     List your app's screens and the scenarios that open each one
  check   Validate .tapthrough/scenarios and .tapthrough/plans against your routes
  plan    <pr-link>  What to check on a PR, for an agent driving a simulator
  launch  <pr-link> --scenario <key>  Print a single-use link that signs in,
          seeds and opens one scenario (expires in 15 minutes)

Options:
  --dir <path>         The Expo app's directory (default: current directory)
  --platform <p>       ios or android (plan and launch; default: ios)
  --scenario <key>     The scenario to launch
  --server <url>       Tapthrough server for bare link IDs (default: $TAPTHROUGH_URL or ${DEFAULT_SERVER})
  --json               Print machine-readable output (map, plan, launch)
  -h, --help           Show this help

Docs: https://github.com/tapthrough/tapthrough/blob/main/docs/scenario-map.md
      https://github.com/tapthrough/tapthrough/blob/main/docs/agent-review.md`

function readLibrary(project: Project) {
  const files = project
    .list(SCENARIO_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, text: project.read(`${SCENARIO_DIR}/${name}`) ?? '' }))
  return parseLibrary(files)
}

function readPlans(project: Project) {
  return project
    .list('.tapthrough/plans')
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const file = `.tapthrough/plans/${name}`
      return { file, result: parsePlanFile(project.read(file)) }
    })
}

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

  const project = loadProject(values.dir)
  const library = readLibrary(project)

  if (command === 'map') {
    const map = buildMap({ ...project, scenarios: library.scenarios })
    console.log(values.json ? JSON.stringify(map, null, 2) : formatMap(map))
    return 0
  }

  if (command === 'check') {
    if (!project.appDir) {
      console.error('No Expo Router app found here (looked for src/app and app). Pass --dir.')
      return 1
    }
    const plans = readPlans(project)
    const issues = checkScenarios({ routes: project.routes, library, plans })
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
