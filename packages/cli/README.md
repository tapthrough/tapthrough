# @tapthrough/cli

Maps an Expo Router app's screens to its [Tapthrough](https://github.com/tapthrough/tapthrough) scenarios,
and checks scenario and plan files before a PR does.

```sh
npx @tapthrough/cli map           # every screen, and the scenarios that open it
npx @tapthrough/cli map --json    # the same, for scripts and coding agents
npx @tapthrough/cli check         # validate .tapthrough/scenarios and .tapthrough/plans
npx @tapthrough/cli doctor        # check the whole setup: SDK, workflow, scenarios
```

Pass `--dir <path>` to run it on an app in a subdirectory. `check` exits with code 1 when it finds a
problem, so it works as a CI step.

`doctor` does the same for the whole setup, and `doctor --url <preview-or-seed-hook-url>` also asks a
deployment how it is configured.

Docs: [Map your screens](https://github.com/tapthrough/tapthrough/blob/main/docs/scenario-map.md),
[Check your setup](https://github.com/tapthrough/tapthrough/blob/main/docs/doctor.md).

The package also exports the route and import-graph helpers the Tapthrough Action uses (`routesFromFiles`,
`affectedRoutesByImports`), plus `buildMap` and `checkScenarios`.

## License

MIT
