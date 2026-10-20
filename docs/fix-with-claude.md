# Fix with Claude

When a reviewer reports a bug that comes from the PR, Claude can look into it and push a fix to the PR's
branch. The fix gets its own preview build, and the reviewer re-checks it from the app.

Claude runs in **your** GitHub Actions with **your** Anthropic API key. Tapthrough never sees your code or
your key: it starts the workflow and hands it a push token for the PR branch that lasts an hour.

## Set it up

1. Add your Anthropic API key as a repository secret named `ANTHROPIC_API_KEY` (**Settings → Secrets and
   variables → Actions → New repository secret**).
2. Add this workflow on your default branch as `.github/workflows/tapthrough-fix.yml`:

```yaml
name: Tapthrough fix

# Started by Tapthrough when someone asks Claude to fix a report.
on:
  repository_dispatch:
    types: [tapthrough-fix]

permissions:
  contents: read
  # Proves to Tapthrough which repo is asking. No Tapthrough secret needed.
  id-token: write

concurrency:
  group: tapthrough-fix-${{ github.event.client_payload.pr }}

jobs:
  fix:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: tapthrough/tapthrough/fix@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

The Tapthrough app needs **Contents: Read and write** to start the workflow and push the fix. If your
installation predates that permission, an org owner accepts it under **Settings → GitHub Apps → Tapthrough
→ Configure**.

## Start a fix

- **From the app:** after sending a report that comes from the PR, tap **Ask Claude to fix**.
- **On GitHub:** tick **Fix with Claude** in the report's comment. Only people with write access to the repo
  can start a fix this way.

Reports marked "not from this PR" don't offer a fix. File them as an issue instead.

## What Claude does

1. Reads the report, the screenshot, the console errors, the screen's code and the PR's diff.
2. Decides whether the PR causes the bug.
3. If it does and the fix is small and clear, it edits the files. Otherwise it changes nothing and says why.

The report comment on the PR shows the outcome, with a link to the run. A pushed fix is marked **fixed**, and it
stays open until a reviewer re-checks it on the new build.

## Guardrails

- **What the agent can use:** reading and editing files only. It has no shell and no web access, and it runs
  without your GitHub token or the push token. Those stay in the workflow's own steps.
- **Paths it can't change:** edits under `.github/` or `.tapthrough/`, and edits to lockfiles, are undone
  before committing.
- **Untrusted reports:** report text is passed to Claude as a description, never as instructions.
- **Limits:** five fix runs per PR per day, and one at a time per report. The `max-turns` input caps each
  run's cost (default 40).
- **Forks:** PRs from forks can't be fixed, since Tapthrough can't push to them.

## Inputs

| Input | Default | |
| --- | --- | --- |
| `anthropic-api-key` | required | Your key |
| `model` | Claude Code's default | e.g. `claude-sonnet-5-5` |
| `max-turns` | `40` | Upper bound on the agent's turns |
| `claude-code-version` | pinned | The Claude Code CLI version to install |
| `api-url` | `https://tapthrough.dev` | Tapthrough's URL |
