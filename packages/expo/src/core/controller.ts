import { scenarioIdFromToken } from './feedback.js'
import { type LaunchDeps, type LaunchError, runLaunch } from './launch.js'
import { parseLaunchUrl } from './url.js'

export type LaunchState =
  | { status: 'idle' }
  | { status: 'launching' }
  | { status: 'done'; path: string }
  | { status: 'error'; error: LaunchError }

export type ControllerDeps = Omit<LaunchDeps, 'navigate'>
type Navigate = LaunchDeps['navigate']

/** A value that may not exist yet; `get()` waits for it. */
function slot<T>() {
  let value: T | undefined
  let waiters: ((value: T) => void)[] = []
  return {
    set(next: T | undefined) {
      value = next
      if (next === undefined) return
      for (const resolve of waiters) resolve(next)
      waiters = []
    },
    get(): Promise<T> {
      return value !== undefined
        ? Promise.resolve(value)
        : new Promise((resolve) => waiters.push(resolve))
    },
  }
}

/**
 * Turns incoming URLs into launches. Each token runs once and launches run one
 * at a time. A URL can arrive before the app is ready (Expo Router hands over
 * the initial URL before the root layout mounts), so each launch waits for
 * `configure()` and navigation waits for `setNavigator()`.
 */
export function createLaunchController() {
  let state: LaunchState = { status: 'idle' }
  const listeners = new Set<() => void>()
  const seen = new Set<string>()
  const queue: string[] = []
  const deps = slot<ControllerDeps>()
  const navigator = slot<Navigate>()
  let running = false
  let lastScenarioId: string | undefined

  function setState(next: LaunchState) {
    state = next
    for (const listener of listeners) listener()
  }

  async function drain() {
    if (running) return
    running = true
    try {
      for (let token = queue.shift(); token !== undefined; token = queue.shift()) {
        const current = await deps.get()
        setState({ status: 'launching' })
        const result = await runLaunch(token, {
          ...current,
          navigate: async (path) => (await navigator.get())(path),
        })
        if (result.ok) lastScenarioId = scenarioIdFromToken(token)
        setState(
          result.ok
            ? { status: 'done', path: result.path }
            : { status: 'error', error: result.error },
        )
      }
    } finally {
      running = false
    }
  }

  return {
    /** Queues a launch if `url` carries a token not seen before. Returns whether it did. */
    offer(url: string | null | undefined): boolean {
      const token = parseLaunchUrl(url)
      if (!token || seen.has(token)) return false
      seen.add(token)
      queue.push(token)
      void drain()
      return true
    },
    /** Supplies the seed hook URL and adapters; queued launches start once this is called. */
    configure(next: ControllerDeps | undefined) {
      deps.set(next)
    },
    /** Pass the router's navigate once it can navigate; undefined when it unmounts. */
    setNavigator(next: Navigate | undefined) {
      navigator.set(next)
    },
    dismiss() {
      if (state.status === 'error' || state.status === 'done') setState({ status: 'idle' })
    },
    getState: () => state,
    /** The scenario the app was last launched into, for attributing reports. */
    lastScenarioId: () => lastScenarioId,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export type LaunchController = ReturnType<typeof createLaunchController>
