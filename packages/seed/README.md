# @tapthrough/seed

The seed hook for [Tapthrough](https://github.com/tapthrough/tapthrough). When a reviewer opens a
preview link, your app sends the link's token here. The hook creates the reviewer's starting state in
your **staging** backend and returns a logged-in session. The session goes straight to your app and
never passes through Tapthrough.

```sh
npm install @tapthrough/seed zod
```

## What it does with each request

1. Refuses to run unless `environment` is `staging` or `development`.
2. Verifies the token's signature against Tapthrough's public keys, plus the issuer, your app ID and the
   expiry.
3. Redeems the token with Tapthrough. A token works once, and redeeming returns the scenario: which
   preset to run, its params, the route and any feature flags.
4. Runs the preset, or your shared test account for tier 0 scenarios.
5. Returns `{ session, refs, route, flags }` to the app.

## Presets

A preset is a named starting state: a schema for its params, and a function that creates the data.

```ts
import { definePreset } from '@tapthrough/seed'
import { createTestUser } from '@tapthrough/seed/supabase'
import { z } from 'zod'

const supabase = {
  url: Deno.env.get('SUPABASE_URL')!,
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
}

export const presets = {
  'user-with-notes': definePreset({
    description: 'A signed-in user with a few notes',
    params: z.object({ count: z.number().int().min(1).max(20).default(3) }),
    async seed({ params, reviewerId }) {
      const { user, session, admin } = await createTestUser({
        ...supabase,
        userMetadata: { reviewerId },
      })
      const { data: notes, error } = await admin
        .from('notes')
        .insert(
          Array.from({ length: params.count }, (_, i) => ({
            user_id: user.id,
            title: `Note ${i + 1}`,
          })),
        )
        .select('id')
      if (error) throw new Error(error.message)
      return { session, refs: { notes } }
    },
  }),
}
```

`refs` is what the scenario's route can point at. A route of `/notes/[id]/edit` with
`id: "$seed.notes[0].id"` opens the first note you created.

If the preset throws, the app shows your error message.

## Deploying as a Supabase edge function

Edge functions run on Deno, which resolves bare imports through the function's `deno.json`:

```json
// supabase/functions/tapthrough-seed/deno.json
{
  "imports": {
    "@tapthrough/seed": "npm:@tapthrough/seed@^0.1.0",
    "@tapthrough/seed/supabase": "npm:@tapthrough/seed@^0.1.0/supabase",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@^2",
    "zod": "npm:zod@^4"
  }
}
```

```ts
// supabase/functions/tapthrough-seed/index.ts
import { createSeedHandler } from '@tapthrough/seed'
import { presets } from './presets.ts'

Deno.serve(
  createSeedHandler({
    appId: 'com.acme.notes',
    environment: Deno.env.get('TAPTHROUGH_ENV'),
    issuer: Deno.env.get('TAPTHROUGH_ISSUER'),
    presets,
  }),
)
```

```sh
supabase secrets set TAPTHROUGH_ENV=staging TAPTHROUGH_ISSUER=https://tapthrough.dev
supabase functions deploy tapthrough-seed --no-verify-jwt
```

Use `--no-verify-jwt` because the request carries a Tapthrough link token, not a Supabase JWT. The
handler verifies it.

The handler is a plain `(Request) => Promise<Response>`, so it also runs in Bun, Cloudflare Workers,
Vercel or Node 18+.

## Options

| Option | Required | Description |
| --- | --- | --- |
| `appId` | Yes | Your app's ID as registered with Tapthrough. Tokens for other apps are refused. |
| `environment` | Yes | Must be `staging` or `development`. Unset or anything else returns `403 not_staging`. |
| `presets` | Yes | Your presets, by name. |
| `sharedAccount` | No | `(context) => Promise<{ session }>` for tier 0 scenarios, which log in to a shared account instead of seeding. |
| `issuer` | No | Tapthrough's base URL. Defaults to `https://tapthrough.dev`. |

## Errors

Errors come back as `{ error: { code, message } }`, and the app shows the message.

| Status | Code | Meaning |
| --- | --- | --- |
| 401 | `expired`, `invalid`, `wrong_audience` | The token failed verification. |
| 403 | `not_staging` | The hook isn't running in staging or development. |
| 409 | `token_used` | The link was already opened. Reopen it from the PR. |
| 410 | `link_expired` | The PR is closed. |
| 400 | `unknown_preset`, `invalid_params` | The scenario asked for a preset or params this hook doesn't have. |
| 500 | `seed_failed` | Your preset threw. |
| 501 | `tier_unsupported` | Tier 0 without a `sharedAccount`, or tier 1. |

## License

MIT
