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
