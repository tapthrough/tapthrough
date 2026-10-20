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

export interface Checklist {
  pr: number
  sha: string
  open: boolean
  scenarios: { key: string; title: string; routePath: string; steps: ChecklistStep[] }[]
  recheck?: RecheckItem[]
}

/** Whether the Review sheet has anything to show. */
export function hasReviewItems(checklist: Checklist | null): checklist is Checklist {
  return Boolean(
    checklist &&
      (checklist.scenarios.some((s) => s.steps.length > 0) || (checklist.recheck?.length ?? 0) > 0),
  )
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
