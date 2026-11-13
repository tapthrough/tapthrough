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

/** A freehand line drawn on the screenshot: points in fractions of its width and height. */
export interface AnnotationStroke {
  kind: 'draw'
  points: [number, number][]
}

export type Annotation = AnnotationBox | AnnotationStroke

/** The most points a stroke keeps; longer ones are thinned evenly. */
export const MAX_STROKE_POINTS = 120
/** Points closer than this to the last one (in fractions) add nothing visible. */
const MIN_STEP = 0.004

/**
 * Adds a touch position, in the drawing area's coordinates, to a stroke.
 * Returns the same array when the point is too close to the last one, so a
 * slow finger doesn't pile up points.
 */
export function addStrokePoint(
  points: [number, number][],
  at: { x: number; y: number },
  size: { width: number; height: number },
): [number, number][] {
  if (size.width <= 0 || size.height <= 0) return points
  const next: [number, number] = [round(clamp(at.x / size.width)), round(clamp(at.y / size.height))]
  const last = points.at(-1)
  if (last && Math.hypot(next[0] - last[0], next[1] - last[1]) < MIN_STEP) return points
  return [...points, next]
}

/** Keeps the first and last points and an even spread between, up to `max`. */
export function thinStroke(
  points: [number, number][],
  max = MAX_STROKE_POINTS,
): [number, number][] {
  if (points.length <= max) return points
  const step = (points.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)] as [number, number])
}

/** A finished stroke, or null when it was only a tap. */
export function finishStroke(points: [number, number][]): AnnotationStroke | null {
  return points.length >= 2 ? { kind: 'draw', points: thinStroke(points) } : null
}

export interface Segment {
  left: number
  top: number
  length: number
  angle: number
}

/**
 * A stroke as straight segments in pixels, each centered on its midpoint and
 * rotated into place, for drawing with plain views.
 */
export function strokeSegments(
  points: [number, number][],
  size: { width: number; height: number },
): Segment[] {
  const segments: Segment[] = []
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1] as [number, number]
    const [bx, by] = points[i] as [number, number]
    const x1 = ax * size.width
    const y1 = ay * size.height
    const x2 = bx * size.width
    const y2 = by * size.height
    const length = Math.hypot(x2 - x1, y2 - y1)
    segments.push({
      left: (x1 + x2) / 2 - length / 2,
      top: (y1 + y2) / 2,
      length,
      angle: Math.atan2(y2 - y1, x2 - x1),
    })
  }
  return segments
}
