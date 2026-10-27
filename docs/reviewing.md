# Reviewing a PR

You don't need to build anything or know the code. Each pull request has a Tapthrough comment with an
**Open preview** link and a QR code.

## Open it

| Where | What to do |
| --- | --- |
| **Computer** | Click **Open preview**, then **Open in iOS Simulator**. This needs [Expo Orbit](https://expo.dev/orbit), signed in to your team's Expo account. |
| **Phone** | Scan the QR code. The first time, install the preview app your team shares. Then tap **Open PR build**, and **Start scenario** to land on the screen with test data. |

On an iPhone, your team has to register the phone before you can install the preview app. Run
`eas device:create`, or ask a teammate to, and open the link it gives you on the phone. Then turn on
**Developer Mode** in Settings → Privacy & Security, and restart when asked.

If the PR has scenarios, the page shows them as tabs. Pick one to see its test plan.

## Review

In the app, tap the round **Review** button on the right edge. If it's in the way, drag it anywhere; it
snaps to the nearer side and stays there for the session. It fades while you test, and its badge shows how
many steps are left, a check when they've all passed, or **!** when one failed.

- **See where you are.** The top of the checklist shows how many steps are checked, like **1 of 3 checked**.
- **Pass or Fail each step.** Pass is recorded right away. Fail takes a screenshot of the app and lets you
  say what happened.
- **Re-check earlier reports.** After a new push, reports from before show up first. Mark them **Fixed** or
  **Still broken**.
- **Report something else.** For anything outside the plan: write what's wrong, and the screenshot comes
  along. **Mark up** lets you highlight what's wrong or blur personal data before it's sent.
- **Get new builds.** When someone pushes to the PR, or Claude pushes a fix, a short notice appears at the
  top and the Review button gets a yellow dot. Open the checklist and tap **Open** to switch to the new
  build, then re-check.

Your name (entered once) and device are attached. So are the screen you were on, recent errors and failed
network requests (with tokens removed), which helps the developer reproduce it.

## On the PR

- Passed steps get ticked in the Tapthrough comment, with your name and platform.
- Each report is its own comment with the screenshot, and the main comment lists all reports with their
  status.
- Tapthrough guesses whether each report comes from the PR, and says why. Reports on a screen the PR changes,
  or reaches through imports or a layout, count as the PR's. So do console errors that name a changed file.
  Reports on screens the PR doesn't touch are marked **probably not from this PR**.
- After sending, the app shows the guess. Tap once to correct it, or to answer when Tapthrough can't tell.
  A failed step always counts as the PR's.
- Reports that aren't from the PR are listed apart under **Noticed while testing**. They don't count as open
  and don't need a re-check. **Create issue on GitHub** in the app, or the link under the report, fills in a
  GitHub issue for you to submit.
- A new push resets the checklist, so the next round of testing starts clean.

## Gate merges on it

Every PR gets a **Tapthrough** check on its latest commit:

| Check | When |
| --- | --- |
| Failed | A step failed on this commit, or a report from the PR is broken on it |
| In progress | Steps aren't all checked yet, or earlier reports and pushed fixes need a re-check |
| Passed | Every step passed or was skipped on this commit, and every report from the PR is verified fixed |
| Neutral | No test plan and no reports, so there's nothing to verify |

Reports marked as not from the PR never count. To require it before merging, add **Tapthrough** as a
required status check in your branch protection rules or ruleset. A new push starts the check over, just as
it resets the checklist.
