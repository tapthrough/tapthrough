# @tapthrough/protocol

The versioned contract shared by every [Tapthrough](https://github.com/tapthrough/tapthrough) component:
the GitHub Action, the Expo SDK, the seed hook and the hosted service.

```sh
npm install @tapthrough/protocol
```

## What's in it

- **`@tapthrough/protocol`**: Zod schemas and types for the scenario a preview link opens (`Scenario`,
  `Seed`, `Route`, `TestStep`), the manifest and run report the Action sends (`Manifest`, `RunReport`), and
  the seed-hook requests and responses (`SeedHookRequest`, `SeedHookResponse`, `RedeemRequest`,
  `RedeemResponse`). It also has `resolveRoute`, which turns a scenario route such as `/notes/[id]` with
  `id: "$seed.notes[0].id"` into a real path using the IDs the seed hook returned, and `resolveSeedRef`
  for a single reference.
- **`@tapthrough/protocol/tokens`**: ES256 signing and verification for link tokens, so a seed hook can
  check that a request really came from a Tapthrough link.

`PROTOCOL_VERSION` is bumped on any breaking change to these shapes.

## License

MIT
