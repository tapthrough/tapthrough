import { createDiagnostics } from '@tapthrough/core'
import { createRoot } from 'react-dom/client'
import { type BrowserWindow, browserInfo, installBrowserDiagnostics } from './browser.js'
import { launchedScenarioId } from './cookie.js'
import { Panel } from './Panel.js'
import { createReviewStore } from './store.js'
import { STYLES } from './styles.js'

export interface MountConfig {
  host: string
  appId: string
  apiUrl: string
}

/** One recorder per page: it outlives the panel if the app remounts it. */
const diagnostics = createDiagnostics()

/** True on the first page after a launch redirect, once per launch. */
function justLaunched(scenarioId: string | undefined): boolean {
  if (!scenarioId) return false
  try {
    if (window.sessionStorage.getItem('tapthrough:seen') === scenarioId) return false
    window.sessionStorage.setItem('tapthrough:seen', scenarioId)
    return true
  } catch {
    return false
  }
}

/**
 * Renders the panel into `element`'s shadow root with its own React root, so
 * the app's styles can't change it, its styles can't leak, and clicks inside
 * it are handled there instead of by the app. Returns a function that removes it.
 */
export function mount(element: HTMLElement, config: MountConfig): () => void {
  const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLES
  const container = document.createElement('div')
  shadow.replaceChildren(style, container)

  installBrowserDiagnostics(diagnostics, window as unknown as BrowserWindow, config.apiUrl)

  const scenarioId = launchedScenarioId(document.cookie)
  const store = createReviewStore({
    ...config,
    scenarioId,
    device: () => browserInfo(navigator.userAgent),
    diagnostics: () => diagnostics.snapshot(),
  })
  const root = createRoot(container)
  // Open straight after a launch, so the reviewer sees what to check.
  root.render(
    <Panel store={store} defaultOpen={justLaunched(scenarioId)} launchedScenarioId={scenarioId} />,
  )
  // Unmounting inside another root's commit warns; let that render finish first.
  return () => {
    setTimeout(() => root.unmount(), 0)
  }
}
