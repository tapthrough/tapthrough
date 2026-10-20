# Plan files

A plan file tells Tapthrough which screens a PR changes, what state to open them in, and what to test. Put
it in the PR at `.tapthrough/plans/<pr-number>.json`. Tapthrough reads it at the PR's latest commit, so
editing it in a new push updates the comment.

> Plans are written by hand for now. Generating them from the diff and the linked ticket is next.

## Example

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
| `scenarios` | Yes | 1 to 5 scenarios |
| `key` | Yes | Lowercase letters, digits and dashes. Keep it stable across pushes; links and checklist results use it. |
| `title` | Yes | Shown in the PR comment and the app, e.g. "Edit note: empty title" |
| `route.path` | Yes | An Expo Router path, with `[param]` segments |
| `route.params` | No | Values for the segments. `$seed.<path>` points at data your seed hook returned, e.g. `$seed.notes[0].id`. |
| `seed` | Yes | `{ "tier": 2, "preset": "<name>", "params": { … }, "role": "viewer" }` runs a preset from your seed hook. `{ "tier": 0 }` signs in to your shared test account instead. |
| `flags` | No | Feature flags the app sees while reviewing; read them with `useFlagOverride` |
| `steps` | No | Up to 10 `{ "action", "expect" }` pairs; reviewers pass or fail each one in the app |

## What happens when it's wrong

If the file is missing, the comment links to the PR's build without a scenario and suggests adding one. If
it can't be parsed, the comment says why (for example `duplicate scenario key "edit-note"`) and still links
to the build.
