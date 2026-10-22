# Set up Tapthrough with your coding agent

**For people:** paste this into Claude Code, Cursor, Codex or any coding agent that can run commands in
your repo:

```text
Read https://raw.githubusercontent.com/tapthrough/tapthrough/main/docs/onboard-with-your-agent.md and follow it step by step.
```

The agent does the code changes and tells you the three things only you can do: install the GitHub App,
add a secret and make one build.

---

**For agents:** the rest of this file is for you. Follow the steps in order. Make changes in a new branch
and open one pull request at the end. When a step says *ask the user*, stop and ask. Don't guess, and don't
create accounts, tokens or secrets yourself.

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
- **`seed`:** `{ "tier": 0 }` until a seed hook exists (step 6). Then use a preset the hook defines. Don't
  invent preset names.
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

## 6. Seed data (ask first)

Scenarios open signed in with test data only when the app has a **seed hook**: a small endpoint on the
user's staging backend that creates a test user and data for each preset. Ask the user:

- Is there a staging backend where creating test users is allowed?
- Which states matter for review (empty account, account with data, admin, viewer)?

If they say yes, build the hook with [`@tapthrough/seed`](../packages/seed/README.md), add `seedHookUrl`
to the config plugin, and switch the scenarios' `seed` to the new presets. If not, leave `{ "tier": 0 }`;
links still open the right screen.

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
4. **Push any commit to this PR.** The Tapthrough comment appears in about two minutes, and the PR itself
   is the first thing to review.

Also list any screens you gave only a "Look at the screen" step, so the user can fill in the checks.
