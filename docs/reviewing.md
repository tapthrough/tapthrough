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

The button opens a panel over the app with what this PR needs checked. Tap the expand
button to fill the screen. Tap the Review button again (now an ✕) to close it.

1. **Pick something to check.** Each item says why it's on the list, like "This PR changed this screen."
   The top shows how far you are, like **1 of 3 checked**.
2. **Set up.** The item shows what setup does (signs you in as a test user, adds test data, opens the
   screen) and its steps. Tap **Set Up and Start** and the app gets itself ready without leaving. Already
   where you need to be? Tap **Skip Setup**. If setup can't run, the panel lists the same steps to do by
   hand, then **I'm Ready**.
3. **Pass or Fail each step.** One step at a time. Pass is recorded right away. Fail takes a screenshot of
   the app and lets you say what happened.
4. **Send.** The report shows the step you were on and what was expected. Tap the screenshot to leave it
   out, or **Mark Up** to highlight what's wrong or blur personal data. After sending, say whether this PR
   caused it or it was **Already broken**; Tapthrough suggests one. A PR bug can go straight to
   **Ask Claude to Fix**; an old one becomes a GitHub issue.

Also in the panel:

- **Other states.** Every scenario in the app, not just the ones this PR touched, so you can jump to an
  empty account or a viewer role and look around.
- **Re-check earlier reports.** After a new push, reports from before show up first. Mark them **Fixed** or
  **Still broken**.
- **Report Something Else.** For anything outside the plan: write what's wrong, and the screenshot comes
  along.
- **Get new builds.** When someone pushes to the PR, or Claude pushes a fix, a short notice appears at the
  top and the Review button gets a yellow dot. Tap **View**, or **Open** in the panel, to switch to the new
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
  and don't need a re-check. Tap **Create GitHub Issue** in the app, or tick **File as a GitHub issue** in
  the report's PR comment, and Tapthrough opens the issue with the report's screenshot and details and
  links it from the PR. You don't need to sign in to GitHub on the phone. The checkbox only counts for
  people with write access to the repo. The app says before you tap whether Claude will start on the issue
  by itself (the repo has [`autoFixIssues`](fix-with-claude.md) on) or a developer adds the
  `tapthrough:fix` label.
- Sending always posts the report as a comment on the PR first. Filing an issue is a second, separate step.
- A new push keeps checks on screens it didn't touch and clears the rest. Kept checks show the commit they
  were made on, in the app and the PR comment. A push that changes dependencies or app config (`package.json`,
  lockfiles, `app.json`, native folders, `.tapthrough/`) clears everything, since that can affect any screen.
  The app says how many checks were cleared and why.

## Gate merges on it

Every PR gets a **Tapthrough** check on its latest commit:

| Check | When |
| --- | --- |
| Failed | A step failed on this commit, or a report from the PR is broken on it |
| In progress | Steps aren't all checked yet, or earlier reports and pushed fixes need a re-check |
| Passed | Every step passed or was skipped, on this commit or on an earlier one for a screen the push didn't touch, and every report from the PR is verified fixed |
| Neutral | No test plan and no reports, so there's nothing to verify |

Reports marked as not from the PR never count. To require it before merging, add **Tapthrough** as a
required status check in your branch protection rules or ruleset. A new push re-evaluates the check with the
checks it keeps, the same way the checklist does.
