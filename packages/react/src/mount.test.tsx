// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBrowserDiagnostics } from './browser.js'
import { TapthroughPanel } from './index.js'

const checklist = {
  pr: 12,
  sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  open: true,
  scenarios: [
    {
      key: 'pricing',
      title: 'Pricing',
      routePath: '/pricing',
      steps: [{ index: 0, action: 'Open pricing', expect: 'Plans show', result: null }],
    },
  ],
}

const realFetch = globalThis.fetch
let requests: URL[]

beforeEach(() => {
  requests = []
  resetBrowserDiagnostics()
  window.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    requests.push(url)
    return url.pathname === '/api/v1/checklist'
      ? Response.json(checklist)
      : Response.json({}, { status: 404 })
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  window.fetch = realFetch
  // biome-ignore lint/suspicious/noDocumentCookie: the test environment has no Cookie Store
  document.cookie = 'tapthrough=; Max-Age=0'
  window.sessionStorage.clear()
})

function shadow() {
  return document.querySelector('[data-tapthrough]')?.shadowRoot ?? null
}

describe('TapthroughPanel', () => {
  it('loads the panel after mounting, into a shadow root with its own styles', async () => {
    render(<TapthroughPanel host="acme-1.vercel.app" appId="app.acme.com" />)
    // Only the empty host element at first: the panel is a separate chunk.
    expect(document.querySelector('[data-tapthrough]')).toBeTruthy()
    expect(shadow()).toBeNull()

    await waitFor(() => expect(shadow()?.querySelector('.launcher')).toBeTruthy())
    expect(shadow()?.querySelector('style')?.textContent).toContain('.launcher')
    // Nothing of the panel is in the page's own DOM, where the app's CSS could reach it.
    expect(document.querySelector('.launcher')).toBeNull()
    expect(shadow()?.querySelector('.launcher')?.textContent).toBe('Review1')
  })

  it('asks Tapthrough about this deployment and app, at the default address', async () => {
    render(<TapthroughPanel host="acme-1.vercel.app" appId="app.acme.com" />)
    await waitFor(() => expect(requests.length).toBeGreaterThan(0))
    const [request] = requests
    expect(request?.origin).toBe('https://tapthrough-cloud.vercel.app')
    expect(request?.searchParams.get('updateGroupId')).toBe('acme-1.vercel.app')
    expect(request?.searchParams.get('projectId')).toBe('app.acme.com')
    expect(request?.searchParams.get('platform')).toBe('web')
  })

  it('opens by itself on the first page after a launch, once', async () => {
    const state = encodeURIComponent(JSON.stringify({ v: 1, scn: 'scn_1', flags: {} }))
    // biome-ignore lint/suspicious/noDocumentCookie: the test environment has no Cookie Store
    document.cookie = `tapthrough=${state}`
    const first = render(<TapthroughPanel host="acme-1.vercel.app" appId="app.acme.com" />)
    await waitFor(() => expect(shadow()?.querySelector('.panel')).toBeTruthy())
    first.unmount()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })

    render(<TapthroughPanel host="acme-1.vercel.app" appId="app.acme.com" />)
    await waitFor(() => expect(shadow()?.querySelector('.launcher')).toBeTruthy())
    expect(shadow()?.querySelector('.panel')).toBeNull()
  })

  it('leaves nothing behind when the app unmounts it', async () => {
    const view = render(<TapthroughPanel host="acme-1.vercel.app" appId="app.acme.com" />)
    await waitFor(() => expect(shadow()?.querySelector('.launcher')).toBeTruthy())
    const root = shadow()
    view.unmount()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(document.querySelector('[data-tapthrough]')).toBeNull()
    expect(root?.querySelector('.launcher')).toBeNull()
  })
})
