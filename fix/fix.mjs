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

async function claim() {
  const fixRequestId = process.env.FIX_REQUEST_ID
  if (!fixRequestId) throw new Error('This workflow runs from Tapthrough’s repository_dispatch.')
  mkdirSync(workdir, { recursive: true })
  const task = await api('/api/v1/fix/claim', { apiVersion: 1, fixRequestId, workdir })
  console.log(`::add-mask::${task.pushToken}`)
  const { pushToken, ...rest } = task
  writeFileSync(taskFile, JSON.stringify({ ...rest, fixRequestId }, null, 2))
  output('claimed', 'true')
  output('head-ref', task.headRef)
  output('push-token', pushToken)
  console.log(`Fixing a report on PR #${task.pr} (branch ${task.headRef}).`)
}

async function prepare() {
  const task = JSON.parse(readFileSync(taskFile, 'utf8'))
  // fetch-depth: 0 already has the base branch; fetch it again only if it's missing.
  try {
    git('rev-parse', '--verify', `origin/${task.baseRef}`)
  } catch {
    git('fetch', '--no-tags', 'origin', task.baseRef)
  }
  const diff = git('diff', `origin/${task.baseRef}...HEAD`)
  writeFileSync(task.paths.diff, diff)
  if (task.screenshotUrl) {
    const response = await fetch(task.screenshotUrl)
    if (response.ok) writeFileSync(task.paths.screenshot, Buffer.from(await response.arrayBuffer()))
  }
  writeFileSync(path.join(workdir, 'prompt.md'), task.prompt)
}

function agent() {
  const task = JSON.parse(readFileSync(taskFile, 'utf8'))
  const args = [
    '-p',
    task.prompt,
    '--allowedTools',
    'Read,Edit,MultiEdit,Write,Glob,Grep',
    '--disallowedTools',
    'Bash,WebFetch,WebSearch,NotebookEdit',
    '--permission-mode',
    'acceptEdits',
    '--add-dir',
    workdir,
    '--max-turns',
    process.env.CLAUDE_MAX_TURNS || '40',
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

/** Undoes anything the agent changed under protected paths. */
function restoreProtected() {
  const changed = git('status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2), file: line.slice(3).replace(/^.* -> /, '') }))
  for (const { code, file } of changed) {
    if (!PROTECTED.some((pattern) => pattern.test(file))) continue
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
  const verdict = readVerdict(task.paths.verdict)
  restoreProtected()
  const dirty = git('status', '--porcelain', '--untracked-files=all') !== ''

  if (!dirty || verdict?.outcome !== 'fixed') {
    await report({
      outcome: 'declined',
      fromThisPr: verdict?.fromThisPr ?? null,
      summary: verdict?.summary || 'Claude made no changes.',
    })
    return
  }

  const subject = (verdict.summary.split(/(?<=\.)\s/)[0] || 'Fix a reported issue').slice(0, 68)
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
      `Fix: ${subject}`,
      '-m',
      `${verdict.summary}\n\nReported by a reviewer on PR #${task.pr} through Tapthrough.\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
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
      'origin',
      `HEAD:refs/heads/${task.headRef}`,
    ],
    { stdio: 'inherit' },
  )
  await report({
    outcome: 'fixed',
    fromThisPr: verdict.fromThisPr ?? true,
    summary: verdict.summary,
    commitSha,
  })
  console.log(`Pushed ${commitSha.slice(0, 7)} to ${task.headRef}.`)
}

const steps = { claim, prepare, agent, finish }
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
