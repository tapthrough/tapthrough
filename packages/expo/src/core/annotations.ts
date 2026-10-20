/** A box drawn on the screenshot, in fractions of its width and height (what the server expects). */
export interface AnnotationBox {
  kind: 'highlight' | 'blur'
  x: number
  y: number
  w: number
  h: number
}

/** Boxes smaller than this (in fractions) are treated as accidental taps. */
const MIN_SIZE = 0.03
export const MAX_ANNOTATIONS = 10

const clamp = (value: number) => Math.min(1, Math.max(0, value))
const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * The box between where a drag started and where it is now, in the drawing
 * area's coordinates, normalized to its size. Works in any drag direction and
 * clamps to the image. Returns null while the drag is too small to be a box.
 */
export function boxFromDrag(
  kind: AnnotationBox['kind'],
  start: { x: number; y: number },
  current: { x: number; y: number },
  size: { width: number; height: number },
): AnnotationBox | null {
  if (size.width <= 0 || size.height <= 0) return null
  const x1 = clamp(start.x / size.width)
  const y1 = clamp(start.y / size.height)
  const x2 = clamp(current.x / size.width)
  const y2 = clamp(current.y / size.height)
  const w = Math.abs(x2 - x1)
  const h = Math.abs(y2 - y1)
  if (w < MIN_SIZE || h < MIN_SIZE) return null
  return { kind, x: round(Math.min(x1, x2)), y: round(Math.min(y1, y2)), w: round(w), h: round(h) }
}
