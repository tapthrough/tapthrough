import { type ComponentType, useEffect, useState } from 'react'
import { AccessibilityInfo, type ColorValue, Platform, type ViewProps } from 'react-native'

declare const require: (id: string) => unknown

/**
 * Optional Expo modules. Metro only treats a `require` as optional when the
 * call sits directly inside a `try` block, so each loader has its own; an app
 * without the module still builds and the SDK falls back to something plainer.
 */
function once<T>(load: () => T | null): () => T | null {
  let value: T | null | undefined
  return () => {
    if (value === undefined) value = load()
    return value
  }
}

export interface Glass {
  GlassView: ComponentType<
    ViewProps & {
      glassEffectStyle?: 'regular' | 'clear'
      tintColor?: string
      isInteractive?: boolean
    }
  >
  isLiquidGlassAvailable(): boolean
}

/** Liquid Glass on iOS 26 through `expo-glass-effect`, or null. */
export const loadGlass = once(() => {
  try {
    const glass = require('expo-glass-effect') as Glass
    return glass.isLiquidGlassAvailable() ? glass : null
  } catch {
    return null
  }
})

interface Symbols {
  SymbolView: ComponentType<
    ViewProps & {
      name: string
      size?: number
      tintColor?: ColorValue
      weight?: 'regular' | 'medium' | 'semibold' | 'bold'
      type?: 'monochrome' | 'hierarchical'
    }
  >
}

/** SF Symbols through `expo-symbols`, on iOS only. */
export const loadSymbols = once(() => {
  if (Platform.OS !== 'ios') return null
  try {
    return require('expo-symbols') as Symbols
  } catch {
    return null
  }
})

interface HapticsModule {
  selectionAsync(): Promise<void>
  notificationAsync(type: unknown): Promise<void>
  impactAsync(style: unknown): Promise<void>
  NotificationFeedbackType: { Success: unknown; Warning: unknown }
  ImpactFeedbackStyle: { Light: unknown }
}

const loadHaptics = once(() => {
  try {
    return require('expo-haptics') as HapticsModule
  } catch {
    return null
  }
})

function play(run: (haptics: HapticsModule) => Promise<void>) {
  const haptics = loadHaptics()
  if (haptics) run(haptics).catch(() => {})
}

/** Haptics through `expo-haptics`; silent without it. Only for the reviewer's own actions. */
export const haptics = {
  selection: () => play((h) => h.selectionAsync()),
  success: () => play((h) => h.notificationAsync(h.NotificationFeedbackType.Success)),
  warning: () => play((h) => h.notificationAsync(h.NotificationFeedbackType.Warning)),
  light: () => play((h) => h.impactAsync(h.ImpactFeedbackStyle.Light)),
}

function useAccessibilitySetting(
  read: () => Promise<boolean>,
  event: 'reduceMotionChanged' | 'reduceTransparencyChanged',
) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let live = true
    read()
      .then((value) => live && setOn(value))
      .catch(() => {})
    const subscription = AccessibilityInfo.addEventListener(event, setOn)
    return () => {
      live = false
      subscription.remove()
    }
  }, [read, event])
  return on
}

const readMotion = () => AccessibilityInfo.isReduceMotionEnabled()
const readTransparency = () =>
  Platform.OS === 'ios' ? AccessibilityInfo.isReduceTransparencyEnabled() : Promise.resolve(false)

export const useReduceMotion = () => useAccessibilitySetting(readMotion, 'reduceMotionChanged')
export const useReduceTransparency = () =>
  useAccessibilitySetting(readTransparency, 'reduceTransparencyChanged')
