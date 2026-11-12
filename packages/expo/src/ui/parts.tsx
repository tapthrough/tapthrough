import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  type ColorValue,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native'
import { loadGlass, loadSymbols, useReduceTransparency } from './native.js'
import { text, useColors } from './theme.js'

/** SF Symbol names used by the SDK, with a text fallback for apps without `expo-symbols`. */
const GLYPHS = {
  xmark: '✕',
  checkmark: '✓',
  'chevron.left': '‹',
  'chevron.right': '›',
  'arrow.up.left.and.arrow.down.right': '⤢',
  'arrow.down.right.and.arrow.up.left': '⤡',
  'arrow.clockwise': '↻',
  'arrow.down.circle.fill': '↓',
  'arrow.right.circle': '→',
  'person.fill': '●',
  'tray.full.fill': '▤',
  'flag.fill': '⚑',
  'arrow.right': '→',
} as const
export type IconName = keyof typeof GLYPHS

export function Icon({
  name,
  size = 17,
  color,
  weight = 'semibold',
}: {
  name: IconName
  size?: number
  color: ColorValue
  weight?: 'regular' | 'medium' | 'semibold' | 'bold'
}) {
  const symbols = loadSymbols()
  if (symbols) {
    return (
      <symbols.SymbolView
        name={name}
        size={size}
        tintColor={color}
        weight={weight}
        style={{ width: size, height: size }}
        pointerEvents="none"
      />
    )
  }
  return (
    <Text
      style={{ color, fontSize: size, lineHeight: size * 1.15, fontWeight: '600' }}
      allowFontScaling={false}
    >
      {GLYPHS[name]}
    </Text>
  )
}

/**
 * A floating surface: Liquid Glass where the system has it, otherwise a solid
 * grouped background with a soft shadow. Reduce Transparency always gets solid.
 */
export function Surface({
  radius,
  style,
  children,
  ...rest
}: ViewProps & { radius: number; children: ReactNode }) {
  const colors = useColors()
  const solid = useReduceTransparency()
  const glass = solid ? null : loadGlass()
  return (
    <View
      {...rest}
      style={[
        { borderRadius: radius },
        glass ? styles.glassShadow : [styles.solid, { backgroundColor: colors.surface }],
        style,
      ]}
    >
      {glass ? (
        <glass.GlassView
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
          glassEffectStyle="regular"
          pointerEvents="none"
        />
      ) : null}
      {children}
    </View>
  )
}

/** A 44pt circle holding one symbol: back, close, expand. */
export function CircleButton({
  icon,
  label,
  onPress,
  tint = false,
}: {
  icon: IconName
  label: string
  onPress: () => void
  tint?: boolean
}) {
  const colors = useColors()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.circle,
        { backgroundColor: tint ? colors.tint : colors.fill },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size={15} color={tint ? '#FFFFFF' : colors.label} />
    </Pressable>
  )
}

type CapsuleKind = 'prominent' | 'gray' | 'plain'

/** Every text button: prominent (tint fill), gray (secondary fill) or plain (tint text). */
export function Capsule({
  title,
  onPress,
  kind = 'prominent',
  icon,
  iconColor,
  busy = false,
  disabled = false,
  accessibilityLabel,
  fillColor,
  style,
}: {
  title: string
  onPress: () => void
  kind?: CapsuleKind
  icon?: IconName
  iconColor?: ColorValue
  busy?: boolean
  disabled?: boolean
  accessibilityLabel?: string
  /** Fills the button with a result color, e.g. green once Pass is chosen. */
  fillColor?: ColorValue
  style?: StyleProp<ViewStyle>
}) {
  const colors = useColors()
  const fg =
    fillColor || kind === 'prominent' ? '#FFFFFF' : kind === 'gray' ? colors.label : colors.tint
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [
        styles.capsule,
        kind === 'prominent' && { backgroundColor: colors.tint },
        kind === 'gray' && { backgroundColor: colors.fill },
        kind === 'plain' && styles.plain,
        fillColor ? { backgroundColor: fillColor } : null,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={14} color={fillColor ? fg : (iconColor ?? fg)} /> : null}
          <Text
            style={[
              kind === 'plain' ? text.subhead : text.headline,
              { color: fg },
              kind === 'gray' && styles.grayText,
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  solid: {
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  glassShadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsule: {
    minHeight: 50,
    borderRadius: 25,
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plain: { minHeight: 44 },
  grayText: { fontSize: 15 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
})
