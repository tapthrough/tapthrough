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
  try {
    const base64 = await shot.captureScreen({
      format: 'jpg',
      quality: 0.7,
      result: 'base64',
      width: targetWidth,
      height: Math.round((targetWidth * height) / width),
    })
    return { contentType: 'image/jpeg', base64 }
  } catch {
    return null
  }
}
