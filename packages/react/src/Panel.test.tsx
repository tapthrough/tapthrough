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
        '/api/v1/pulls': { json: { pulls: [] } },
        '/api/v1/pulls/approve': { json: { pr: 12, result: 'review' } },
      }[url.pathname] ?? { status: 404, json: {} }
    return Response.json(reply.json, { status: reply.status ?? 200 })
  })
  return { fetch: doFetch as unknown as typeof fetch, calls }
}

/** Nothing checked yet, on two pages. */
const fresh: Checklist = {
  ...base,
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
          result: null,
        },
      ],
    },
    {
      key: 'settings',
      title: 'Settings: profile',
      routePath: '/settings',
      steps: [{ index: 0, action: 'Open settings', expect: 'Your name is shown', result: null }],
    },
  ],
}

function setup(
  checklist: Checklist = base,
  replies: Record<string, Reply> = {},
  path = '/pricing',
) {
  const stub = api(checklist, replies)
  const store = createReviewStore({
    apiUrl: 'https://tapthrough.test',
    host: 'acme-1.vercel.app',
    appId: 'app.acme.com',
    fetch: stub.fetch,
    currentPath: () => path,
  })
  const navigate = vi.fn()
  const captureTab = vi.fn(async () => ({ contentType: 'image/jpeg' as const, base64: 'AAAA' }))
  const user = userEvent.setup()
  render(
    <Panel store={store} navigate={navigate} captureTab={captureTab} currentPath={() => path} />,
  )
  const sent = (path: string) => stub.calls.filter((call) => call.path === path)
  return { store, navigate, captureTab, user, sent, calls: stub.calls }
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Review/ }))
  return screen.getByRole('complementary', { name: 'Tapthrough review' })
}

const button = (panel: HTMLElement, name: string | RegExp) =>
  within(panel).getByRole('button', { name })
const heading = (panel: HTMLElement) => within(panel).getByRole('heading', { level: 2 }).textContent

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
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

  describe('the list', () => {
    it('opens to the PR: what to check, how far along it is, and one next action', async () => {
      const { user } = setup(fresh, {}, '/somewhere-else')
      const panel = await openPanel(user)
      expect(heading(panel)).toBe('PR #12')
      expect(within(panel).getByText('0 of 2 checked · a1b2c3d')).toBeTruthy()
      expect(
        within(panel).getByText(/Check these 2 on PR #12\. Each one sets the app up/),
      ).toBeTruthy()
      expect(button(panel, /Pricing: plan comparison.*2 steps · sets itself up/)).toBeTruthy()
      expect(button(panel, /Settings: profile.*1 step · sets itself up/)).toBeTruthy()
      expect(button(panel, 'Start: Pricing: plan comparison')).toBeTruthy()
      expect(button(panel, 'Report Issue')).toBeTruthy()
      // Not every step of every scenario: those are one screen each.
      expect(within(panel).queryByRole('button', { name: /^Pass/ })).toBeNull()
    })

    it("starts with the page the reviewer is on, even when it isn't first", async () => {
      const { user } = setup(fresh, {}, '/settings')
      const panel = await openPanel(user)
      expect(heading(panel)).toBe('Settings: profile')
      await user.click(button(panel, 'Back'))
      expect(button(panel, /Settings: profile.*This page · 1 step/)).toBeTruthy()
      expect(button(panel, 'Start: Settings: profile')).toBeTruthy()
    })

    it('says Continue for a scenario with results, including other reviewers’', async () => {
      const { user } = setup(base, {}, '/elsewhere')
      const panel = await openPanel(user)
      expect(button(panel, /Pricing: plan comparison.*1 of 2 checked/)).toBeTruthy()
      await user.click(button(panel, 'Continue: Pricing: plan comparison'))
      expect(within(panel).getByText('Step 1 of 2')).toBeTruthy()
      await user.click(button(panel, /^Pass/))
      await user.click(
        await within(panel).findByRole('button', { name: /^Switch to yearly billing/ }),
      )
      expect(within(panel).getByText('Passed by Sam')).toBeTruthy()
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
      expect(
        within(panel).getByRole('link', { name: 'Open its preview' }).getAttribute('href'),
      ).toBe('https://acme-2.vercel.app')
      expect(within(panel).getByText(/pull request is closed/)).toBeTruthy()
      expect(within(panel).getByText('Nothing to check · a1b2c3d')).toBeTruthy()
      // A closed PR can't be approved.
      expect(within(panel).queryByRole('button', { name: /Approve/ })).toBeNull()
      expect(button(panel, 'Report Issue')).toBeTruthy()
    })

    it('remembers the reviewer name and sends it', async () => {
      const { user, sent } = setup(base, {}, '/elsewhere')
      const panel = await openPanel(user)
      await user.type(within(panel).getByLabelText('Your name, shown on reports'), 'Ana')
      expect(window.localStorage.getItem('tapthrough:name')).toBe('Ana')
      await user.click(button(panel, 'Continue: Pricing: plan comparison'))
      await user.click(button(panel, /^Pass/))
      await waitFor(() => expect(sent('/api/v1/step-results')).toHaveLength(1))
      expect(sent('/api/v1/step-results')[0]?.body).toMatchObject({ reporterName: 'Ana' })
    })
  })

  describe('the brief', () => {
    it('says why the scenario is in the plan and what will be checked', async () => {
      const { user } = setup(fresh)
      const panel = await openPanel(user)
      expect(heading(panel)).toBe('Pricing: plan comparison')
      expect(within(panel).getByText('2 steps')).toBeTruthy()
      expect(within(panel).getByText('This PR changes app/pricing/page.tsx')).toBeTruthy()
      expect(within(panel).getByText('Switch to yearly billing')).toBeTruthy()
      expect(within(panel).getByText('Expect: Each price changes')).toBeTruthy()
    })

    it('with test data, sets the preview up and comes back on the first step', async () => {
      const { user, navigate, sent } = setup(fresh)
      const panel = await openPanel(user)
      expect(within(panel).getByText(/Sign you in as a test user and open \/pricing/)).toBeTruthy()
      await user.click(button(panel, 'Set Up and Start'))
      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith('https://acme-1.vercel.app/pricing'),
      )
      expect(sent('/api/v1/checklist/launch')[0]?.body).toMatchObject({ scenario: 'pricing' })
      // The page is about to reload: where to resume is already saved.
      expect(JSON.parse(window.sessionStorage.getItem('tapthrough:panel') ?? '{}')).toEqual({
        pr: 12,
        open: true,
        nav: { view: 'step', key: 'pricing', index: 0 },
      })
    })

    it('with test data, Skip Setup goes to the first step without leaving the page', async () => {
      const { user, navigate } = setup(fresh)
      const panel = await openPanel(user)
      await user.click(button(panel, 'Skip Setup'))
      expect(within(panel).getByText('Step 1 of 2')).toBeTruthy()
      expect(navigate).not.toHaveBeenCalled()
    })

    it('without test data, starts in place on the scenario’s own page', async () => {
      const { user, navigate } = setup({ ...fresh, web: { access: 'open', launch: 'off' } })
      const panel = await openPanel(user)
      expect(
        within(panel).getByText(/Sign in with your own account if a step needs one/),
      ).toBeTruthy()
      expect(within(panel).queryByRole('button', { name: /Set Up/ })).toBeNull()
      await user.click(button(panel, 'Start'))
      expect(within(panel).getByText('Step 1 of 2')).toBeTruthy()
      expect(navigate).not.toHaveBeenCalled()
    })

    it('without test data, opens the page from elsewhere, or says to open a record yourself', async () => {
      const off: Checklist = {
        ...fresh,
        web: { access: 'open', launch: 'off' },
        scenarios: [
          ...fresh.scenarios,
          {
            key: 'job',
            title: 'Job detail',
            routePath: '/jobs/[id]',
            steps: [{ index: 0, action: 'Read the job', expect: 'It has a title', result: null }],
          },
        ],
      }
      const { user, navigate } = setup(off, {}, '/elsewhere')
      const panel = await openPanel(user)
      expect(
        within(panel).getByText(/Each one opens its page and walks you through it/),
      ).toBeTruthy()
      expect(button(panel, /Pricing: plan comparison.*2 steps$/)).toBeTruthy()
      await user.click(button(panel, /Job detail/))
      expect(within(panel).getByText(/Open any, then start/)).toBeTruthy()
      expect(within(panel).queryByRole('button', { name: /Open Page/ })).toBeNull()
      expect(button(panel, 'Start')).toBeTruthy()
      await user.click(button(panel, 'Back'))
      await user.click(button(panel, /^Pricing: plan comparison/))
      await user.click(button(panel, 'Open Page and Start'))
      await waitFor(() => expect(navigate).toHaveBeenCalledOnce())
      expect(within(panel).getByText('Step 1 of 2')).toBeTruthy()
    })
  })

  describe('the steps', () => {
    it('passes one step at a time, then sums the scenario up and moves to the next', async () => {
      const { user, sent } = setup(fresh)
      const panel = await openPanel(user)
      await user.click(button(panel, 'Skip Setup'))
      expect(within(panel).getByText('Open the pricing page')).toBeTruthy()
      expect(within(panel).getByText('Expect: Three plans are shown')).toBeTruthy()
      expect(within(panel).queryByText('Switch to yearly billing')).toBeNull()

      await user.click(button(panel, 'Pass: Open the pricing page'))
      await within(panel).findByText('Step 2 of 2')
      expect(sent('/api/v1/step-results')[0]?.body).toMatchObject({
        scenarioKey: 'pricing',
        stepIndex: 0,
        result: 'pass',
        platform: 'web',
      })
      await user.click(button(panel, 'Previous step'))
      expect(button(panel, 'Pass: Open the pricing page').getAttribute('aria-pressed')).toBe('true')
      // Already passed: carries on without saving it again.
      await user.click(button(panel, 'Pass: Open the pricing page'))
      await user.click(button(panel, 'Pass: Switch to yearly billing'))

      await within(panel).findByText('All passed')
      expect(within(panel).getByText('2 of 2 passed')).toBeTruthy()
      expect(sent('/api/v1/step-results')).toHaveLength(2)
      await user.click(button(panel, 'Next: Settings: profile'))
      expect(heading(panel)).toBe('Settings: profile')
      expect(within(panel).getByText('1 step')).toBeTruthy()
    })

    it('keeps the step when saving fails, and shows who checked one already', async () => {
      const { user } = setup(base, {
        '/api/v1/step-results': { status: 500, json: { error: { message: 'Could not save.' } } },
      })
      const panel = await openPanel(user)
      expect(within(panel).getByText('Step 1 of 2')).toBeTruthy()
      await user.click(button(panel, /^Pass/))
      expect((await within(panel).findByRole('alert')).textContent).toContain('Could not save.')
      expect(within(panel).getByText('Step 1 of 2')).toBeTruthy()
      expect(button(panel, /^Pass/).getAttribute('aria-pressed')).toBe('false')
      await user.click(button(panel, 'Back'))
      await user.click(button(panel, /^Pricing: plan comparison/))
      // Back on its open step; the one Sam passed says so.
      expect(within(panel).getByText('Step 1 of 2')).toBeTruthy()
      expect(within(panel).queryByText('Passed by Sam')).toBeNull()
    })

    it('fails a step with a note and a captured screenshot, and links to the report', async () => {
      const { user, sent, captureTab } = setup()
      const panel = await openPanel(user)
      await user.click(button(panel, 'Fail: Open the pricing page'))
      const note = within(panel).getByLabelText('What happened instead?')
      expect(document.activeElement).toBe(note)
      expect(within(panel).getByText('Step 1 of 2 · failed')).toBeTruthy()
      await user.type(note, 'Only two plans')
      await user.click(button(panel, 'Capture this tab'))
      expect(await within(panel).findByAltText('Screenshot to send')).toBeTruthy()
      expect(captureTab).toHaveBeenCalledOnce()
      await user.click(button(panel, 'Report on the PR'))

      // The last step: on to the scenario's summary.
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
      expect(within(panel).getByText('1 failed')).toBeTruthy()
      expect(within(panel).getByText('1 of 2 passed')).toBeTruthy()
      expect(button(panel, /Open the pricing page.*Failed · open to check it again/)).toBeTruthy()
      expect(within(panel).queryByLabelText('What happened instead?')).toBeNull()

      await user.click(button(panel, 'Check Failed Step Again'))
      expect(within(panel).getByText(/This step failed\. If it works now, press Pass/)).toBeTruthy()
      expect(button(panel, 'Fail: Open the pricing page').getAttribute('aria-pressed')).toBe('true')
      await user.click(button(panel, 'Back'))
      expect(within(panel).getByText('1 failed · a1b2c3d')).toBeTruthy()
      expect(within(panel).getByText(/1 step failed, and your reports are on PR #12/)).toBeTruthy()
      expect(within(panel).queryByRole('button', { name: /Approve/ })).toBeNull()
    })

    it('keeps the note open and says why when the report could not be sent', async () => {
      const { user } = setup(base, {
        '/api/v1/feedback': {
          status: 429,
          json: { error: { message: 'Too many reports. Wait a bit.' } },
        },
      })
      const panel = await openPanel(user)
      await user.click(button(panel, /^Fail/))
      await user.type(within(panel).getByLabelText('What happened instead?'), 'Broken')
      await user.click(button(panel, 'Report on the PR'))

      const alert = await within(panel).findByRole('alert')
      expect(alert.textContent).toContain('Too many reports. Wait a bit.')
      expect(
        (within(panel).getByLabelText('What happened instead?') as HTMLTextAreaElement).value,
      ).toBe('Broken')
      await user.click(within(alert).getByRole('button', { name: 'Dismiss' }))
      expect(within(panel).queryByRole('alert')).toBeNull()
      await user.click(button(panel, 'Cancel'))
      expect(button(panel, /^Fail/).getAttribute('aria-pressed')).toBe('false')
    })
  })

  describe('approving', () => {
    it('offers Approve once everything passed, and says what it did', async () => {
      const { user, sent } = setup()
      const panel = await openPanel(user)
      await user.type(within(panel).getByRole('button', { name: 'Back' }), '{Enter}')
      await user.type(within(panel).getByLabelText('Your name, shown on reports'), 'Ana')
      await user.click(button(panel, 'Continue: Pricing: plan comparison'))
      await user.click(button(panel, /^Pass/))
      await user.click(await within(panel).findByRole('button', { name: 'Finish Review' }))
      expect(within(panel).getByText('All passed · a1b2c3d')).toBeTruthy()
      expect(within(panel).getByText(/Everything passed\. Approve PR #12/)).toBeTruthy()

      await user.click(button(panel, 'Approve PR #12'))
      await within(panel).findByText('Approved. An engineer reviews and merges it.')
      expect(sent('/api/v1/pulls/approve')[0]?.body).toMatchObject({
        updateGroupId: 'acme-1.vercel.app',
        projectId: 'app.acme.com',
        platform: 'web',
        by: 'Ana',
      })
      expect(within(panel).getByText('Approved · a1b2c3d')).toBeTruthy()
      expect(within(panel).getByText('No other PRs are waiting for a review.')).toBeTruthy()
      await user.click(button(panel, 'Done'))
      expect(screen.queryByRole('complementary')).toBeNull()
    })

    it('says so when the PR is already approved, and lists other PRs to review', async () => {
      const pull = {
        author: 'sam',
        draft: false,
        needsNewBuild: false,
        fromIdea: false,
        updatedAt: '2026-11-17T00:00:00Z',
      }
      const { user } = setup(
        base,
        {
          '/api/v1/pulls': {
            json: {
              pulls: [
                {
                  ...pull,
                  number: 12,
                  title: 'Yearly billing',
                  current: true,
                  openUrl: null,
                  approved: true,
                },
                {
                  ...pull,
                  number: 14,
                  title: 'New footer',
                  current: false,
                  openUrl: 'https://acme-3.vercel.app',
                  approved: false,
                  toCheck: 2,
                },
                {
                  ...pull,
                  number: 15,
                  title: 'Done already',
                  current: false,
                  openUrl: null,
                  approved: true,
                },
              ],
            },
          },
        },
        '/elsewhere',
      )
      const panel = await openPanel(user)
      await within(panel).findByText('PR #12 is approved.')
      expect(within(panel).queryByRole('button', { name: /Approve|Continue/ })).toBeNull()
      const other = within(panel).getByRole('link', { name: /#14 New footer.*2 to check · sam/ })
      expect(other.getAttribute('href')).toBe('https://acme-3.vercel.app')
      expect(within(panel).queryByText(/Done already/)).toBeNull()
    })

    it('says why when approving fails, and still offers it', async () => {
      const { user } = setup(
        { ...base, scenarios: [] },
        {
          '/api/v1/pulls/approve': {
            status: 409,
            json: { error: { message: 'PR #12 is already closed' } },
          },
        },
      )
      const panel = await openPanel(user)
      expect(within(panel).getByText(/Nothing to check on this PR\. Look around/)).toBeTruthy()
      await user.click(button(panel, 'Approve PR #12'))
      expect((await within(panel).findByRole('alert')).textContent).toContain('already closed')
      expect(button(panel, 'Approve PR #12')).toBeTruthy()
    })
  })

  describe('reporting an issue', () => {
    it('sends a report that is not about a step, then returns to the list with its link', async () => {
      const { user, sent } = setup(base, {}, '/elsewhere')
      const panel = await openPanel(user)
      await user.click(button(panel, 'Report Issue'))
      expect(heading(panel)).toBe('Report an issue')
      const report = within(panel).getByLabelText(/Seen something off/)
      expect(document.activeElement).toBe(report)
      await user.type(report, 'Logo is blurry')
      await user.click(button(panel, 'Capture this tab'))
      await user.click(await within(panel).findByRole('button', { name: 'Remove screenshot' }))
      await user.click(button(panel, 'Send Report'))
      await within(panel).findByRole('link', { name: 'See it on the PR' })
      expect(heading(panel)).toBe('PR #12')
      expect(sent('/api/v1/feedback')[0]?.body).toMatchObject({ body: 'Logo is blurry' })
      expect(sent('/api/v1/feedback')[0]?.body).not.toHaveProperty('screenshot')
      expect(sent('/api/v1/feedback')[0]?.body).not.toHaveProperty('cause')
    })

    it('will not send an empty report', async () => {
      const { user } = setup(base, {}, '/elsewhere')
      const panel = await openPanel(user)
      await user.click(button(panel, 'Report Issue'))
      const send = button(panel, 'Send Report') as HTMLButtonElement
      expect(send.disabled).toBe(true)
      await user.type(within(panel).getByLabelText(/Seen something off/), '   ')
      expect(send.disabled).toBe(true)
    })
  })

  it('lists earlier reports first, takes the verdict and returns to the list', async () => {
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
    const { user, sent } = setup(
      withRecheck,
      { '/api/v1/findings/f_9/check': { json: {} } },
      '/elsewhere',
    )
    const panel = await openPanel(user)
    expect(within(panel).getByText('2 left to check on PR #12.')).toBeTruthy()
    expect(
      button(panel, /Re-check: Yearly toggle does nothing.*Sam reported this on fffffff/),
    ).toBeTruthy()
    await user.click(button(panel, 'Re-check Earlier Report'))
    expect(heading(panel)).toBe('Re-check')
    expect(within(panel).getByText('“Yearly toggle does nothing”')).toBeTruthy()
    await user.click(button(panel, /Fixed/))
    await waitFor(() => expect(heading(panel)).toBe('PR #12'))
    expect(sent('/api/v1/findings/f_9/check')[0]?.body).toMatchObject({ result: 'fixed' })
    expect(button(panel, /Re-check: Yearly toggle does nothing.*Fixed here/)).toBeTruthy()
    expect(button(panel, 'Continue: Pricing: plan comparison')).toBeTruthy()
  })

  it('in a walkthrough, goes screen to screen without a summary in between', async () => {
    const walk: Checklist = {
      ...fresh,
      web: { access: 'open', launch: 'off' },
      walkthrough: { intro: 'This PR changes the theme. Look each screen over.' },
      scenarios: fresh.scenarios.map((s) => ({ ...s, steps: s.steps.slice(0, 1) })),
    }
    const { user } = setup(walk, {}, '/elsewhere')
    const panel = await openPanel(user)
    expect(
      within(panel).getByText('This PR changes the theme. Look each screen over.'),
    ).toBeTruthy()
    expect(button(panel, /Pricing: plan comparison.*Not checked yet/)).toBeTruthy()
    await user.click(button(panel, 'Start: Pricing: plan comparison'))
    expect(within(panel).getByText('Screen 1 of 2')).toBeTruthy()
    await user.click(button(panel, 'Start Without Opening'))
    await user.click(button(panel, /^Pass/))
    await waitFor(() => expect(heading(panel)).toBe('Settings: profile'))
    expect(within(panel).getByText('Screen 2 of 2')).toBeTruthy()
  })

  describe('opening and closing', () => {
    it('picks up on the same step after a page load', async () => {
      window.sessionStorage.setItem(
        'tapthrough:panel',
        JSON.stringify({ pr: 12, open: true, nav: { view: 'step', key: 'pricing', index: 1 } }),
      )
      setup(fresh, {}, '/settings')
      const panel = await screen.findByRole('complementary', { name: 'Tapthrough review' })
      expect(heading(panel)).toBe('Pricing: plan comparison')
      expect(within(panel).getByText('Step 2 of 2')).toBeTruthy()
    })

    it("stays closed after a page load if it was closed, or if that was another PR's", async () => {
      window.sessionStorage.setItem(
        'tapthrough:panel',
        JSON.stringify({ pr: 99, open: true, nav: { view: 'step', key: 'pricing', index: 1 } }),
      )
      const { user } = setup(fresh, {}, '/elsewhere')
      const panel = await openPanel(user)
      expect(heading(panel)).toBe('PR #12')
    })

    it('falls back to the list when what was saved no longer exists', async () => {
      window.sessionStorage.setItem(
        'tapthrough:panel',
        JSON.stringify({ pr: 12, open: true, nav: { view: 'step', key: 'gone', index: 0 } }),
      )
      setup(fresh, {}, '/elsewhere')
      const panel = await screen.findByRole('complementary', { name: 'Tapthrough review' })
      expect(heading(panel)).toBe('PR #12')
    })

    it('closes on Escape and gives focus back to the Review button', async () => {
      const { user } = setup(base, {}, '/elsewhere')
      await openPanel(user)
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Close review panel')
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('complementary')).toBeNull()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Review/ }))
    })

    it('moves focus to the title of each new screen', async () => {
      const { user } = setup(base, {}, '/elsewhere')
      const panel = await openPanel(user)
      await user.click(button(panel, 'Continue: Pricing: plan comparison'))
      expect(document.activeElement).toBe(within(panel).getByRole('heading', { level: 2 }))
    })

    it('sits beside the page on a wide window instead of covering it, and gives the room back', async () => {
      document.documentElement.style.marginRight = '4px'
      const { user } = setup()
      expect(document.documentElement.style.marginRight).toBe('4px')
      await openPanel(user)
      expect(document.documentElement.style.marginRight).toBe('380px')
      await user.keyboard('{Escape}')
      expect(document.documentElement.style.marginRight).toBe('4px')
      document.documentElement.style.marginRight = ''
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
      let marginDuringCapture: string | undefined
      const captureTab = vi.fn(
        () =>
          new Promise<null>((resolve) => {
            hiddenDuringCapture = document.querySelector('.root')?.hasAttribute('hidden')
            marginDuringCapture = document.documentElement.style.marginRight
            release = resolve
          }),
      )
      const user = userEvent.setup()
      render(<Panel store={store} captureTab={captureTab} currentPath={() => '/elsewhere'} />)
      const panel = await openPanel(user)
      await user.click(button(panel, 'Report Issue'))
      await user.click(button(panel, 'Capture this tab'))
      await waitFor(() => expect(captureTab).toHaveBeenCalled())
      expect(hiddenDuringCapture).toBe(true)
      // The page is back at its full width for the screenshot.
      expect(marginDuringCapture).toBe('')
      await act(async () => release(null))
      await waitFor(() =>
        expect(document.querySelector('.root')?.hasAttribute('hidden')).toBe(false),
      )
      // Cancelling the browser's prompt attaches nothing and says nothing.
      expect(screen.queryByAltText('Screenshot to send')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
})
