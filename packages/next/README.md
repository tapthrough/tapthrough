# @tapthrough/next

Tapthrough for Next.js: a Review button on every pull request's preview deployment, with the PR's test
plan and a way to report issues, and nothing in production.

```sh
npm install @tapthrough/next
```

```tsx
// app/layout.tsx
import { Tapthrough } from '@tapthrough/next/panel'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Tapthrough appId="app.acme.com" />
      </body>
    </html>
  )
}
```

Then add the workflow and the GitHub App. The full setup is in
[getting started with Next.js](https://github.com/tapthrough/tapthrough/blob/main/docs/getting-started-nextjs.md).

Supports the App Router on Vercel preview deployments. Web support is in beta.

## What's in the package

| Import | What it is |
| --- | --- |
| `@tapthrough/next/panel` | `<Tapthrough appId>`: a server component for the root layout. Renders the Review button in preview deployments and nothing anywhere else. |
| `@tapthrough/next` | `createLaunchRoute`: the route a Tapthrough link opens when you use test data. It seeds a test user, sets the session cookies and redirects to the scenario's page. Also `previewEnv`, `stateFromCookieHeader` and `flagOverride`. |
| `@tapthrough/next/authjs` | `authJsAuth()`: signs in apps on Auth.js (NextAuth v5) with JWT sessions. |
| `@tapthrough/next/supabase` | `supabaseSsrAuth({ url, anonKey })`: signs in apps on `@supabase/ssr`. Needs `@supabase/ssr` installed. |

## Production

- `<Tapthrough>` renders nothing unless `VERCEL_ENV` is `preview`. A production page downloads a loader of
  under 1 KB and never fetches the panel.
- The launch route answers 404 outside preview deployments, and stays off in a Vercel production
  deployment even when `enabled` is passed.
- `GET /api/tapthrough/launch?status=1` answers setup facts for `npx @tapthrough/cli doctor --url`: that
  the route is on, whether the seed hook is in the app, whether an auth adapter is set, and whether
  `TAPTHROUGH_ENV` is valid. It carries no secrets, never shows an invalid value (only its length), and is
  a 404 wherever the launch route is.
- On hosts other than Vercel, set `TAPTHROUGH_ENABLED=true` and `TAPTHROUGH_PREVIEW_HOST` in the preview
  environment only.

MIT licensed.
