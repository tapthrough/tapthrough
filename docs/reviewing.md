# Reviewing a PR

You don't need to build anything or know the code. Each pull request has a Tapthrough comment with an
**Open preview** link and a QR code.

## Open it

| Where | What to do |
| --- | --- |
| **Computer** | Click **Open preview**, then **Open in iOS Simulator**. This needs [Expo Orbit](https://expo.dev/orbit), signed in to your team's Expo account. |
| **Android phone** | Scan the QR code. The first time, install the preview app your team shares. Then tap **Open PR build**, and **Start scenario** to land on the screen with test data. |
| **iPhone** | Coming once your team adds iPhone builds |

If the PR has scenarios, the page shows them as tabs. Pick one to see its test plan.

## Review

In the app, tap the dark **Review** button in the bottom-right corner.

- **Pass or Fail each step.** Pass is recorded right away. Fail takes a screenshot of the app and lets you
  say what happened.
- **Re-check earlier reports.** After a new push, reports from before show up first. Mark them **Fixed** or
  **Still broken**.
- **Report something else.** For anything outside the plan: write what's wrong, and the screenshot comes
  along.

Your name (entered once) and device are attached. So are the screen you were on, recent errors and failed
network requests (with tokens removed), which helps the developer reproduce it.

## On the PR

- Passed steps get ticked in the Tapthrough comment, with your name and platform.
- Each report is its own comment with the screenshot, and the main comment lists all reports with their
  status.
- If a report isn't caused by the PR, use **Open it as a new issue** under the report. It fills in a GitHub
  issue for you to submit.
- A new push resets the checklist, so the next round of testing starts clean.
