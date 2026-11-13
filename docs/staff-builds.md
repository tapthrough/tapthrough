# Feedback from staging and TestFlight builds

PR previews have the Review button. Staging and TestFlight builds can have one too, with less in it:
testers can **report an issue** and **share an idea**, and follow their ideas under **Ideas**. There's no
PR there, so a report goes straight to a GitHub issue with the screenshot (drawn on if they want), the
screen, the app's version and build, the device, and recent errors and failed requests.

Store builds never show it. You turn it on per build, at build time.

## 1. Make an app key

The key tells Tapthrough which repo a staging build belongs to. Run this in the app's repo, signed in to
GitHub (`gh auth login`) as someone with write access:

```sh
npx @tapthrough/cli app-key
```

It prints the key. Store it as an EAS environment variable for the builds that use it, so it isn't in
the repo:

```sh
eas env:create --name TAPTHROUGH_APP_KEY --value <key> --environment preview --visibility sensitive
```

## 2. Turn it on for staging builds only

```ts
// app.config.ts
plugins: [
  ['@tapthrough/expo', {
    enabled: process.env.APP_VARIANT === 'development', // PR previews
    staff: process.env.APP_VARIANT === 'staging',      // staging and TestFlight
    appKey: process.env.TAPTHROUGH_APP_KEY,
    apiUrl: 'https://tapthrough-cloud.vercel.app',
  }],
],
```

Set `APP_VARIANT=staging` in the `env` of the build profile you send to TestFlight. When `staff` is off,
the key isn't written into the build at all.

> **One binary for TestFlight and the App Store?** If you promote the exact TestFlight build to the App
> Store, a build-time switch can't tell them apart: the store would get the button too. Use a separate
> staging build for TestFlight (its own bundle ID, like `com.acme.app.staging`), or wait for the
> runtime TestFlight check, which is coming.

## What testers see

The round button opens **Feedback**:

- **Report Issue.** Write what's wrong, mark up the screenshot, and send. It becomes a GitHub issue
  labeled `tapthrough:report`, and the app shows its number and a link.
- **Share Idea.** Claude writes it up as an issue, asks questions first if it needs to, and can build it
  into a PR. See [Ideas from the app](ideas.md).
- **Ideas.** Every idea with where it is: written up, building, ready to test, merged. If something is
  stuck, it says so.

## Limits

- 30 reports per repo per day from staging builds. Ideas share the [usual limits](ideas.md#limits).
- Claude never starts on these issues by itself; add the `tapthrough:fix` label if you want it to.
- Anyone with the build has the key, and the key is in the build. Don't turn `staff` on for builds
  outside your testers. If a key leaks, tell us and we'll rotate it.
