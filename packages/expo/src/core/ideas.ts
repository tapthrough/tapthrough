import type { Platform } from '@tapthrough/protocol'
import type { PreviewContext } from './feedback.js'

export type IdeaStatus =
  | 'grooming'
  | 'needs_answers'
  | 'ready'
  | 'building'
  | 'built'
  | 'ready_to_test'
  | 'approved'
  | 'merged'
  | 'closed'
  | 'declined'
  | 'failed'
  | 'not_set_up'

export type IdeaAction = 'answer' | 'build' | 'approve' | 'retry'

/** One step from sent to merged: done, in progress, not reached yet, or where it stopped. */
export interface IdeaStage {
  key: 'sent' | 'written' | 'built' | 'preview' | 'merged'
  title: string
  state: 'done' | 'active' | 'waiting' | 'failed'
  detail: string | null
  at: string | null
}

/** An idea someone sent from the app, as Tapthrough reports it. */
export interface Idea {
  id: string
  status: IdeaStatus
  body: string
  title: string | null
  summary: string | null
  questions: string[]
  steps: { action: string; expect: string }[]
  authorName: string | null
  issueNumber: number | null
  issueUrl: string | null
  prNumber: number | null
  prUrl: string | null
  previewUrl: string | null
  note: string | null
  /** e.g. "Claude has a question", from the server so wording can change without an app update. */
  statusLine: string
  /** Older servers send none; the app then shows the status line only. */
  stages?: IdeaStage[]
  /** Something looks stuck or slow; null when all is well. */
  warning?: string | null
  runUrl?: string | null
  actionsUrl?: string
  createdAt: string
  actions: IdeaAction[]
}

/** An open PR with a preview, for switching builds without going back to GitHub. */
export interface OpenPr {
  number: number
  title: string
  author: string | null
  draft: boolean
  current: boolean
  openUrl: string | null
  needsNewBuild: boolean
  fromIdea: boolean
  updatedAt: string
}

export type ApproveOutcome = 'review' | 'auto_merge' | 'merged'

type Result<T> = ({ ok: true } & T) | { ok: false; message: string }

interface Options {
  apiUrl: string
  fetch?: typeof fetch
}

const OFFLINE = "Couldn't reach Tapthrough. Check your connection and try again."

/**
 * Who's asking: a PR build, proved by its running update, or a staging or
 * TestFlight build, proved by the repo's app key.
 */
export type Caller = { kind: 'build'; preview: PreviewContext } | { kind: 'key'; appKey: string }

function credential(caller: Caller, platform: Platform) {
  return caller.kind === 'build'
    ? {
        apiVersion: 1,
        updateGroupId: caller.preview.updateGroupId,
        projectId: caller.preview.projectId,
        platform,
      }
    : { apiVersion: 1, appKey: caller.appKey, platform }
}

function query(caller: Caller, platform: Platform) {
  return new URLSearchParams(
    caller.kind === 'build'
      ? {
          updateGroupId: caller.preview.updateGroupId,
          projectId: caller.preview.projectId,
          platform,
        }
      : { appKey: caller.appKey, platform },
  )
}

async function call<T>(
  options: Options,
  path: string,
  init: { method: 'GET' } | { method: 'POST'; body: unknown },
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<Result<T>> {
  const doFetch = options.fetch ?? fetch
  let response: Response
  try {
    response = await doFetch(`${options.apiUrl.replace(/\/$/, '')}${path}`, {
      method: init.method,
      ...(init.method === 'POST'
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
        : {}),
    })
  } catch {
    return { ok: false, message: OFFLINE }
  }
  const body = (await response.json().catch(() => undefined)) as
    | (Record<string, unknown> & { error?: { message?: string } })
    | undefined
  const value = response.ok && body ? pick(body) : undefined
  if (value !== undefined) return { ok: true, ...value }
  // A server from before ideas answers 404 without an error code.
  if (response.status === 404 && !body?.error) {
    return { ok: false, message: 'This version of Tapthrough doesn’t take ideas yet.' }
  }
  return { ok: false, message: body?.error?.message ?? `Tapthrough returned ${response.status}.` }
}

const pickIdea = (body: Record<string, unknown>) =>
  body.idea && typeof body.idea === 'object' ? { idea: body.idea as Idea } : undefined

export interface IdeaDraft {
  body: string
  authorName?: string
  authorEmail?: string
  route?: string
  device?: { os?: string; osVersion?: string; model?: string }
  screenshot?: { contentType: 'image/jpeg' | 'image/png'; base64: string }
}

/** Sends an idea; Claude starts writing it up in the repo's fix workflow. Never throws. */
export function submitIdea(
  input: { caller: Caller; platform: Platform; draft: IdeaDraft },
  options: Options,
) {
  const { draft } = input
  return call(
    options,
    '/api/v1/ideas',
    {
      method: 'POST',
      body: {
        ...credential(input.caller, input.platform),
        body: draft.body,
        ...(draft.authorName ? { authorName: draft.authorName } : {}),
        ...(draft.authorEmail ? { authorEmail: draft.authorEmail } : {}),
        ...(draft.route ? { route: draft.route } : {}),
        ...(draft.device ? { device: draft.device } : {}),
        ...(draft.screenshot ? { screenshot: draft.screenshot } : {}),
      },
    },
    pickIdea,
  )
}

/** The app's recent ideas, newest first; an empty list when Tapthrough can't say. */
export async function fetchIdeas(
  caller: Caller,
  platform: Platform,
  options: Options,
): Promise<Idea[]> {
  const path = `/api/v1/ideas?${query(caller, platform)}`
  const result = await call(options, path, { method: 'GET' }, (body) =>
    Array.isArray(body.ideas) ? { ideas: body.ideas as Idea[] } : undefined,
  )
  return result.ok ? result.ideas : []
}

/** The repo's open PRs with previews; null when Tapthrough can't say. */
export async function fetchOpenPrs(
  preview: PreviewContext,
  platform: Platform,
  options: Options,
): Promise<OpenPr[] | null> {
  const path = `/api/v1/pulls?${query({ kind: 'build', preview }, platform)}`
  const result = await call(options, path, { method: 'GET' }, (body) =>
    Array.isArray(body.pulls) ? { pulls: body.pulls as OpenPr[] } : undefined,
  )
  return result.ok ? result.pulls : null
}

/** Answers Claude's questions; it writes the idea up again with them. Never throws. */
export function answerIdea(
  input: {
    caller: Caller
    platform: Platform
    id: string
    answers: string[]
    by?: string
  },
  options: Options,
) {
  return call(
    options,
    `/api/v1/ideas/${encodeURIComponent(input.id)}/answers`,
    {
      method: 'POST',
      body: {
        ...credential(input.caller, input.platform),
        answers: input.answers,
        ...(input.by ? { by: input.by } : {}),
      },
    },
    pickIdea,
  )
}

/** Build It, Retry or Approve on one idea. Never throws. */
export function ideaAction(
  input: {
    caller: Caller
    platform: Platform
    id: string
    action: 'build' | 'retry' | 'approve'
    by?: string
  },
  options: Options,
) {
  return call(
    options,
    `/api/v1/ideas/${encodeURIComponent(input.id)}/${input.action}`,
    {
      method: 'POST',
      body: { ...credential(input.caller, input.platform), ...(input.by ? { by: input.by } : {}) },
    },
    (body) => {
      const picked = pickIdea(body)
      if (!picked) return undefined
      const result = body.result
      return {
        ...picked,
        approve:
          result === 'review' || result === 'auto_merge' || result === 'merged'
            ? (result as ApproveOutcome)
            : null,
      }
    },
  )
}

/** Ideas waiting on a person: questions to answer, or a build to test. */
export function ideasNeedingYou(ideas: Idea[]): number {
  return ideas.filter((idea) => idea.status === 'needs_answers' || idea.status === 'ready_to_test')
    .length
}

/** What Approve did, in plain words. */
export function approveMessage(outcome: ApproveOutcome | null): string {
  if (outcome === 'merged') return 'Approved and merged.'
  if (outcome === 'auto_merge') return 'Approved. It merges once its checks pass.'
  return 'Approved. An engineer reviews and merges it.'
}

/** Grooming, building or waiting on a preview: worth refreshing often while someone watches. */
export function isMoving(idea: Idea): boolean {
  return idea.status === 'grooming' || idea.status === 'building' || idea.status === 'built'
}

/** "2:41 PM" today, "Nov 10" before, for a timeline step. */
export function stepTime(iso: string | null, now = new Date()): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export interface StaffReport {
  body: string
  reporterName?: string
  route?: string
  device?: { os?: string; osVersion?: string; model?: string }
  app?: { version?: string; build?: string }
  screenshot?: { contentType: 'image/jpeg' | 'image/png'; base64: string }
  annotations?: unknown[]
  diagnostics?: unknown
}

/**
 * Files a report from a staging or TestFlight build. There's no PR to comment
 * on, so Tapthrough opens a GitHub issue. Never throws.
 */
export function sendStaffReport(
  input: { appKey: string; platform: Platform; report: StaffReport },
  options: Options,
) {
  const { report } = input
  return call(
    options,
    '/api/v1/reports',
    {
      method: 'POST',
      body: {
        apiVersion: 1,
        appKey: input.appKey,
        platform: input.platform,
        body: report.body,
        ...(report.reporterName ? { reporterName: report.reporterName } : {}),
        ...(report.route ? { route: report.route } : {}),
        ...(report.device ? { device: report.device } : {}),
        ...(report.app ? { app: report.app } : {}),
        ...(report.screenshot ? { screenshot: report.screenshot } : {}),
        ...(report.screenshot && report.annotations?.length
          ? { annotations: report.annotations }
          : {}),
        ...(report.diagnostics ? { diagnostics: report.diagnostics } : {}),
      },
    },
    (body) =>
      typeof body.issueNumber === 'number' && typeof body.issueUrl === 'string'
        ? { issueNumber: body.issueNumber, issueUrl: body.issueUrl }
        : undefined,
  )
}
