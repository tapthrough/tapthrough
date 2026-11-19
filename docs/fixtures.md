# Fixtures: review a PR with no backend

A fixture file is a list of requests your app makes and the response each one gets. When a reviewer
opens a scenario that uses fixtures, Tapthrough answers the app's requests itself. Your backend is never
called, so you need no seed hook, no staging database and no test account.

Use fixtures when:

- your backend can't be reached from a preview build, or you can't add an endpoint to it
- you want a screen in a state that is hard to create for real (an empty list, an error, a slow response)
- you want to try Tapthrough before setting up a [seed hook](seed-hook-contract.md)

Fixtures answer requests made with `fetch` in the app. They don't cover pages that read a database in
server code, such as Next.js server components; use a seed hook for those.

> Fixtures work in Expo apps today. Web support is planned.

## 1. Write a fixture file

Put it in `.tapthrough/fixtures/<name>.json`:

```json
{
  "v": 1,
  "baseUrl": "https://api.acme.com/v1",
  "session": { "access_token": "fixture-token" },
  "routes": [
    { "url": "/me", "body": { "id": "u1", "name": "Sam Reviewer" } },
    { "url": "/notes", "body": [{ "id": "n1", "title": "Groceries" }] },
    { "url": "/notes/:id", "body": { "id": "n1", "title": "Groceries", "text": "Milk" } },
    { "method": "POST", "url": "/notes", "status": 201, "body": { "id": "n2" } },
    { "url": "/billing", "status": 500, "body": { "error": "Unavailable" } }
  ]
}
```

| Field | Meaning |
|---|---|
| `baseUrl` | The API your app talks to. Paths in `routes` are relative to it. |
| `unmatched` | What a request under `baseUrl` gets when no route matches. `error` (the default) answers 501 with a message naming the missing route, and never calls your backend. `passthrough` sends the request on. |
| `session` | Passed to your auth adapter's `signIn`, so the app starts signed in. Use made-up values. Never put a real token here. |
| `routes` | Checked in order. The first match answers. |

Each route:

| Field | Meaning |
|---|---|
| `method` | `GET` by default. `*` answers every method. |
| `url` | A path or a full URL. `:name` matches one path segment. A trailing `*` matches the rest. |
| `query` | Query parameters the request must carry. Other parameters are ignored. |
| `status` | `200` by default. |
| `headers` | Response headers. `content-type` is `application/json` unless you set it. |
| `body` | Sent as JSON. Leave it out for an empty response. |
| `delayMs` | Wait this long before answering, to show loading states. |

Requests to other hosts (images, analytics, Tapthrough itself) pass through untouched. Without a
`baseUrl`, a path matches on any host and unmatched requests always pass through.

## 2. Point a scenario at it

In `.tapthrough/scenarios/<key>.json`:

```json
{
  "title": "Notes list",
  "route": { "path": "/notes" },
  "seed": { "tier": 1, "fixtures": "notes-list" },
  "steps": [{ "action": "Open the list", "expect": "One note, 'Groceries'" }]
}
```

Run `npx tapthrough check`. It reports a scenario whose fixture file is missing or invalid.

## 3. Set up the app

Nothing to add if you already use `<Tapthrough>`. An app with no seed hook can leave `seedHookUrl` out.

Two options are worth setting:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage'

<Tapthrough auth={auth} reset={reset} fixtureStorage={AsyncStorage}>
```

- `fixtureStorage` keeps the fixtures when the app restarts. Without it they last until the app closes,
  and a restarted app would call your real backend with the fixture's made-up session.
- `auth` receives the fixture's `session`. If your app checks the session with your backend on start,
  add a route for that request too.

## How it works

1. The reviewer opens the scenario's link.
2. The app redeems the link with Tapthrough, which returns the fixture file from the PR's commit. If
   you have a seed hook, the hook redeems the link and passes the fixtures on.
3. The app clears local state, starts answering requests from the fixtures, signs in with `session`
   and opens the scenario's screen.
4. Opening a scenario without fixtures stops the answering, so one scenario never leaks into the next.

Tapthrough takes over `fetch` only in builds where it is enabled. Production builds are untouched.

## Limits

- **Writes don't stick.** A `POST` gets its canned answer, but the next `GET` returns what the file
  says. Check that the request is made and the UI reacts, not that the data changed.
- **Only `fetch`.** Requests made another way (XMLHttpRequest-only libraries, native modules, WebSockets)
  are not answered. Axios uses XMLHttpRequest by default; set its `adapter` to `fetch`.
- **Fixtures can drift from your API.** Copy them from real responses, and update them in the PR that
  changes the API.
- **It reviews the screen, not the integration.** A PR that breaks the real API contract can still look
  fine.
