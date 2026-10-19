import * as Linking from 'expo-linking'
import { type Href, router, useRootNavigationState } from 'expo-router'
import { type ReactNode, useEffect } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { setFlagOverrides } from './core/flags.js'
import type { AuthAdapter, ResetTarget } from './core/launch.js'
import { ReportButton } from './Feedback.js'
import { useLaunchState } from './hooks.js'
import { controller, pluginConfig } from './runtime.js'

export interface TapthroughProps {
  children: ReactNode
  /** How to log in with the seeded session, e.g. `supabaseAuth(supabase)`. */
  auth: AuthAdapter
  /** Local state to clear before logging in: query caches, persisted keys, stores. */
  reset?: ResetTarget[]
  /** Overrides the config plugin's `seedHookUrl`. */
  seedHookUrl?: string
  /** Overrides the config plugin's `enabled`. Off unless one of them turns it on. */
  enabled?: boolean
  /** Shows the Report button on PR previews. Defaults to true. */
  feedback?: boolean
  /** Overrides the config plugin's `apiUrl`, where reports are sent. */
  apiUrl?: string
}

/**
 * Wrap your root layout's content with it. When the app opens from a
 * Tapthrough link, it seeds the test user, logs in, applies flags and opens
 * the scenario's screen. Otherwise it renders `children` and does nothing.
 */
export function Tapthrough({
  children,
  auth,
  reset,
  seedHookUrl,
  enabled,
  feedback = true,
  apiUrl,
}: TapthroughProps) {
  const config = pluginConfig()
  const isEnabled = enabled ?? config.enabled
  const hookUrl = seedHookUrl ?? config.seedHookUrl
  const navigationReady = Boolean(useRootNavigationState()?.key)

  useEffect(() => {
    if (!isEnabled) return
    if (!hookUrl) {
      console.warn('[tapthrough] Enabled without a seedHookUrl; launch links will be ignored.')
      return
    }
    controller.configure({
      seedHookUrl: hookUrl,
      auth,
      reset: reset ?? [],
      applyFlags: setFlagOverrides,
    })
    return () => controller.configure(undefined)
  }, [isEnabled, hookUrl, auth, reset])

  useEffect(() => {
    if (!navigationReady) return
    // Back to the root of the stack, then push: the reviewer lands on the scenario's
    // screen with a back button, instead of on a stack that holds only that screen.
    controller.setNavigator((path) => {
      if (router.canDismiss()) router.dismissAll()
      router.push(path as Href)
    })
    return () => controller.setNavigator(undefined)
  }, [navigationReady])

  // Fallback for apps without `+native-intent`; tokens are de-duplicated.
  useEffect(() => {
    if (!isEnabled) return
    let active = true
    void Linking.getInitialURL().then((url) => {
      if (active) controller.offer(url)
    })
    const subscription = Linking.addEventListener('url', ({ url }) => controller.offer(url))
    return () => {
      active = false
      subscription.remove()
    }
  }, [isEnabled])

  return (
    <>
      {children}
      {isEnabled && feedback ? <ReportButton apiUrl={apiUrl ?? config.apiUrl} /> : null}
      {isEnabled ? <LaunchOverlay /> : null}
    </>
  )
}

function LaunchOverlay() {
  const state = useLaunchState()
  if (state.status === 'launching') {
    return (
      <View style={styles.backdrop} pointerEvents="auto">
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.backdropText}>Setting up your review…</Text>
      </View>
    )
  }
  if (state.status === 'error') {
    return (
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.title}>Couldn't open this preview</Text>
        <Text style={styles.message}>{state.error.message}</Text>
        <Pressable
          onPress={controller.dismiss}
          style={styles.button}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.buttonText}>Dismiss</Text>
        </Pressable>
      </View>
    )
  }
  return null
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: 'rgba(17, 17, 17, 0.85)',
  },
  backdropText: { color: '#ffffff', fontSize: 16 },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 48,
    padding: 16,
    gap: 8,
    borderRadius: 12,
    backgroundColor: '#1f1f1f',
  },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  message: { color: '#d4d4d4', fontSize: 14, lineHeight: 20 },
  button: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 12 },
  buttonText: { color: '#8ab4ff', fontSize: 15, fontWeight: '600' },
})
