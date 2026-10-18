# Tapthrough

Every pull request in your Expo app gets a link that opens the change on the right screen, already
logged in with the right data, plus a short test plan and one-tap feedback that posts back to the PR.

This repo holds everything that runs on your side: the GitHub Action, the SDK, the seed-hook helper
and the shared protocol. The hosted service lives in a separate, private repo.

## Packages

| Package | Status | Does |
| --- | --- | --- |
| [`@tapthrough/protocol`](packages/protocol) | M1 | Versioned schemas (scenario, run report, seed hook) and link-token signing and verification |
| `@tapthrough/cli` | M3 | Builds the manifest and reports runs from the Action |
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
