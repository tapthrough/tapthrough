import { parseLaunchUrl } from './core/url.js'
import { controller } from './runtime.js'

/**
 * Hands launch links to Tapthrough and keeps Expo Router from trying to open
 * them as a screen. Use it as your `app/+native-intent.tsx`:
 *
 * ```ts
 * export { redirectSystemPath } from '@tapthrough/expo'
 * ```
 *
 * If you already have a `redirectSystemPath`, call `handleLaunchPath(path)`
 * first and return early when it returns true.
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string
  initial: boolean
}): string | null {
  if (!handleLaunchPath(path)) return path
  // Stay put on a warm open; start at the root on a cold one. The SDK navigates once seeded.
  return initial ? '/' : null
}

/** Queues the launch if `path` is a Tapthrough launch link. Returns whether it was one. */
export function handleLaunchPath(path: string): boolean {
  try {
    if (!parseLaunchUrl(path)) return false
    controller.offer(path)
    return true
  } catch {
    return false
  }
}
