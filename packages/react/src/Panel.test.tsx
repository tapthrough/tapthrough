// @vitest-environment happy-dom
import type { Checklist } from '@tapthrough/core'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Panel } from './Panel.js'
import { createReviewStore } from './store.js'

const base: Checklist = {
  pr: 12,
  sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  open: true,
  scenarios: [
    {
      key: 'pricing',
      title: 'Pricing: plan comparison',
      routePath: '/pricing',
      why: 'This PR changes app/pricing/page.tsx',
      steps: [
        {
          index: 0,
          action: 'Open the pricing page',
          expect: 'Three plans are shown',
          result: null,
        },
        {
          index: 1,
          action: 'Switch to yearly billing',
          expect: 'Each price changes',
          result: { result: 'pass', reporter: 'Sam', platform: 'web' },
        },
      ],
    },
  ],
}

type Reply = { status?: number; json: unknown }

/** A Tapthrough API stub. Records calls; `replies` overrides a path's answer. */
function api(checklist: Checklist, replies: Record<string, Reply> = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const doFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    calls.push({ path: url.pathname, body })
    const reply = replies[url.pathname] ??
      {
        '/api/v1/checklist': { json: checklist },
        '/api/v1/step-results': { json: {} },
        '/api/v1/feedback': {
          json: { commentUrl: 'https://github.test/acme/web/pull/12#c1', findingId: 'f_1' },
        },
        '/api/v1/checklist/launch': { json: { launchUrl: 'https://acme-1.vercel.app/pricing' } },
      }[url.pathname] ?? { status: 404, json: {} }
    return Response.json(reply.json, { status: reply.status ?? 200 })
  })
  return { fetch: doFetch as unknown as typeof fetch, calls }
}

function setup(checklist: Checklist = base, replies: Record<string, Reply> = {}) {
  const stub = api(checklist, replies)
  const store = createReviewStore({
    apiUrl: 'https://tapthrough.test',
    host: 'acme-1.vercel.app',
    appId: 'app.acme.com',
    fetch: stub.fetch,
    currentPath: () => '/pricing',
  })
  const navigate = vi.fn()
  const captureTab = vi.fn(async () => ({ contentType: 'image/jpeg' as const, base64: 'AAAA' }))
  const user = userEvent.setup()
  render(<Panel store={store} navigate={navigate} captureTab={captureTab} />)
  const sent = (path: string) => stub.calls.filter((call) => call.path === path)
  return { store, navigate, captureTab, user, sent, calls: stub.calls }
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Review/ }))
  return screen.getByRole('complementary', { name: 'Tapthrough review' })
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('Panel', () => {
  it('shows nothing until the checklist loads, then a button that says what is left', async () => {
    setup()
    expect(screen.queryByRole('button')).toBeNull()
    const launcher = await screen.findByRole('button', { name: 'Review, 1 to check' })
    expect(launcher.textContent).toBe('Review1')
  })

  it("shows nothing at all when the deployment isn't a Tapthrough PR build", async () => {
    const { calls } = setup(base, { '/api/v1/checklist': { status: 404, json: {} } })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(document.body.textContent).toBe('')
  })

  it('opens to the plan, with results other reviewers already recorded', async () => {
    const { user } = setup()
    const panel = await openPanel(user)
    expect(within(panel).getByRole('heading', { name: 'Review PR #12' })).toBeTruthy()
    expect(within(panel).getByText('1 of 2 checked · a1b2c3d')).toBeTruthy()
    expect(within(panel).getByText('This PR changes app/pricing/page.tsx')).toBeTruthy()
    expect(within(panel).getByText('Passed by Sam')).toBeTruthy()
    const [pass1, pass2] = within(panel).getAllByRole('button', { name: 'Pass' })
    expect(pass1?.getAttribute('aria-pressed')).toBe('false')
    expect(pass2?.getAttribute('aria-pressed')).toBe('true')
  })

  it('passes a step, saves it, and un-passes it on a second click', async () => {
    const { user, sent } = setup()
    const panel = await openPanel(user)
    const pass = within(panel).getAllByRole('button', { name: 'Pass' })[0] as HTMLElement
    await user.click(pass)
    await waitFor(() => expect(within(panel).getByText('2 of 2 passed · a1b2c3d')).toBeTruthy())
    expect(sent('/api/v1/step-results')[0]?.body).toMatchObject({
      scenarioKey: 'pricing',
      stepIndex: 0,
      result: 'pass',
      platform: 'web',
    })
    await user.click(pass)
    await waitFor(() => expect(within(panel).getByText('1 of 2 checked · a1b2c3d')).toBeTruthy())
    expect(sent('/api/v1/step-results')[1]?.body).toMatchObject({ result: 'skip' })
  })

  it('fails a step with a note and a captured screenshot, and links to the report', async () => {
    const { user, sent, captureTab } = setup()
    const panel = await openPanel(user)
    await user.click(within(panel).getAllByRole('button', { name: 'Fail' })[0] as HTMLElement)
    const note = within(panel).getByLabelText('What happened instead?')
    expect(document.activeElement).toBe(note)
    await user.type(note, 'Only two plans')
    const step = note.closest('li') as HTMLElement
    await user.click(within(step).getByRole('button', { name: 'Capture this tab' }))
    expect(await within(panel).findByAltText('Screenshot to send')).toBeTruthy()
    expect(captureTab).toHaveBeenCalledOnce()
    await user.click(within(panel).getByRole('button', { name: 'Report on the PR' }))

    const link = await within(panel).findByRole('link', { name: 'See it on the PR' })
    expect(link.getAttribute('href')).toBe('https://github.test/acme/web/pull/12#c1')
    expect(sent('/api/v1/feedback')[0]?.body).toMatchObject({
      body: 'Step failed: Open the pricing page\nExpected: Three plans are shown\n\nOnly two plans',
      cause: 'pr',
      route: '/pricing',
      screenshot: { contentType: 'image/jpeg', base64: 'AAAA' },
    })
    expect(sent('/api/v1/step-results')[0]?.body).toMatchObject({
      result: 'fail',
      findingId: 'f_1',
    })
    expect(within(panel).getByRole('button', { name: 'Failed' })).toBeTruthy()
    expect(within(panel).getByText('2 of 2 checked · 1 failed · a1b2c3d')).toBeTruthy()
    expect(within(panel).queryByLabelText('What happened instead?')).toBeNull()
  })

  it('keeps the note open and says why when the report could not be sent', async () => {
    const { user } = setup(base, {
      '/api/v1/feedback': {
        status: 429,
        json: { error: { message: 'Too many reports. Wait a bit.' } },
      },
    })
    const panel = await openPanel(user)
    await user.click(within(panel).getAllByRole('button', { name: 'Fail' })[0] as HTMLElement)
    await user.type(within(panel).getByLabelText('What happened instead?'), 'Broken')
    await user.click(within(panel).getByRole('button', { name: 'Report on the PR' }))

    const alert = await within(panel).findByRole('alert')
    expect(alert.textContent).toContain('Too many reports. Wait a bit.')
    expect(
      (within(panel).getByLabelText('What happened instead?') as HTMLTextAreaElement).value,
    ).toBe('Broken')
    expect(within(panel).getByText('1 of 2 checked · a1b2c3d')).toBeTruthy()
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(within(panel).queryByRole('alert')).toBeNull()
  })

  it('removes an attached screenshot before sending', async () => {
    const { user, sent } = setup()
    const panel = await openPanel(user)
    const report = within(panel).getByLabelText(/Seen something else/)
    await user.type(report, 'Logo is blurry')
    await user.click(within(panel).getByRole('button', { name: 'Capture this tab' }))
    await user.click(await within(panel).findByRole('button', { name: 'Remove screenshot' }))
    await user.click(within(panel).getByRole('button', { name: 'Send report' }))
    await within(panel).findByRole('link', { name: 'See it on the PR' })
    expect(sent('/api/v1/feedback')[0]?.body).not.toHaveProperty('screenshot')
    expect((report as HTMLTextAreaElement).value).toBe('')
  })

  it('remembers the reviewer name and sends it', async () => {
    const { user, sent } = setup()
    const panel = await openPanel(user)
    await user.type(within(panel).getByLabelText('Your name, shown on reports'), 'Ana')
    expect(window.localStorage.getItem('tapthrough:name')).toBe('Ana')
    await user.click(within(panel).getAllByRole('button', { name: 'Pass' })[0] as HTMLElement)
    await waitFor(() => expect(sent('/api/v1/step-results')).toHaveLength(1))
    expect(sent('/api/v1/step-results')[0]?.body).toMatchObject({ reporterName: 'Ana' })
  })

  it('will not send an empty report', async () => {
    const { user } = setup()
    const panel = await openPanel(user)
    const send = within(panel).getByRole('button', { name: 'Send report' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    await user.type(within(panel).getByLabelText(/Seen something else/), '   ')
    expect(send.disabled).toBe(true)
  })

  it('closes on Escape and gives focus back to the Review button', async () => {
    const { user } = setup()
    await openPanel(user)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close review panel')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Review/ }))
  })

  it('sets a scenario up by going to the link Tapthrough returns', async () => {
    const { user, navigate, sent } = setup()
    const panel = await openPanel(user)
    await user.click(within(panel).getByRole('button', { name: 'Set up' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://acme-1.vercel.app/pricing'))
    expect(sent('/api/v1/checklist/launch')[0]?.body).toMatchObject({ scenario: 'pricing' })
  })

  it('without test data, offers Open page, and nothing for a page that needs a record', async () => {
    const off: Checklist = {
      ...base,
      web: { access: 'open', launch: 'off' },
      scenarios: [
        ...base.scenarios,
        { key: 'job', title: 'Job detail', routePath: '/jobs/[id]', steps: [] },
      ],
    }
    const { user } = setup(off)
    const panel = await openPanel(user)
    expect(within(panel).getAllByRole('button', { name: 'Open page' })).toHaveLength(1)
    expect(within(panel).queryByRole('button', { name: 'Set up' })).toBeNull()
    const job = within(panel).getByRole('region', { name: 'Job detail' })
    expect(within(job).queryByRole('button')).toBeNull()
  })

  it('lists earlier reports to check again and records the verdict', async () => {
    const withRecheck: Checklist = {
      ...base,
      recheck: [
        {
          id: 'f_9',
          excerpt: 'Yearly toggle does nothing',
          reporter: 'Sam',
          sha: 'ffffffff00000000',
          platform: 'web',
          stillBrokenHere: false,
        },
      ],
    }
    const { user, sent } = setup(withRecheck, { '/api/v1/findings/f_9/check': { json: {} } })
    const panel = await openPanel(user)
    const section = within(panel).getByRole('region', { name: 'Check these again' })
    expect(within(section).getByText('“Yearly toggle does nothing”')).toBeTruthy()
    expect(within(section).getByText('Sam · fffffff')).toBeTruthy()
    await user.click(within(section).getByRole('button', { name: 'Fixed' }))
    await waitFor(() =>
      expect(
        within(section).getByRole('button', { name: 'Fixed' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    )
    expect(sent('/api/v1/findings/f_9/check')[0]?.body).toMatchObject({ result: 'fixed' })
  })

  it('tells the reviewer about a newer push, a closed PR and an empty plan', async () => {
    const { user } = setup({
      ...base,
      open: false,
      scenarios: [],
      newerBuild: {
        sha: 'bbbbbbbb11111111',
        updateGroupId: 'acme-2.vercel.app',
        openUrl: null,
        hasFix: true,
      },
    })
    const launcher = await screen.findByRole('button', { name: 'Review, newer push available' })
    await user.click(launcher)
    const panel = screen.getByRole('complementary')
    expect(within(panel).getByText(/newer push to this PR \(bbbbbbb, with a fix\)/)).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Open its preview' }).getAttribute('href')).toBe(
      'https://acme-2.vercel.app',
    )
    expect(within(panel).getByText(/pull request is closed/)).toBeTruthy()
    expect(within(panel).getByText(/no test plan yet/)).toBeTruthy()
  })

  it('hides itself while the tab is captured, so it is not in the screenshot', async () => {
    const stub = api(base)
    const store = createReviewStore({
      apiUrl: 'https://tapthrough.test',
      host: 'acme-1.vercel.app',
      appId: 'app.acme.com',
      fetch: stub.fetch,
    })
    let release: (value: null) => void = () => {}
    let hiddenDuringCapture: boolean | undefined
    const captureTab = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          hiddenDuringCapture = document.querySelector('.root')?.hasAttribute('hidden')
          release = resolve
        }),
    )
    const user = userEvent.setup()
    render(<Panel store={store} captureTab={captureTab} />)
    const panel = await openPanel(user)
    await user.click(
      within(panel).getAllByRole('button', { name: 'Capture this tab' })[0] as HTMLElement,
    )
    await waitFor(() => expect(captureTab).toHaveBeenCalled())
    expect(hiddenDuringCapture).toBe(true)
    await act(async () => release(null))
    await waitFor(() => expect(document.querySelector('.root')?.hasAttribute('hidden')).toBe(false))
    // Cancelling the browser's prompt attaches nothing and says nothing.
    expect(screen.queryByAltText('Screenshot to send')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
