/** Path the preview link opens: `<scheme>://tapthrough/launch?t=<token>`, or the same path on a universal link. */
export const LAUNCH_PATH = 'tapthrough/launch'

// Parsed by hand: React Native's URL polyfill doesn't handle custom schemes everywhere.
const LAUNCH_URL = /(?:^|\/)tapthrough\/launch\/?\?(?:[^#]*&)?t=([^&#]+)/

/**
 * Returns the link token from a launch URL or path, or null for any other URL.
 * Accepts `myapp://tapthrough/launch?t=…`, `https://host/tapthrough/launch?t=…`
 * and the bare path Expo Router passes to `+native-intent`.
 */
export function parseLaunchUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const match = LAUNCH_URL.exec(url)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}
