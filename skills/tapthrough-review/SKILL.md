---
name: tapthrough-review
description: Check an Expo pull request on an Expo Simulators cloud simulator using its Tapthrough plan. Signs in with test data, opens each changed screen, runs each checklist step, records a clip per step and reports pass, fail or unsure. Use when asked to review, QA, verify or test a PR that has a Tapthrough comment, or to "run the Tapthrough checklist".
---

# Review a PR with Tapthrough on Expo Simulators

Tapthrough's PR comment links to a plan: the PR's build, one scenario per changed screen (a test
account, test data and the screen to open) and the steps to check on each. You run that plan on an
[Expo Simulators](https://docs.expo.dev/preview/simulators/introduction/) session and report what you
saw. A person decides whether to merge.

**Be an independent checker.** Judge each step only against its "Expect" line and what is on the
screen. Don't read the diff to decide whether a step passed, and don't fix code while reviewing. If
the expected result is a matter of taste ("looks right", "feels fast"), mark it **unsure** so a
person looks.

## 0. Before you start

Stop and ask the user if any of these fail. Don't create accounts, plans or tokens yourself.

- `npx --yes eas-cli@latest simulator:availability --json` shows `"available": true`.
- The repo's `eas.json` has a build profile for the simulator with the development client, for example:

  ```json
  { "build": { "dev-sim": { "developmentClient": true, "ios": { "simulator": true }, "android": { "buildType": "apk" } } } }
  ```

  A finished build of it must match the PR's fingerprint. A PR that changes native code needs a new one:
  `npx eas-cli@latest build --platform ios --profile dev-sim --non-interactive` (ask first, builds cost money).
- You have the PR's Tapthrough link (`https://…/l/<id>`). It's in the Tapthrough comment on the PR:
  `gh pr view <number> --comments | grep -oE 'https://[^ )]+/l/[0-9a-f-]{36}' | head -1`

## 1. Read the plan

```sh
npx @tapthrough/cli plan "<pr-link>" --platform ios
```

It lists the build URL, every scenario with its launch command, what setup does and the steps. Add
`--json` for the same as data. If it says the PR is closed or has no build, stop and tell the user.

## 2. Start one simulator for the whole review

Get the PR's fingerprint hash with
`npx eas-cli@latest fingerprint:generate --platform ios --build-profile dev-sim --non-interactive --json`
(read the hash from its output), then:

```sh
npx eas-cli@latest simulator:start --platform ios --type agent-device \
  --build-fingerprint <hash> --open-url "<build URL from the plan>" \
  --name "PR <number> Tapthrough review" --max-idle-time-minutes 10 --non-interactive
```

This writes `.env.eas-simulator`. Prefix every device command with `npx eas-cli@latest simulator:exec`.
Never print, commit or post `.env.eas-simulator`, `remoteConfig` or artifact `downloadUrl`s: they are
credentials.

Wait until the app shows the PR's build, not the development client's home screen:
`npx eas-cli@latest simulator:exec npx agent-device@latest snapshot -i`.

## 3. Check each scenario

For each scenario in the plan, in order:

1. Get a fresh launch link. Each one works once and expires in 15 minutes, so get it just before you
   open it, and get a new one to retry.

   ```sh
   URL=$(npx @tapthrough/cli launch "<pr-link>" --scenario <key> --platform ios)
   npx eas-cli@latest simulator:exec npx agent-device@latest open "$URL" --platform ios
   ```

   If iOS asks to open the app, accept it: `… agent-device@latest alert accept --platform ios`.
   Wait for the Tapthrough setup banner to finish and the scenario's screen to open. If setup fails,
   mark every step in the scenario **blocked**, with the message on screen, and move on.

2. For each step, record a short clip, do the action, then take a screenshot of the result:

   ```sh
   X="npx eas-cli@latest simulator:exec npx agent-device@latest"
   mkdir -p tapthrough-review
   $X record start ./tapthrough-review/<key>-<step>.mp4
   $X snapshot -i          # find the elements, then press / fill / scroll
   $X screenshot ./tapthrough-review/<key>-<step>.png
   $X record stop
   ```

   Use `press`, not `tap`. Compare the screen with "Expect" and give the step one verdict:
   - **pass**: the screen matches Expect.
   - **fail**: it doesn't. Say what you saw instead, in one sentence a designer would understand.
   - **unsure**: Expect is subjective, the step doesn't apply, or you can't tell. Say why.
   - **blocked**: you couldn't do the action (setup failed, element missing, crash).

   Don't use the Tapthrough Review button or report sheet inside the app. Those are for people.

## 4. Stop the simulator

```sh
npx eas-cli@latest simulator:stop --non-interactive
```

Stop it even if the review failed part way. Sessions are billed by the minute.

## 5. Report

Post one PR comment. Keep it short, failures first:

```markdown
### Agent check on iOS (Expo Simulators): 1 fail, 1 unsure, 4 pass

| Scenario | Step | Result | What I saw |
| --- | --- | --- | --- |
| Pin a note | 2. Unpin it | ❌ fail | The note stayed at the top after Unpin |
| Pin a note | 3. Pin icon matches the design | ❔ unsure | Subjective, needs a person |
| … | | ✅ pass | |

Clips and screenshots are on the Expo session page (needs Expo access). Steps marked unsure need a person:
open them from the Tapthrough link above.
```

Post it with `gh pr comment <number> --body-file <file>`. Don't upload the clips anywhere public.
Then tell the user the counts and which steps need a person.
