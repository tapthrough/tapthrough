export interface Point {
  x: number
  y: number
}

export interface Bounds {
  width: number
  height: number
  /** Space kept clear at the top and bottom, for the status bar and home indicator. */
  insetTop: number
  insetBottom: number
}

export const BUBBLE_SIZE = 48
export const EDGE_MARGIN = 8
/** Movement under this many points counts as a tap, not a drag. */
export const TAP_SLOP = 6

function clampY(y: number, bounds: Bounds, size: number) {
  const min = bounds.insetTop
  const max = bounds.height - bounds.insetBottom - size
  return Math.min(Math.max(y, min), Math.max(min, max))
}

/** Where the bubble rests after a drag: the nearer side edge, kept on screen. */
export function snapToEdge(point: Point, bounds: Bounds, size = BUBBLE_SIZE): Point {
  const left = point.x + size / 2 < bounds.width / 2
  return {
    x: left ? EDGE_MARGIN : bounds.width - size - EDGE_MARGIN,
    y: clampY(point.y, bounds, size),
  }
}

/** Starts on the right edge, a little above the bottom, clear of most tab bars. */
export function defaultPosition(bounds: Bounds, size = BUBBLE_SIZE): Point {
  return snapToEdge(
    { x: bounds.width, y: bounds.height - bounds.insetBottom - size - 96 },
    bounds,
    size,
  )
}

export function isTap(dx: number, dy: number) {
  return Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP
}
