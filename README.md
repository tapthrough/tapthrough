# Tapthrough

Every pull request in your Expo app gets a link that opens the change on the right screen, already
logged in with the right data, plus a short test plan and one-tap feedback that posts back to the PR.

This repo holds everything that runs on your side: the GitHub Action, the SDK, the seed-hook helper
and the shared protocol. The hosted service lives in a separate, private repo.

## Docs

- [Getting started](docs/getting-started.md): set up Tapthrough on an Expo app in about 30 minutes
- [Set up with your coding agent](docs/onboard-with-your-agent.md): one line for Claude Code, Cursor or Codex
- [Plan files](docs/plan-files.md): land reviewers on the right screen with test data and a checklist
- [Map your screens](docs/scenario-map.md): see which screens have scenarios, and check scenario files
- [Reviewing a PR](docs/reviewing.md): for reviewers, including those who don't write code

## Packages

| Package | Status | Does |
| --- | --- | --- |
| [`@tapthrough/protocol`](packages/protocol) | M1 | Versioned schemas (scenario, run report, seed hook) and link-token signing and verification |
| [`@tapthrough/cli`](packages/cli) | M3 | `map` lists screens and their scenarios; `check` validates scenario files. Also the route graph the Action uses |
| [`@tapthrough/expo`](packages/expo) | M2 | The SDK and config plugin: seeds, logs in, applies flags and navigates when the app opens from a link |
| [`@tapthrough/seed`](packages/seed) | M2 | Fetch-API seed-hook handler for Deno, Node or edge functions, with a Supabase test-user helper |

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

Requires Node 22 and pnpm 10.

## Security notes

- **Run the Action on `pull_request`, never `pull_request_target`.** PRs from forks get no OIDC
  token, so the Action fails on them. That's deliberate. `pull_request_target` would run the
  fork's code, including its `app.config.js` and `eas update`, with your `EXPO_TOKEN`.
- **Keep the SDK off in store builds** (`enabled: false` in the config plugin). It ignores launch
  links unless enabled, and refuses tokens minted for any other app.
- **List your repos in the seed hook** (`repos` in `createSeedHandler`). It refuses tokens from any
  other repo before redeeming them.
