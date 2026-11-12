import type { Platform } from '@tapthrough/protocol'
import type { AnnotationBox } from './annotations.js'
import type { Diagnostics } from './diagnostics.js'

/** Which PR build is running, read from the loaded EAS update's manifest. */
export interface PreviewContext {
  updateGroupId: string
  /** The EAS project the update belongs to; the server checks it against the repo. */
  projectId: string
  /** The EAS Update branch, e.g. `pr-142`. */
  branch: string | undefined
}

/**
 * The update group of the running EAS update, from `Constants.manifest2`.
 * A development build has it however the update was opened (QR code, Orbit
 * or a Tapthrough link); an embedded or local build has none.
 */
export function previewContextFromManifest(manifest: unknown): PreviewContext | null {
  const m = manifest as {
    metadata?: { updateGroup?: unknown; branchName?: unknown }
    extra?: { eas?: { projectId?: unknown } }
  } | null
  const metadata = m?.metadata
  const projectId = m?.extra?.eas?.projectId
  if (typeof metadata?.updateGroup !== 'string' || metadata.updateGroup === '') return null
  if (typeof projectId !== 'string') return null
  return {
    updateGroupId: metadata.updateGroup,
    projectId,
    branch: typeof metadata.branchName === 'string' ? metadata.branchName : undefined,
  }
}

/** A link token's payload, read without verification (the seed hook and server verify). */
export function decodeTokenClaims(token: string): Record<string, unknown> | undefined {
  const payload = token.split('.')[1]
  if (!payload) return undefined
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json: unknown = JSON.parse(
      globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')),
    )
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * The scenario ID (`scn`) from a link token, for attributing reports. The
 * server checks the ID belongs to the same PR.
 */
export function scenarioIdFromToken(token: string): string | undefined {
  const scn = decodeTokenClaims(token)?.scn
  return typeof scn === 'string' ? scn : undefined
}

export interface FeedbackInput {
  preview: PreviewContext
  platform: Platform
  body: string
  reporterName?: string
  route?: string
  scenarioId?: string
  device?: { os?: string; osVersion?: string; model?: string }
  screenshot?: { contentType: 'image/jpeg' | 'image/png'; base64: string }
  diagnostics?: Diagnostics
  /** Boxes drawn on the screenshot; only sent with a screenshot. */
  annotations?: AnnotationBox[]
  /** The reporter's own call; left out, Tapthrough guesses. */
  cause?: 'pr' | 'unrelated'
}

/** Whether a report is caused by the PR: Tapthrough's guess unless a person said. */
export type Cause = 'pr' | 'unrelated' | 'unknown'

export interface Triage {
  cause: Cause
  causeSource: 'guess' | 'reporter' | 'developer'
  /** Plain-text reasons behind the guess. */
  reasons: string[]
  /** GitHub's prefilled new-issue form, for bugs the PR didn't cause. */
  issueUrl?: string
}

export type FeedbackResult =
  | ({ ok: true; commentUrl: string; findingId?: string } & Partial<Triage>)
  | { ok: false; message: string }

/** Markdown reasons from the server, as plain text for the app. */
export function plainReason(reason: string): string {
  return reason.replace(/`([^`]*)`/g, '$1').replace(/\*\*/g, '')
}

/** Posts a report to Tapthrough, which comments it on the PR. Never throws. */
export async function sendFeedback(
  input: FeedbackInput,
  options: { apiUrl: string; fetch?: typeof fetch },
): Promise<FeedbackResult> {
  const doFetch = options.fetch ?? fetch
  let response: Response
  try {
    response = await doFetch(`${options.apiUrl.replace(/\/$/, '')}/api/v1/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: 1,
        updateGroupId: input.preview.updateGroupId,
        projectId: input.preview.projectId,
        platform: input.platform,
        body: input.body,
        ...(input.reporterName ? { reporterName: input.reporterName } : {}),
        ...(input.route ? { route: input.route } : {}),
        ...(input.scenarioId ? { scenarioId: input.scenarioId } : {}),
        ...(input.device ? { device: input.device } : {}),
        ...(input.screenshot ? { screenshot: input.screenshot } : {}),
        ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
        ...(input.screenshot && input.annotations?.length
          ? { annotations: input.annotations }
          : {}),
        ...(input.cause ? { cause: input.cause } : {}),
      }),
    })
  } catch {
    return { ok: false, message: "Couldn't reach Tapthrough. Check your connection and try again." }
  }
  const body = (await response.json().catch(() => undefined)) as
    | ({ commentUrl?: string; findingId?: string; error?: { message?: string } } & Partial<Triage>)
    | undefined
  if (response.ok && body?.commentUrl) {
    return {
      ok: true,
      commentUrl: body.commentUrl,
      ...(body.findingId ? { findingId: body.findingId } : {}),
      // Older servers don't triage; the app then just asks.
      cause: body.cause ?? 'unknown',
      causeSource: body.causeSource ?? 'guess',
      reasons: (body.reasons ?? []).map(plainReason),
      ...(body.issueUrl ? { issueUrl: body.issueUrl } : {}),
    }
  }
  return { ok: false, message: body?.error?.message ?? `Tapthrough returned ${response.status}.` }
}

export type StepResultValue = 'pass' | 'fail' | 'skip'

export interface ChecklistStep {
  index: number
  action: string
  expect: string
  result: { result: StepResultValue; reporter: string | null; platform: Platform } | null
}

/** A report from an earlier commit, to re-check on this build. */
export interface RecheckItem {
  id: string
  excerpt: string
  reporter: string | null
  sha: string
  platform: Platform
  stillBrokenHere: boolean
}

/** A later push to the PR than the build that's running. */
export interface NewerBuild {
  sha: string
  updateGroupId: string
  /** Opens it in the development build; null when the server can't build the link. */
  openUrl: string | null
  /** True when the push is a fix Claude made for a report. */
  hasFix: boolean
}

/**
 * One part of getting the app into a scenario's starting state, said two ways:
 * what Tapthrough does when it sets the app up, and what a person does by hand.
 */
export interface SetupLine {
  kind: 'account' | 'data' | 'flag' | 'screen'
  /** e.g. "Signs you in as a test user with the viewer role" */
  auto: string
  /** e.g. "Sign in as a user with the viewer role" */
  manual: string
}

export interface ChecklistScenario {
  key: string
  title: string
  routePath: string
  /** Why the PR runs it, e.g. "This PR changes src/app/index.tsx". Older servers omit it. */
  why?: string | null
  /** How the starting state is made. Older servers omit it. */
  setup?: SetupLine[]
  steps: ChecklistStep[]
}

/** A scenario in the run that isn't part of the PR's plan, for jumping into its state. */
export interface LibraryEntry {
  key: string
  title: string
  routePath: string
  /** True for scenarios already in `scenarios`. */
  picked: boolean
  why?: string | null
  setup?: SetupLine[]
}

export interface Checklist {
  pr: number
  sha: string
  open: boolean
  scenarios: ChecklistScenario[]
  recheck?: RecheckItem[]
  newerBuild?: NewerBuild | null
  library?: LibraryEntry[]
}

/** Whether the Review sheet has anything to show. */
export function hasReviewItems(checklist: Checklist | null): checklist is Checklist {
  return Boolean(
    checklist &&
      (checklist.scenarios.some((s) => s.steps.length > 0) ||
        (checklist.recheck?.length ?? 0) > 0 ||
        checklist.library?.some((entry) => !entry.picked) ||
        checklist.newerBuild),
  )
}

export interface Progress {
  total: number
  passed: number
  failed: number
}

/** Step results across the plan, keyed `scenario:index` like the Review sheet. */
export function checklistProgress(
  checklist: Checklist,
  results: Record<string, StepResultValue | undefined> = {},
): Progress {
  const progress = { total: 0, passed: 0, failed: 0 }
  for (const scenario of checklist.scenarios) {
    for (const step of scenario.steps) {
      progress.total += 1
      const result = results[`${scenario.key}:${step.index}`] ?? step.result?.result
      if (result === 'pass') progress.passed += 1
      if (result === 'fail') progress.failed += 1
    }
  }
  return progress
}

/** One line for the sheet's header, e.g. `1 of 3 checked` or `3 of 3 passed`. */
export function progressLabel({ total, passed, failed }: Progress): string {
  if (total === 0) return 'No steps to check'
  if (passed === total) return `${total} of ${total} passed`
  const label = `${passed + failed} of ${total} checked`
  return failed ? `${label} · ${failed} failed` : label
}

export type Badge =
  | { kind: 'new-build' }
  | { kind: 'failed' }
  | { kind: 'remaining'; count: number }
  | { kind: 'done' }

/** What the floating Review button shows: a new build wins, then failures, then steps left. */
export function reviewBadge(checklist: Checklist | null): Badge | null {
  if (!checklist) return null
  if (checklist.newerBuild) return { kind: 'new-build' }
  const progress = checklistProgress(checklist)
  if (progress.total === 0) return null
  if (progress.failed) return { kind: 'failed' }
  const count = progress.total - progress.passed
  return count === 0 ? { kind: 'done' } : { kind: 'remaining', count }
}

/** Marks an earlier report fixed or still broken on this build. Never throws. */
export async function sendRecheck(
  input: {
    preview: PreviewContext
    platform: Platform
    findingId: string
    result: 'fixed' | 'still_broken'
    reporterName?: string
  },
  options: { apiUrl: string; fetch?: typeof fetch },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const doFetch = options.fetch ?? fetch
  try {
    const response = await doFetch(
      `${options.apiUrl.replace(/\/$/, '')}/api/v1/findings/${encodeURIComponent(input.findingId)}/check`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiVersion: 1,
          updateGroupId: input.preview.updateGroupId,
          projectId: input.preview.projectId,
          platform: input.platform,
          result: input.result,
          ...(input.reporterName ? { reporterName: input.reporterName } : {}),
        }),
      },
    )
    if (response.ok) return { ok: true }
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined
    return { ok: false, message: body?.error?.message ?? `Tapthrough returned ${response.status}.` }
  } catch {
    return { ok: false, message: "Couldn't reach Tapthrough. Check your connection and try again." }
  }
}

/** The reporter saying whether the PR caused a report. Never throws. */
export async function sendCause(
  input: {
    preview: PreviewContext
    platform: Platform
    findingId: string
    cause: 'pr' | 'unrelated'
  },
  options: { apiUrl: string; fetch?: typeof fetch },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const doFetch = options.fetch ?? fetch
  try {
    const response = await doFetch(
      `${options.apiUrl.replace(/\/$/, '')}/api/v1/findings/${encodeURIComponent(input.findingId)}/cause`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiVersion: 1,
          updateGroupId: input.preview.updateGroupId,
          projectId: input.preview.projectId,
          platform: input.platform,
          cause: input.cause,
        }),
      },
    )
    if (response.ok) return { ok: true }
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined
    return { ok: false, message: body?.error?.message ?? `Tapthrough returned ${response.status}.` }
  } catch {
    return { ok: false, message: "Couldn't reach Tapthrough. Check your connection and try again." }
  }
}

export type FixRequestResult =
  | { ok: true; status: 'requested' | 'not_set_up' }
  | { ok: false; message: string }

/** Asks Claude to fix a report on the PR's branch, in the repo's own Actions. Never throws. */
export async function requestFix(
  input: {
    preview: PreviewContext
    platform: Platform
    findingId: string
    reporterName?: string
  },
  options: { apiUrl: string; fetch?: typeof fetch },
): Promise<FixRequestResult> {
  const doFetch = options.fetch ?? fetch
  try {
    const response = await doFetch(
      `${options.apiUrl.replace(/\/$/, '')}/api/v1/findings/${encodeURIComponent(input.findingId)}/fix`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiVersion: 1,
          updateGroupId: input.preview.updateGroupId,
          projectId: input.preview.projectId,
          platform: input.platform,
          ...(input.reporterName ? { reporterName: input.reporterName } : {}),
        }),
      },
    )
    const body = (await response.json().catch(() => undefined)) as
      | { status?: 'requested' | 'not_set_up'; error?: { message?: string } }
      | undefined
    if (response.ok && body?.status) return { ok: true, status: body.status }
    return { ok: false, message: body?.error?.message ?? `Tapthrough returned ${response.status}.` }
  } catch {
    return { ok: false, message: "Couldn't reach Tapthrough. Check your connection and try again." }
  }
}

export type LaunchRequestResult = { ok: true; launchUrl: string } | { ok: false; message: string }

/**
 * Asks Tapthrough for a launch link into one of the PR's scenarios, so the
 * app can set itself up for it without leaving. Never throws.
 */
export async function requestLaunch(
  input: { preview: PreviewContext; platform: Platform; scenarioKey: string },
  options: { apiUrl: string; fetch?: typeof fetch },
): Promise<LaunchRequestResult> {
  const doFetch = options.fetch ?? fetch
  try {
    const response = await doFetch(`${options.apiUrl.replace(/\/$/, '')}/api/v1/checklist/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: 1,
        updateGroupId: input.preview.updateGroupId,
        projectId: input.preview.projectId,
        platform: input.platform,
        scenario: input.scenarioKey,
      }),
    })
    const body = (await response.json().catch(() => undefined)) as
      | { launchUrl?: string; error?: { message?: string } }
      | undefined
    if (response.ok && typeof body?.launchUrl === 'string') {
      return { ok: true, launchUrl: body.launchUrl }
    }
    if (response.status === 404 && !body?.error) {
      return { ok: false, message: 'This version of Tapthrough can’t set the app up yet.' }
    }
    return { ok: false, message: body?.error?.message ?? `Tapthrough returned ${response.status}.` }
  } catch {
    return { ok: false, message: "Couldn't reach Tapthrough. Check your connection and try again." }
  }
}

/** The PR's test plan and current results for the running build, or null if there isn't one. */
export async function fetchChecklist(
  preview: PreviewContext,
  platform: Platform,
  options: { apiUrl: string; fetch?: typeof fetch },
): Promise<Checklist | null> {
  const doFetch = options.fetch ?? fetch
  const query = new URLSearchParams({
    updateGroupId: preview.updateGroupId,
    projectId: preview.projectId,
    platform,
  })
  try {
    const response = await doFetch(`${options.apiUrl.replace(/\/$/, '')}/api/v1/checklist?${query}`)
    if (!response.ok) return null
    return (await response.json()) as Checklist
  } catch {
    return null
  }
}

/** Records a pass, fail or skip for one step. Never throws. */
export async function sendStepResult(
  input: {
    preview: PreviewContext
    platform: Platform
    scenarioKey: string
    stepIndex: number
    result: StepResultValue
    reporterName?: string
    findingId?: string
  },
  options: { apiUrl: string; fetch?: typeof fetch },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const doFetch = options.fetch ?? fetch
  try {
    const response = await doFetch(`${options.apiUrl.replace(/\/$/, '')}/api/v1/step-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: 1,
        updateGroupId: input.preview.updateGroupId,
        projectId: input.preview.projectId,
        platform: input.platform,
        scenarioKey: input.scenarioKey,
        stepIndex: input.stepIndex,
        result: input.result,
        ...(input.reporterName ? { reporterName: input.reporterName } : {}),
        ...(input.findingId ? { findingId: input.findingId } : {}),
      }),
    })
    if (response.ok) return { ok: true }
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined
    return { ok: false, message: body?.error?.message ?? `Tapthrough returned ${response.status}.` }
  } catch {
    return { ok: false, message: "Couldn't reach Tapthrough. Check your connection and try again." }
  }
}

/** The report body for a failed step: the step and its expectation, then the reviewer's note. */
export function failedStepBody(step: { action: string; expect: string }, note: string): string {
  const parts = [`Step failed: ${step.action}`, `Expected: ${step.expect}`]
  if (note.trim()) parts.push('', note.trim())
  return parts.join('\n')
}
