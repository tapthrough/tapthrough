import {
  type Checklist,
  type ChecklistStep,
  checklistProgress,
  failedStepBody,
  fetchChecklist,
  type PreviewContext,
  type Progress,
  type Results,
  requestLaunch,
  resultsFrom,
  sendFeedback,
  sendStepResult,
  stepId,
} from '@tapthrough/core'

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
}

export interface ReviewState {
  /** `none`: this deployment isn't a Tapthrough PR build, so there's nothing to show. */
  status: 'loading' | 'ready' | 'none'
  checklist: Checklist | null
  /** Results by `scenario:index`, including ones recorded this session. */
  results: Results
  progress: Progress
  /** Step IDs (and `report`, `setup:<key>`) with a request in flight. */
  busy: ReadonlySet<string>
  /** The last thing that went wrong, said for a reviewer. */
  error: string | null
  /** Where the last report was posted on the PR. */
  lastReportUrl: string | null
}

const EMPTY_PROGRESS: Progress = { total: 0, passed: 0, failed: 0 }

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
    async fail(scenarioKey: string, step: ChecklistStep, note: string, name?: string) {
      const id = stepId(scenarioKey, step.index)
      const before = state.results[id]
      set({ results: { ...state.results, [id]: 'fail' }, error: null })
      busy(id, true)
      const report = await sendFeedback(
        {
          preview,
          platform: 'web',
          body: failedStepBody(step, note),
          ...(name ? { reporterName: name } : {}),
          ...(route() ? { route: route() as string } : {}),
          ...(config.scenarioId ? { scenarioId: config.scenarioId } : {}),
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
          ...(name ? { reporterName: name } : {}),
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
    async report(body: string, name?: string) {
      if (!body.trim()) return false
      busy('report', true)
      set({ error: null })
      const report = await sendFeedback(
        {
          preview,
          platform: 'web',
          body: body.trim(),
          ...(name ? { reporterName: name } : {}),
          ...(route() ? { route: route() as string } : {}),
          ...(config.scenarioId ? { scenarioId: config.scenarioId } : {}),
        },
        options,
      )
      busy('report', false)
      if (!report.ok) {
        set({ error: report.message })
        return false
      }
      set({ lastReportUrl: report.commentUrl })
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

    dismissError() {
      set({ error: null })
    },
  }
}

export type ReviewStore = ReturnType<typeof createReviewStore>
