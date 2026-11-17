/** A screenshot as reports carry it. */
export interface Screenshot {
  contentType: 'image/jpeg'
  base64: string
}

/** Longest side of an attached screenshot. Plenty to read text, small enough to upload fast. */
export const MAX_SIDE = 1600
/** The server refuses more than this many base64 characters. */
export const MAX_BASE64 = 4_000_000

/** A size no larger than `max` on its longest side, keeping the shape. Never enlarges. */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max || longest === 0) return { width, height }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** The base64 part of a `data:` URL. */
export function base64Of(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

type Drawable = HTMLImageElement | HTMLVideoElement | ImageBitmap

function sizeOf(source: Drawable): { width: number; height: number } {
  if ('videoWidth' in source) return { width: source.videoWidth, height: source.videoHeight }
  if ('naturalWidth' in source) return { width: source.naturalWidth, height: source.naturalHeight }
  return { width: source.width, height: source.height }
}

/** Draws `source` scaled down to a JPEG the server will accept. */
export function toScreenshot(source: Drawable, doc: Document = document): Screenshot {
  const size = sizeOf(source)
  if (size.width === 0 || size.height === 0) throw new Error('That image is empty.')
  const { width, height } = fitWithin(size.width, size.height)
  const canvas = doc.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error("This browser can't prepare the image.")
  // A white page behind transparent PNGs, which JPEG would otherwise turn black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  for (const quality of [0.82, 0.6, 0.4]) {
    const base64 = base64Of(canvas.toDataURL('image/jpeg', quality))
    if (base64.length <= MAX_BASE64) return { contentType: 'image/jpeg', base64 }
  }
  throw new Error('That image is too large to attach.')
}

/** An image file the reviewer picked or pasted, as a screenshot. */
export async function fileToScreenshot(file: Blob, doc: Document = document): Promise<Screenshot> {
  if (!file.type.startsWith('image/')) throw new Error('Attach an image file.')
  const url = URL.createObjectURL(file)
  try {
    const image = doc.createElement('img')
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("That file isn't an image this browser can read."))
      image.src = url
    })
    return toScreenshot(image, doc)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Whether this browser can capture the tab at all. */
export function canCaptureTab(nav: Navigator = navigator): boolean {
  return typeof nav.mediaDevices?.getDisplayMedia === 'function'
}

/**
 * Asks the browser to share this tab and takes one frame of it. The browser
 * shows its own prompt each time; nothing is recorded beyond the one frame.
 * Returns null when the reviewer cancels the prompt.
 */
export async function captureTab(doc: Document = document): Promise<Screenshot | null> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
      // Chrome: offer this tab first, instead of a list of every window.
      ...({ preferCurrentTab: true, selfBrowserSurface: 'include' } as object),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return null
    throw new Error("Couldn't capture the tab. Attach an image instead.")
  }
  try {
    const video = doc.createElement('video')
    video.muted = true
    video.srcObject = stream
    await video.play()
    // One more frame, so the browser's "sharing" prompt has gone from the picture.
    await new Promise((resolve) => setTimeout(resolve, 250))
    return toScreenshot(video, doc)
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
}
