import type { PlanFileResult, RouteEntry, ScenarioSpec } from '@tapthrough/protocol'
import { routeParams } from './map.js'

export interface Issue {
  file: string
  message: string
}

function routeIssues(scenario: ScenarioSpec, known: Set<string>): string[] {
  const issues: string[] = []
  if (known.size > 0 && !known.has(scenario.route.path)) {
    const hint = scenario.route.path.includes('(')
      ? ' Leave out groups like (tabs).'
      : ' Run `npx @tapthrough/cli map` to list the screens.'
    issues.push(`route "${scenario.route.path}" isn't a screen in the app.${hint}`)
  }
  for (const param of routeParams(scenario.route.path)) {
    if (scenario.route.params[param] === undefined) {
      issues.push(`route.params is missing "${param}"`)
    }
  }
  return issues
}

/**
 * Everything that would make a scenario open the wrong place or not at all:
 * files the service would reject, routes that aren't screens, and unfilled
 * `[param]` segments. The service skips broken files; this catches them before a PR.
 */
export function checkScenarios(input: {
  routes: RouteEntry[]
  library: { scenarios: ScenarioSpec[]; errors: Issue[] }
  plans: { file: string; result: PlanFileResult }[]
}): Issue[] {
  const known = new Set(input.routes.map((route) => route.path))
  const keys = new Set(input.library.scenarios.map((scenario) => scenario.key))
  const issues: Issue[] = input.library.errors.map((error) => ({
    file: `.tapthrough/scenarios/${error.file}`,
    message: error.message,
  }))

  for (const scenario of input.library.scenarios) {
    for (const message of routeIssues(scenario, known)) {
      issues.push({ file: `.tapthrough/scenarios/${scenario.key}.json`, message })
    }
  }

  for (const { file, result } of input.plans) {
    if (result.status === 'invalid') {
      issues.push({ file, message: result.message })
      continue
    }
    if (result.status !== 'ok') continue
    for (const key of result.plan.include) {
      if (!keys.has(key)) issues.push({ file, message: `include "${key}" isn't in the library` })
    }
    for (const scenario of result.plan.scenarios) {
      for (const message of routeIssues(scenario, known)) {
        issues.push({ file, message: `${scenario.key}: ${message}` })
      }
    }
  }
  return issues
}

export function formatIssues(issues: Issue[], scenarioCount: number): string {
  if (issues.length === 0) {
    return `${scenarioCount} scenario${scenarioCount === 1 ? '' : 's'} checked, no problems.`
  }
  return [
    `${issues.length} problem${issues.length === 1 ? '' : 's'}:`,
    ...issues.map((issue) => `  ${issue.file}: ${issue.message}`),
  ].join('\n')
}
