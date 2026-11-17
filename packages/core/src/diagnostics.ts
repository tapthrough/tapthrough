/** What a report carries about the moments before it: bounded, scrubbed, no request bodies. */
export interface Diagnostics {
  screens: { path: string; at: number }[]
  logs: { level: 'error' | 'warn'; message: string; at: number }[]
  requests: { method: string; path: string; status: number; at: number }[]
}

const LIMITS = { screens: 20, logs: 20, requests: 10 }

/** Removes credentials from text: query params, Bearer headers and JWT-looking strings. */
export function redact(text: string): string {
  return text
    .replace(
      /\b(access_token|refresh_token|id_token|token|apikey|api_key|key|password|secret|t)=([^&\s"']+)/gi,
      '$1=[redacted]',
    )
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
}

/** Host and path only: query strings often carry tokens or personal data. */
export function requestPath(url: string): string {
  const [withoutQuery = ''] = url.split(/[?#]/)
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/]+)(\/.*)?$/i.exec(withoutQuery)
  return redact(match ? `${match[1]}${match[2] ?? '/'}` : withoutQuery)
}

function format(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

function push<T>(list: T[], item: T, max: number) {
  list.push(item)
  if (list.length > max) list.splice(0, list.length - max)
}

export function createDiagnostics(now: () => number = Date.now) {
  const screens: Diagnostics['screens'] = []
  const logs: Diagnostics['logs'] = []
  const requests: Diagnostics['requests'] = []

  return {
    recordScreen(path: string) {
      if (screens.at(-1)?.path === path) return
      push(screens, { path: requestPath(path), at: now() }, LIMITS.screens)
    },
    recordLog(level: 'error' | 'warn', args: unknown[]) {
      push(logs, { level, message: redact(format(args)).slice(0, 500), at: now() }, LIMITS.logs)
    },
    recordRequest(method: string, url: string, status: number) {
      push(
        requests,
        {
          method: method.toUpperCase().slice(0, 10),
          path: requestPath(url).slice(0, 300),
          status,
          at: now(),
        },
        LIMITS.requests,
      )
    },
    snapshot(): Diagnostics {
      return { screens: [...screens], logs: [...logs], requests: [...requests] }
    },
  }
}

export type DiagnosticsRecorder = ReturnType<typeof createDiagnostics>

interface Hooks {
  console: Pick<Console, 'error' | 'warn'>
  errorUtils?: {
    getGlobalHandler(): (error: unknown, isFatal?: boolean) => void
    setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void
  }
  fetchHost: { fetch: typeof fetch }
}

/**
 * Starts recording console errors and warnings, uncaught errors and failed
 * requests. Each hook calls through to the original, so the app behaves the
 * same. Requests to `ignoreUrl` (Tapthrough itself) are skipped.
 */
export function installDiagnostics(recorder: DiagnosticsRecorder, hooks: Hooks, ignoreUrl: string) {
  const { console: target, errorUtils, fetchHost } = hooks

  for (const level of ['error', 'warn'] as const) {
    const original = target[level].bind(target)
    target[level] = (...args: unknown[]) => {
      recorder.recordLog(level, args)
      original(...args)
    }
  }

  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler()
    errorUtils.setGlobalHandler((error, isFatal) => {
      recorder.recordLog('error', [isFatal ? 'Uncaught (fatal):' : 'Uncaught:', error])
      previous(error, isFatal)
    })
  }

  const originalFetch = fetchHost.fetch
  fetchHost.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method =
      init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    const ignored = url.startsWith(ignoreUrl)
    try {
      const response = await originalFetch(input, init)
      if (!ignored && !response.ok) recorder.recordRequest(method, url, response.status)
      return response
    } catch (error) {
      if (!ignored) recorder.recordRequest(method, url, 0)
      throw error
    }
  }
}
