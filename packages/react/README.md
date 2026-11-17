# @tapthrough/react

The Review panel Tapthrough shows on a pull request's preview deployment: the PR's test plan with Pass
and Fail, and a form that reports an issue on the PR.

**Using Next.js? Install [`@tapthrough/next`](https://www.npmjs.com/package/@tapthrough/next) instead.**
It includes this package and decides on the server whether to show the panel. See
[getting started with Next.js](https://github.com/tapthrough/tapthrough/blob/main/docs/getting-started-nextjs.md).

This package is the panel alone. On its own it doesn't find your pages or your preview deployments, so
other React setups (Vite, Remix, React Router) aren't supported end to end yet.

```tsx
import { TapthroughPanel } from '@tapthrough/react'

// Render it only in preview deployments.
<TapthroughPanel host="acme-git-fix-title-acme.vercel.app" appId="app.acme.com" />
```

| Prop | |
| --- | --- |
| `host` | The preview deployment's own host. Reports carry it so they reach the right pull request. |
| `appId` | The app ID registered with Tapthrough. |
| `apiUrl` | Tapthrough's base URL, if you run your own. |

`TapthroughPanel` is a small loader. It fetches the panel when it mounts, and renders it in its own
shadow root with its own React root, so your styles can't change it and its styles can't leak. It shows
nothing unless the deployment belongs to a pull request Tapthrough knows about.

Needs React 18 or newer. MIT licensed.
