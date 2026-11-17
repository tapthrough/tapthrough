import { describe, expect, it } from 'vitest'
import { Tapthrough } from './panel.js'

describe('Tapthrough', () => {
  it('renders the panel in a preview, with the deployment host', () => {
    const element = Tapthrough({
      appId: 'app.acme.com',
      env: { VERCEL_ENV: 'preview', VERCEL_URL: 'acme-1.vercel.app' },
    })
    expect(element?.props).toEqual({ host: 'acme-1.vercel.app', appId: 'app.acme.com' })
  })

  it('passes a custom API URL through', () => {
    const element = Tapthrough({
      appId: 'app.acme.com',
      apiUrl: 'https://tapthrough.acme.dev',
      env: { VERCEL_ENV: 'preview', VERCEL_URL: 'acme-1.vercel.app' },
    })
    expect(element?.props.apiUrl).toBe('https://tapthrough.acme.dev')
  })

  it('renders nothing in production, in development, or without a host', () => {
    const app = { appId: 'app.acme.com' }
    expect(
      Tapthrough({ ...app, env: { VERCEL_ENV: 'production', VERCEL_URL: 'acme.vercel.app' } }),
    ).toBeNull()
    expect(Tapthrough({ ...app, env: { VERCEL_ENV: 'development' } })).toBeNull()
    expect(Tapthrough({ ...app, env: { VERCEL_ENV: 'preview' } })).toBeNull()
    expect(Tapthrough({ ...app, env: {} })).toBeNull()
  })
})
