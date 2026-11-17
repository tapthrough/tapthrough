'use client'

import { useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Panel } from './Panel.js'
import { createReviewStore } from './store.js'
import { STYLES } from './styles.js'

export { Panel, type PanelProps } from './Panel.js'
export {
  createReviewStore,
  type ReviewConfig,
  type ReviewState,
  type ReviewStore,
} from './store.js'

export const DEFAULT_API_URL = 'https://tapthrough-cloud.vercel.app'

/** The cookie `@tapthrough/next`'s launch route leaves behind; readable by design. */
const STATE_COOKIE = 'tapthrough'

/** The scenario the reviewer was launched into, from the launch cookie. */
export function launchedScenarioId(cookies: string): string | undefined {
  for (const part of cookies.split(';')) {
    const at = part.indexOf('=')
    if (at < 0 || part.slice(0, at).trim() !== STATE_COOKIE) continue
    try {
      const state = JSON.parse(decodeURIComponent(part.slice(at + 1).trim())) as { scn?: unknown }
      return typeof state.scn === 'string' ? state.scn : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

export interface TapthroughPanelProps {
  /** This preview deployment's host, e.g. `process.env.VERCEL_URL`. */
  host: string
  /** The app ID registered with Tapthrough. */
  appId: string
  /** Tapthrough's base URL. */
  apiUrl?: string
}

/**
 * The Review button for a pull request's preview deployment. Mount it once,
 * only in previews (`@tapthrough/next`'s `<Tapthrough>` does that for you).
 *
 * It renders into its own shadow root with its own React root, so the app's
 * styles can't change it, its styles can't leak, and clicks inside it are
 * handled there instead of by the app.
 */
export function TapthroughPanel({ host, appId, apiUrl = DEFAULT_API_URL }: TapthroughPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = hostRef.current
    if (!element) return
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLES
    const mount = document.createElement('div')
    shadow.replaceChildren(style, mount)

    const scenarioId = launchedScenarioId(document.cookie)
    const store = createReviewStore({ apiUrl, host, appId, scenarioId })
    const root: Root = createRoot(mount)
    // Open straight after a launch, so the reviewer sees what to check.
    root.render(<Panel store={store} defaultOpen={Boolean(scenarioId) && justLaunched()} />)
    // Unmounting inside React's own commit warns; let this render finish first.
    return () => {
      setTimeout(() => root.unmount(), 0)
    }
  }, [host, appId, apiUrl])

  return <div ref={hostRef} data-tapthrough="" />
}

/** True on the first page after a launch redirect, once per launch. */
function justLaunched(): boolean {
  try {
    const cookie = document.cookie
    const seen = window.sessionStorage.getItem('tapthrough:seen')
    const now = launchedScenarioId(cookie) ?? ''
    if (seen === now) return false
    window.sessionStorage.setItem('tapthrough:seen', now)
    return true
  } catch {
    return false
  }
}
