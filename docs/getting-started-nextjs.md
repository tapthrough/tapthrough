# Getting started with Next.js

Tapthrough adds one comment to every pull request in your Next.js app. It links to the PR's preview
deployment and lists what to test. Reviewers, including people who don't write code, open the preview,
click **Review**, check off steps and report issues. Everything lands back on the PR.

The basic setup takes about 10 minutes and creates no users or data anywhere.

> **Beta.** Web support is new. The setup on this page runs on a production app's pull requests today.
> [Test data](#optional-test-data) is built and tested but hasn't been run by an outside team yet. The
> Action runs from `tapthrough/tapthrough@main` until `v1` is tagged.

## What's supported

| | |
| --- | --- |
| Next.js with the **App Router** (`app/` or `src/app/`) | Supported |
| Hosted on **Vercel**, deployed through its GitHub integration | Supported |
| Next.js Pages Router | Not yet: only pages under `app/` are found |
| Other React apps (Vite, Remix, React Router) | Not yet |
| Other hosts | Not tested. See [other hosts](#other-hosts) |

Using Expo? See [getting started](getting-started.md).

## What you need

- A Next.js App Router app in a GitHub repo
- A Vercel project that builds a preview deployment for each pull request
- React 18 or newer

## 1. Install the GitHub App

Install **TapThrough** on your repo: <https://github.com/apps/tapthrough/installations/new>. It asks for:

| Permission | Why |
| --- | --- |
| Contents: read and write | To read your scenarios and `.tapthrough/` settings. Write is only used to start your own workflows (`repository_dispatch`) when someone asks Claude to fix a report. Tapthrough never pushes code. |
| Pull requests: read and write | To post and update the Tapthrough comment |
| Issues: read and write | To file reports as issues when a reviewer asks |
| Checks: read and write | For the review check run |

## 2. Add the Review button

```sh
npm install @tapthrough/next
```

Pick an **app ID**: a name for this app that you won't change, such as your production hostname
(`app.acme.com`). Letters, digits, dots, dashes and colons. It is fixed to the repo the first time a
pull request reports it.

Add `<Tapthrough>` to your root layout:

```tsx
// app/layout.tsx
import { Tapthrough } from '@tapthrough/next/panel'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Tapthrough appId="app.acme.com" />
      </body>
    </html>
  )
}
```

`<Tapthrough>` is a server component. It renders the Review button only when `VERCEL_ENV` is `preview`.

**In production it renders nothing.** A production page downloads a loader of under 1 KB and never
fetches the panel. A Vercel production deployment can't be made to show it, whatever else is set.

The button sits in the bottom-right corner, in its own shadow root, so your styles don't affect it and its
styles don't affect your page.

## 3. Add the workflow

```yaml
# .github/workflows/tapthrough.yml
name: Tapthrough preview

on:
  pull_request:

permissions:
  contents: read
  id-token: write # proves to Tapthrough which repo and pull request this run is for
  deployments: read # finds the preview deployment of this commit

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the Action diffs against the base branch
      - uses: tapthrough/tapthrough@main
        with:
          platform: web
          app-id: app.acme.com
          test-data: "off"
```

It needs no secrets and no install step. On each push it waits for Vercel to finish deploying the commit,
works out which pages the PR's changes reach, and reports both to Tapthrough.

`test-data: "off"` means reviewers sign in with their own accounts and Tapthrough never signs anyone in or
creates anything. Keep it unless you set up [test data](#optional-test-data).

**If the repo deploys to more than one Vercel project,** the Action stops and lists the environments it
found. Name the one reviewers should open:

```yaml
          preview-environment: Preview – acme-web
```

## 4. Open a pull request

Push a branch and open a PR. Within a minute or two of Vercel finishing, the PR gets a Tapthrough comment
with an **Open preview** link. The link opens a page that sends the reviewer to the preview. On the
preview, the **Review** button opens the panel.

Without scenarios, the panel says there is nothing to check and offers **Report Issue** and
**Approve PR**. The next step gives it a test plan.

### What reviewers can do in the panel

The panel works the same way as the one in the phone app. It lists what to check on the PR, shows one
main button for the next thing to do, and walks through one step at a time.

- **Start where they are.** Opened on a page the PR has a scenario for, the panel goes straight to that
  scenario. Otherwise it opens on the list.
- **Read the brief.** Each scenario says why it is in the plan and what will be checked, then **Start**.
  If the reviewer is on another page, **Open Page and Start** takes them there and the panel comes back
  on the first step.
- **Pass or fail each step,** one at a time. Results show on the PR comment's checklist, with who
  checked them.
- **Report an issue,** from a failed step or with **Report Issue**. It becomes a comment on the PR.
- **Attach a screenshot:** capture the tab, pick an image, or paste one into the note. The panel hides
  itself while the tab is captured.
- **Check earlier reports again.** After a new push, reports from earlier commits come first, with
  **Fixed** and **Still Broken**.
- **Approve the PR.** Once everything passed, **Approve PR** adds the `tapthrough:approved` label and a
  comment saying who tested it. Then the panel lists the repo's other open PRs waiting for a review.
- **Move to a newer push.** If the PR has a later commit than the preview they're on, the panel links to
  its preview.

While it is open on a window 900px or wider, the panel sits beside the page instead of covering it.

### What a report includes

Besides the reviewer's words and screenshot, a report carries what helps someone reproduce it:

- the page's path, the browser and the operating system
- the pages visited since the panel loaded (paths only, without query strings)
- up to 20 console errors and warnings, with tokens and credentials removed
- up to 10 failed requests: method, path and status. Never bodies, headers or query strings.

This is recorded only in preview deployments, only in the reviewer's browser, and sent only when they
send a report.

## 5. Add scenarios

A scenario is a page and the steps to check on it. Put one JSON file per scenario in
`.tapthrough/scenarios/`:

```json
{
  "title": "Pricing: plan comparison",
  "route": { "path": "/pricing" },
  "seed": { "tier": 0 },
  "steps": [
    { "action": "Open the pricing page", "expect": "Three plans are shown side by side" },
    { "action": "Switch to yearly billing", "expect": "Each price changes and shows the yearly saving" }
  ]
}
```

Each PR runs the scenarios whose pages it changes, directly or through shared components. Reviewers pass
or fail each step in the panel. A failed step asks what happened and posts the report on the PR.

Without test data, three rules apply:

- **Use pages with no `[param]` in their path.** There is no data to fill a parameter with. Cover a
  detail page from its list page instead, with a step such as "Open any project from the list".
- **`seed` is always `{ "tier": 0 }`.** The format requires it; it has no effect here.
- **Say which account a step needs,** for example "Sign in as an admin", and don't assume data exists.

`npx @tapthrough/cli map` lists your pages and which have scenarios. `npx @tapthrough/cli check`
validates the files. See [scenarios and plan files](plan-files.md) and [map your screens](scenario-map.md).

> **If your previews use your production database,** reviewers follow these steps with real accounts on
> real data. Don't write steps that send email, publish, pay or delete.

## Optional: test data

With test data, the link signs the reviewer in as a fresh test user and opens the scenario's page with
the records it needs, including pages with `[param]` segments.

**Only do this if your preview deployments use a database where creating test users is safe.** On Vercel,
give the Preview environment its own database variables. If previews share the production database,
stay with `test-data: "off"`.

### The seed hook

The seed hook creates the test user and data. It can live in the same app:

```sh
npm install @tapthrough/seed
```

```ts
// lib/tapthrough/seed.ts
import { createSeedHandler } from '@tapthrough/seed'
import { presets } from './presets'

export const seedHandler = createSeedHandler({
  appId: 'app.acme.com',
  repos: ['acme/web'],
  environment: process.env.TAPTHROUGH_ENV,
  presets,
})
```

```ts
// app/api/tapthrough/seed/route.ts
import { seedHandler } from '@/lib/tapthrough/seed'

export const POST = seedHandler
```

The handler lives outside the route file because Next.js only allows a route file to export its HTTP
methods and config.

Set `TAPTHROUGH_ENV=staging` on the **Preview** environment only. The handler refuses to run unless it is
`staging` or `development`. See the [`@tapthrough/seed` README](../packages/seed/README.md) for writing
presets.

### The launch route

The launch route is what a Tapthrough link opens. It asks the seed hook for a test user, sets the session
cookies and redirects to the scenario's page. It must be at this path:

```ts
// app/api/tapthrough/launch/route.ts
import { createLaunchRoute } from '@tapthrough/next'
import { authJsAuth } from '@tapthrough/next/authjs'
import { seedHandler } from '@/lib/tapthrough/seed'

export const GET = createLaunchRoute({
  appId: 'app.acme.com',
  seed: seedHandler, // or the seed hook's URL, if it runs elsewhere
  auth: authJsAuth(),
})
```

Outside preview deployments the route answers 404.

Pick the adapter for how your app signs people in:

| Your app uses | Adapter | The preset's `session` |
| --- | --- | --- |
| Auth.js (NextAuth v5) with JWT sessions | `authJsAuth()` from `@tapthrough/next/authjs` | `{ sessionToken }`: a token encoded with your `AUTH_SECRET`, e.g. with `encode` from `next-auth/jwt`, salted with the session cookie's name |
| Supabase with `@supabase/ssr` | `supabaseSsrAuth({ url, anonKey })` from `@tapthrough/next/supabase` | `{ access_token, refresh_token }`, which `createTestUser` from `@tapthrough/seed/supabase` returns |
| Something else | Your own `{ signIn(session, cookies, request) }` | Whatever your `signIn` needs to set its cookies |
| No login | Leave `auth` out | Anything |

If a middleware or proxy redirects signed-out visitors to a login page, make sure it leaves
`/api/tapthrough/` alone. Most already skip `/api`.

### Turn it on

Remove `test-data: "off"` from the workflow. Scenarios can now use presets and parameters:

```json
{
  "title": "Project settings: rename",
  "route": { "path": "/projects/[id]/settings", "params": { "id": "$seed.project.id" } },
  "seed": { "tier": 2, "preset": "owner-with-project" },
  "steps": [{ "action": "Change the name and save", "expect": "The header shows the new name" }]
}
```

### Feature flags

A scenario's `flags` are kept in a cookie by the launch route. Check them before your own flags, on the
server:

```ts
import { headers } from 'next/headers'
import { flagOverride, stateFromCookieHeader } from '@tapthrough/next'

const state = stateFromCookieHeader((await headers()).get('cookie'))
const newEditor = flagOverride(state, 'newEditor') ?? flags.newEditor
```

## Previews behind a login

If Vercel Deployment Protection is on for previews, visitors must sign in to Vercel before the app loads.
The Action notices and says so in its log, the comment and the link page. Reviewers then need access to
the Vercel team, or a Shareable Link from the deployment's Share menu.

Tapthrough doesn't ask for your protection bypass secret.

## Other hosts

The Action finds the preview through the GitHub deployment your host records for the commit. For a host
that doesn't record one, pass the URL yourself:

```yaml
          preview-url: ${{ steps.deploy.outputs.url }}
```

Off Vercel, also set `TAPTHROUGH_ENABLED=true` and `TAPTHROUGH_PREVIEW_HOST=<the preview's host>` in the
preview environment only, so the Review button and launch route turn on. This path hasn't been tested on
a real host yet.

## Action inputs for web

| Input | Default | |
| --- | --- | --- |
| `platform` | `auto` | `web`, `expo`, or `auto` to read it from `package.json` |
| `app-id` | | Required. The app ID from step 2 |
| `test-data` | `on` | `off` when Tapthrough must not sign anyone in or create data |
| `preview-environment` | any starting with `Preview` | The GitHub deployment environment to wait for |
| `preview-timeout` | `600` | Seconds to wait for the preview deployment |
| `preview-url` | | Skips waiting; for hosts that don't record GitHub deployments |
| `working-directory` | `.` | The app's directory, in a monorepo |
| `api-url` | Tapthrough's | Only if you run your own |

## When something's off

Run `npx @tapthrough/cli doctor` first. It checks the layout, the workflow and your scenarios, and with
`--url <preview-url>` it asks the preview whether the launch route is on and `TAPTHROUGH_ENV` is valid.
See [check your setup](doctor.md).

| You see | Cause |
| --- | --- |
| No Tapthrough comment | The workflow didn't run or failed. Open its log; the Action says what it was waiting for. |
| `No preview deployment was ready after 600s` | Vercel didn't deploy this commit, or the environment name doesn't match `preview-environment`. |
| `This commit has preview deployments in 2 environments` | Set `preview-environment`. |
| `GitHub refused to list deployments` | Add `deployments: read` to the job's permissions. |
| `This repo is registered as "…"` | The repo already has an app ID. Use that one in the workflow and the layout. |
| The comment appears but the preview has no Review button | `<Tapthrough>` isn't in the root layout, its `appId` differs from the workflow's `app-id`, or the page is a production deployment. |
| "The preview has no Tapthrough launch route" | Expected without test data: set `test-data: "off"`. With test data, add the launch route. |
