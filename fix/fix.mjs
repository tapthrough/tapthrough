// The Tapthrough fix workflow, in four steps run by action.yml. Plain Node,
// no dependencies. The push token only reaches the last step: the agent runs
// with file tools only and an environment holding nothing but its model key.
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const workdir = path.join(process.env.RUNNER_TEMP ?? '/tmp', 'tapthrough-fix')
const taskFile = path.join(workdir, 'task.json')
const apiUrl = (process.env.TAPTHROUGH_API_URL ?? '').replace(/\/$/, '')

/** Paths the agent must never change; restored before committing. */
const PROTECTED = [
  /^\.github\//,
  /^\.tapthrough\//,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/,
]

/** A build adds a scenario for its screen, so testers land on it; nothing else in `.tapthrough/`. */
const BUILD_ALLOWED = [/^\.tapthrough\/scenarios\/[\w-]+\.json$/]

/** A code review may only add or change tests. */
const TEST_FILE = /(^|\/)(__tests__|__snapshots__)\/|\.(test|spec)\.[cm]?[jt]sx?$/
const testsFile = path.join(workdir, 'tests.json')
const testOutputFile = path.join(workdir, 'test-output.txt')

function isProtected(file, mode) {
  if (mode === 'review') return !TEST_FILE.test(file) || PROTECTED.some((pattern) => pattern.test(file))
  if (mode === 'build' && BUILD_ALLOWED.some((pattern) => pattern.test(file))) return false
  return PROTECTED.some((pattern) => pattern.test(file))
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !bearer) {
    throw new Error('No OIDC token: add `permissions: id-token: write` to the fix workflow.')
  }
  const response = await fetch(`${url}&audience=${encodeURIComponent(apiUrl)}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  })
  if (!response.ok) throw new Error(`Couldn't get an OIDC token: ${response.status}`)
  return (await response.json()).value
}

async function api(route, body) {
  const response = await fetch(`${apiUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await oidcToken()}` },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    let message = text
    try {
      message = JSON.parse(text).error?.message ?? text
    } catch {}
    throw new Error(`Tapthrough ${route} returned ${response.status}: ${message}`)
  }
  return text ? JSON.parse(text) : undefined
}

/**
 * Other repos the agent may read, like the app's API, cloned read-only into the
 * working folder. The token goes in a one-off header, so it isn't saved in the
 * clone's config where the agent could read it. A failed clone is a warning.
 */
function cloneContext(context) {
  if (!context?.token || !context.repos?.length) return
  const auth = Buffer.from(`x-access-token:${context.token}`).toString('base64')
  console.log(`::add-mask::${auth}`)
  for (const { repo, path: dir } of context.repos) {
    if (!dir.startsWith(`${workdir}/`)) continue
    rmSync(dir, { recursive: true, force: true })
    try {
      execFileSync(
        'git',
        [
          '-c',
          `http.extraheader=AUTHORIZATION: basic ${auth}`,
          'clone',
          '--depth',
          '1',
          '--no-tags',
          '--quiet',
          `https://github.com/${repo}.git`,
          dir,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      )
      console.log(`Cloned ${repo} for reference.`)
    } catch (error) {
      console.log(
        `::warning::Couldn't clone ${repo} for reference: ${String(error.stderr ?? error).slice(0, 300)}`,
      )
    }
  }
}

async function claim() {
  const fixRequestId = process.env.FIX_REQUEST_ID
  if (!fixRequestId) throw new Error('This workflow runs from Tapthrough’s repository_dispatch.')
  mkdirSync(workdir, { recursive: true })
  const task = await api('/api/v1/fix/claim', { apiVersion: 1, fixRequestId, workdir })
  // Grooming gets no token at all.
  if (task.pushToken) console.log(`::add-mask::${task.pushToken}`)
  if (task.context?.token) console.log(`::add-mask::${task.context.token}`)
  cloneContext(task.context)
  // Neither token is written down: the push token goes to the last step only.
  const { pushToken, context, ...rest } = task
  writeFileSync(
    taskFile,
    JSON.stringify(
      { ...rest, context: context ? { repos: context.repos } : undefined, fixRequestId },
      null,
      2,
    ),
  )
  output('claimed', 'true')
  output('mode', task.mode)
  output('head-ref', task.headRef)
  // An issue fix starts from the default branch and pushes a branch of its own.
  output('checkout-ref', task.checkoutRef ?? task.headRef)
  output('push-token', pushToken)
  const what = {
    issue: `Fixing issue #${task.issue} from ${task.checkoutRef}, onto ${task.headRef}.`,
    groom: `Writing up an idea from the app against ${task.checkoutRef}.`,
    review: `Reviewing the code of PR #${task.pr} (branch ${task.headRef}).`,
    build: `Building idea #${task.issue} from ${task.checkoutRef}, onto ${task.headRef}.`,
  }
  console.log(what[task.mode] ?? `Fixing a report on PR #${task.pr} (branch ${task.headRef}).`)
}

async function prepare() {
  const task = JSON.parse(readFileSync(taskFile, 'utf8'))
  // Only a PR fix or review has a diff; issues and ideas start from the default branch.
  if (task.mode === 'pr' || task.mode === 'review' || task.mode === undefined) {
    // fetch-depth: 0 already has the base branch; fetch it again only if it's missing.
    try {
      git('rev-parse', '--verify', `origin/${task.baseRef}`)
    } catch {
      git('fetch', '--no-tags', 'origin', task.baseRef)
    }
    const diff = git('diff', `origin/${task.baseRef}...HEAD`)
    writeFileSync(task.paths.diff, diff)
  }
  if (task.screenshotUrl) {
    const response = await fetch(task.screenshotUrl)
    if (response.ok) writeFileSync(task.paths.screenshot, Buffer.from(await response.arrayBuffer()))
  }
  if (task.mode === 'review') {
    const setup = testSetup()
    task.testCommand = setup?.command ?? null
    task.install = setup?.install ?? null
    task.prompt = `${task.prompt}\n\n${testSetupPrompt(setup)}`
    writeFileSync(taskFile, JSON.stringify(task, null, 2))
  }
  writeFileSync(path.join(workdir, 'prompt.md'), task.prompt)
}

/**
 * How this repo runs its tests: its package manager and `test` script. Null
 * when it has none, so the review writes no tests.
 */
function testSetup() {
  let pkg
  try {
    pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  } catch {
    return null
  }
  const script = pkg.scripts?.test
  if (typeof script !== 'string' || !script.trim() || /no test specified/.test(script)) return null
  const manager = existsSync('pnpm-lock.yaml')
    ? 'pnpm'
    : existsSync('yarn.lock')
      ? 'yarn'
      : existsSync('bun.lockb') || existsSync('bun.lock')
        ? 'bun'
        : 'npm'
  const install = {
    npm: existsSync('package-lock.json') ? ['npm', 'ci'] : ['npm', 'install'],
    pnpm: ['pnpm', 'install', '--frozen-lockfile'],
    yarn: ['yarn', 'install', '--frozen-lockfile'],
    bun: ['bun', 'install', '--frozen-lockfile'],
  }[manager]
  // `--` passes the test files on to Jest or Vitest.
  const command = manager === 'npm' ? ['npm', 'test', '--'] : [manager, 'test']
  const existing = git('ls-files')
    .split('\n')
    .filter((file) => TEST_FILE.test(file) && !file.includes('node_modules/'))
    .slice(0, 15)
  return { manager, install, command, script, existing }
}

function testSetupPrompt(setup) {
  if (!setup) {
    return [
      '## Test setup',
      '',
      'This repo has no `test` script, so there is nothing to run tests with. Write no test files. Put the most important cases that should be tested in your findings instead (severity "low"), and set `tests` to [].',
    ].join('\n')
  }
  return [
    '## Test setup',
    '',
    `Tests run with \`${setup.command.join(' ')} <files>\` (the \`test\` script is \`${setup.script}\`).`,
    ...(setup.existing.length
      ? [
          'Existing tests to copy the style of:',
          ...setup.existing.map((file) => `- ${file}`),
        ]
      : ['There are no tests yet: write the first ones in the style the test script expects.']),
  ].join('\n')
}

/** Installs the repo's dependencies so its tests can run. No secrets are in this step's environment. */
function install() {
  const task = JSON.parse(readFileSync(taskFile, 'utf8'))
  if (task.mode !== 'review' || !task.install) return
  if (task.install[0] !== 'npm') execFileSync('corepack', ['enable'], { stdio: 'inherit' })
  execFileSync(task.install[0], task.install.slice(1), {
    stdio: 'inherit',
    env: testEnv(),
    timeout: 10 * 60 * 1000,
  })
}

/** What test commands see: no GitHub, OIDC or model tokens. */
function testEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    CI: 'true',
    NODE_ENV: 'test',
    TZ: 'UTC',
  }
}

/** Test files the agent added or changed, after anything else it touched is undone. */
function agentTests() {
  restoreProtected('review')
  return git('status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^.* -> /, ''))
    .filter((file) => TEST_FILE.test(file) && !/__snapshots__\//.test(file) && existsSync(file))
}

function countCases(file) {
  try {
    return (readFileSync(file, 'utf8').match(/\b(it|test)(\.each\([\s\S]*?\))?\s*\(/g) ?? [])
      .length
  } catch {
    return 0
  }
}

/**
 * Runs the agent's tests. On a failure the first time, it hands the output to
 * the agent's second try; the final time, it drops the tests and says why.
 */
function verify() {
  const task = JSON.parse(readFileSync(taskFile, 'utf8'))
  if (task.mode !== 'review') return
  const final = process.argv[3] === 'final'
  const files = agentTests()
  const write = (tests) => writeFileSync(testsFile, JSON.stringify(tests, null, 2))
  if (!task.testCommand) {
    write({ status: 'none', added: [] })
    output('failed', 'false')
    return
  }
  if (files.length === 0) {
    write({ status: 'not_run', added: [] })
    output('failed', 'false')
    return
  }
  const [cmd, ...args] = task.testCommand
  const run = spawnSync(cmd, [...args, ...files], {
    env: testEnv(),
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const text = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim()
  console.log(text.slice(-6000))
  if (run.status === 0) {
    write({ status: 'passed', added: files.map((file) => ({ file, cases: countCases(file) })) })
    output('failed', 'false')
    return
  }
  writeFileSync(testOutputFile, text.slice(-20000))
  if (!final) {
    console.log("The agent's tests failed; giving it one more try with the output.")
    output('failed', 'true')
    return
  }
  // Still failing: leave its tests out, and say why on the PR.
  for (const file of files) {
    if (git('ls-files', '--', file)) git('checkout', 'HEAD', '--', file)
    else rmSync(file, { force: true })
  }
  write({ status: 'failed', added: [], output: text.slice(-3000) })
  output('failed', 'true')
}

function agent() {
  const task = JSON.parse(readFileSync(taskFile, 'utf8'))
  // Grooming reads the code and writes only its verdict; nothing it changes is pushed.
  const groom = task.mode === 'groom'
  const retry = process.argv[3] === 'retry'
  const prompt =
    task.mode === 'review' && retry
      ? `${task.prompt}\n\n## Your tests failed\n\nThe test run's output is in ${testOutputFile}. Fix the tests you wrote so they pass, changing only test files. If a test fails because the app code is wrong, delete that test and add the problem to \`findings\`. Then write ${task.paths.verdict} again.`
      : task.prompt
  const turns =
    (task.mode === 'review' && process.env.CLAUDE_REVIEW_MAX_TURNS) ||
    (groom && process.env.CLAUDE_GROOM_MAX_TURNS) ||
    (task.mode === 'build' && process.env.CLAUDE_BUILD_MAX_TURNS) ||
    process.env.CLAUDE_MAX_TURNS ||
    '40'
  const args = [
    '-p',
    prompt,
    '--allowedTools',
    groom ? 'Read,Glob,Grep,Write' : 'Read,Edit,MultiEdit,Write,Glob,Grep',
    '--disallowedTools',
    groom
      ? 'Bash,WebFetch,WebSearch,NotebookEdit,Edit,MultiEdit'
      : 'Bash,WebFetch,WebSearch,NotebookEdit',
    '--permission-mode',
    'acceptEdits',
    '--add-dir',
    workdir,
    '--max-turns',
    turns,
    '--output-format',
    'json',
  ]
  if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL)
  // Only what Claude Code needs: no GitHub or OIDC tokens.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    CI: 'true',
    DISABLE_AUTOUPDATER: '1',
  }
  const result = spawnSync('claude', args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout)
    throw new Error(`Claude Code exited with ${result.status}`)
  }
  try {
    const summary = JSON.parse(result.stdout)
    console.log(
      `Claude finished in ${summary.num_turns ?? '?'} turns, cost $${summary.total_cost_usd ?? '?'}.`,
    )
  } catch {
    console.log(result.stdout.slice(-2000))
  }
}

function readVerdict(file) {
  if (!existsSync(file)) return undefined
  try {
    const verdict = JSON.parse(readFileSync(file, 'utf8'))
    return {
      outcome: verdict.outcome === 'fixed' ? 'fixed' : 'declined',
      fromThisPr: typeof verdict.fromThisPr === 'boolean' ? verdict.fromThisPr : null,
      summary: String(verdict.summary ?? '').slice(0, 1000),
    }
  } catch {
    return undefined
  }
}

/** A groom job's spec, passed on as is; Tapthrough checks its shape. */
function readGroomVerdict(file) {
  if (!existsSync(file)) return undefined
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    if (v.outcome !== 'groomed') {
      return { outcome: 'declined', summary: String(v.summary ?? '').slice(0, 1000) }
    }
    return {
      outcome: 'groomed',
      summary: String(v.summary ?? '').slice(0, 1000),
      idea: {
        title: v.title,
        summary: v.summary,
        spec: v.spec,
        questions: v.questions,
        steps: v.steps,
        size: v.size,
      },
    }
  } catch {
    return undefined
  }
}

/** Undoes anything the agent changed under protected paths. */
function restoreProtected(mode) {
  const changed = git('status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2), file: line.slice(3).replace(/^.* -> /, '') }))
  for (const { code, file } of changed) {
    if (!isProtected(file, mode)) continue
    console.log(`Reverting a change to protected path ${file}`)
    if (code === '??') rmSync(file, { force: true })
    else git('checkout', 'HEAD', '--', file)
  }
}

async function finish() {
  const task = JSON.parse(readFileSync(taskFile, 'utf8'))
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  const report = (fields) =>
    api('/api/v1/fix/result', { apiVersion: 1, fixRequestId: task.fixRequestId, runUrl, ...fields })

  if (process.env.AGENT_OUTCOME !== 'success') {
    await report({ outcome: 'failed', summary: 'The agent step failed; see the run.' })
    return
  }
  if (task.mode === 'review') {
    await finishReview(task, report)
    return
  }
  if (task.mode === 'groom') {
    const groomed = readGroomVerdict(task.paths.verdict)
    await report(groomed ?? { outcome: 'failed', summary: 'Claude wrote no spec.' })
    console.log(groomed?.outcome === 'groomed' ? 'Sent the spec to Tapthrough.' : 'No spec.')
    return
  }
  const verdict = readVerdict(task.paths.verdict)
  restoreProtected(task.mode)
  const dirty = git('status', '--porcelain', '--untracked-files=all') !== ''

  if (!dirty || verdict?.outcome !== 'fixed') {
    await report({
      outcome: 'declined',
      fromThisPr: verdict?.fromThisPr ?? null,
      summary: verdict?.summary || 'Claude made no changes.',
    })
    return
  }

  const build = task.mode === 'build'
  const subject = (
    verdict.summary.split(/(?<=\.)\s/)[0] || (build ? 'Build an idea' : 'Fix a reported issue')
  ).slice(0, 68)
  git('add', '--all')
  execFileSync(
    'git',
    [
      '-c',
      'user.name=tapthrough[bot]',
      '-c',
      'user.email=tapthrough[bot]@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      `${build ? 'Build' : 'Fix'}: ${subject}`,
      '-m',
      `${verdict.summary}\n\n${
        build
          ? `Built from idea #${task.issue}, sent from the app through Tapthrough.`
          : task.mode === 'issue'
            ? `Requested on issue #${task.issue} through Tapthrough.`
            : `Reported by a reviewer on PR #${task.pr} through Tapthrough.`
      }\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
    ],
    { stdio: 'inherit' },
  )
  const commitSha = git('rev-parse', 'HEAD')
  // The App token pushes, so the PR's preview workflow runs for the fix.
  const basic = Buffer.from(`x-access-token:${process.env.PUSH_TOKEN}`).toString('base64')
  execFileSync(
    'git',
    [
      '-c',
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`,
      'push',
      // Issue and idea branches are Tapthrough's own, so a retry replaces them.
      ...(task.mode === 'issue' || build ? ['--force'] : []),
      'origin',
      `HEAD:refs/heads/${task.headRef}`,
    ],
    { stdio: 'inherit' },
  )
  await report({
    outcome: 'fixed',
    ...(task.mode === 'issue' || build ? {} : { fromThisPr: verdict.fromThisPr ?? true }),
    summary: verdict.summary,
    commitSha,
  })
  console.log(`Pushed ${commitSha.slice(0, 7)} to ${task.headRef}.`)
}

/** The agent's review, as Tapthrough expects it; it checks the shape again. */
function readReviewVerdict(file) {
  if (!existsSync(file)) return undefined
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return {
      summary: String(v.summary ?? '').slice(0, 1000),
      findings: (Array.isArray(v.findings) ? v.findings : []).slice(0, 20).map((f) => ({
        severity: ['high', 'medium', 'low'].includes(f?.severity) ? f.severity : 'medium',
        ...(typeof f?.file === 'string' ? { file: f.file.slice(0, 300) } : {}),
        ...(Number.isInteger(f?.line) && f.line > 0 ? { line: f.line } : {}),
        title: String(f?.title ?? 'Untitled finding').slice(0, 200),
        ...(f?.detail ? { detail: String(f.detail).slice(0, 1000) } : {}),
      })),
    }
  } catch {
    return undefined
  }
}

async function finishReview(task, report) {
  const verdict = readReviewVerdict(task.paths.verdict)
  if (!verdict) {
    await report({ outcome: 'failed', summary: 'Claude wrote no review.' })
    return
  }
  let tests = existsSync(testsFile)
    ? JSON.parse(readFileSync(testsFile, 'utf8'))
    : { status: 'not_run', added: [] }
  // Only the tests that passed are still in the working tree; anything else was undone.
  restoreProtected('review')
  let commitSha
  if (tests.status === 'passed' && tests.added.length) {
    const files = tests.added.map((t) => t.file)
    git('add', '--', ...files)
    const subject = `${'Test: '}cover PR #${task.pr} (${tests.added.reduce((n, t) => n + t.cases, 0)} cases)`
    execFileSync(
      'git',
      [
        '-c',
        'user.name=tapthrough[bot]',
        '-c',
        'user.email=tapthrough[bot]@users.noreply.github.com',
        'commit',
        '--quiet',
        '-m',
        subject.slice(0, 72),
        '-m',
        `Tests Claude added while reviewing PR #${task.pr} through Tapthrough. They ran and passed.\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
      ],
      { stdio: 'inherit' },
    )
    const basic = Buffer.from(`x-access-token:${process.env.PUSH_TOKEN}`).toString('base64')
    try {
      execFileSync(
        'git',
        [
          '-c',
          `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`,
          'push',
          'origin',
          `HEAD:refs/heads/${task.headRef}`,
        ],
        { stdio: 'inherit' },
      )
      commitSha = git('rev-parse', 'HEAD')
      console.log(`Pushed tests in ${commitSha.slice(0, 7)} to ${task.headRef}.`)
    } catch {
      // Someone pushed while the review ran; the next push gets its own review.
      tests = {
        status: 'not_run',
        added: [],
        output: 'The branch moved on while Claude was reviewing, so its tests were not pushed.',
      }
    }
  }
  await report({
    outcome: 'reviewed',
    summary: verdict.summary || 'Reviewed.',
    ...(commitSha ? { commitSha } : {}),
    review: { findings: verdict.findings, tests },
  })
}

const steps = { claim, prepare, install, agent, verify, finish }
const step = steps[process.argv[2]]
if (!step) {
  console.error(`Unknown step ${process.argv[2]}`)
  process.exit(2)
}
try {
  await step()
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
