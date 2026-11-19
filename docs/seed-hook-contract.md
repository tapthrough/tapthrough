# The seed hook contract

The seed hook is one HTTP endpoint that you run in your own stack, on your stage environment. When a
reviewer opens a Tapthrough link, the app sends the link's token to the seed hook. The seed hook checks
the token, creates a test user and data, and returns a session. The app signs in with that session and
opens the scenario's screen.

This page describes the seed hook as a plain HTTP contract, so you can write it in any language: .NET,
Python, Go, Java, Ruby or anything else that can verify a JWT and make one HTTP call. Tapthrough never
hosts or provisions your database, and the session never passes through Tapthrough.

Using JavaScript or TypeScript? [`@tapthrough/seed`](../packages/seed/README.md) implements all of this.
See [what `@tapthrough/seed` gives you](#what-tapthroughseed-gives-you).

Not sure you need a seed hook? See
[choosing how reviewers get their data](getting-started.md#choosing-how-reviewers-get-their-data).

## Overview

```text
app or preview server            your seed hook (stage)                 Tapthrough
        |  POST { token }               |                                    |
        |------------------------------>|  GET /.well-known/jwks.json        |
        |                               |----------------------------------->|
        |                               |  POST /api/v1/tokens/redeem        |
        |                               |----------------------------------->|
        |                               |  { scenarioId, seed, route, flags }|
        |                               |<-----------------------------------|
        |                               |  run the preset on your stage data |
        |  { session, refs, route, flags }                                   |
        |<------------------------------|                                    |
```

Values you need:

| Name | Value |
| --- | --- |
| Issuer | Tapthrough's base URL, without a trailing slash. `https://tapthrough-cloud.vercel.app` unless you run your own. |
| App ID | Your app's ID as registered with Tapthrough, for example `com.acme.notes` or `app.acme.com`. It is the `aud` claim of your links. |
| Repos | The GitHub repos (`owner/name`) whose pull requests may seed here. At least one. |
| Environment | A variable you set on the stage deployment only. The reference handler reads `TAPTHROUGH_ENV` and accepts `staging` or `development`. |

## The request

The Expo SDK sends the request from the reviewer's device. On Next.js, the launch route sends it from
your preview server. Both send the same thing:

```http
POST <your seed hook URL>
Content-Type: application/json

{ "token": "<link token>" }
```

- `token` is a non-empty string: the link token, a signed JWT.
- There is no `Authorization` header and no cookie. The token is the only credential.
- The SDK sets no timeout of its own. The reviewer waits on a loading screen until the seed hook answers.
- The caller must be able to reach the URL: the reviewer's phone for Expo, your preview deployment for
  Next.js.

## The link token

| Property | Value |
| --- | --- |
| Format | JWT (JWS compact) |
| Algorithm | `ES256`. Accept no other algorithm. |
| Header | `alg`, `kid`, `typ: "JWT"`. `kid` is the key's RFC 7638 thumbprint. |
| Keys | JWKS at `<issuer>/.well-known/jwks.json` |
| Lifetime | 15 minutes (`exp` is `iat` plus 900 seconds) |
| Single use | Enforced by the redeem call, not by the signature |

Claims:

| Claim | Type | Meaning |
| --- | --- | --- |
| `ver` | `1` | Claims version |
| `iss` | string | The issuer. Must equal your configured issuer exactly. |
| `aud` | string | The app ID. Must equal your app ID. |
| `sub` | string | Tapthrough's ID for the reviewer. Stable across opens. |
| `jti` | string, 16 characters or more | The token's ID. Redeem uses it for single use. |
| `iat` | integer | Issued at, in seconds |
| `exp` | integer | Expiry, in seconds |
| `scn` | string | The scenario's ID |
| `repo` | string | The GitHub repo, `owner/name` |
| `pr` | positive integer | The pull request number |

## What the seed hook must do, in order

The order matters. Each step must pass before the next one runs. This is the order of
`createSeedHandler` in [`packages/seed/src/handler.ts`](../packages/seed/src/handler.ts).

1. **Accept `POST` only.** Answer any other method with `405 method_not_allowed`.
2. **Check the environment.** If the environment variable is not `staging` or `development`, answer
   `403 not_staging`. Unset counts as not allowed. Do this before you read the body, so a seed hook
   deployed to production by mistake does nothing.
3. **Read the body.** It must be JSON with a non-empty string `token`. Otherwise answer
   `400 bad_request`.
4. **Verify the token** with a JWT library:
   - the signature, against the JWKS at `<issuer>/.well-known/jwks.json`, with `ES256` only
   - `iss` equals your issuer
   - `aud` equals your app ID
   - `exp` is in the future. The reference handler allows no clock skew.
   - the claims have the types in the table above

   Answer `401 expired` for an expired token, `401 wrong_audience` for another app's token, and
   `401 invalid` for anything else that is wrong with the token. If you cannot fetch the keys, answer
   `502 keys_unavailable`: that says nothing about the token.
5. **Check the repo.** Compare the `repo` claim with your list of repos, ignoring case. If it is not
   in the list, answer `403 repo_not_allowed`. Do this before you redeem.
6. **Redeem the token** with Tapthrough. See [the redeem call](#the-redeem-call). Redeeming marks the
   token as used and returns the scenario: which preset to run, its params, the route and the flags.
   Never create a user before redeem succeeds.
7. **Create the starting state** from the scenario's `seed`:
   - `tier: 2`: look up `seed.preset` in your presets. If you have no preset with that name, answer
     `400 unknown_preset`. Validate `seed.params` (treat a missing `params` as `{}` and fill in your
     defaults). If they are wrong, answer `400 invalid_params` and name the field. Then run the preset.
   - `tier: 0`: sign in to your shared test account, if your seed hook supports one. Otherwise answer
     `501 tier_unsupported`.
   - `tier: 1`: answer `501 tier_unsupported`. The reference handler does this.
8. **Respond** with `200` and [the success response](#the-success-response). Copy `route` and `flags`
   from the redeem response without changing them.

If anything else fails, for example the database call inside a preset, answer `500 seed_failed`. Log the
details on your side with a short error ID, and put only the ID in the message. Preset errors can carry
database details that a reviewer should not see.

Steps 4 and 5 are yours to do even though redeem also verifies the token. Redeem cannot know which app
ID and which repos this deployment trusts.

## The redeem call

```http
POST <issuer>/api/v1/tokens/redeem
Content-Type: application/json

{ "token": "<the same link token>" }
```

A `200` response:

```json
{
  "apiVersion": 1,
  "scenarioId": "scn_8f3a",
  "seed": { "tier": 2, "preset": "user-with-notes", "params": { "count": 3 }, "role": "viewer" },
  "route": { "path": "/notes/[id]/edit", "params": { "id": "$seed.notes[0].id" } },
  "flags": { "newEditor": true }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `apiVersion` | `1` | |
| `scenarioId` | string | |
| `seed.tier` | `0`, `1` or `2` | See step 7 |
| `seed.preset` | string | Always present for tier 2 |
| `seed.params` | object | Optional. Any JSON values. |
| `seed.role` | string | Optional. The role the scenario asks for, for example `viewer`. |
| `route.path` | string starting with `/` | A file-router path with `[param]` segments |
| `route.params` | object of strings | Values may be `$seed.` references. Defaults to `{}`. |
| `flags` | object of booleans or strings | Defaults to `{}` |

What to do with other answers:

- **Not `2xx`, with an error body** (`{ "error": { "code", "message" } }`): pass the code, the message
  and the HTTP status through to the app unchanged. The message is written for the reviewer.
- **Not `2xx`, without a readable error body:** answer `502 redeem_failed`.
- **`2xx` with a body you cannot read:** answer `502 redeem_failed`.
- **The request itself fails** (network error): the reference handler does not handle this case
  separately, so it answers `500 seed_failed`.

Errors that redeem returns today:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | The body had no `token` |
| 401 | `invalid`, `expired`, `wrong_audience` | Redeem verifies the token again |
| 409 | `token_used` | The link was already opened. The reviewer reopens it from the PR. |
| 410 | `link_expired` | The pull request is closed |
| 429 | `rate_limited` | The link was opened too many times in a short period |
| 500 | `scenario_invalid` | The stored scenario failed validation |

Treat this list as open. Pass through any code you receive.

## The success response

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "apiVersion": 1,
  "session": { "access_token": "…", "refresh_token": "…" },
  "refs": { "notes": [{ "id": "note_1" }, { "id": "note_2" }] },
  "route": { "path": "/notes/[id]/edit", "params": { "id": "$seed.notes[0].id" } },
  "flags": { "newEditor": true }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `apiVersion` | Yes | Must be `1`. The SDK rejects a response without it. |
| `session` | Yes | A JSON object. See [the session](#the-session). Use `{}` if the app has no login. |
| `refs` | Yes | A JSON object with the records the preset created. Use `{}` if there are none. |
| `route` | Yes | Copied from the redeem response |
| `flags` | No | Copied from the redeem response. Defaults to `{}`. |

### What the app does with it

In this order (see [`packages/core/src/launch.ts`](../packages/core/src/launch.ts)):

1. Reads the response. If it does not match the table above, the reviewer sees an error
   (`bad_response`) and nothing changes in the app.
2. Resolves the route. Each `route.params` value that starts with `$seed.` is looked up in `refs`, then
   the values replace the `[param]` segments of `route.path`. If a reference is missing, the launch
   stops with `bad_route` before anything changes.
3. Clears local state.
4. Calls the app's auth adapter with `session`.
5. Applies `flags`.
6. Opens the resolved path.

### `$seed.` references

A reference is a path into `refs`: keys joined with dots, and `[n]` for a list index.
`$seed.notes[0].id` reads `refs.notes[0].id`. The value it points at must be a string or a number.
The seed hook does not resolve references. It returns `refs` and the SDK resolves them.

So a preset must return every record that a scenario's route points at. If a scenario uses
`"id": "$seed.project.id"`, the preset's `refs` must contain `project.id`.

## Errors

Every error has this body, with the HTTP status from the table:

```json
{ "error": { "code": "token_used", "message": "This link was already opened. Reopen it from the PR." } }
```

The app shows `message` to the reviewer as it is, so write it for them.

| Status | Code | When |
| --- | --- | --- |
| 405 | `method_not_allowed` | The request is not a `POST` |
| 403 | `not_staging` | The environment is not `staging` or `development` |
| 400 | `bad_request` | The body is not JSON with a `token` |
| 401 | `expired` | The token's `exp` has passed |
| 401 | `wrong_audience` | The token's `aud` is not your app ID |
| 401 | `invalid` | The signature, issuer, algorithm or claims are wrong |
| 502 | `keys_unavailable` | The JWKS could not be fetched |
| 403 | `repo_not_allowed` | The token's `repo` is not in your list |
| 502 | `redeem_failed` | Redeem answered with something unreadable |
| as received | as received | An error from redeem, passed through: `token_used` (409), `link_expired` (410) and the others in [the redeem call](#the-redeem-call) |
| 400 | `unknown_preset` | The scenario names a preset this seed hook does not have |
| 400 | `invalid_params` | The scenario's params fail the preset's checks |
| 501 | `tier_unsupported` | Tier 0 without a shared test account, or tier 1 |
| 500 | `seed_failed` | Anything else, usually an error inside a preset |

If the app receives a non-`2xx` answer without this body, the reviewer sees
"The seed hook returned `<status>`."

## Presets

A preset is a named starting state. The scenario files in `.tapthrough/scenarios/` refer to presets by
name, so the names in your seed hook and in the scenarios must match.

A preset receives:

| Input | From | Meaning |
| --- | --- | --- |
| `reviewerId` | the token's `sub` | Stable for one reviewer across opens. Use it to tag or find that reviewer's test data. |
| `scenarioId` | redeem's `scenarioId` | |
| `repo` | the token's `repo` | |
| `pr` | the token's `pr` | |
| `role` | redeem's `seed.role` | Optional |
| `params` | redeem's `seed.params` | After your validation and defaults |

A preset returns:

| Output | Required | Meaning |
| --- | --- | --- |
| `session` | Yes | What the app signs in with |
| `refs` | No | The records it created, for `$seed.` references. The seed hook sends `{}` when the preset returns none. |

Give each preset typed params with defaults and limits, for example `count`: an integer from 1 to 20,
default 3. Reject anything else with `invalid_params`.

A shared test account handler receives the same inputs without `params`, and returns a `session`.

## The session

`session` is a JSON object that your seed hook and your app agree on. Tapthrough does not read it. The
seed hook creates it by signing the test user in, the same way the app would, and the app's auth adapter
turns it into a signed-in state.

| The app uses | `session` | How the app consumes it |
| --- | --- | --- |
| Supabase, in an Expo app | `{ "access_token", "refresh_token" }` | `supabaseAuth(client)` from `@tapthrough/expo/supabase` calls `auth.setSession` |
| Supabase with `@supabase/ssr`, in a Next.js app | `{ "access_token", "refresh_token" }` | `supabaseSsrAuth({ url, anonKey })` from `@tapthrough/next/supabase` writes the Supabase cookies |
| Auth.js (NextAuth v5) with JWT sessions | `{ "sessionToken" }`: a token encoded with the app's `AUTH_SECRET`, salted with the session cookie's name | `authJsAuth()` from `@tapthrough/next/authjs` sets the session cookie |
| Your own API or another provider | Whatever your sign-in needs, for example `{ "token": "…" }` | Your own adapter. Expo: `{ signIn(session) }`. Next.js: `{ signIn(session, cookies, request) }`. |
| No login | `{}` | Leave the adapter out |

Rules for a session:

- Return tokens for the test user only. Never return a service key, an admin key or a password.
- Use what your normal sign-in returns. The app should not need a special code path beyond the adapter.
- If your provider lets you choose, keep the lifetime short. A review session lasts minutes to hours.

## Test users

Make every test user easy to recognise and impossible to confuse with a real person.

- **Use a reserved email domain.** The reference helper uses `tt-<uuid>@tapthrough.test`. The `.test`
  top-level domain is reserved and never receives mail. Do not use a domain that you or anyone else
  owns.
- **Mark the user.** The reference helper sets `tapthrough: true` in the user's metadata. A flag or a
  column works too. Cleanup jobs and analytics filters can then find these users.
- **Use a random password** that nobody learns, or no password at all. The reference helper generates a
  random one for each user and returns only the session.
- **Confirm the email in code.** Never send a confirmation email, a welcome email or a notification to
  a test user.

Decide what happens when the same reviewer opens a link again. Both ways are valid:

| Way | How | Trade-off |
| --- | --- | --- |
| A new user for each open | Create a user with a random address each time. The reference helper `createTestUser` does this. | Reviewers never see each other's changes or their own earlier ones. Users pile up, so delete marked users on a schedule. |
| One user per reviewer and preset | Derive the address from `reviewerId` and the preset name. On each open, delete that user's data and create it again. | Nothing piles up. The preset must reset the data every time, so the scenario always starts from the same state. |

`reviewerId` is an opaque string. If you put it in an email address or a key, hash it first unless you
know that it only has safe characters.

A token is single use, so one token never runs a preset twice. A reviewer who reopens the link from the
PR gets a new token and runs the preset again. Tapthrough limits how often one link can be redeemed.

## Security rules

- **Never enable the seed hook on production.** Set the environment variable on the stage deployment
  only. Check it first, on every request. Make sure the stage deployment does not use the production
  database.
- **Verify before you redeem, and redeem before you create anything.** Check the signature, issuer,
  audience, expiry and repo yourself.
- **Never log the token or the session.** Both are credentials. Log the error ID, the preset name and
  the reviewer ID instead.
- **Sessions never pass through Tapthrough.** The seed hook creates the session and returns it straight
  to the app. Do not send it anywhere else.
- **Send `Cache-Control: no-store`** on the success response. The reference handler sets it on the
  success response only, not on error responses.
- **Do not leak preset errors.** Answer `seed_failed` with an error ID and keep the details in your
  logs.
- **Keep secrets in the seed hook.** Admin keys that create users stay in the seed hook's environment.
  They never go in the app or in the response.
- **Use HTTPS.**

### CORS

The reference handler sets no CORS headers and does not answer `OPTIONS` requests. An `OPTIONS` request
gets `405 method_not_allowed`.

That works for the callers Tapthrough ships today:

- The Expo SDK calls the seed hook from a native app. Native apps do not enforce CORS.
- The Next.js launch route calls the seed hook from your server, or runs it in the same process.

If a browser page calls your seed hook directly, the browser sends a preflight request first, because
the request has a JSON content type. In that case add CORS yourself: answer `OPTIONS` with
`Access-Control-Allow-Origin` for your preview origins, `Access-Control-Allow-Methods: POST` and
`Access-Control-Allow-Headers: Content-Type`, and add `Access-Control-Allow-Origin` to the `POST`
response. Do not allow credentials. The request needs no cookies.

## Test it with curl

Set the URL of your deployed seed hook:

```sh
HOOK=https://stage-api.acme.com/tapthrough/seed
```

A request without a token must fail with `400 bad_request`:

```sh
curl -i -X POST "$HOOK" -H 'Content-Type: application/json' -d '{}'
```

A made-up token must fail with `401 invalid`:

```sh
curl -i -X POST "$HOOK" -H 'Content-Type: application/json' -d '{"token":"not-a-token"}'
```

A `GET` must fail with `405`:

```sh
curl -i "$HOOK"
```

Run the first command against **production** as well. It must answer `403 not_staging`, or `404` if
the route is not deployed there. Any other answer means the environment guard is not working.

For a full run you need a real link token. A token is the `t` query parameter of a launch link:
`<scheme>://tapthrough/launch?t=<token>` in an Expo app, `/api/tapthrough/launch?t=<token>` on a web
preview. `npx @tapthrough/cli launch <pr-link> --scenario <key>` prints a single-use launch link for
a pull request that has the Tapthrough comment. Then:

```sh
curl -i -X POST "$HOOK" -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\"}"
```

Expect `200`, `Cache-Control: no-store`, and a body with `apiVersion`, `session`, `refs`, `route` and
`flags`. Run the same command again: it must fail with `409 token_used`. The token expires after 15
minutes, and the test creates a real test user on your stage environment.

## Reference implementation in Python

This is a sketch to show the shape, with Flask, [PyJWT](https://pyjwt.readthedocs.io/) and `requests`
(`pip install flask "pyjwt[crypto]" requests`). It has one preset and no shared test account.

> **How far this was tested.** We ran this code with stubbed `myapp.testdata` functions against a local
> stand-in for Tapthrough (a test key, a local JWKS and a local redeem endpoint). It returned the
> statuses and codes in the error table for each case. It has not been run against the real Tapthrough
> service or a real database. Treat it as a starting point, not as a supported package.

```python
import logging
import os
import uuid

import jwt  # PyJWT, installed as pyjwt[crypto]
import requests
from flask import Flask, jsonify, request

# Your code: create or reset a user and its data on stage, and sign it in.
from myapp.testdata import insert_notes, reset_test_user, sign_in

ISSUER = os.environ.get("TAPTHROUGH_ISSUER", "https://tapthrough-cloud.vercel.app").rstrip("/")
APP_ID = "com.acme.notes"
REPOS = {"acme/notes"}  # lowercase owner/name
jwks = jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json")  # caches the keys
app = Flask(__name__)


class SeedError(Exception):
    def __init__(self, code, message, status):
        self.code, self.message, self.status = code, message, status


def user_with_notes(context, params):
    count = params.get("count", 3)
    if type(count) is not int or not 1 <= count <= 20:
        raise SeedError("invalid_params", 'Invalid params for "user-with-notes" at count', 400)
    # One user per reviewer and preset, reset on every open.
    user = reset_test_user(f"tt-{context['reviewerId']}-notes@tapthrough.test")
    notes = insert_notes(user["id"], count)
    return {"session": sign_in(user), "refs": {"notes": [{"id": n["id"]} for n in notes]}}


PRESETS = {"user-with-notes": user_with_notes}


def verify(token):
    try:
        key = jwks.get_signing_key_from_jwt(token)
        return jwt.decode(token, key.key, algorithms=["ES256"], issuer=ISSUER, audience=APP_ID,
                          options={"require": ["exp", "iat", "sub", "jti", "scn", "repo", "pr"]})
    except jwt.ExpiredSignatureError:
        raise SeedError("expired", "This link has expired. Reopen it from the PR.", 401)
    except jwt.InvalidAudienceError:
        raise SeedError("wrong_audience", "Link token is for a different app", 401)
    except jwt.PyJWKClientConnectionError:
        raise SeedError("keys_unavailable", "Couldn't reach Tapthrough to check this link.", 502)
    except (jwt.InvalidTokenError, jwt.PyJWKClientError):
        raise SeedError("invalid", "Link token is invalid", 401)


def redeem(token):
    response = requests.post(f"{ISSUER}/api/v1/tokens/redeem", json={"token": token}, timeout=10)
    try:
        body = response.json()
    except ValueError:
        body = None
    if not response.ok:
        error = body.get("error") if isinstance(body, dict) else None
        if isinstance(error, dict) and "code" in error and "message" in error:
            raise SeedError(error["code"], error["message"], response.status_code)
        raise SeedError("redeem_failed", f"Tapthrough returned {response.status_code}", 502)
    if not isinstance(body, dict) or body.get("apiVersion") != 1 or "seed" not in body:
        raise SeedError("redeem_failed", "Tapthrough returned an unexpected response", 502)
    return body


@app.post("/tapthrough/seed")  # Flask answers other methods with its own 405 page
def seed_hook():
    try:
        if os.environ.get("TAPTHROUGH_ENV") not in ("staging", "development"):
            raise SeedError("not_staging", "Seeding is disabled in this environment", 403)
        body = request.get_json(silent=True)
        token = body.get("token") if isinstance(body, dict) else None
        if not isinstance(token, str) or not token:
            raise SeedError("bad_request", "Expected { token }", 400)
        claims = verify(token)
        if str(claims["repo"]).lower() not in REPOS:
            raise SeedError("repo_not_allowed", "This link is from a repo this app does not trust", 403)
        scenario = redeem(token)
        seed = scenario["seed"]
        if seed.get("tier") != 2:
            raise SeedError("tier_unsupported", "This hook only runs presets", 501)
        preset = PRESETS.get(seed.get("preset"))
        if preset is None:
            raise SeedError("unknown_preset", f'Unknown preset "{seed.get("preset")}"', 400)
        context = {"reviewerId": claims["sub"], "scenarioId": scenario["scenarioId"],
                   "repo": claims["repo"], "pr": claims["pr"], "role": seed.get("role")}
        result = preset(context, seed.get("params") or {})
        response = jsonify(apiVersion=1, session=result["session"], refs=result.get("refs", {}),
                           route=scenario["route"], flags=scenario.get("flags", {}))
        response.headers["Cache-Control"] = "no-store"
        return response
    except SeedError as error:
        return jsonify(error={"code": error.code, "message": error.message}), error.status
    except Exception:
        error_id = uuid.uuid4().hex[:8]
        logging.exception("tapthrough seeding failed (%s)", error_id)  # details stay in the logs
        message = f"Seeding failed. Check the seed hook's logs for error {error_id}."
        return jsonify(error={"code": "seed_failed", "message": message}), 500
```

Differences from the reference handler: Flask's own `405` page replaces the `method_not_allowed` JSON
body, and the example checks fewer claim types than step 4 lists.

## Connect the app

- **Expo:** set `seedHookUrl` in the `@tapthrough/expo` config plugin to the seed hook's URL, and pass an
  auth adapter to `<Tapthrough auth={…}>`. See [getting started](getting-started.md).
- **Next.js:** pass the seed hook's URL as `seed` to `createLaunchRoute`, and pick an auth adapter. See
  [getting started with Next.js](getting-started-nextjs.md#the-launch-route).

Then point your scenarios at the presets: `"seed": { "tier": 2, "preset": "<name>" }`. See
[scenarios and plan files](plan-files.md).

## What `@tapthrough/seed` gives you

A JavaScript or TypeScript team does not write any of the steps above. With
[`@tapthrough/seed`](../packages/seed/README.md):

| You get | From |
| --- | --- |
| Steps 1 to 8, the redeem call, the success response, every error code and status, `Cache-Control: no-store`, and error IDs in the logs | `createSeedHandler({ appId, repos, environment, presets })`, a Fetch API handler for Deno, Bun, Node 18 and later, and edge functions |
| JWKS fetching and caching | Built into the handler |
| Typed presets, with params checked by a zod schema and defaults filled in | `definePreset` |
| Tier 0 through the same endpoint | The `sharedAccount` option |
| A confirmed Supabase test user at `tt-<uuid>@tapthrough.test` with a random password, its session, and an admin client for inserting data | `createTestUser` from `@tapthrough/seed/supabase` |
| The seed hook inside a Next.js app, without a network hop | Pass the handler as `seed` to `createLaunchRoute` from `@tapthrough/next` |

You still write the presets, choose the app ID and repos, set the environment variable on stage only,
and deploy.
