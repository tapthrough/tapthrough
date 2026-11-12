import {
  type ColorValue,
  DynamicColorIOS,
  Platform,
  PlatformColor,
  type TextStyle,
  useColorScheme,
} from 'react-native'

/** Light and dark values; on iOS they back the system colors' names below. */
const TABLE = {
  surface: { light: '#FFFFFF', dark: '#1C1C1E' },
  label: { light: '#000000', dark: '#FFFFFF' },
  secondary: { light: 'rgba(60,60,67,0.6)', dark: 'rgba(235,235,245,0.6)' },
  tertiary: { light: 'rgba(60,60,67,0.3)', dark: 'rgba(235,235,245,0.3)' },
  separator: { light: 'rgba(60,60,67,0.29)', dark: 'rgba(84,84,88,0.65)' },
  fill: { light: 'rgba(118,118,128,0.12)', dark: 'rgba(118,118,128,0.24)' },
  tint: { light: '#007AFF', dark: '#0A84FF' },
  pass: { light: '#34C759', dark: '#30D158' },
  fail: { light: '#FF3B30', dark: '#FF453A' },
  tintFill: { light: 'rgba(0,122,255,0.12)', dark: 'rgba(10,132,255,0.22)' },
}

type Name = keyof typeof TABLE
export type Colors = Record<Name, ColorValue>

const IOS_NAMES: Partial<Record<Name, string>> = {
  surface: 'secondarySystemGroupedBackground',
  label: 'label',
  secondary: 'secondaryLabel',
  tertiary: 'tertiaryLabel',
  separator: 'separator',
  fill: 'tertiarySystemFill',
  tint: 'systemBlue',
  pass: 'systemGreen',
  fail: 'systemRed',
}

function iosColors(): Colors {
  const colors = {} as Colors
  for (const name of Object.keys(TABLE) as Name[]) {
    const system = IOS_NAMES[name]
    // System colors follow dark mode and Increase Contrast by themselves. They
    // can't take an alpha, so the tinted fill is a dynamic pair instead.
    colors[name] = system ? PlatformColor(system) : DynamicColorIOS(TABLE[name])
  }
  return colors
}

const ios = Platform.OS === 'ios' ? iosColors() : null

/** The SDK's colors: iOS system colors, or a light/dark table elsewhere. */
export function useColors(): Colors {
  const scheme = useColorScheme()
  if (ios) return ios
  const mode = scheme === 'dark' ? 'dark' : 'light'
  const colors = {} as Colors
  for (const name of Object.keys(TABLE) as Name[]) colors[name] = TABLE[name][mode]
  return colors
}

/** Apple's text styles at the default Dynamic Type size. */
export const text = {
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22 },
  subhead: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
} satisfies Record<string, TextStyle>

/** The iOS curve for things that enter or leave, as a spring. */
export const SPRING = { stiffness: 260, damping: 28, mass: 1 }
