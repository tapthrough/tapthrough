import type { FixtureRoute, Fixtures } from '@tapthrough/protocol'

/** One request the app made while fixtures were on, for diagnostics. */
export interface FixtureCall {
  method: string
  url: string
  /** `fixture`: answered from a route. `missing`: under `baseUrl` with no route. `passthrough`: sent on. */
  outcome: 'fixture' | 'missing' | 'passthrough'
  status?: number
}

export interface FixtureFetchOptions {
  /** Called for every request, whether or not a fixture answered it. */
  onCall?: (call: FixtureCall) => void
  /** Resolves relative request URLs (a browser's `location.origin`). */
  origin?: string
}

interface Compiled {
  route: FixtureRoute
  /** Undefined when the route matches its path on any host. */
  origin: string | undefined
  path: RegExp
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `/users/:id/files/*` → a pattern for the whole path. A trailing slash is optional. */
function pathPattern(path: string): RegExp {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  const source = trimmed
    .split('/')
    .map((segment, index, all) => {
      if (segment === '*' && index === all.length - 1) return '.*'
      if (/^:\w+$/.test(segment)) return '[^/]+'
      return escapeRegExp(segment)
    })
    .join('/')
  return new RegExp(`^${source}/?$`)
}

function compile(route: FixtureRoute, baseUrl: URL | undefined): Compiled {
  if (/^https?:\/\//i.test(route.url)) {
    const url = new URL(route.url)
    return { route, origin: url.origin, path: pathPattern(decodeURI(url.pathname)) }
  }
  const path = route.url.startsWith('/') ? route.url : `/${route.url}`
  if (!baseUrl) return { route, origin: undefined, path: pathPattern(path) }
  const prefix = baseUrl.pathname.replace(/\/+$/, '')
  return { route, origin: baseUrl.origin, path: pathPattern(`${prefix}${path}`) }
}

function isUnder(url: URL, baseUrl: URL): boolean {
  if (url.origin !== baseUrl.origin) return false
  const prefix = baseUrl.pathname.replace(/\/+$/, '')
  return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
}

function respond(route: FixtureRoute): Response {
  const headers = new Headers(route.headers)
  const empty = route.body === undefined || route.status === 204 || route.status === 304
  if (!empty && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(empty ? null : JSON.stringify(route.body), { status: route.status, headers })
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * A `fetch` that answers from fixtures. Requests a route covers never leave
 * the device. Under `baseUrl`, a request with no route gets a 501 (or is sent
 * on, with `unmatched: 'passthrough'`); everything else goes to `realFetch`.
 */
export function createFixtureFetch(
  fixtures: Fixtures,
  realFetch: typeof fetch,
  options: FixtureFetchOptions = {},
): typeof fetch {
  const baseUrl = fixtures.baseUrl ? new URL(fixtures.baseUrl) : undefined
  const compiled = fixtures.routes.map((route) => compile(route, baseUrl))

  return async (input, init) => {
    const request = typeof input === 'object' && 'url' in input ? input : undefined
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const raw = request ? request.url : String(input)

    let url: URL
    try {
      url = new URL(raw, options.origin)
    } catch {
      // A relative URL with nowhere to resolve it; the platform's fetch decides.
      options.onCall?.({ method, url: raw, outcome: 'passthrough' })
      return realFetch(input, init)
    }

    const path = decodeURI(url.pathname)
    const match = compiled.find(
      ({ route, origin, path: pattern }) =>
        (route.method === '*' || route.method === method) &&
        (origin === undefined || origin === url.origin) &&
        pattern.test(path) &&
        Object.entries(route.query ?? {}).every(([key, value]) =>
          url.searchParams.getAll(key).includes(value),
        ),
    )

    if (match) {
      if (match.route.delayMs) await wait(match.route.delayMs)
      options.onCall?.({ method, url: url.href, outcome: 'fixture', status: match.route.status })
      return respond(match.route)
    }

    if (baseUrl && fixtures.unmatched === 'error' && isUnder(url, baseUrl)) {
      options.onCall?.({ method, url: url.href, outcome: 'missing', status: 501 })
      return new Response(
        JSON.stringify({
          error: {
            code: 'tapthrough_no_fixture',
            message: `No Tapthrough fixture answers ${method} ${url.pathname}. Add a route for it to this scenario's fixture file.`,
          },
        }),
        { status: 501, headers: { 'content-type': 'application/json' } },
      )
    }

    options.onCall?.({ method, url: url.href, outcome: 'passthrough' })
    return realFetch(input, init)
  }
}

/**
 * Swaps `target.fetch` for one that answers from fixtures. Returns a function
 * that puts the original back. Installing again replaces the earlier fixtures
 * rather than stacking on them.
 */
export function installFixtures(
  fixtures: Fixtures,
  options: FixtureFetchOptions & { target?: { fetch: typeof fetch } } = {},
): () => void {
  const target = options.target ?? (globalThis as { fetch: typeof fetch })
  const state = target as { fetch: typeof fetch; [ORIGINAL]?: typeof fetch }
  const original = state[ORIGINAL] ?? target.fetch
  const origin =
    options.origin ?? (globalThis as { location?: { origin?: string } }).location?.origin
  const installed = createFixtureFetch(fixtures, original.bind(target), { ...options, origin })
  state[ORIGINAL] = original
  target.fetch = installed
  return () => {
    if (target.fetch !== installed) return
    target.fetch = original
    delete state[ORIGINAL]
  }
}

const ORIGINAL = Symbol.for('tapthrough.fixtures.originalFetch')
