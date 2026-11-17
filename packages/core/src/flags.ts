import type { Flags } from '@tapthrough/protocol'

type Listener = () => void

let overrides: Readonly<Flags> = {}
const listeners = new Set<Listener>()

/**
 * Feature flags a scenario forces on or off. Your flag lookup should check
 * these first: `getFlagOverride('newEditor') ?? yourFlags.newEditor`.
 */
export function getFlagOverride(name: string): boolean | string | undefined {
  return Object.hasOwn(overrides, name) ? overrides[name] : undefined
}

export function getFlagOverrides(): Readonly<Flags> {
  return overrides
}

/** Replaces all overrides. Called by the launch sequence. */
export function setFlagOverrides(next: Flags): void {
  overrides = Object.freeze({ ...next })
  for (const listener of listeners) listener()
}

export function subscribeToFlagOverrides(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
