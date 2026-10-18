# @tapthrough/expo

The [Tapthrough](https://github.com/tapthrough/tapthrough) SDK for Expo Router apps. When a reviewer opens
a pull request's preview link, the app:

1. sends the link token to your [seed hook](../seed), which creates a fresh test user in staging
2. clears local state: query caches, persisted keys, stores
3. logs in as that user
4. applies the scenario's feature flags
5. opens the screen the PR changed

When the app opens any other way, the SDK does nothing.

```sh
npx expo install @tapthrough/expo
```

## Setup

### 1. Config plugin

```ts
// app.config.ts
export default {
  scheme: 'acmenotes',
  plugins: [
    [
      '@tapthrough/expo',
      {
        enabled: process.env.APP_VARIANT === 'preview',
        seedHookUrl: 'https://<ref>.supabase.co/functions/v1/tapthrough-seed',
      },
    ],
  ],
}
```

The SDK ignores launch links unless `enabled` is true, so keep it off for store builds. The plugin
requires a `scheme`, because links open `<scheme>://tapthrough/launch?t=<token>`.

### 2. Wrap the root layout

```tsx
// app/_layout.tsx
import { resetQueryClient, resetStorage, Tapthrough } from '@tapthrough/expo'
import { supabaseAuth } from '@tapthrough/expo/supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Stack } from 'expo-router'

const auth = supabaseAuth(supabase)
const reset = [resetQueryClient(queryClient), resetStorage(AsyncStorage, ['notes-store'])]

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Tapthrough auth={auth} reset={reset}>
        <Stack />
      </Tapthrough>
    </QueryClientProvider>
  )
}
```

Define `auth` and `reset` outside the component, or memoize them, so they don't change on every render.

`reset` runs **before** sign-in, so a listed key can't wipe the new session. List only your app's own
keys, not the auth client's.

### 3. Hand launch links to the SDK

```ts
// app/+native-intent.ts
export { redirectSystemPath } from '@tapthrough/expo'
```

Without this file, Expo Router tries to open `/tapthrough/launch` as a screen and shows its "not found"
page. If you already have a `redirectSystemPath`, call `handleLaunchPath(path)` first and return `'/'`
(or `null` when the app was already open) when it returns true.

### 4. Read flag overrides

```ts
import { useFlagOverride } from '@tapthrough/expo'

const newEditor = useFlagOverride('newEditor') ?? flags.newEditor
```

Outside React, use `getFlagOverride(name)`.

## API

| Export | Does |
| --- | --- |
| `<Tapthrough auth reset? seedHookUrl? enabled?>` | Runs the launch sequence and shows a loading screen, or an error card the reviewer can dismiss. `seedHookUrl` and `enabled` override the plugin. |
| `redirectSystemPath`, `handleLaunchPath(path)` | For `+native-intent`, as above. |
| `supabaseAuth(client)` from `@tapthrough/expo/supabase` | Logs in with the `{ access_token, refresh_token }` that `createTestUser` returns. |
| `resetQueryClient(client)`, `resetStorage(storage, keys)`, `resetStores(stores)` | Reset targets for TanStack Query, AsyncStorage or MMKV, and Zustand. A reset target is any `() => void \| Promise<void>`. |
| `useFlagOverride(name)`, `getFlagOverride(name)`, `getFlagOverrides()` | The scenario's flag values. `undefined` means the scenario leaves that flag alone. |
| `useLaunchState()` | `idle`, `launching`, `done` (with `path`) or `error` (with `error.code` and `error.message`). |

Any other auth provider works through `auth={{ signIn: async (session) => { … } }}`, where `session` is
whatever your seed hook returns.

## License

MIT
