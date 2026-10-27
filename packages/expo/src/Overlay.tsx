import { type ComponentType, type ReactNode, useEffect, useRef } from 'react'
import { BackHandler, Platform, StyleSheet, View } from 'react-native'

interface Screens {
  FullWindowOverlay: ComponentType<{
    children: ReactNode
    unstable_accessibilityContainerViewIsModal?: boolean
  }>
}

declare const require: (id: string) => unknown

let screens: Screens | null | undefined

/** `react-native-screens` comes with Expo Router; without it, the overlay is a plain view. */
function loadScreens(): Screens | null {
  if (screens === undefined) {
    try {
      // Metro treats a require inside try/catch as an optional dependency.
      screens = require('react-native-screens') as Screens
    } catch {
      screens = null
    }
  }
  return screens
}

/**
 * Keeps the Review button and its sheets above everything, like Expo's dev
 * tools button. On iOS, native modals and form sheets are presented above the
 * app's root view, so the overlay lives in the window itself. On Android,
 * native-stack modals stay in the same view tree, so a top-level view is enough.
 */
export function Overlay({ children }: { children: ReactNode }) {
  const content = (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {children}
    </View>
  )
  const FullWindowOverlay = Platform.OS === 'ios' ? loadScreens()?.FullWindowOverlay : undefined
  if (!FullWindowOverlay) return content
  // Not modal for VoiceOver: the app underneath stays reachable while only the button shows.
  return (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
      {content}
    </FullWindowOverlay>
  )
}

/** Android's back button closes the topmost sheet, as it did when these were Modals. */
export function useBackPress(onBack: () => void) {
  const handler = useRef(onBack)
  handler.current = onBack
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handler.current()
      return true
    })
    return () => subscription.remove()
  }, [])
}
