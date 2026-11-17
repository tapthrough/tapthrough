import { type DiagnosticsRecorder, installDiagnostics } from '@tapthrough/core'

/** What a report says about where it was sent from, in the fields phones use. */
export interface BrowserInfo {
  /** The browser, e.g. `Chrome`. */
  os: string
  /** Its major version, e.g. `142`. */
  osVersion: string
  /** The operating system, e.g. `macOS`. */
  model: string
}

const BROWSERS: [name: string, pattern: RegExp][] = [
  // Order matters: Edge and Opera also say Chrome, and Chrome also says Safari.
  ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
  ['Opera', /OPR\/(\d+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ['Safari', /Version\/(\d+)[\d.]* .*Safari\//],
]

const SYSTEMS: [name: string, pattern: RegExp][] = [
  ['iOS', /iPhone|iPad|iPod/],
  ['Android', /Android/],
  ['macOS', /Mac OS X|Macintosh/],
  ['Windows', /Windows/],
  ['ChromeOS', /CrOS/],
  ['Linux', /Linux/],
]

/** Browser and operating system from a user agent string; empty parts when it can't tell. */
export function browserInfo(userAgent: string): Partial<BrowserInfo> {
  const info: Partial<BrowserInfo> = {}
  for (const [name, pattern] of BROWSERS) {
    const match = pattern.exec(userAgent)
    if (match?.[1]) {
      info.os = name
      info.osVersion = match[1]
      break
    }
  }
  const system = SYSTEMS.find(([, pattern]) => pattern.test(userAgent))
  if (system) info.model = system[0]
  return info
}

/** The parts of `window` the recorder hooks into. */
export interface BrowserWindow {
  console: Pick<Console, 'error' | 'warn'>
  fetch: typeof fetch
  location: { pathname: string }
  history: Pick<History, 'pushState' | 'replaceState'>
  addEventListener(type: string, listener: (event: never) => void): void
}

let installed = false

/**
 * Starts recording what a bug report is most useful with: the pages visited,
 * console errors and warnings, uncaught errors, and requests that failed.
 * Bodies and query strings are never kept. Everything calls through to the
 * original, so the app behaves the same. Installs once per page.
 */
export function installBrowserDiagnostics(
  recorder: DiagnosticsRecorder,
  target: BrowserWindow,
  ignoreUrl: string,
): void {
  if (installed) return
  installed = true
  installDiagnostics(recorder, { console: target.console, fetchHost: target }, ignoreUrl)

  target.addEventListener('error', (event: { message?: string }) => {
    recorder.recordLog('error', ['Uncaught:', event.message ?? 'error'])
  })
  target.addEventListener('unhandledrejection', (event: { reason?: unknown }) => {
    recorder.recordLog('error', ['Unhandled rejection:', event.reason])
  })

  const record = () => recorder.recordScreen(target.location.pathname)
  record()
  // Client-side navigation doesn't fire an event, so watch the history calls routers make.
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = target.history[method].bind(target.history)
    target.history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args)
      record()
    }
  }
  target.addEventListener('popstate', record)
}

/** For tests: lets a new window be instrumented. */
export function resetBrowserDiagnostics(): void {
  installed = false
}
