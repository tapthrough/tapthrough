import {
  approveMessage,
  approvePr,
  type Checklist,
  type ChecklistStep,
  checklistProgress,
  type Diagnostics,
  failedStepBody,
  fetchChecklist,
  fetchOpenPrs,
  type OpenPr,
  type PreviewContext,
  type Progress,
  type Results,
  requestLaunch,
  resultsFrom,
  sendFeedback,
  sendRecheck,
  sendStepResult,
  stepId,
} from '@tapthrough/core'
import type { BrowserInfo } from './browser.js'
import type { Screenshot } from './image.js'

export interface ReviewConfig {
  /** Tapthrough's base URL. */
  apiUrl: string
  /** This preview deployment's host; reports carry it so they reach the right PR. */
  host: string
  /** The app ID registered with Tapthrough. */
  appId: string
  /** The scenario the reviewer was launched into, for attributing reports. */
  scenarioId?: string | undefined
  fetch?: typeof fetch
  /** The page the reviewer is on; defaults to `location.pathname`. */
  currentPath?: () => string | undefined
  /** The browser and operating system, sent with reports. */
  device?: () => Partial<BrowserInfo>
  /** Recent pages, console errors and failed requests, sent with reports. */
  diagnostics?: () => Diagnostics
}

/** A reviewer's verdict on a report from an earlier commit. */
export type RecheckResult = 'fixed' | 'still_broken'

export interface ReviewState {
  /** `none`: this deployment isn't a Tapthrough PR build, so there's nothing to show. */
  status: 'loading' | 'ready' | 'none'
  checklist: Checklist | null
  /** Results by `scenario:index`, including ones recorded this session. */
  results: Results
  progress: Progress
  /** Earlier reports checked again this session, by finding ID. */
  rechecked: Readonly<Record<string, RecheckResult>>
  /** The repo's open PRs with previews; null until loaded, or when Tapthrough can't say. */
  pulls: OpenPr[] | null
  /** Someone approved this PR after testing it, here or on another device. */
  approved: boolean
  /** What Approve did, once this reviewer pressed it. */
  approveNote: string | null
  /** IDs with a request in flight: a step ID, `report`, `approve`, `setup:<key>` or `recheck:<id>`. */
  busy: ReadonlySet<string>
  /** The last thing that went wrong, said for a reviewer. */
  error: string | null
  /** Where the last report was posted on the PR. */
  lastReportUrl: string | null
}

const EMPTY_PROGRESS: Progress = { total: 0, passed: 0, failed: 0 }

/** What a report can carry besides its words. */
export interface ReportExtras {
  name?: string | undefined
  screenshot?: Screenshot | null | undefined
}

/**
 * The Review panel's state and actions, with no React or DOM in it. Results
 * are shown as soon as the reviewer picks them and rolled back if saving fails.
 */
export function createReviewStore(config: ReviewConfig) {
  const preview: PreviewContext = {
    updateGroupId: config.host,
    projectId: config.appId,
    branch: undefined,
  }
  const options = { apiUrl: config.apiUrl, ...(config.fetch ? { fetch: config.fetch } : {}) }
  const listeners = new Set<() => void>()
  let state: ReviewState = {
    status: 'loading',
    checklist: null,
    results: {},
    progress: EMPTY_PROGRESS,
    rechecked: {},
    pulls: null,
    approved: false,
    approveNote: null,
    busy: new Set(),
    error: null,
    lastReportUrl: null,
  }

  function set(next: Partial<ReviewState>) {
    state = { ...state, ...next }
    if (state.checklist) {
      state = { ...state, progress: checklistProgress(state.checklist, state.results) }
    }
    for (const listener of listeners) listener()
  }

  function busy(id: string, on: boolean) {
    const next = new Set(state.busy)
    if (on) next.add(id)
    else next.delete(id)
    set({ busy: next })
  }

  const route = () =>
    config.currentPath?.() ??
    (globalThis as { location?: { pathname?: string } }).location?.pathname

  /** What every report says about where and how it was sent. */
  function context(extras: ReportExtras) {
    const path = route()
    const device = config.device?.()
    const diagnostics = config.diagnostics?.()
    return {
      preview,
      platform: 'web' as const,
      ...(extras.name ? { reporterName: extras.name } : {}),
      ...(path ? { route: path } : {}),
      ...(config.scenarioId ? { scenarioId: config.scenarioId } : {}),
      ...(device && Object.keys(device).length > 0 ? { device } : {}),
      ...(diagnostics ? { diagnostics } : {}),
      ...(extras.screenshot ? { screenshot: extras.screenshot } : {}),
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /** Fetches the PR's checklist for this deployment. */
    async load() {
      const checklist = await fetchChecklist(preview, 'web', options)
      if (!checklist) {
        // Keep what's on screen if a refresh fails; only a first load can find nothing.
        if (state.status === 'loading') set({ status: 'none' })
        return
      }
      // The reviewer's own picks this session win over what the server had when asked.
      const mine = Object.fromEntries(
        Object.entries(state.results).filter(([, result]) => result !== undefined),
      )
      set({ status: 'ready', checklist, results: { ...resultsFrom(checklist), ...mine } })
    },

    /** Records a pass (or clears back to a skip). */
    async mark(scenarioKey: string, stepIndex: number, result: 'pass' | 'skip', name?: string) {
      const id = stepId(scenarioKey, stepIndex)
      const before = state.results[id]
      set({ results: { ...state.results, [id]: result }, error: null })
      busy(id, true)
      const saved = await sendStepResult(
        {
          preview,
          platform: 'web',
          scenarioKey,
          stepIndex,
          result,
          ...(name ? { reporterName: name } : {}),
        },
        options,
      )
      busy(id, false)
      if (!saved.ok) set({ results: { ...state.results, [id]: before }, error: saved.message })
      return saved.ok
    },

    /** Fails a step: posts a report on the PR with the reviewer's note, then records the failure. */
    async fail(scenarioKey: string, step: ChecklistStep, note: string, extras: ReportExtras = {}) {
      const id = stepId(scenarioKey, step.index)
      const before = state.results[id]
      set({ results: { ...state.results, [id]: 'fail' }, error: null })
      busy(id, true)
      const report = await sendFeedback(
        {
          ...context(extras),
          body: failedStepBody(step, note),
          // The reviewer said this step of the PR's own plan failed.
          cause: 'pr',
        },
        options,
      )
      if (!report.ok) {
        busy(id, false)
        set({ results: { ...state.results, [id]: before }, error: report.message })
        return false
      }
      const saved = await sendStepResult(
        {
          preview,
          platform: 'web',
          scenarioKey,
          stepIndex: step.index,
          result: 'fail',
          ...(extras.name ? { reporterName: extras.name } : {}),
          ...(report.findingId ? { findingId: report.findingId } : {}),
        },
        options,
      )
      busy(id, false)
      // The report is on the PR either way; only the tick failed to save.
      set({ lastReportUrl: report.commentUrl, ...(saved.ok ? {} : { error: saved.message }) })
      return true
    },

    /** Posts a report that isn't about a step. */
    async report(body: string, extras: ReportExtras = {}) {
      if (!body.trim()) return false
      busy('report', true)
      set({ error: null })
      const report = await sendFeedback({ ...context(extras), body: body.trim() }, options)
      busy('report', false)
      if (!report.ok) {
        set({ error: report.message })
        return false
      }
      set({ lastReportUrl: report.commentUrl })
      return true
    },

    /** Says whether a report from an earlier commit is fixed on this preview. */
    async recheck(findingId: string, result: RecheckResult, name?: string) {
      const id = `recheck:${findingId}`
      busy(id, true)
      set({ error: null })
      const saved = await sendRecheck(
        { preview, platform: 'web', findingId, result, ...(name ? { reporterName: name } : {}) },
        options,
      )
      busy(id, false)
      if (!saved.ok) {
        set({ error: saved.message })
        return false
      }
      set({ rechecked: { ...state.rechecked, [findingId]: result } })
      return true
    },

    /** The repo's other open PRs, and whether this one is already approved. */
    async loadPulls() {
      const pulls = await fetchOpenPrs(preview, 'web', options)
      if (!pulls) return
      const current = pulls.find((pr) => pr.current)
      // An approval made here stands even if the list was read just before it.
      set({ pulls, approved: state.approved || Boolean(current?.approved) })
    },

    /** Tells the team the PR is good to merge, after testing it. */
    async approve(name?: string) {
      busy('approve', true)
      set({ error: null })
      const result = await approvePr(
        { caller: { kind: 'build', preview }, platform: 'web', ...(name ? { by: name } : {}) },
        options,
      )
      busy('approve', false)
      if (!result.ok) {
        set({ error: result.message })
        return false
      }
      set({ approved: true, approveNote: approveMessage(result.approve) })
      return true
    },

    /** A link that sets the preview up for a scenario: test user, data, and its page. */
    async setUp(scenarioKey: string): Promise<string | null> {
      const id = `setup:${scenarioKey}`
      busy(id, true)
      set({ error: null })
      const launch = await requestLaunch({ preview, platform: 'web', scenarioKey }, options)
      busy(id, false)
      if (!launch.ok) {
        set({ error: launch.message })
        return null
      }
      return launch.launchUrl
    },

    /** For problems outside the store, e.g. an image that couldn't be attached. */
    setError(message: string) {
      set({ error: message })
    },

    dismissError() {
      set({ error: null })
    },
  }
}

export type ReviewStore = ReturnType<typeof createReviewStore>

/**
 * What a scenario's link does in this app, or null when it can't do anything:
 * without test data, a page that needs a record has nothing to open.
 */
export function setUpLabel(checklist: Checklist, routePath: string): 'Set up' | 'Open page' | null {
  if (checklist.web?.launch !== 'off') return 'Set up'
  return routePath.includes('[') ? null : 'Open page'
}
