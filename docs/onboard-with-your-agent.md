# Set up Tapthrough with your coding agent

**For people:** paste this into Claude Code, Cursor, Codex or any coding agent that can run commands in
your repo:

```text
Read https://raw.githubusercontent.com/tapthrough/tapthrough/main/docs/onboard-with-your-agent.md and follow it step by step.
```

The agent does the code changes and tells you the three things only you can do: install the GitHub App,
add a secret and make one build. If you want reviewers to open signed in with test data, it also writes
the seed hook and its presets from your schema. You then set one environment variable on your stage
environment and deploy.

---

**For agents:** the rest of this file is for you. Follow the steps in order. Make changes in a new branch
and open one pull request at the end. When a step says *ask the user*, stop and ask. Don't guess, don't
create accounts, tokens or secrets yourself, and don't read `.env` files.

Tapthrough adds one comment to every pull request in an Expo app: a link that opens the PR's code on the
screen it changed, signed in with test data, plus a checklist reviewers tick off inside the app. Full guide
for people: [getting started](getting-started.md).

## 1. Check the app fits

Read `package.json`, `app.json` or `app.config.*`, and `eas.json`. Confirm all of these:

- `expo-router` is a dependency, and screens live in `src/app/` or `app/`
- `expo-updates` is a dependency (the app uses EAS Update)
- `expo-dev-client` is a dependency
- the Expo config has a `scheme` and `extra.eas.projectId`

If something is missing, tell the user what and why, and ask before adding it. `expo-updates` and
`expo-dev-client` change native code, so they need a new build. If the app doesn't use Expo Router, stop:
Tapthrough doesn't support it yet.

If the app is a Next.js app instead, follow [getting started with Next.js](getting-started-nextjs.md)
for the setup. For test data, use step 6 of this file with the differences in
[Next.js apps](#nextjs-apps).

**Is the app already on TestFlight or the App Store?** Look for `eas submit`, a `submit` section in
`eas.json`, or a workflow that builds on pushes to the main branch. If so, tell the user before you
change anything:

- This one-PR setup makes the development build use the store app's bundle ID, so installing it replaces
  the TestFlight app on a reviewer's phone. The
  [apps already in the store](https://tapthrough-cloud.vercel.app/docs/existing-app) guide adds a
  separate "(Dev)" app instead. Ask which they want.
- Merging your PR may start a store build. Say so before you merge, and never push straight to the main
  branch.

In a monorepo, do everything below in the Expo app's directory and set `working-directory` in the
workflow.

## 2. Add the SDK

```sh
npx expo install @tapthrough/expo react-native-view-shot
```

> **Early access:** if npm can't find `@tapthrough/expo`, ask the user for the tarball we sent them and
> install that file instead.

1. Add the config plugin to the Expo config. Turn it on only outside production builds. Use the env var
   the app already uses to pick a variant (`APP_VARIANT` here is an example):

   ```ts
   plugins: [
     ['@tapthrough/expo', {
       enabled: process.env.APP_VARIANT !== 'production',
       apiUrl: 'https://tapthrough-cloud.vercel.app',
     }],
   ],
   ```

   Leave out `seedHookUrl` for now; step 6 covers it.

2. Wrap the root layout (`src/app/_layout.tsx` or `app/_layout.tsx`) in `<Tapthrough>`, outside the
   navigator and inside any providers the app's screens need:

   ```tsx
   import { Tapthrough } from '@tapthrough/expo'

   <Tapthrough auth={auth} reset={reset}>
     <Stack />
   </Tapthrough>
   ```

   - `auth(session)` signs the app in with what the seed hook returns. Find how the app signs in today
     (Supabase, Firebase, Clerk, a custom API) and call the same thing.
   - `reset()` clears local state (query caches, persisted stores) before a scenario starts.
   - The [SDK README](../packages/expo/README.md) has ready-made helpers for Supabase, React Query,
     AsyncStorage and Zustand. Use one when it matches.
   - If you can't tell how sign-in works, ask the user.

3. Create `+native-intent.ts` next to the root layout:

   ```ts
   export { redirectSystemPath } from '@tapthrough/expo'
   ```

   If the app already has a `redirectSystemPath`, keep it and add this at the top of it instead:

   ```ts
   import { handleLaunchPath } from '@tapthrough/expo'

   if (handleLaunchPath(path)) return initial ? '/' : null
   ```

4. Set `"runtimeVersion": { "policy": "fingerprint" }` in the Expo config, unless the app already pins a
   runtime version on purpose. If it does, ask the user.

## 3. Add the workflow

Create `.github/workflows/tapthrough.yml` with the workflow from
[getting started, step 4](getting-started.md#4-add-the-workflow). Match the repo's package manager: swap
`npm ci` and `cache: npm` for pnpm or yarn if that's what the lockfile says.

Keep `on: pull_request`. Never use `pull_request_target`.

## 4. Map the screens

```sh
npx @tapthrough/cli map
```

This lists every screen, which scenarios open it (none yet), its route params and the files it imports.
Use `--json` if that's easier for you to read.

## 5. Write scenarios

Write one file per screen at `.tapthrough/scenarios/<key>.json`. The format is in
[plan files](plan-files.md). Start with the screens people change most, or all of them if there are fewer
than 15.

For each screen, read the route file and the files it `uses`, then write:

- **`title`:** what a reviewer sees, e.g. "Cart: two items". Not the file name.
- **`route.path`:** the screen's path exactly as `map` printed it.
- **`route.params`:** one value for each `[param]`. Point at seed data (`"$seed.orders[0].id"`), never a
  hard-coded production ID.
- **`seed`:** `{ "tier": 0 }` until a seed hook exists (step 6). Then use a preset the seed hook defines.
  Don't invent preset names.
- **`steps`:** two or three `{ "action", "expect" }` pairs, using only behavior you found in the code:
  labels, validation messages, where a button goes. Write `expect` as what the reviewer will see on
  screen. If you aren't sure what a screen does, give it a single "Look at the screen" step and say so in
  the PR.

Screens with very different states (empty, full, error, signed out) can have one scenario each, e.g.
`cart-empty.json` and `cart-two-items.json`.

Then run:

```sh
npx @tapthrough/cli check
```

Fix every problem it reports and run it again until it passes.

## 6. Write the seed hook and presets

Scenarios open signed in with test data only when the app has a **seed hook**: one HTTP endpoint on the
user's stage environment that creates a test user and data for each **preset**, and returns a session.
You write the seed hook and the presets. The user sets one environment variable and deploys.

The seed hook is a plain HTTP contract, so it works with any backend in any language. Read
[the seed hook contract](seed-hook-contract.md) before you write anything. The three ways reviewers can
get their data are in
[choosing how reviewers get their data](getting-started.md#choosing-how-reviewers-get-their-data).

Rules for this step:

- Never create accounts, tokens or secrets, and never read `.env` files. Read `.env.example`, config
  code and deployment config for variable **names** only.
- Never run a preset, a migration or a script against any database or environment. You write code. The
  user deploys it.
- Never guess. If you can't find something below, ask the user.

### 6.1 Find the data, the sign-in and a place for the endpoint

Read the code and write down, with file paths:

- **How the app stores data:** schema files, ORM models and migrations (for example `schema.prisma`,
  `supabase/migrations/`, Drizzle or TypeORM models, Django or Rails models, EF Core entities). Note
  each table a scenario's screen reads, its required columns and its foreign keys.
- **How the app authenticates:** the auth provider (Supabase, Firebase, Clerk, Auth.js, a custom API),
  how a user is created, how roles are stored, and what a signed-in session consists of on the client.
- **Where a stage endpoint can live:** an existing stage API, a Supabase edge function, or an Expo
  Router API route on EAS Hosting. Prefer the place that already has access to the stage database and
  the auth provider's admin API.

Then ask the user two things, and stop until they answer:

- Is there a stage environment where creating test users is allowed?
- Does it use a database that is separate from production?

If either answer is no, don't write a seed hook. Leave the scenarios on `{ "tier": 0 }` and say so in
the PR.

**If the backend is in another repo or another language,** don't write the handler in the app's repo
and don't guess the schema from the client's API calls. Ask the user for access to the backend repo.
With access, write the seed hook there, in the backend's own language and framework, following
[the seed hook contract](seed-hook-contract.md). Without access, stop this step: give the user the
contract's link and the list of presets from 6.2, so their backend team can write it.

### 6.2 Propose the presets

A preset is a named starting state. Derive the presets from the screens your scenarios open in step 5,
not from the whole schema. A small set usually covers an app:

- a new user with nothing (empty states, onboarding)
- a user with typical data (lists, detail screens, edit forms)
- a user in each role the screens check (admin, member, viewer)

For each preset, write:

- **a name** in lowercase with dashes, for example `user-with-notes`
- **a one-line description**
- **typed params** with defaults and limits, for example `count`: an integer from 1 to 20, default 3
- **the records it creates**, by table
- **the `refs` it returns**: every record a scenario's route points at with `$seed.`, for example
  `notes[0].id`

**Show the user this list and wait for a yes before you write code.** Ask which states matter for
review that you missed. Keep the list short: a preset with a param beats three similar presets.

### 6.3 Write the handler and the presets

- **JavaScript or TypeScript backend:** use [`@tapthrough/seed`](../packages/seed/README.md).
  `createSeedHandler` does the token checks, the redeem call and the errors. You write the presets with
  `definePreset` and a zod schema for the params. For Supabase, `createTestUser` from
  `@tapthrough/seed/supabase` creates the user and returns the session.
- **Any other backend:** implement
  [the steps in the contract](seed-hook-contract.md#what-the-seed-hook-must-do-in-order), in order, with
  the backend's standard JWT library. The contract has a Python example.

In both cases:

- **Read the environment from a variable**, `TAPTHROUGH_ENV`, and refuse to run unless it is `staging`
  or `development`. Never hard-code `staging`, and never add a default.
- **Set the app ID and the repos.** The app ID is the one Tapthrough has for the app: for Expo, the
  bundle ID or Android package in the Expo config; for Next.js, the `appId` in the layout and the
  workflow. The repo is this repo's `owner/name`. If the iOS and Android IDs differ, ask the user.
- **Give test users a reserved, obviously fake identity:** an email at `tapthrough.test`, a name such
  as "Test Reviewer", and a marker in the user's metadata (`tapthrough: true`) or a column. Never use a
  real domain, a real person's name or a real phone number.
- **Make each preset safe to run again.** Either create a new user for each open and say in the PR that
  marked users need a cleanup job, or keep one user per reviewer and preset (derive it from
  `reviewerId`) and delete and recreate that user's data on each open. Use the second way when the
  backend makes it easy.
- **Create only what the preset needs,** through the same code paths or constraints the app uses, so
  the data is valid. Don't send email, push notifications or webhooks for test users.
- **Return the session the app's sign-in expects,** and write the matching `auth` adapter in the app
  (step 2). The contract lists [the session shapes](seed-hook-contract.md#the-session).
- **Never log the token or the session.**
- **Read secrets from environment variables by name.** If the handler needs an admin key that the
  stage environment doesn't have yet, add it to the hand-over list. Don't create it.

Then connect the app and the scenarios:

1. Add `seedHookUrl` to the config plugin, with the URL the seed hook will have once deployed. If you
   don't know the URL, ask the user.
2. Switch the scenarios' `seed` to the new presets, for example
   `{ "tier": 2, "preset": "user-with-notes", "params": { "count": 3 } }`, and point `route.params` at
   the preset's `refs`. Use only preset names that the seed hook defines.

### 6.4 List what only the user can do

Add these to the hand-over list in step 8. You can't do any of them:

1. **Set `TAPTHROUGH_ENV=staging` on the stage or preview environment only. Never on production.**
2. **Confirm that the stage environment does not use the production database.** If it does, the seed
   hook must not be deployed.
3. **Add any secret the handler reads** that the stage environment doesn't have yet. Name each
   variable.
4. **Deploy the seed hook,** and tell you its URL if it differs from the `seedHookUrl` you set.

### 6.5 Verify

```sh
npx @tapthrough/cli check
```

`check` validates the scenario files and their routes. It does not call the seed hook and does not
compare preset names, so do that yourself: every `seed.preset` in `.tapthrough/scenarios/` must be a
preset the seed hook defines, and every `$seed.` reference must be in that preset's `refs`.

`doctor` checks the setup, and with `--url` it checks a deployed preview or seed hook. Run the first
now. Give the user the second to run after they deploy:

```sh
npx @tapthrough/cli doctor
npx @tapthrough/cli doctor --url <preview-or-hook-url>
```

See [doctor](doctor.md). The contract also has
[curl commands](seed-hook-contract.md#test-it-with-curl) the user can run against the deployed seed
hook.

### 6.6 Notifications (ask first)

Ask whether reviewers should get a push notification when a PR is ready to review. If yes, follow
[step 6 of getting started](getting-started.md#6-tell-reviewers-when-a-pr-is-ready-optional): check
`package.json` for `expo-notifications` (add it with `npx expo install expo-notifications` if missing,
and note that this needs a new development build), and pass `tapthroughNotifications` from
`@tapthrough/expo/notifications` to `<Tapthrough notifications>`. The Apple push key is the user's step:
add "run `eas credentials -p ios` and set up a push key" to the hand-over list.

### Next.js apps

For a Next.js app, the setup steps are in [getting started with Next.js](getting-started-nextjs.md).
Steps 6.1 to 6.5 apply, with these differences:

- **The link opens a launch route in the app,** `app/api/tapthrough/launch/route.ts`, made with
  `createLaunchRoute` from `@tapthrough/next`. It calls the seed hook on the server, sets the session
  cookies and redirects to the scenario's page. There is no `seedHookUrl`.
- **If the app has its own stage database access** (the Next.js app is the backend), write the handler
  in `lib/tapthrough/seed.ts`, export it as `POST` from `app/api/tapthrough/seed/route.ts`, and pass
  the handler itself as `seed` to `createLaunchRoute`. See
  [the seed hook](getting-started-nextjs.md#the-seed-hook).
- **If the backend is elsewhere,** write the seed hook there (6.1) and pass its URL as `seed`.
- **Pick the auth adapter** from [the table](getting-started-nextjs.md#the-launch-route): `authJsAuth()`,
  `supabaseSsrAuth(...)` or your own `{ signIn(session, cookies, request) }`. The preset's `session`
  must match it.
- **Check the middleware.** If it redirects signed-out visitors, make sure it leaves `/api/tapthrough/`
  alone.
- **Remove `test-data: "off"`** from the workflow once the launch route exists.
- **For the user:** set `TAPTHROUGH_ENV=staging` on Vercel's **Preview** environment only, and confirm
  that the Preview environment has its own database variables. The launch route answers 404 outside
  preview deployments, and a Vercel production deployment never enables it.

## 7. Keep it current

Add this to the repo's `AGENTS.md` or `CLAUDE.md` (create `AGENTS.md` if neither exists):

```md
## Tapthrough
When you add a screen under `src/app/`, or change what a screen shows, add or update its scenario in
`.tapthrough/scenarios/` and run `npx @tapthrough/cli check`. Format:
https://github.com/tapthrough/tapthrough/blob/main/docs/plan-files.md
```

## 8. Open the PR and hand over

Open one pull request with everything above. In its description, list what the user has to do, in this
order:

1. **Install the GitHub App** on the repo: <https://github.com/apps/tapthrough/installations/new>
2. **Add an `EXPO_TOKEN` repo secret.** A robot token from their Expo account, with the Developer role,
   works best.
3. **Make a development build** if native code changed (step 1 or 2 added a native dependency):
   `eas build --profile development --platform ios` (or `android`). Reviewers install it once.
   For iPhones, the user registers each phone with `eas device:create`, then runs the first iPhone build
   in their own terminal: it asks for their Apple sign-in, so you can't run it. Point them to
   [the first iPhone build](getting-started.md#the-first-iphone-build-is-interactive) for the prompts.
4. **Push any commit to this PR.** The Tapthrough comment appears in about two minutes, and the PR itself
   is the first thing to review.

If you wrote a seed hook, add the list from [step 6.4](#64-list-what-only-the-user-can-do) after these:
set `TAPTHROUGH_ENV=staging` on the stage environment only and never on production, confirm that the
stage environment does not use the production database, add any secret the handler reads, and deploy
the seed hook. Add the `doctor --url` command from step 6.5 for them to run after the deploy.

Also list the presets you wrote, and any screens you gave only a "Look at the screen" step, so the user
can fill in the checks.
