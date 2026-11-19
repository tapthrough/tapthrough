import { FIXTURES_DIR, type Framework, type ScenarioSpec } from '@tapthrough/protocol'
import { checkScenarios, readLibrary, readPlans } from './check.js'
import { LOCKFILES, type LockfileName, resolvedVersions } from './doctor-lockfile.js'
import { readWorkflow, usesTapthroughAction, type WorkflowInfo } from './doctor-workflow.js'
import type { Project } from './project.js'
import { detectFramework } from './routes.js'

export {
  checkLatest,
  checkPreview,
  checkSeedHook,
  type LiveTarget,
  liveChecks,
  liveTarget,
} from './doctor-live.js'

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface DoctorCheck {
  /** Stable name for the check, e.g. `workflow-branches`. */
  id: string
  status: CheckStatus
  /** One or two plain sentences: what was found and, if it's wrong, how to fix it. */
  message: string
  /** The individual problems behind the message, when there are several. */
  details?: string[]
}

export interface DoctorReport {
  /** Null when the directory is neither an Expo nor a Next.js app. */
  framework: Framework | null
  /** The workflow's `test-data` input, when a workflow was found and could be read. */
  testData?: string
  /** The workflow's `app-id` input, for web apps. */
  appId?: string
  /** Resolved @tapthrough versions from the lockfile, by package. */
  versions?: Record<string, string[]>
  checks: DoctorCheck[]
  summary: Record<CheckStatus, number>
  /** What no check can verify. Always printed. */
  note: string
}

export const DATABASE_NOTE =
  "The doctor can't see which database a preview uses. Set TAPTHROUGH_ENV only where the database is safe to write test data to, and never on production."

const DOCS = 'https://github.com/tapthrough/tapthrough/blob/main/docs'
const SOURCE_EXT = '(tsx|ts|jsx|js|mjs|cjs)'
const EXPO_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs']

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Source text without comments, so a commented-out example doesn't count as set up. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

function parseJson(text: string | null): unknown {
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A path under the repo root, as `project.read` and `project.list` want it. */
function fromRepoRoot(project: Project, relative: string): string {
  const depth = project.appRoot === '' ? 0 : project.appRoot.split('/').length
  return `${'../'.repeat(depth)}${relative}`
}

/** A source file under the app directory, by name without its extension. */
function appSource(project: Project, name: string): { file: string; text: string } | null {
  if (!project.appDir) return null
  const pattern = new RegExp(
    `^${`${project.appDir}/${name}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.${SOURCE_EXT}$`,
  )
  for (const [file, text] of project.sources) {
    if (pattern.test(file)) return { file, text: withoutComments(text) }
  }
  return null
}

const RENDERS_TAPTHROUGH = /<Tapthrough[\s/>]/

/** Source files other than `skip` that render `<Tapthrough>`. */
function rendersElsewhere(project: Project, skip: string | undefined): string | undefined {
  for (const [file, text] of project.sources) {
    if (file === skip || !text.includes('@tapthrough/')) continue
    if (RENDERS_TAPTHROUGH.test(withoutComments(text))) return file
  }
  return undefined
}

function checkApp(project: Project, framework: Framework | null): DoctorCheck {
  const id = 'app'
  if (!framework) {
    return {
      id,
      status: 'fail',
      message:
        "This isn't an Expo or Next.js app: package.json lists neither `expo` nor `next`. Run the doctor in the app's directory, or pass --dir.",
    }
  }
  const name = framework === 'next-app' ? 'Next.js app' : 'Expo app (Expo Router)'
  if (!project.appDir) {
    return {
      id,
      status: 'fail',
      message: `${name}, but it has no app or src/app directory. Tapthrough finds screens in the ${framework === 'next-app' ? 'App Router' : 'Expo Router'} directory.`,
    }
  }
  return {
    id,
    status: 'pass',
    message: `${name}; ${plural(project.routes.length, 'screen')} in ${project.appDir}.`,
  }
}

function checkSdk(project: Project, framework: Framework): DoctorCheck {
  const id = 'sdk'
  const sdk = framework === 'next-app' ? '@tapthrough/next' : '@tapthrough/expo'
  const install = framework === 'next-app' ? `npm install ${sdk}` : `npx expo install ${sdk}`
  const json = parseJson(project.read('package.json'))
  const deps = isObject(json)
    ? {
        ...(isObject(json.devDependencies) ? json.devDependencies : {}),
        ...(isObject(json.dependencies) ? json.dependencies : {}),
      }
    : {}
  const range = deps[sdk]
  if (typeof range !== 'string') {
    return { id, status: 'fail', message: `${sdk} isn't in package.json. Run \`${install}\`.` }
  }
  return { id, status: 'pass', message: `${sdk} ${range} is in package.json.` }
}

function findLockfile(project: Project): { name: LockfileName; text: string } | null {
  for (const base of ['', fromRepoRoot(project, '')]) {
    for (const name of LOCKFILES) {
      const text = project.read(`${base}${name}`)
      if (text !== null) return { name, text }
    }
    if (project.appRoot === '') break
  }
  return null
}

function checkVersions(project: Project): DoctorCheck {
  const id = 'sdk-versions'
  const lockfile = findLockfile(project)
  if (!lockfile) {
    return {
      id,
      status: 'warn',
      message:
        "Couldn't tell which versions get installed: no pnpm-lock.yaml, yarn.lock or package-lock.json here or at the repo root.",
    }
  }
  const versions = resolvedVersions(lockfile.name, lockfile.text)
  if (!versions) {
    return { id, status: 'warn', message: `Couldn't tell: ${lockfile.name} couldn't be read.` }
  }
  if (versions.size === 0) {
    return {
      id,
      status: 'warn',
      message: `${lockfile.name} lists no @tapthrough packages. Install again so the lockfile includes them, and commit it.`,
    }
  }
  const list = [...versions].map(([name, found]) => `${name} ${found.join(' and ')}`)
  const split = [...versions].filter(([, found]) => found.length > 1).map(([name]) => name)
  if (split.length > 0) {
    const dedupe =
      lockfile.name === 'package-lock.json'
        ? 'npm dedupe'
        : lockfile.name === 'yarn.lock'
          ? 'yarn dedupe` (Yarn 2 or later) or `npx yarn-deduplicate && yarn install'
          : 'pnpm dedupe'
    return {
      id,
      status: 'warn',
      message: `${lockfile.name} resolves ${split.join(', ')} to more than one version, so an old copy may be the one that runs. Upgrade the @tapthrough packages together, then run \`${dedupe}\`.`,
      details: list,
    }
  }
  return { id, status: 'pass', message: `${lockfile.name} resolves ${list.join(', ')}.` }
}

interface FoundWorkflow extends WorkflowInfo {
  file: string
}

function findWorkflows(project: Project): FoundWorkflow[] {
  const dir = fromRepoRoot(project, '.github/workflows')
  const found: FoundWorkflow[] = []
  for (const name of project.list(dir).filter((file) => /\.ya?ml$/.test(file))) {
    const text = project.read(`${dir}/${name}`)
    if (text === null || !usesTapthroughAction(text)) continue
    found.push({ file: `.github/workflows/${name}`, ...readWorkflow(text) })
  }
  return found
}

function checkWorkflow(workflow: FoundWorkflow, framework: Framework): DoctorCheck {
  const id = 'workflow'
  const { file, inputs } = workflow
  const problems: string[] = []
  if (!workflow.idToken) {
    problems.push(
      "It needs `id-token: write` under `permissions`; without it the Action can't prove which repo it runs for.",
    )
  }
  if (!inputs) {
    return {
      id,
      status: problems.length > 0 ? 'fail' : 'warn',
      message: `${file} uses the Tapthrough action, but the doctor couldn't read its \`with:\` inputs.${problems.map((p) => ` ${p}`).join('')}`,
    }
  }

  const platform = inputs.platform ?? 'auto'
  const web = framework === 'next-app'
  const shown = [`platform ${platform}`]
  if (web) {
    shown.push(
      `app-id ${inputs['app-id'] ?? '(not set)'}`,
      `test-data ${inputs['test-data'] ?? 'on'}`,
    )
  }
  if (!['auto', 'web', 'expo'].includes(platform) && !platform.includes('${{')) {
    problems.push(`\`platform: ${platform}\` isn't one of web, expo or auto.`)
  } else if ((platform === 'web' && !web) || (platform === 'expo' && web)) {
    problems.push(
      `\`platform: ${platform}\` doesn't match this ${web ? 'Next.js' : 'Expo'} app. Use \`${web ? 'web' : 'expo'}\` or leave it out.`,
    )
  }
  if (web && !inputs['app-id']) {
    problems.push('Web needs `app-id`: the same app ID `<Tapthrough appId>` uses.')
  }
  if (
    web &&
    inputs['test-data'] &&
    !['on', 'off'].includes(inputs['test-data']) &&
    !inputs['test-data'].includes('${{')
  ) {
    problems.push(`\`test-data: ${inputs['test-data']}\` should be "on" or "off".`)
  }
  if (!web && !inputs['update-json']) {
    problems.push('Expo needs `update-json`: the file `eas update --json` wrote.')
  }
  const summary = `${file} uses the Tapthrough action (${shown.join(', ')}).`
  return {
    id,
    status: problems.length > 0 ? 'fail' : 'pass',
    message: [summary, ...problems].join(' '),
  }
}

function checkBranches(workflow: FoundWorkflow): DoctorCheck {
  const id = 'workflow-branches'
  const { file, trigger } = workflow
  if (trigger.kind === 'all') {
    return { id, status: 'pass', message: `${file} runs for pull requests into every branch.` }
  }
  if (trigger.kind === 'none') {
    return {
      id,
      status: 'fail',
      message: `${file} doesn't run on \`pull_request\`, so no PR gets a Tapthrough comment. Add \`on: pull_request\`.`,
    }
  }
  if (trigger.kind === 'unknown') {
    return {
      id,
      status: 'warn',
      message: `Couldn't tell which pull requests ${file} runs for. Check its \`on.pull_request\` section: a \`branches\` list there leaves out PRs into other branches.`,
    }
  }
  const limits: string[] = []
  if (trigger.branches) limits.push(`into ${trigger.branches.join(', ')}`)
  if (trigger.branchesIgnore) limits.push(`not into ${trigger.branchesIgnore.join(', ')}`)
  if (trigger.paths) limits.push(`that change ${trigger.paths.join(', ')}`)
  if (trigger.pathsIgnore) limits.push(`that change more than ${trigger.pathsIgnore.join(', ')}`)
  const keys = [
    trigger.branches && 'branches',
    trigger.branchesIgnore && 'branches-ignore',
    trigger.paths && 'paths',
    trigger.pathsIgnore && 'paths-ignore',
  ].filter(Boolean)
  return {
    id,
    status: 'warn',
    message: `${file} runs only for pull requests ${limits.join(' and ')}. Other PRs get no Tapthrough comment. Remove \`${keys.join('`, `')}\` under \`on.pull_request\` to cover them all.`,
  }
}

function literalAppId(text: string | undefined, pattern: RegExp): string | undefined {
  return text === undefined ? undefined : pattern.exec(text)?.[1]
}

function checkWeb(project: Project, workflow: FoundWorkflow | undefined): DoctorCheck[] {
  const checks: DoctorCheck[] = []
  const appDir = project.appDir ?? 'app'
  const layout = appSource(project, 'layout')
  const inLayout = layout !== null && RENDERS_TAPTHROUGH.test(layout.text)
  const elsewhere = inLayout ? undefined : rendersElsewhere(project, layout?.file)

  if (!layout) {
    checks.push({
      id: 'web-panel',
      status: 'fail',
      message: `No root layout at ${appDir}/layout.tsx. Add one and render \`<Tapthrough appId="…" />\` from @tapthrough/next/panel in its body.`,
    })
  } else if (inLayout) {
    checks.push({
      id: 'web-panel',
      status: 'pass',
      message: `${layout.file} renders <Tapthrough>.`,
    })
  } else if (elsewhere) {
    checks.push({
      id: 'web-panel',
      status: 'warn',
      message: `Couldn't tell: <Tapthrough> is rendered in ${elsewhere}, not in ${layout.file}. Make sure the root layout renders it on every page.`,
    })
  } else {
    checks.push({
      id: 'web-panel',
      status: 'fail',
      message: `${layout.file} doesn't render <Tapthrough>, so previews have no Review button. Add \`<Tapthrough appId="…" />\` from @tapthrough/next/panel inside <body>.`,
    })
  }

  const route = appSource(project, 'api/tapthrough/launch/route')
  const routePath = `${appDir}/api/tapthrough/launch/route.ts`
  const testData = workflow?.inputs ? (workflow.inputs['test-data'] ?? 'on') : undefined
  if (route) {
    const made = route.text.includes('createLaunchRoute')
    checks.push({
      id: 'web-launch-route',
      status: made ? 'pass' : 'warn',
      message: made
        ? `${route.file} is the launch route.${testData === 'off' ? ' The workflow has `test-data: "off"`, so links don\'t use it yet.' : ''}`
        : `Couldn't tell: ${route.file} exists but doesn't call createLaunchRoute from @tapthrough/next.`,
    })
  } else if (testData === 'off') {
    checks.push({
      id: 'web-launch-route',
      status: 'pass',
      message: 'No launch route, and none is needed: the workflow has `test-data: "off"`.',
    })
  } else if (testData === undefined) {
    checks.push({
      id: 'web-launch-route',
      status: 'warn',
      message: `No launch route at ${routePath}. That is fine with \`test-data: "off"\` in the workflow; with test data on, links fail without it.`,
    })
  } else {
    checks.push({
      id: 'web-launch-route',
      status: 'fail',
      message: `The workflow has test data on, but there is no launch route at ${routePath}. Add it (${DOCS}/getting-started-nextjs.md#the-launch-route) or set \`test-data: "off"\`.`,
    })
  }

  const ids = new Map<string, string>()
  const fromLayout = literalAppId(layout?.text, /<Tapthrough\b[^>]*\bappId=["']([^"']+)["']/)
  const fromRoute = literalAppId(
    route?.text,
    /createLaunchRoute\(\s*\{[^}]*?\bappId:\s*["']([^"']+)["']/,
  )
  const fromWorkflow = workflow?.inputs?.['app-id']
  if (fromLayout && layout) ids.set(layout.file, fromLayout)
  if (fromRoute && route) ids.set(route.file, fromRoute)
  if (fromWorkflow && workflow && !fromWorkflow.includes('${{'))
    ids.set(workflow.file, fromWorkflow)
  if (ids.size > 1) {
    const same = new Set(ids.values()).size === 1
    checks.push({
      id: 'app-id',
      status: same ? 'pass' : 'fail',
      message: same
        ? `The app ID is ${[...ids.values()][0]} everywhere it is set.`
        : `The app ID differs: ${[...ids].map(([file, value]) => `${value} in ${file}`).join(', ')}. Use one app ID in all of them, or links are refused.`,
    })
  }
  return checks
}

interface ExpoPlugin {
  /** Whether the plugin is listed; `unknown` when a JS config didn't say either way. */
  listed: 'yes' | 'no' | 'unknown'
  where?: string
  seedHookUrl: boolean
  /** Set when app.json alone configures it, so it can't be turned off per build. */
  alwaysOn?: boolean
}

function readExpoPlugin(project: Project): ExpoPlugin {
  const jsName = EXPO_CONFIGS.find((name) => project.read(name) !== null)
  const jsText = jsName ? withoutComments(project.read(jsName) ?? '') : undefined
  if (jsName && jsText && /['"`]@tapthrough\/expo['"`]/.test(jsText)) {
    return { listed: 'yes', where: jsName, seedHookUrl: /\bseedHookUrl\b\s*[:,}]/.test(jsText) }
  }

  const json = parseJson(project.read('app.json'))
  const expo = isObject(json) && isObject(json.expo) ? json.expo : json
  const plugins = isObject(expo) && Array.isArray(expo.plugins) ? expo.plugins : []
  const entry = plugins.find(
    (plugin) =>
      plugin === '@tapthrough/expo' || (Array.isArray(plugin) && plugin[0] === '@tapthrough/expo'),
  )
  if (entry !== undefined) {
    const options: unknown = Array.isArray(entry) ? entry[1] : undefined
    const props = isObject(options) ? options : {}
    return {
      listed: 'yes',
      where: 'app.json',
      seedHookUrl: typeof props.seedHookUrl === 'string' && props.seedHookUrl !== '',
      alwaysOn: !jsName && props.enabled !== false,
    }
  }
  // A JS config can build its plugin list anywhere; not seeing the name isn't proof.
  if (jsName) return { listed: 'unknown', where: jsName, seedHookUrl: false }
  return { listed: 'no', seedHookUrl: false }
}

function checkMobile(project: Project, needs: StateNeeds): DoctorCheck[] {
  const checks: DoctorCheck[] = []
  const plugin = readExpoPlugin(project)
  const example = "`['@tapthrough/expo', { enabled: process.env.APP_VARIANT !== 'production' }]`"
  if (plugin.listed === 'no') {
    checks.push({
      id: 'mobile-plugin',
      status: 'fail',
      message: `The config plugin isn't in app.json and there is no app.config file. Add ${example} to \`plugins\` in app.config.ts.`,
    })
  } else if (plugin.listed === 'unknown') {
    checks.push({
      id: 'mobile-plugin',
      status: 'warn',
      message: `Couldn't tell: ${plugin.where} doesn't mention @tapthrough/expo, but it may build its plugins elsewhere. Check that \`plugins\` includes ${example}.`,
    })
  } else if (plugin.alwaysOn) {
    checks.push({
      id: 'mobile-plugin',
      status: 'warn',
      message:
        'The config plugin is in app.json, where it is on in every build, store builds included. Move the config to app.config.ts and set `enabled` from the build variant.',
    })
  } else {
    checks.push({
      id: 'mobile-plugin',
      status: 'pass',
      message: `The config plugin is in ${plugin.where}${plugin.where === 'app.json' ? '' : ' (found by a text search)'}.`,
    })
  }

  const layout = appSource(project, '_layout')
  const appDir = project.appDir ?? 'app'
  const wraps = layout !== null && RENDERS_TAPTHROUGH.test(layout.text)
  const elsewhere = wraps ? undefined : rendersElsewhere(project, layout?.file)
  if (!layout) {
    checks.push({
      id: 'mobile-wrapper',
      status: 'fail',
      message: `No root layout at ${appDir}/_layout.tsx. Add one and wrap its content in <Tapthrough> from @tapthrough/expo.`,
    })
  } else if (wraps) {
    checks.push({
      id: 'mobile-wrapper',
      status: 'pass',
      message: `${layout.file} wraps the app in <Tapthrough>.`,
    })
  } else if (elsewhere) {
    checks.push({
      id: 'mobile-wrapper',
      status: 'warn',
      message: `Couldn't tell: <Tapthrough> is used in ${elsewhere}, not in ${layout.file}. Make sure it wraps the root layout's content.`,
    })
  } else {
    checks.push({
      id: 'mobile-wrapper',
      status: 'fail',
      message: `${layout.file} doesn't use <Tapthrough>, so launch links do nothing. Wrap the layout's content: \`<Tapthrough><Stack /></Tapthrough>\`.`,
    })
  }

  const asProp = [...project.sources.values()].some(
    (text) =>
      text.includes('@tapthrough/expo') &&
      /<Tapthrough\b[^>]*\bseedHookUrl=/.test(withoutComments(text)),
  )
  if (plugin.seedHookUrl || asProp) {
    checks.push({
      id: 'mobile-seed-hook',
      status: 'pass',
      message: `\`seedHookUrl\` is set${plugin.seedHookUrl ? ` in ${plugin.where}` : ' on <Tapthrough>'}. Run the doctor with --url <that URL> to check the hook answers.`,
    })
  } else if (plugin.listed !== 'unknown' && needs.fixtures > 0 && needs.seedHook === 0) {
    checks.push({
      id: 'mobile-seed-hook',
      status: 'pass',
      message: `No seed hook is needed: ${needs.fixtures === 1 ? 'the scenario uses' : `all ${needs.fixtures} scenarios use`} fixtures.`,
    })
  } else {
    const count =
      needs.seedHook > 0
        ? `${plural(needs.seedHook, 'scenario')} need${needs.seedHook === 1 ? 's' : ''} one`
        : ''
    checks.push({
      id: 'mobile-seed-hook',
      status: 'warn',
      message:
        plugin.listed === 'unknown'
          ? "Couldn't tell whether `seedHookUrl` is set. Without it, only scenarios that use fixtures open; the rest fail with no sign-in and no test data."
          : `\`seedHookUrl\` isn't set${count ? `, and ${count}` : ''}. Without it, only scenarios that use fixtures open. Deploy a seed hook and pass its URL to the config plugin, or use fixtures (${DOCS}/fixtures.md).`,
    })
  }
  return checks
}

/** How many scenarios need each way of getting their starting state. */
interface StateNeeds {
  fixtures: number
  /** Shared-account and preset scenarios; both go through the seed hook. */
  seedHook: number
}

function readScenarios(project: Project): ScenarioSpec[] {
  return [
    ...readLibrary(project).scenarios,
    ...readPlans(project).flatMap((plan) =>
      plan.result.status === 'ok' ? plan.result.plan.scenarios : [],
    ),
  ]
}

function stateNeeds(scenarios: ScenarioSpec[]): StateNeeds {
  const fixtures = scenarios.filter((scenario) => scenario.seed.tier === 1).length
  return { fixtures, seedHook: scenarios.length - fixtures }
}

function checkScenarioFiles(project: Project, framework: Framework): DoctorCheck[] {
  const library = readLibrary(project)
  const plans = readPlans(project)
  const issues = checkScenarios({
    routes: project.routes,
    library,
    plans,
    readFixtures: (name) => project.read(`${FIXTURES_DIR}/${name}.json`),
  })
  const scenarios: ScenarioSpec[] = [
    ...library.scenarios,
    ...plans.flatMap((plan) => (plan.result.status === 'ok' ? plan.result.plan.scenarios : [])),
  ]
  const count = plural(scenarios.length, 'scenario')

  const checks: DoctorCheck[] = []
  if (issues.length > 0) {
    checks.push({
      id: 'scenarios',
      status: 'fail',
      message: `${count}, ${plural(issues.length, 'problem')}. The service skips broken files; fix them, then run \`tapthrough check\`.`,
      details: issues.map((issue) => `${issue.file}: ${issue.message}`),
    })
  } else if (scenarios.length === 0) {
    checks.push({
      id: 'scenarios',
      status: 'warn',
      message: `No scenarios yet, so reviewers get a link but nothing to check. Add one JSON file per scenario in .tapthrough/scenarios (${DOCS}/plan-files.md).`,
    })
  } else {
    checks.push({ id: 'scenarios', status: 'pass', message: `${count}, no problems.` })
  }

  const onFixtures = stateNeeds(scenarios).fixtures
  if (framework === 'next-app' && onFixtures > 0) {
    checks.push({
      id: 'scenario-fixtures',
      status: 'fail',
      message: `${plural(onFixtures, 'scenario')} use${onFixtures === 1 ? 's' : ''} fixtures, which work in Expo apps only for now. On web, use a preset or a shared test account.`,
    })
  }

  const presets = [
    ...new Set(scenarios.flatMap((s) => (s.seed.preset ? [s.seed.preset] : []))),
  ].sort()
  if (presets.length === 0) return checks
  const sources = [...project.sources.values()]
  if (!sources.some((text) => /\b(createSeedHandler|definePreset)\b/.test(text))) {
    checks.push({
      id: 'scenario-presets',
      status: 'warn',
      message: `Couldn't tell whether the ${plural(presets.length, 'preset')} the scenarios use exist: the seed hook's code isn't in this directory. Check its presets include ${presets.join(', ')}.`,
    })
    return checks
  }
  const missing = presets.filter((preset) => {
    const name = preset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const named = new RegExp(`['"\`]${name}['"\`]|(^|[\\s{,])${name}\\s*[:,(}]`, 'm')
    return !sources.some((text) => named.test(text))
  })
  checks.push(
    missing.length > 0
      ? {
          id: 'scenario-presets',
          status: 'warn',
          message: `Scenarios use ${plural(missing.length, 'preset')} that no source file names: ${missing.join(', ')}. A link to one fails with "Unknown preset". Add the preset to the seed hook or fix the scenario.`,
        }
      : {
          id: 'scenario-presets',
          status: 'pass',
          message: `The ${plural(presets.length, 'preset')} the scenarios use ${presets.length === 1 ? 'is' : 'are'} named in the source.`,
        },
  )
  return checks
}

function summarize(checks: DoctorCheck[]): Record<CheckStatus, number> {
  const summary = { pass: 0, warn: 0, fail: 0 }
  for (const check of checks) summary[check.status]++
  return summary
}

/**
 * Checks a customer's setup from the files on disk: which kind of app it is,
 * the SDK, where `<Tapthrough>` is rendered, the workflow and the scenarios.
 * No network. `liveChecks` adds what a deployment says about itself.
 */
export function runDoctor(project: Project): DoctorReport {
  const framework = detectFramework(project.read('package.json'))
  const checks: DoctorCheck[] = [checkApp(project, framework)]
  if (!framework || !project.appDir) {
    return { framework, checks, summary: summarize(checks), note: DATABASE_NOTE }
  }

  const workflows = findWorkflows(project)
  const lockfile = findLockfile(project)
  const versions = lockfile ? resolvedVersions(lockfile.name, lockfile.text) : null
  checks.push(checkSdk(project, framework), checkVersions(project))
  checks.push(
    ...(framework === 'next-app'
      ? checkWeb(project, workflows[0])
      : checkMobile(project, stateNeeds(readScenarios(project)))),
  )
  if (workflows.length === 0) {
    checks.push({
      id: 'workflow',
      status: 'fail',
      message: `No workflow in .github/workflows uses tapthrough/tapthrough, so no PR gets a comment. Add one: ${DOCS}/${framework === 'next-app' ? 'getting-started-nextjs.md#3-add-the-workflow' : 'getting-started.md#4-add-the-workflow'}.`,
    })
  }
  for (const workflow of workflows) {
    checks.push(checkWorkflow(workflow, framework), checkBranches(workflow))
  }
  checks.push(...checkScenarioFiles(project, framework))

  const inputs = workflows[0]?.inputs
  return {
    framework,
    ...(framework === 'next-app' && inputs ? { testData: inputs['test-data'] ?? 'on' } : {}),
    ...(framework === 'next-app' && inputs?.['app-id'] ? { appId: inputs['app-id'] } : {}),
    ...(versions && versions.size > 0 ? { versions: Object.fromEntries(versions) } : {}),
    checks,
    summary: summarize(checks),
    note: DATABASE_NOTE,
  }
}

/** The report with the `--url` checks added after the static ones. */
export function withLiveChecks(report: DoctorReport, live: DoctorCheck[]): DoctorReport {
  const checks = [...report.checks, ...live]
  return { ...report, checks, summary: summarize(checks) }
}

export function doctorExitCode(report: DoctorReport): number {
  return report.summary.fail > 0 ? 1 : 0
}

/** One line per check, then the totals and the reminder about the database. */
export function formatDoctor(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((check) => check.id.length))
  const lines = report.checks.flatMap((check) => [
    `${check.status}  ${check.id.padEnd(width)}  ${check.message}`,
    ...(check.details ?? []).map((detail) => `      ${''.padEnd(width)}  ${detail}`),
  ])
  const { pass, warn, fail } = report.summary
  return [
    ...lines,
    '',
    `${pass} passed, ${plural(warn, 'warning')}, ${fail} failed.`,
    `Note: ${report.note}`,
  ].join('\n')
}
