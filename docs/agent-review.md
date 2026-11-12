# Have your coding agent check a PR

[Expo Simulators](https://docs.expo.dev/preview/simulators/introduction/) gives your coding agent a cloud
iOS simulator or Android emulator. On its own, the agent starts on a fresh install: signed out, no data,
no idea what the PR changed. Tapthrough gives it what to check. Each scenario signs it in with test data
and opens the changed screen. Then it runs that screen's checklist and records a clip of every step.

The agent marks each step pass, fail or unsure and posts a table to the PR. You only look at what failed
or needs a person's judgment.

## What you need

- Tapthrough set up on the repo ([getting started](getting-started.md)), so PRs get a Tapthrough comment
- An Expo plan with Expo Simulators. Check with `npx eas-cli@latest simulator:availability`.
- A development build made for the simulator, matching the PR's fingerprint. Add a profile to `eas.json`:

  ```json
  { "build": { "dev-sim": { "developmentClient": true, "ios": { "simulator": true }, "android": { "buildType": "apk" } } } }
  ```

  and build it once: `eas build --platform ios --profile dev-sim`. You only rebuild when native code
  changes.

## Run it

Install the skill in Claude Code, Codex, Cursor or any agent that reads skills:

```sh
npx skills@latest add tapthrough/tapthrough --skill tapthrough-review
```

Then ask: *"Check PR 42 with Tapthrough."* Without the skill, paste:

```text
Read https://raw.githubusercontent.com/tapthrough/tapthrough/main/skills/tapthrough-review/SKILL.md and follow it for PR 42.
```

The agent starts one simulator, works through every scenario, stops the simulator and comments on the PR.
A review of a typical PR takes a few minutes of simulator time.

## What the agent uses

Two CLI commands do the Tapthrough part. You can use them in your own scripts too.

```sh
# The PR's build URL, scenarios, setup and steps (add --json for data)
npx @tapthrough/cli plan https://tapthrough-cloud.vercel.app/l/<id> --platform ios

# A single-use link that signs in, seeds and opens one scenario. It expires in 15 minutes.
npx @tapthrough/cli launch https://tapthrough-cloud.vercel.app/l/<id> --scenario pin-note --platform ios
```

Open the launch link in the running app, for example with
`eas simulator:exec npx agent-device@latest open "<launch link>" --platform ios`.

## Good to know

- **The agent checks, people decide.** It judges each step only against the checklist's "Expect" line,
  not the diff. Subjective steps come back as unsure, so a designer or PM can look.
- **Clips stay in Expo.** Recordings and screenshots stay on the Expo session page, which needs Expo access
  to your project. The agent doesn't post them anywhere public.
- **Same access as the PR link.** Anyone with the PR's Tapthrough link can read its plan and start its
  scenarios. That's the same as opening the link on a phone.
- **Not yet:** agent results aren't shown in the in-app checklist or the Tapthrough PR comment. For now
  they're a separate comment.
