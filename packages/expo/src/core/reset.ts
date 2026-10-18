import type { ResetTarget } from './launch.js'

/** Clears a TanStack Query cache so the test user never sees the previous user's data. */
export function resetQueryClient(queryClient: { clear(): void }): ResetTarget {
  return () => queryClient.clear()
}

/** Removes persisted keys from AsyncStorage, MMKV or anything with `removeItem`. */
export function resetStorage(
  storage: { removeItem(key: string): void | Promise<void> },
  keys: string[],
): ResetTarget {
  return async () => {
    for (const key of keys) await storage.removeItem(key)
  }
}

interface ResettableStore {
  getInitialState(): unknown
  setState(state: never, replace: true): void
}

/** Puts Zustand stores back to their initial state. */
export function resetStores(stores: ResettableStore[]): ResetTarget {
  return () => {
    for (const store of stores) store.setState(store.getInitialState() as never, true)
  }
}
