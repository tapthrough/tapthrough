import { z } from 'zod'

/** Where a repo keeps its fixture files: `.tapthrough/fixtures/<name>.json`. */
export const FIXTURES_DIR = '.tapthrough/fixtures'

export const FixtureMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
export type FixtureMethod = z.infer<typeof FixtureMethod>

/** One canned answer: a request the app makes and the response it gets instead. */
export const FixtureRoute = z.object({
  /** Defaults to GET. `*` answers every method. */
  method: z.union([FixtureMethod, z.literal('*')]).default('GET'),
  /**
   * A path (`/v1/applications/:id`) or a full URL (`https://api.acme.com/v1/me`).
   * `:name` matches one path segment and a trailing `*` matches the rest.
   * A path is relative to the file's `baseUrl` when there is one, and
   * otherwise matches that path on any host.
   */
  url: z.string().min(1),
  /** Query parameters the request must carry. Others are ignored. */
  query: z.record(z.string(), z.string()).optional(),
  status: z.number().int().min(200).max(599).default(200),
  headers: z.record(z.string(), z.string()).optional(),
  /** Sent as JSON. Leave out for an empty body. */
  body: z.unknown().optional(),
  /** Milliseconds to wait before answering, to show loading states. */
  delayMs: z.number().int().min(0).max(30_000).optional(),
})
export type FixtureRoute = z.infer<typeof FixtureRoute>

/**
 * Canned network responses for one starting state. With these a preview needs
 * no backend: the SDK answers the app's requests itself.
 */
export const Fixtures = z.object({
  v: z.literal(1),
  /** The API the app talks to, e.g. `https://api.acme.com`. */
  baseUrl: z.string().url().optional(),
  /**
   * What a request under `baseUrl` gets when no route matches. `error` answers
   * 501 so a missing fixture is obvious and the real backend is never called;
   * `passthrough` sends it on. Requests outside `baseUrl` always pass through.
   */
  unmatched: z.enum(['error', 'passthrough']).default('error'),
  /**
   * Handed to the app's auth adapter, so the app starts signed in. The values
   * are fakes the fixtures recognise, never a real credential.
   */
  session: z.record(z.string(), z.unknown()).optional(),
  /** Checked in order; the first match answers. */
  routes: z.array(FixtureRoute).max(500),
})
export type Fixtures = z.infer<typeof Fixtures>
