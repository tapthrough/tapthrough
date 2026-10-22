#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { parseLibrary, parsePlanFile, SCENARIO_DIR } from '@tapthrough/protocol'
import { checkScenarios, formatIssues } from './check.js'
import { buildMap, formatMap } from './map.js'
import { loadProject, type Project } from './project.js'

const HELP = `Usage: tapthrough <command> [options]

Commands:
  map     List your app's screens and the scenarios that open each one
  check   Validate .tapthrough/scenarios and .tapthrough/plans against your routes

Options:
  --dir <path>  The Expo app's directory (default: current directory)
  --json        Print machine-readable output (map only)
  -h, --help    Show this help

Docs: https://github.com/tapthrough/tapthrough/blob/main/docs/scenario-map.md`

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

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: 'string', default: '.' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const command = positionals[0]
  if (values.help || !command) {
    console.log(HELP)
    return command || values.help ? 0 : 1
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

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
