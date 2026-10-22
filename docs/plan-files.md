# Scenarios and plan files

A scenario is one state of your app, written as data: which screen, what test data, which flags, and what to
check. Tapthrough opens reviewers right on it and gives them the steps as a checklist.

## The scenario library

Put scenarios in your repo at `.tapthrough/scenarios/<key>.json`, one per file. The file name is the key.

```json
{
  "title": "Edit note",
  "route": { "path": "/notes/[id]/edit", "params": { "id": "$seed.notes[0].id" } },
  "seed": { "tier": 2, "preset": "user-with-notes", "params": { "count": 3 } },
  "steps": [
    { "action": "Clear the title and tap Save", "expect": "\"Title required\" appears under the title" }
  ]
}
```

Each PR runs the scenarios it touches, and the comment says why for each one:

- **Screen changed:** the PR changes the screen's route file.
- **Reached through imports:** the PR changes a component the screen uses, directly or through other files
  (for example, `note-form.tsx` reaches `/notes/new` and `/notes/[id]/edit`).
- **Scenario updated:** the PR changes the scenario file itself.

The rest of the library stays available from the app's Review menu. When none match, the comment says so.
A few scenarios per screen, written once, cover every PR after that, and agents can write them too, since
they're plain JSON. `npx @tapthrough/cli map` lists the screens that don't have one yet, and
`npx @tapthrough/cli check` validates the files. See [map your screens](scenario-map.md).

## Per-PR plan files

For something only one PR needs, add `.tapthrough/plans/<pr-number>.json`. It can define scenarios of its
own and `include` library scenarios that weren't picked automatically:

```json
{ "include": ["settings"], "scenarios": [ { "key": "new-note-counter", "title": "…", "route": { "path": "/notes/new" }, "seed": { "tier": 2, "preset": "empty-account" } } ] }
```

A plan scenario with the same key as a library scenario replaces it for that PR. Tapthrough reads the plan
at the PR's latest commit, so editing it in a new push updates the comment.

## Plan file example

```json
{
  "scenarios": [
    {
      "key": "edit-note",
      "title": "Edit note: empty title",
      "route": { "path": "/notes/[id]/edit", "params": { "id": "$seed.notes[0].id" } },
      "seed": { "tier": 2, "preset": "user-with-notes", "params": { "count": 3 } },
      "flags": { "newEditor": true },
      "steps": [
        { "action": "Clear the title and tap Save", "expect": "\"Title required\" appears under the field" },
        { "action": "Type a title and save", "expect": "You're back on the note, with the new title" }
      ]
    }
  ]
}
```

## Fields

| Field | Required | Notes |
| --- | --- | --- |
| `key` | In plan files | The file name in the library. Lowercase letters, digits and dashes. Keep it stable across pushes; links and checklist results use it. |
| `title` | Yes | Shown in the PR comment and the app, e.g. "Edit note: empty title" |
| `route.path` | Yes | An Expo Router path, with `[param]` segments |
| `route.params` | No | Values for the segments. `$seed.<path>` points at data your seed hook returned, e.g. `$seed.notes[0].id`. |
| `seed` | Yes | `{ "tier": 2, "preset": "<name>", "params": { … }, "role": "viewer" }` runs a preset from your seed hook. `{ "tier": 0 }` signs in to your shared test account instead. |
| `flags` | No | Feature flags the app sees while reviewing; read them with `useFlagOverride` |
| `steps` | No | Up to 10 `{ "action", "expect" }` pairs; reviewers pass or fail each one in the app |

## What happens when it's wrong

A broken library file or plan file never fails the run. The comment names the file and says why (for example
`key "edit" doesn't match the file name` or `duplicate scenario key "edit-note"`), and the other scenarios
still run. With no scenarios at all, the comment links to the PR's build and suggests adding some.
