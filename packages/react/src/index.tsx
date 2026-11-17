'use client'

import { useEffect, useRef } from 'react'

export const DEFAULT_API_URL = 'https://tapthrough-cloud.vercel.app'

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
 * This component is only a loader. The panel itself is fetched when it
 * mounts, so a page that imports this file but never renders it (production,
 * with `<Tapthrough>`) downloads a few hundred bytes and none of the panel.
 */
export function TapthroughPanel({ host, appId, apiUrl = DEFAULT_API_URL }: TapthroughPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = hostRef.current
    if (!element) return
    let unmount: (() => void) | undefined
    let cancelled = false
    void import('./mount.js').then(({ mount }) => {
      if (!cancelled) unmount = mount(element, { host, appId, apiUrl })
    })
    return () => {
      cancelled = true
      unmount?.()
    }
  }, [host, appId, apiUrl])

  return <div ref={hostRef} data-tapthrough="" />
}
