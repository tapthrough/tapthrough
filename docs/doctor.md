# Check your setup

`tapthrough doctor` checks your Tapthrough setup and says what to fix. Run it before your first pull
request, and again when a link doesn't work.

```sh
npx @tapthrough/cli doctor
```

Run it in the app's directory, or pass `--dir <path>`. It works for Expo and Next.js apps.

Each check prints one line: `pass`, `warn` or `fail`, the check's name, and what it found. A `fail`
means something will not work. A `warn` means something may surprise you, or the doctor couldn't tell.
The command exits with code 1 if any check fails, so it works as a CI step.

## Example

```
pass  app                Next.js app; 14 screens in src/app.
pass  sdk                @tapthrough/next ^0.1.2 is in package.json.
pass  sdk-versions       pnpm-lock.yaml resolves @tapthrough/next 0.1.2.
pass  web-panel          src/app/layout.tsx renders <Tapthrough>.
fail  web-launch-route   The workflow has test data on, but there is no launch route at src/app/api/tapthrough/launch/route.ts. Add it (…) or set `test-data: "off"`.
pass  app-id             The app ID is app.acme.com everywhere it is set.
pass  workflow           .github/workflows/tapthrough.yml uses the Tapthrough action (platform web, app-id app.acme.com, test-data on).
warn  workflow-branches  .github/workflows/tapthrough.yml runs only for pull requests into main. Other PRs get no Tapthrough comment. Remove `branches` under `on.pull_request` to cover them all.
fail  scenarios          2 scenarios, 1 problem. The service skips broken files; fix them, then run `tapthrough check`.
                         .tapthrough/scenarios/billing.json: route "/billing" isn't a screen in the app. Run `npx @tapthrough/cli map` to list the screens.

6 passed, 1 warning, 2 failed.
Note: The doctor can't see which database a preview uses. Set TAPTHROUGH_ENV only where the database is safe to write test data to, and never on production.
```

## What it checks

These checks read the files in your repo. They use no network.

| Check | What it looks at |
| --- | --- |
| `app` | Whether this is an Expo or a Next.js app, and where its screens are. |
| `sdk` | `@tapthrough/expo` or `@tapthrough/next` is in `package.json`. |
| `sdk-versions` | The versions of `@tapthrough/*` packages in your lockfile (pnpm, Yarn or npm). It warns when one package resolves to two versions. |
| `web-panel` | Next.js: the root layout renders `<Tapthrough>`. |
| `web-launch-route` | Next.js: the launch route is at `app/api/tapthrough/launch/route.ts`. It is not needed with `test-data: "off"`. |
| `app-id` | Next.js: the app ID is the same in the layout, the launch route and the workflow. |
| `mobile-plugin` | Expo: the config plugin is in `app.json` or `app.config.*`. |
| `mobile-wrapper` | Expo: the root layout uses `<Tapthrough>`. |
| `mobile-seed-hook` | Expo: `seedHookUrl` is set. It passes without one when every scenario uses [fixtures](fixtures.md), and otherwise says how many scenarios need a seed hook. |
| `workflow` | A workflow in `.github/workflows` uses the Tapthrough action. It shows the `platform`, `app-id` and `test-data` inputs, and checks for `id-token: write`. |
| `workflow-branches` | Which pull requests start the workflow. It warns when `on.pull_request` has `branches` or `paths`, because other PRs get no comment. |
| `scenarios` | The same as `tapthrough check`: how many scenarios you have and how many have problems, including a fixture file that is missing or invalid. |
| `scenario-fixtures` | Next.js: no scenario uses fixtures. They work in Expo apps only for now. |
| `scenario-presets` | Each preset your scenarios use is named somewhere in your source. |

The doctor reads source files as text. When it can't be sure, it says "Couldn't tell" as a warning
and tells you what to look at. It never reads `.env` files.

## Check a deployment with `--url`

The checks above can't see how a deployment is configured. Pass `--url` to ask it:

```sh
# A Next.js preview deployment
npx @tapthrough/cli doctor --url https://acme-git-my-branch-acme.vercel.app

# A seed hook, for Expo apps or a hook that runs outside the app
npx @tapthrough/cli doctor --url https://<ref>.supabase.co/functions/v1/tapthrough-seed
```

A URL with no path is a preview deployment. A URL with a path is a seed hook.

| Check | What it does |
| --- | --- |
| `live-launch` | Sends `GET /api/tapthrough/launch?status=1` to the preview. It tells apart a missing route, a route that is off in this deployment, and a route that is on. |
| `live-app-id` | Compares the app ID the deployed launch route uses with the workflow's `app-id`. If they differ, the app refuses every link. |
| `live-seed-env` | Reads from that answer whether `TAPTHROUGH_ENV` is `staging` or `development`. Any other value stops the seed hook, for example `true`. |
| `live-seed-hook` | Sends `POST { "token": "doctor" }` to the seed hook. The hook checks its environment first, then the token. So "environment" in the answer means `TAPTHROUGH_ENV` is wrong, and "invalid token" means the hook is reachable and its environment is right. |

The doctor sends these two requests and nothing else. It sends no credentials and no real token, and
nothing is seeded. It reports what the deployment answered. It does not guess whether a URL is a
preview or production.

The launch route answers `?status=1` only where Tapthrough is on, so never on a Vercel production
deployment. The answer has no secrets. It says that the route is on, whether the seed hook is in the
app or at another URL, whether an auth adapter is set, the app ID, and whether `TAPTHROUGH_ENV` is valid. A valid
value is shown. An invalid value is never shown, only its length. This needs a version of
`@tapthrough/next` that has the status answer; with an older one the doctor says so.

If the preview is behind Vercel Deployment Protection, the doctor can't reach the route and says so.

## What it can't check

**The doctor can't see which database a preview uses.** Set `TAPTHROUGH_ENV` only where the database
is safe to write test data to, and never on production. If your previews share the production
database, keep `test-data: "off"`.

## Check for newer releases with `--latest`

```sh
npx @tapthrough/cli doctor --latest
```

This asks the npm registry for the newest version of each `@tapthrough` package in your lockfile, and
warns about the ones that are behind. It sends the package names and nothing else.

## For scripts

`--json` prints the same report as JSON:

```json
{
  "framework": "next-app",
  "testData": "on",
  "checks": [{ "id": "app", "status": "pass", "message": "Next.js app; 14 screens in src/app." }],
  "summary": { "pass": 6, "warn": 1, "fail": 2 },
  "note": "The doctor can't see which database a preview uses. …"
}
```

A check with several problems lists them in `details`.
