import {
  ErrorResponse,
  RedeemResponse,
  SeedHookRequest,
  type SeedHookResponse,
} from '@tapthrough/protocol'
import {
  type LinkTokenClaims,
  LinkTokenError,
  remoteKeys,
  type VerifyLinkTokenOptions,
  verifyLinkToken,
} from '@tapthrough/protocol/tokens'
import type { Presets, SeedContext, SeedResult } from './presets.js'

type JWTVerifyGetKey = VerifyLinkTokenOptions['keys']

export const DEFAULT_ISSUER = 'https://tapthrough.dev'

/** Environments the handler will seed in. Anything else, including unset, is refused. */
export const SEEDABLE_ENVIRONMENTS = ['staging', 'development'] as const

export interface SeedHandlerOptions {
  /** The app ID registered with Tapthrough; tokens for any other app are refused. */
  appId: string
  /**
   * This deployment's environment, e.g. `Deno.env.get('TAPTHROUGH_ENV')`. Must be
   * `staging` or `development`, so a misdeployed hook can never create users in production.
   */
  environment: string | undefined
  presets: Presets
  /** Tier 0: log in to a shared test account instead of seeding. */
  sharedAccount?: (context: SeedContext) => Promise<SeedResult>
  /** Tapthrough's base URL. Tokens must be issued by it; JWKS and redeem are fetched from it. */
  issuer?: string
  /** For tests: verify against these keys instead of fetching the JWKS. */
  keys?: JWTVerifyGetKey
  /** For tests, or runtimes without a global fetch. */
  fetch?: typeof fetch
}

class SeedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } } satisfies ErrorResponse, { status })
}

/**
 * A Fetch API handler (Deno, Bun, Node 18+, edge functions) for the seed hook.
 * The SDK posts `{ token }`; the handler verifies the token, redeems it with
 * Tapthrough (single use, returns the scenario), runs the preset, and returns
 * the session. Sessions are created here and go straight to the app; they never
 * pass through Tapthrough.
 */
export function createSeedHandler(
  options: SeedHandlerOptions,
): (request: Request) => Promise<Response> {
  const issuer = (options.issuer ?? DEFAULT_ISSUER).replace(/\/$/, '')
  const doFetch = options.fetch ?? fetch
  let keys = options.keys

  return async (request) => {
    if (request.method !== 'POST') {
      return errorResponse('method_not_allowed', 'Use POST', 405)
    }
    try {
      if (!(SEEDABLE_ENVIRONMENTS as readonly string[]).includes(options.environment ?? '')) {
        throw new SeedError(
          'not_staging',
          `Seeding is disabled in environment "${options.environment ?? 'unset'}"`,
          403,
        )
      }

      const body = SeedHookRequest.safeParse(await request.json().catch(() => undefined))
      if (!body.success) throw new SeedError('bad_request', 'Expected { token }', 400)
      const { token } = body.data

      keys ??= remoteKeys(`${issuer}/.well-known/jwks.json`)
      const claims = await verify(token, { keys, issuer, appId: options.appId })
      const scenario = await redeem(token, issuer, doFetch)

      const context: SeedContext = {
        reviewerId: claims.sub,
        scenarioId: scenario.scenarioId,
        repo: claims.repo,
        pr: claims.pr,
        role: scenario.seed.role,
      }
      const result = await runSeed(scenario.seed, context, options)

      return Response.json(
        {
          apiVersion: 1,
          session: result.session,
          refs: result.refs ?? {},
          route: scenario.route,
          flags: scenario.flags,
        } satisfies SeedHookResponse,
        { headers: { 'Cache-Control': 'no-store' } },
      )
    } catch (error) {
      if (error instanceof SeedError) return errorResponse(error.code, error.message, error.status)
      const message = error instanceof Error ? error.message : 'Seeding failed'
      return errorResponse('seed_failed', message, 500)
    }
  }
}

async function verify(
  token: string,
  options: { keys: JWTVerifyGetKey; issuer: string; appId: string },
): Promise<LinkTokenClaims> {
  try {
    return await verifyLinkToken(token, options)
  } catch (error) {
    if (error instanceof LinkTokenError) {
      const message =
        error.code === 'expired' ? 'This link has expired. Reopen it from the PR.' : error.message
      throw new SeedError(error.code, message, 401)
    }
    throw error
  }
}

async function redeem(token: string, issuer: string, doFetch: typeof fetch) {
  const response = await doFetch(`${issuer}/api/v1/tokens/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = ErrorResponse.safeParse(body)
    if (error.success) {
      throw new SeedError(error.data.error.code, error.data.error.message, response.status)
    }
    throw new SeedError('redeem_failed', `Tapthrough returned ${response.status}`, 502)
  }
  const scenario = RedeemResponse.safeParse(body)
  if (!scenario.success) {
    throw new SeedError('redeem_failed', 'Tapthrough returned an unexpected response', 502)
  }
  return scenario.data
}

async function runSeed(
  seed: RedeemResponse['seed'],
  context: SeedContext,
  options: SeedHandlerOptions,
): Promise<SeedResult> {
  if (seed.tier === 0) {
    if (!options.sharedAccount) {
      throw new SeedError('tier_unsupported', 'No shared account is configured', 501)
    }
    return options.sharedAccount(context)
  }
  if (seed.tier === 1) {
    throw new SeedError('tier_unsupported', 'Network mocks are not supported yet', 501)
  }

  const name = seed.preset as string
  const preset = Object.hasOwn(options.presets, name) ? options.presets[name] : undefined
  if (!preset) throw new SeedError('unknown_preset', `Unknown preset "${name}"`, 400)

  const params = preset.params.safeParse(seed.params ?? {})
  if (!params.success) {
    const issue = params.error.issues[0]
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
    throw new SeedError(
      'invalid_params',
      `Invalid params for "${name}"${where}: ${issue?.message}`,
      400,
    )
  }
  return preset.seed({ ...context, params: params.data })
}
