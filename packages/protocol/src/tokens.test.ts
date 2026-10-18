import { describe, expect, it } from 'vitest'
import {
  generateSigningKey,
  importSigningKey,
  LinkTokenError,
  localKeys,
  signLinkToken,
  verifyLinkToken,
} from './tokens.js'

const issuer = 'https://tapthrough.dev'
const input = {
  issuer,
  appId: 'com.acme.notes.preview',
  reviewerId: 'user_123',
  scenarioId: 'scn_abc',
  repo: 'acme/notes',
  pr: 142,
}

async function setup() {
  const { privateKeyPem, publicJwk } = await generateSigningKey()
  const key = await importSigningKey(privateKeyPem)
  return { key, keys: localKeys({ keys: [publicJwk] }), publicJwk }
}

describe('link tokens', () => {
  it('round-trips claims', async () => {
    const { key, keys } = await setup()
    const { token, jti } = await signLinkToken(input, key)
    const claims = await verifyLinkToken(token, { keys, issuer, appId: input.appId })
    expect(claims).toMatchObject({
      ver: 1,
      iss: issuer,
      aud: input.appId,
      sub: 'user_123',
      scn: 'scn_abc',
      repo: 'acme/notes',
      pr: 142,
      jti,
    })
    expect(claims.exp - claims.iat).toBe(15 * 60)
  })

  it('uses the key thumbprint as kid', async () => {
    const { key, publicJwk } = await setup()
    expect(key.kid).toBe(publicJwk.kid)
  })

  it('rejects an expired token', async () => {
    const { key, keys } = await setup()
    const { token } = await signLinkToken(input, key, { now: new Date(Date.now() - 16 * 60_000) })
    await expect(
      verifyLinkToken(token, { keys, issuer, appId: input.appId }),
    ).rejects.toMatchObject({ code: 'expired' })
  })

  it('rejects a token for another app', async () => {
    const { key, keys } = await setup()
    const { token } = await signLinkToken(input, key)
    await expect(
      verifyLinkToken(token, { keys, issuer, appId: 'com.other.app' }),
    ).rejects.toMatchObject({ code: 'wrong_audience' })
  })

  it('rejects a token signed by an unknown key', async () => {
    const { key } = await setup()
    const other = await setup()
    const { token } = await signLinkToken(input, key)
    await expect(
      verifyLinkToken(token, { keys: other.keys, issuer, appId: input.appId }),
    ).rejects.toBeInstanceOf(LinkTokenError)
  })

  it('rejects a token from another issuer', async () => {
    const { key, keys } = await setup()
    const { token } = await signLinkToken({ ...input, issuer: 'https://evil.example' }, key)
    await expect(
      verifyLinkToken(token, { keys, issuer, appId: input.appId }),
    ).rejects.toMatchObject({ code: 'invalid' })
  })
})
