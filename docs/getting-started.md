# Getting started

Tapthrough adds one comment to every pull request in your Expo app. It holds a link and QR code that open
the PR's code on the right screen, already signed in with test data, plus a checklist of what to test.
Reviewers, including people who don't write code, check off steps and report issues from inside the app.
Everything lands back on the PR.

This guide takes about 30 minutes for a typical Expo Router app.

> **Early access.** The Action runs from `tapthrough/tapthrough@main` until `v1` is tagged, and the SDK
> packages are installed from tarballs we send you until they're on npm.

## What you need

- An Expo app using **Expo Router**, on **EAS Update**, with `expo-dev-client`
- A GitHub repo for it
- An Expo account. Builds and updates run on **your** EAS plan, and Tapthrough never holds your Expo
  credentials.
- **For seeded test data (optional):** a staging backend where creating test users is allowed

## 1. Install the GitHub App

Install **TapThrough** on your repo: <https://github.com/apps/tapthrough/installations/new>. It asks for:

| Permission | Why |
| --- | --- |
| Contents: read | To read your PR's test plan (`.tapthrough/plans/<pr>.json`) |
| Pull requests: read and write | To post and update the Tapthrough comment |
| Issues: read | For linked tickets (coming) |
| Checks: read and write | For the review check run (coming) |

## 2. Add the SDK

```sh
npx expo install @tapthrough/expo react-native-view-shot
```

`react-native-view-shot` is optional. It lets the app attach screenshots to reports, and it's native, so
the next step's build picks it up.

Then:

1. **Add the config plugin** in `app.json` or `app.config.ts`. Turn it on only for preview builds:

   ```ts
   plugins: [
     ['@tapthrough/expo', {
       enabled: process.env.APP_VARIANT !== 'production',
       seedHookUrl: 'https://<your-staging>/functions/v1/tapthrough-seed',
       apiUrl: 'https://tapthrough-cloud.vercel.app',
     }],
   ],
   ```

2. **Wrap your root layout:**

   ```tsx
   // app/_layout.tsx
   import { Tapthrough } from '@tapthrough/expo'

   export default function RootLayout() {
     return (
       <Tapthrough auth={auth} reset={reset}>
         <Stack />
       </Tapthrough>
     )
   }
   ```

   `auth` signs the app in with the session your seed hook returns. `reset` clears local state first.
   See the [SDK README](../packages/expo/README.md) for Supabase, React Query, AsyncStorage and Zustand
   helpers.

3. **Hand launch links to the SDK:**

   ```ts
   // app/+native-intent.ts
   export { redirectSystemPath } from '@tapthrough/expo'
   ```

4. **Use a fingerprint runtime version,** so Tapthrough can tell JS-only PRs (fast updates) from native ones
   (new build):

   ```json
   "runtimeVersion": { "policy": "fingerprint" }
   ```

## 3. Make a development build

```sh
eas build --profile development --platform ios      # simulator build; no Apple account needed
eas build --profile development --platform android  # APK for emulators and Android phones
```

Your `development` profile needs `"developmentClient": true`, plus `"ios": { "simulator": true }` and
`"android": { "buildType": "apk" }`. Reviewers install it once. After that, each PR arrives as an update.
You only need a new build when native code changes.

## 4. Add the workflow

Add an `EXPO_TOKEN` secret to the repo. A robot token from your Expo account works best (it needs the
Developer role). Then create `.github/workflows/tapthrough.yml`:

```yaml
name: Tapthrough preview
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  id-token: write # lets the Action prove which repo it's reporting for; no Tapthrough secret
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: expo/expo-github-action@v9
        with: { eas-version: latest, token: '${{ secrets.EXPO_TOKEN }}' }
      - run: npm ci
      - name: Publish this PR as an EAS Update
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
        run: >
          eas update --branch "pr-${{ github.event.pull_request.number }}"
          --message "$PR_TITLE" --non-interactive --json > eas-update.json
      - uses: tapthrough/tapthrough@main
        with:
          update-json: eas-update.json
          api-url: https://tapthrough-cloud.vercel.app
```

Use `pull_request`, **never `pull_request_target`**. That trigger would run a fork's code with your
`EXPO_TOKEN`.

Open a PR. In about two minutes the Tapthrough comment appears with a link and QR code that open the PR's
code.

## 5. Land reviewers on the right screen (optional)

Without more setup, links open your app's first screen with the PR's code. To open a specific screen with
test data and a checklist:

1. **Add a plan to the PR:** `.tapthrough/plans/<pr-number>.json`. See [plan files](plan-files.md).
2. **Deploy a seed hook** that creates the test data on your staging backend. See the
   [seed hook README](../packages/seed/README.md). It only runs in `staging` or `development`, and only for
   the repos you list.

## What reviewers do

See [reviewing a PR](reviewing.md). In short: open the link, test, tap **Review** to pass or fail steps or
report an issue with a screenshot, and it all shows up on the PR.
