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

/** AsyncStorage, MMKV, `localStorage` or anything shaped like them. */
export interface FixtureStorage {
  getItem(key: string): string | null | undefined | Promise<string | null | undefined>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}

export interface FixtureHostOptions extends FixtureFetchOptions {
  /**
   * Where the active fixtures are kept, so they survive the app restarting.
   * Without it they last until the app is closed.
   */
  storage?: FixtureStorage
  storageKey?: string
  target?: { fetch: typeof fetch }
  /** Checks what storage held; return undefined to drop it. */
  parse: (stored: unknown) => Fixtures | undefined
}

export interface FixtureHost {
  /** Starts answering from these fixtures, or stops when there are none. */
  set(fixtures: Fixtures | undefined): Promise<void>
  current(): Fixtures | undefined
  /** Resolves once stored fixtures, if any, are back in place. */
  ready: Promise<void>
  /** Puts the original `fetch` back. Stored fixtures are kept. */
  uninstall(): void
}

export const FIXTURE_STORAGE_KEY = 'tapthrough:fixtures'

/**
 * Owns `fetch` for a preview build. It takes over at once, and holds the
 * app's first requests until stored fixtures have loaded, so a restarted app
 * never reaches the real backend with a fixture's fake session.
 */
export function createFixtureHost(options: FixtureHostOptions): FixtureHost {
  const target = options.target ?? (globalThis as { fetch: typeof fetch })
  const key = options.storageKey ?? FIXTURE_STORAGE_KEY
  const original = target.fetch
  const real = original.bind(target)
  const origin =
    options.origin ?? (globalThis as { location?: { origin?: string } }).location?.origin
  let fixtures: Fixtures | undefined
  let active: typeof fetch | undefined

  function apply(next: Fixtures | undefined) {
    fixtures = next
    active = next ? createFixtureFetch(next, real, { onCall: options.onCall, origin }) : undefined
  }

  const ready = (async () => {
    if (!options.storage) return
    try {
      const stored = await options.storage.getItem(key)
      // A launch that finished while storage was loading wins.
      if (stored && !fixtures) apply(options.parse(JSON.parse(stored)))
    } catch {
      // Unreadable storage means no fixtures, not a broken app.
    }
  })()

  const hosted: typeof fetch = async (input, init) => {
    await ready
    return active ? active(input, init) : real(input, init)
  }
  target.fetch = hosted

  return {
    async set(next) {
      apply(next)
      if (!options.storage) return
      if (next) await options.storage.setItem(key, JSON.stringify(next))
      else await options.storage.removeItem(key)
    },
    current: () => fixtures,
    ready,
    uninstall() {
      if (target.fetch === hosted) target.fetch = original
    },
  }
}
