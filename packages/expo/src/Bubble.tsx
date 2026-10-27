import { type ComponentType, useEffect, useMemo, useRef } from 'react'
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewProps,
} from 'react-native'
import {
  type Bounds,
  BUBBLE_SIZE,
  defaultPosition,
  isTap,
  type Point,
  snapToEdge,
} from './core/bubble.js'
import type { Badge } from './core/feedback.js'

/** Where the reviewer last left it, for the rest of the session. */
let rememberedPosition: Point | null = null

const IDLE_OPACITY = 0.55
const IDLE_AFTER_MS = 2500
const PRESSED_SCALE = 0.9

interface Glass {
  GlassView: ComponentType<
    ViewProps & { glassEffectStyle?: 'regular' | 'clear'; tintColor?: string }
  >
  isLiquidGlassAvailable(): boolean
}

declare const require: (id: string) => unknown

let glass: Glass | null | undefined

/** `expo-glass-effect` is optional: with it, iOS 26 gets Liquid Glass like the system's own buttons. */
function loadGlass(): Glass | null {
  if (glass === undefined) {
    try {
      // Metro treats a require inside try/catch as an optional dependency.
      const module = require('expo-glass-effect') as Glass
      glass = module.isLiquidGlassAvailable() ? module : null
    } catch {
      glass = null
    }
  }
  return glass
}

function bounds(width: number, height: number): Bounds {
  // Conservative insets, so the SDK doesn't need a safe-area dependency.
  return {
    width,
    height,
    insetTop: Platform.OS === 'ios' ? 60 : 32,
    insetBottom: Platform.OS === 'ios' ? 34 : 24,
  }
}

/**
 * A small, draggable Review button. Drag it anywhere; it snaps to the nearer
 * side. It fades while idle so it stays out of the way of the app under test.
 */
export function Bubble({
  onPress,
  badge,
  busy,
}: {
  onPress: () => void
  badge: Badge | null
  busy: boolean
}) {
  const { width, height } = useWindowDimensions()
  const area = bounds(width, height)
  const start = rememberedPosition ? snapToEdge(rememberedPosition, area) : defaultPosition(area)
  const position = useRef(new Animated.ValueXY(start)).current
  const opacity = useRef(new Animated.Value(1)).current
  const scale = useRef(new Animated.Value(1)).current
  const GlassView = loadGlass()?.GlassView
  const state = useRef({
    at: start,
    area,
    onPress,
    idle: undefined as ReturnType<typeof setTimeout> | undefined,
  })
  state.current.area = area
  state.current.onPress = onPress

  // Both values drive the same view, so both stay on the JS driver.
  function wake() {
    clearTimeout(state.current.idle)
    Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: false }).start()
  }

  function press(down: boolean) {
    Animated.spring(scale, {
      toValue: down ? PRESSED_SCALE : 1,
      useNativeDriver: false,
      friction: 6,
      tension: 300,
    }).start()
  }

  function sleepSoon() {
    clearTimeout(state.current.idle)
    // Glass is already see-through, and fading it breaks the effect.
    if (GlassView) return
    state.current.idle = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: IDLE_OPACITY,
        duration: 400,
        useNativeDriver: false,
      }).start()
    }, IDLE_AFTER_MS)
  }

  // Fully visible when something new shows up, then fade again.
  const badgeKey = badge ? `${badge.kind}:${'count' in badge ? badge.count : ''}` : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: wakes on badge changes only
  useEffect(() => {
    wake()
    sleepSoon()
    return () => clearTimeout(state.current.idle)
  }, [badgeKey])

  // Rotation or a resized window: keep it on screen and on an edge.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reruns on size changes only
  useEffect(() => {
    const next = snapToEdge(state.current.at, area)
    state.current.at = next
    position.setValue(next)
  }, [area.width, area.height])

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads current values through refs
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          wake()
          press(true)
        },
        onPanResponderMove: (_event, gesture) => {
          const { at } = state.current
          position.setValue({ x: at.x + gesture.dx, y: at.y + gesture.dy })
        },
        onPanResponderRelease: (_event, gesture) => {
          press(false)
          const { at } = state.current
          if (isTap(gesture.dx, gesture.dy)) {
            position.setValue(at)
            sleepSoon()
            state.current.onPress()
            return
          }
          const next = snapToEdge(
            { x: at.x + gesture.dx, y: at.y + gesture.dy },
            state.current.area,
          )
          state.current.at = next
          rememberedPosition = next
          Animated.spring(position, {
            toValue: next,
            useNativeDriver: false,
            friction: 7,
            tension: 80,
          }).start()
          sleepSoon()
        },
        onPanResponderTerminate: () => {
          press(false)
          position.setValue(state.current.at)
          sleepSoon()
        },
      }),
    [],
  )

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[
        styles.bubble,
        GlassView ? null : styles.solid,
        { opacity, transform: [...position.getTranslateTransform(), { scale }] },
      ]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel(badge)}
      accessibilityHint="Opens the review checklist. Drag to move."
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => onPress()}
    >
      {GlassView ? (
        <GlassView
          style={styles.glass}
          glassEffectStyle="regular"
          tintColor="rgba(14, 22, 32, 0.55)"
          pointerEvents="none"
        />
      ) : null}
      {busy ? <ActivityIndicator color="#ffffff" /> : <Mark />}
      {badge && !busy ? <BadgeView badge={badge} /> : null}
    </Animated.View>
  )
}

function accessibilityLabel(badge: Badge | null) {
  switch (badge?.kind) {
    case 'new-build':
      return 'Review this pull request. A new build is ready.'
    case 'failed':
      return 'Review this pull request. A step failed.'
    case 'remaining':
      return `Review this pull request. ${badge.count} step${badge.count === 1 ? '' : 's'} left.`
    case 'done':
      return 'Review this pull request. Every step passed.'
    default:
      return 'Review this pull request'
  }
}

/** The Tapthrough mark: a phone with a strip of tape across it. */
function Mark() {
  return (
    <View style={styles.mark}>
      <View style={styles.phone} />
      <View style={styles.tape} />
    </View>
  )
}

function BadgeView({ badge }: { badge: Badge }) {
  switch (badge.kind) {
    case 'new-build':
      return <View style={[styles.badge, styles.dot, { backgroundColor: COLORS.tape }]} />
    case 'failed':
      return (
        <View style={[styles.badge, { backgroundColor: COLORS.fail }]}>
          <Text style={styles.badgeText}>!</Text>
        </View>
      )
    case 'done':
      return (
        <View style={[styles.badge, { backgroundColor: COLORS.pass }]}>
          <Text style={styles.badgeText}>✓</Text>
        </View>
      )
    case 'remaining':
      return (
        <View style={[styles.badge, { backgroundColor: COLORS.accent }]}>
          <Text style={styles.badgeText}>{badge.count > 9 ? '9+' : badge.count}</Text>
        </View>
      )
  }
}

export const COLORS = {
  ink: '#0e1620',
  tape: '#ecd88e',
  tapeInk: '#2a2414',
  accent: '#2443f2',
  pass: '#1d8a4b',
  fail: '#cf3a2f',
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Without Liquid Glass: a dark, slightly see-through disc with a soft lift. */
  solid: {
    backgroundColor: 'rgba(18, 24, 33, 0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  glass: { ...StyleSheet.absoluteFill, borderRadius: BUBBLE_SIZE / 2 },
  mark: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  phone: {
    width: 14,
    height: 21,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  tape: {
    position: 'absolute',
    width: 22,
    height: 6,
    borderRadius: 1,
    backgroundColor: COLORS.tape,
    transform: [{ rotate: '-8deg' }],
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.ink,
  },
  dot: { minWidth: 14, width: 14, height: 14, paddingHorizontal: 0, top: -1, right: -1 },
  badgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
})
