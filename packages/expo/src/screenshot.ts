import { Dimensions } from 'react-native'

interface ViewShot {
  captureScreen(options: {
    format: 'jpg' | 'png'
    quality: number
    result: 'base64'
    width?: number
    height?: number
  }): Promise<string>
}

declare const require: (id: string) => unknown

let viewShot: ViewShot | null | undefined

/** `react-native-view-shot` is optional: without it, reports go out without a screenshot. */
function loadViewShot(): ViewShot | null {
  if (viewShot === undefined) {
    try {
      // Metro treats a require inside try/catch as an optional dependency.
      viewShot = require('react-native-view-shot') as ViewShot
    } catch {
      viewShot = null
    }
  }
  return viewShot
}

export interface Screenshot {
  contentType: 'image/jpeg'
  base64: string
}

/** A JPEG of the whole screen, scaled to at most 720px wide to keep uploads small. */
export async function captureScreenshot(): Promise<Screenshot | null> {
  const shot = loadViewShot()
  if (!shot) return null
  const { width, height } = Dimensions.get('window')
  const targetWidth = Math.min(720, Math.round(width * 2))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const base64 = await Promise.race([
      shot.captureScreen({
        format: 'jpg',
        quality: 0.7,
        result: 'base64',
        width: targetWidth,
        height: Math.round((targetWidth * height) / width),
      }),
      // The native capture can stall on some screens; the report shouldn't wait on it.
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)
      }),
    ])
    return base64 ? { contentType: 'image/jpeg', base64 } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const CAPTURE_TIMEOUT_MS = 2500
