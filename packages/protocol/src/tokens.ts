import {
  type CryptoKey,
  calculateJwkThumbprint,
  createLocalJWKSet,
  createRemoteJWKSet,
  errors,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  type JSONWebKeySet,
  type JWK,
  type JWTVerifyGetKey,
  jwtVerify,
  SignJWT,
} from 'jose'
import { z } from 'zod'

export const LINK_TOKEN_ALG = 'ES256'
export const LINK_TOKEN_TTL_SECONDS = 15 * 60

/** Claims carried by a link token. Short names keep QR codes small. */
export const LinkTokenClaims = z.object({
  ver: z.literal(1),
  iss: z.string().min(1),
  /** The customer app's ID; the SDK and seed hook reject tokens for other apps. */
  aud: z.string().min(1),
  /** The reviewer's user ID. */
  sub: z.string().min(1),
  jti: z.string().min(16),
  iat: z.number().int(),
  exp: z.number().int(),
  /** Scenario ID. */
  scn: z.string().min(1),
  repo: z.string().min(1),
  pr: z.number().int().positive(),
})
export type LinkTokenClaims = z.infer<typeof LinkTokenClaims>

export type LinkTokenErrorCode = 'expired' | 'wrong_audience' | 'invalid'

export class LinkTokenError extends Error {
  constructor(
    readonly code: LinkTokenErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'LinkTokenError'
  }
}

export interface SigningKey {
  privateKey: CryptoKey
  kid: string
}

export interface SignLinkTokenInput {
  issuer: string
  appId: string
  reviewerId: string
  scenarioId: string
  repo: string
  pr: number
}

export async function signLinkToken(
  input: SignLinkTokenInput,
  key: SigningKey,
  options: { ttlSeconds?: number; now?: Date } = {},
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const exp = iat + (options.ttlSeconds ?? LINK_TOKEN_TTL_SECONDS)
  const jti = crypto.randomUUID()
  const token = await new SignJWT({
    ver: 1,
    scn: input.scenarioId,
    repo: input.repo,
    pr: input.pr,
  })
    .setProtectedHeader({ alg: LINK_TOKEN_ALG, kid: key.kid, typ: 'JWT' })
    .setIssuer(input.issuer)
    .setAudience(input.appId)
    .setSubject(input.reviewerId)
    .setJti(jti)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key.privateKey)
  return { token, jti, expiresAt: new Date(exp * 1000) }
}

export interface VerifyLinkTokenOptions {
  keys: JWTVerifyGetKey
  issuer: string
  appId: string
  now?: Date
}

/** Verifies the signature, issuer, audience and expiry. Does not enforce single use; redeem does. */
export async function verifyLinkToken(
  token: string,
  options: VerifyLinkTokenOptions,
): Promise<LinkTokenClaims> {
  let payload: unknown
  try {
    ;({ payload } = await jwtVerify(token, options.keys, {
      algorithms: [LINK_TOKEN_ALG],
      issuer: options.issuer,
      audience: options.appId,
      ...(options.now ? { currentDate: options.now } : {}),
    }))
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      throw new LinkTokenError('expired', 'Link token has expired')
    }
    if (error instanceof errors.JWTClaimValidationFailed && error.claim === 'aud') {
      throw new LinkTokenError('wrong_audience', 'Link token is for a different app')
    }
    throw new LinkTokenError('invalid', 'Link token is invalid')
  }
  const claims = LinkTokenClaims.safeParse(payload)
  if (!claims.success) throw new LinkTokenError('invalid', 'Link token claims are malformed')
  return claims.data
}

/** Key set fetched from our `/.well-known/jwks.json`, cached by jose. */
export function remoteKeys(jwksUrl: string | URL): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl))
}

export function localKeys(jwks: JSONWebKeySet): JWTVerifyGetKey {
  return createLocalJWKSet(jwks)
}

export async function importSigningKey(privateKeyPem: string): Promise<SigningKey> {
  const privateKey = await importPKCS8(privateKeyPem, LINK_TOKEN_ALG, { extractable: true })
  const publicJwk = await publicJwkOf(privateKey)
  return { privateKey, kid: publicJwk.kid as string }
}

/** The public half of a signing key, with `kid` set to its RFC 7638 thumbprint. */
export async function publicJwkOf(privateKey: CryptoKey): Promise<JWK> {
  const { kty, crv, x, y } = await exportJWK(privateKey)
  const jwk: JWK = { kty, crv, x, y }
  return { ...jwk, kid: await calculateJwkThumbprint(jwk), alg: LINK_TOKEN_ALG, use: 'sig' }
}

export async function generateSigningKey(): Promise<{ privateKeyPem: string; publicJwk: JWK }> {
  const { privateKey } = await generateKeyPair(LINK_TOKEN_ALG, { extractable: true })
  return { privateKeyPem: await exportPKCS8(privateKey), publicJwk: await publicJwkOf(privateKey) }
}
