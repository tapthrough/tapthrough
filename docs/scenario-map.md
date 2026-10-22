# Map your screens

Tapthrough opens a PR on a screen only when a scenario points at that screen. The CLI shows which screens
have scenarios and which don't, and checks your scenario files before a PR does.

```sh
npx @tapthrough/cli map     # every screen and the scenarios that open it
npx @tapthrough/cli check   # validate .tapthrough/scenarios and .tapthrough/plans
```

Run both in the Expo app's directory, or pass `--dir apps/mobile`.

## `map`

```text
7 screens in src/app, 5 with scenarios

  /                  src/app/index.tsx             empty-list, notes-list
  /notes/[id]        src/app/notes/[id]/index.tsx  note-detail, viewer-note
  /profile/[userId]  src/app/profile/[userId].tsx  (none)
  /settings          src/app/settings.tsx          (none)
  …

Screens without a scenario (2):

  /profile/[userId]
    file: src/app/profile/[userId].tsx
    params: userId (fill each from seed data, e.g. "$seed.items[0].id")
    uses: src/components/button.tsx
  …
```

It reads your Expo Router files the same way the Action does: groups like `(tabs)` are left out, `index`
is its folder's path, and layouts and `+` files aren't screens. For each screen without a scenario, it
lists the params a scenario has to fill and the files the screen imports, which is where to look for what
the screen shows. It also lists the seed presets your scenarios already use, so new ones can reuse them,
and flags scenarios that point at a screen that no longer exists.

`--json` prints the same data for scripts and coding agents.

## `check`

`check` exits with code 1 and lists each problem when:

- a file isn't valid JSON or doesn't match the [scenario format](plan-files.md)
- a file name and its `key` disagree
- `route.path` isn't one of your screens (for example, it includes a group like `/(tabs)/archive`)
- a `[param]` in the path has no value in `route.params`
- a plan file `include`s a scenario that isn't in the library

Tapthrough's service never fails a run over a broken scenario. It skips the file and says why in the PR
comment. `check` catches the problem before the PR.

Add it to CI to keep scenarios in step with your screens:

```yaml
- run: npx @tapthrough/cli check
```

## Let your coding agent write them

Scenarios are plain JSON, so a coding agent can write the whole library: run `map`, read each uncovered
screen, write a scenario, and run `check` until it passes.
[Set up Tapthrough with your coding agent](onboard-with-your-agent.md) walks an agent through it, and
adds a line to your `AGENTS.md` so scenarios stay current as screens change.
