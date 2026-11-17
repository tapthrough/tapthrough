import type { LaunchState } from '@tapthrough/core'
import { getFlagOverride, subscribeToFlagOverrides } from '@tapthrough/core'
import { useCallback, useSyncExternalStore } from 'react'
import { controller } from './runtime.js'

/** The scenario's value for a flag, or undefined when the scenario doesn't set it. */
export function useFlagOverride(name: string): boolean | string | undefined {
  const get = useCallback(() => getFlagOverride(name), [name])
  return useSyncExternalStore(subscribeToFlagOverrides, get, get)
}

/** Where the current launch is: idle, launching, done or error. */
export function useLaunchState(): LaunchState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
}
