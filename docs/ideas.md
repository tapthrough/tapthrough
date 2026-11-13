# Ideas from the app

Anyone testing a Tapthrough build can send an idea from inside the app. Claude reads the code and writes
the idea up as a GitHub issue with a spec and test steps, asking the sender a question or two first if it
needs to. Then someone taps **Build It**, Claude opens a PR, and the sender gets a build to test on their
phone. When it's right, they tap **Approve**.

```
Idea in the app → Claude writes it up → questions? answered in the app → GitHub issue
→ Build It → Claude opens a PR → preview ready → test on the phone → Approve → merge
```

## Set it up

Ideas use the same workflow as [Fix with Claude](fix-with-claude.md). If you've set that up, ideas
already work. Otherwise:

1. Add your Anthropic API key as a repository secret named `ANTHROPIC_API_KEY`.
2. Add `.github/workflows/tapthrough-fix.yml` from [Fix with Claude](fix-with-claude.md).

Claude runs in **your** GitHub Actions with **your** key. Writing an idea up is read-only: Claude can read
the code but its changes are never pushed. Building pushes only to a branch named `tapthrough/idea-<issue>`,
and Tapthrough opens the PR.

You can tune the turn budgets in the workflow:

```yaml
- uses: tapthrough/tapthrough/fix@main
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    groom-max-turns: '25'  # writing an idea up
    build-max-turns: '80'  # building it
```

## Send an idea

In the app, tap the round **Review** button, then **Share Idea**. Or tap **Report Issue** and switch the
toggle at the top to **Idea**.

- Say what you'd change and where. The screen you're on and a screenshot come along.
- Add your email to hear when Claude has a question, when the build is ready to test, and when it merges.
  It's optional: the same news shows under **Ideas** in the Review panel.

## Follow it

Ideas show under **Ideas** in the Review panel, newest first, for everyone testing the app. A dot on the
Review button means one is waiting on someone.

| Status | What to do |
| --- | --- |
| Claude is writing it up | Nothing. It takes a minute or two. |
| Claude has a question | Answer it in the app. Claude writes the idea up again with your answers (up to three rounds). |
| Ready to build | Read the summary and test steps, then tap **Build It**. |
| Claude is building it | Nothing. The PR gets a Tapthrough preview like any other. |
| Ready to test | Tap **Open Build to Test**, go through the steps, then tap **Approve**. |
| Claude didn't take it on | The note says why. Edit the idea into a new one, or tap **Try Again**. |

The GitHub issue has the spec, the open questions, the test steps and the earlier answers, so engineers
can follow along there. The PR closes the issue when it merges.

## Approve and merge

**Approve** labels the PR `tapthrough:approved` and comments who approved it. By default an engineer still
reviews and merges it.

To let Approve merge, opt in with `.tapthrough/settings.json` on your default branch:

```json
{ "ideas": { "merge": "auto" } }
```

Approve then turns on GitHub auto-merge, so your branch protection, required reviews and the Tapthrough
check still decide when it lands. A PR with nothing to wait for merges only if its Tapthrough check passed.

To turn ideas off for a repo: `{ "ideas": { "enabled": false } }`.

## Limits

- 10 ideas written up and 5 built per repo per day.
- Claude never edits `.github/`, `.tapthrough/settings.json`, lockfiles or dependencies. If an idea needs a
  new package, Claude says so instead of building it.
- Ideas can be sent from Tapthrough builds (PR previews) today. Sending them from your App Store or
  TestFlight build is coming.
