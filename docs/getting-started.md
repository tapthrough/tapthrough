# Getting started

Tapthrough adds one comment to every pull request in your Expo app. It holds a link and QR code that open
the PR's code on the right screen, already signed in with test data, plus a checklist of what to test.
Reviewers, including people who don't write code, check off steps and report issues from inside the app.
Everything lands back on the PR.

This guide takes about 30 minutes for a typical Expo Router app. Or hand it to your coding agent: paste
`Read https://raw.githubusercontent.com/tapthrough/tapthrough/main/docs/onboard-with-your-agent.md and follow
it step by step` into Claude Code, Cursor or Codex. See [set up with your coding agent](onboard-with-your-agent.md).

> **Early access.** The Action runs from `tapthrough/tapthrough@main` until `v1` is tagged.

## What you need

- An Expo app using **Expo Router**, on **EAS Update**, with `expo-dev-client`
- A GitHub repo for it
- An Expo account. Builds and updates run on **your** EAS plan, and Tapthrough never holds your Expo
  credentials.
- **For seeded test data (optional):** a staging backend where creating test users is allowed
- **For push notifications (optional):** `expo-notifications`, and an Apple push key in your EAS
  credentials

## 1. Install the GitHub App

Install **TapThrough** on your repo: <https://github.com/apps/tapthrough/installations/new>. It asks for:

| Permission | Why |
| --- | --- |
| Contents: read and write | To read your test plans and `.tapthrough/` settings. Write is only used to start your own workflows (`repository_dispatch`) when someone asks Claude to fix a report. Tapthrough never pushes code. |
| Pull requests: read and write | To post and update the Tapthrough comment |
| Issues: read and write | To file reports as issues when a reviewer asks |
| Checks: read and write | For the review check run |

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
       apiUrl: 'https://tapthrough-cloud.vercel.app',
       // Add later, for test data (step 5):
       // seedHookUrl: 'https://<your-staging>/functions/v1/tapthrough-seed',
     }],
   ],
   ```

   If your app is already in the App Store, make sure store builds set `APP_VARIANT=production`, or
   follow [apps already in the store](https://tapthrough-cloud.vercel.app/docs/existing-app) instead.

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

   No login in your app yet? Leave out `auth` and `reset`: `<Tapthrough><Stack /></Tapthrough>`.
   Otherwise `auth` signs the app in with the session your seed hook returns, and `reset` clears local
   state first.
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

   The fingerprint hashes your app config, including `seedHookUrl` and `apiUrl`, and the version of every
   package with a config plugin, `@tapthrough/expo` included. So changing a URL or upgrading Tapthrough
   would need a new build, and PRs made before the upgrade wouldn't open on builds made after it.
   Tapthrough has no native code and its plugin only writes `extra`, so leave it out with a
   `fingerprint.config.js` next to `app.json`:

   ```js
   /** @type {import('@expo/fingerprint').Config} */
   module.exports = {
     // Tapthrough's version: upgrading it never changes native code.
     ignorePaths: ['node_modules/@tapthrough/expo/package.json'],
     sourceSkips: [
       // Expo's default ("balanced") skips…
       'PackageJsonAndroidAndIosScriptsIfNotContainRun',
       'ExpoConfigVersions',
       'ExpoConfigRuntimeVersionIfString',
       'EasJson',
       'Easignore',
       'AutolinkingConfigPaths',
       // …plus `extra`, where the Tapthrough plugin writes the URLs.
       'ExpoConfigExtraSection',
     ],
     // And the URLs as passed to the plugin.
     fileHookTransform(source, chunk) {
       if (source.type !== 'contents' || source.id !== 'expoConfig' || typeof chunk !== 'string') {
         return chunk
       }
       const config = JSON.parse(chunk)
       config.plugins = config.plugins?.map((plugin) =>
         Array.isArray(plugin) && plugin[0] === '@tapthrough/expo' ? [plugin[0]] : plugin,
       )
       return JSON.stringify(config)
     },
   }
   ```

   Adding this file changes the fingerprint once, so add it before your first development build.

## 3. Make a development build

```sh
eas build --profile development --platform ios      # simulator build; no Apple account needed
eas build --profile development --platform android  # APK for emulators and Android phones
```

Your `development` profile needs `"developmentClient": true`, plus `"ios": { "simulator": true }` and
`"android": { "buildType": "apk" }`. Reviewers install it once. After that, each PR arrives as an update.
You only need a new build when native code changes.

For iPhones, add a second profile without `"simulator": true`, keeping `"distribution": "internal"` and the
same `channel`. This build needs a paid Apple Developer account. Register each reviewer's iPhone first, because
the build only installs on phones that were registered before it was made:

```sh
eas device:create                                          # send the link to the reviewer's iPhone
eas build --profile development-device --platform ios      # rebuild after adding phones
```

> **Already on TestFlight?** If the development build uses the same bundle ID as your TestFlight app,
> installing it replaces the TestFlight app on the reviewer's phone, and Tapthrough links may open the
> wrong app. Give the review app its own bundle ID and scheme first: see
> [apps already in the store](https://tapthrough-cloud.vercel.app/docs/existing-app).

### The first iPhone build is interactive

EAS has to create an ad hoc provisioning profile that lists the registered phones, and that needs your
Apple Developer sign-in. Run the first iPhone build in your own terminal, not in CI or through an agent.
With `--non-interactive` it stops with *"EAS CLI couldn't find any credentials suitable for internal
distribution"*. The prompts:

| Prompt | Answer |
| --- | --- |
| Log in to your Apple account? | **Yes.** Sign in with the Apple ID on your developer team, then the 2FA code. |
| Reuse this distribution certificate? | **Yes.** One certificate signs all your apps, including your TestFlight builds, and Apple allows only a few per team. |
| Select devices for the ad hoc build | Keep every reviewer's iPhone selected (Space toggles), then Return. |

After that, rebuilds run without prompts until you register another phone. Then run the build again
interactively, so the profile picks up the new device.

**On the phone:** open the build page from EAS on the iPhone and tap **Install**. On iOS 16 and later, turn
on **Settings → Privacy & Security → Developer Mode** and restart when asked; the app won't open until
you do. Then open the app once and sign in, so previews have an account to use until you add a
[seed hook](#5-land-reviewers-on-the-right-screen-optional).

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

### PRs that change native code

A PR that adds a native package or changes native config has a new runtime version, and older
development builds can't load it. The Action handles this: it looks on EAS for a development build made
for the PR's runtime. Usually one exists and nothing happens. When none does, it starts one on your EAS
plan (`eas build --profile development --no-wait`), and the PR's comment and link page tell reviewers to
install that build first, with its status and an Install link. Later pushes reuse it.

- It only builds a platform and profile you've built before, so it never starts your first Android
  build by surprise.
- Your `EXPO_TOKEN` needs to be allowed to start builds (a robot token with the Developer role is), and the
  profile must build without prompts. For iPhones, that means the devices are already registered.
- Choose the profile with `native-build-profile` (up to two, like `development, development-simulator`),
  or set it to `off`.

## 5. Land reviewers on the right screen (optional)

Without more setup, links open your app's first screen with the PR's code. To open a specific screen with
test data and a checklist:

1. **Write scenarios** in `.tapthrough/scenarios/`, one per screen state. `npx @tapthrough/cli map` lists
   your screens and which ones still need one. See [plan files](plan-files.md) and
   [map your screens](scenario-map.md).
2. **Deploy a seed hook** that creates the test data on your staging backend. See the
   [seed hook README](../packages/seed/README.md). It only runs in `staging` or `development`, and only for
   the repos you list.
   It can be a Supabase edge function, or an Expo Router API route on EAS Hosting next to your app.
   Reviewers can then tap **Set Up and Start** in the Review panel and the app sets itself up.

## 6. Tell reviewers when a PR is ready (optional)

Reviewers can get a push notification when a new PR's preview is up: "PR #42 is ready to review", with
its title and how many items there are to check. Tapping it opens that PR's build, or its page when the
reviewer's installed build can't run it. Each PR notifies once per platform, however many times it's
pushed.

It's off until you add it, and then each reviewer chooses. Nothing is asked when the app launches.
After a reviewer finishes a PR, the Review panel offers **Notify Me About New PRs**, and iOS asks for
permission then.

1. **Install `expo-notifications`** if your app doesn't have it:

   ```sh
   npx expo install expo-notifications
   ```

   It's a native module, so if you've just added it, make a new development build (see
   [step 3](#3-make-a-development-build)). Apps that already use it don't need one.
2. **Pass the adapter** to `<Tapthrough>`:

   ```tsx
   import { tapthroughNotifications } from '@tapthrough/expo/notifications'

   <Tapthrough auth={auth} reset={reset} notifications={tapthroughNotifications}>
   ```

   The adapter comes from its own entry point, so apps that leave it out never load `expo-notifications`.
3. **Give EAS an Apple push key** (iOS only). Run `eas credentials -p ios`, pick your development profile,
   and under **Push Notifications** set up a key if there isn't one. Builds the Action starts run
   without prompts, so they can't create one for you. Android needs nothing extra.

Notifications go through Expo's push service using each device's Expo push token. Tapthrough stores the
token, the reviewer's name and the build's runtime version, and nothing else. A reviewer turns them off
in the phone's Settings; tokens Expo reports as gone stop being used.

If your app also shows its own notifications, set a foreground handler with
`Notifications.setNotificationHandler` as you normally would. Tapthrough only acts on taps of its own
"PR ready" notifications and leaves the rest to your app.

## What reviewers do

See [reviewing a PR](reviewing.md). In short: open the link, test, tap **Review** to pass or fail steps or
report an issue with a screenshot, and it all shows up on the PR.
