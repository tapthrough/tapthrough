import { TapthroughPanel } from '@tapthrough/react'
import { type Env, previewEnv } from './env.js'

export interface TapthroughProps {
  /** The app ID registered with Tapthrough; the same one the launch route uses. */
  appId: string
  /** Tapthrough's base URL, if you run your own. */
  apiUrl?: string
  /** Defaults to `process.env`. */
  env?: Env
}

/**
 * The Review button for pull request previews. Render it once in the root
 * layout, as a server component:
 *
 * ```tsx
 * <body>
 *   {children}
 *   <Tapthrough appId="app.acme.com" />
 * </body>
 * ```
 *
 * It decides on the server. Outside a preview deployment it renders nothing,
 * so production pages never load the panel's code.
 */
export function Tapthrough({ appId, apiUrl, env }: TapthroughProps) {
  const { enabled, host } = previewEnv(
    env ?? (globalThis as { process?: { env: Env } }).process?.env ?? {},
  )
  if (!enabled || !host) return null
  return <TapthroughPanel host={host} appId={appId} {...(apiUrl ? { apiUrl } : {})} />
}
