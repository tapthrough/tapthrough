export interface CookieOptions {
  path?: string
  domain?: string
  maxAge?: number
  expires?: Date
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'lax' | 'strict' | 'none' | boolean
}

export interface Cookie {
  name: string
  value: string
  options?: CookieOptions
}

/** The cookies a request sent, in order. Values are URL-decoded when they can be. */
export function parseCookies(header: string | null | undefined): { name: string; value: string }[] {
  if (!header) return []
  const out: { name: string; value: string }[] = []
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    const name = part.slice(0, at).trim()
    if (!name) continue
    const raw = part.slice(at + 1).trim()
    let value = raw
    try {
      value = decodeURIComponent(raw)
    } catch {
      // Not URL-encoded; keep it as sent.
    }
    out.push({ name, value })
  }
  return out
}

/** One `Set-Cookie` header value. */
export function serializeCookie({ name, value, options = {} }: Cookie): string {
  if (!/^[\w!#$%&'*+\-.^`|~]+$/.test(name)) throw new Error(`Invalid cookie name: ${name}`)
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`]
  if (options.domain) parts.push(`Domain=${options.domain}`)
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  const sameSite = options.sameSite === true ? 'strict' : options.sameSite
  if (sameSite) parts.push(`SameSite=${sameSite[0]?.toUpperCase()}${sameSite.slice(1)}`)
  return parts.join('; ')
}

/**
 * Cookies for one request and its response. Reads see what the request sent
 * plus anything set since, the way a framework's cookie store behaves.
 */
export function createCookieJar(header: string | null | undefined) {
  const current = new Map(parseCookies(header).map((c) => [c.name, c.value]))
  const changes = new Map<string, Cookie>()
  return {
    getAll: () => [...current].map(([name, value]) => ({ name, value })),
    get: (name: string) => current.get(name),
    set(name: string, value: string, options?: CookieOptions) {
      current.set(name, value)
      changes.set(name, { name, value, ...(options ? { options } : {}) })
    },
    /** `Set-Cookie` values for everything set, last write per name. */
    headers: () => [...changes.values()].map(serializeCookie),
  }
}

export type CookieJar = ReturnType<typeof createCookieJar>
