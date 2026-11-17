import { describe, expect, it } from 'vitest'
import {
  addStrokePoint,
  boxFromDrag,
  finishStroke,
  MAX_STROKE_POINTS,
  strokeSegments,
} from './annotations.js'

const size = { width: 200, height: 400 }

describe('boxFromDrag', () => {
  it('normalizes a drag to fractions of the image', () => {
    expect(boxFromDrag('highlight', { x: 20, y: 40 }, { x: 120, y: 240 }, size)).toEqual({
      kind: 'highlight',
      x: 0.1,
      y: 0.1,
      w: 0.5,
      h: 0.5,
    })
  })

  it('works when dragging up and to the left', () => {
    expect(boxFromDrag('blur', { x: 120, y: 240 }, { x: 20, y: 40 }, size)).toMatchObject({
      x: 0.1,
      y: 0.1,
      w: 0.5,
      h: 0.5,
    })
  })

  it('clamps drags that leave the image', () => {
    expect(boxFromDrag('blur', { x: 150, y: 300 }, { x: 999, y: 999 }, size)).toEqual({
      kind: 'blur',
      x: 0.75,
      y: 0.75,
      w: 0.25,
      h: 0.25,
    })
  })

  it('ignores taps and slivers', () => {
    expect(boxFromDrag('highlight', { x: 50, y: 50 }, { x: 52, y: 200 }, size)).toBeNull()
    expect(boxFromDrag('highlight', { x: 50, y: 50 }, { x: 50, y: 50 }, size)).toBeNull()
    expect(
      boxFromDrag('highlight', { x: 0, y: 0 }, { x: 10, y: 10 }, { width: 0, height: 0 }),
    ).toBeNull()
  })
})

describe('strokes', () => {
  const area = { width: 200, height: 400 }

  it('adds points in fractions and skips ones too close to the last', () => {
    let points = addStrokePoint([], { x: 20, y: 40 }, area)
    expect(points).toEqual([[0.1, 0.1]])
    const same = addStrokePoint(points, { x: 20.2, y: 40.2 }, area)
    expect(same).toBe(points)
    points = addStrokePoint(points, { x: 100, y: 40 }, area)
    expect(points).toEqual([
      [0.1, 0.1],
      [0.5, 0.1],
    ])
  })

  it('clamps to the image', () => {
    expect(addStrokePoint([], { x: -10, y: 900 }, area)).toEqual([[0, 1]])
  })

  it('treats a tap as nothing and thins long strokes', () => {
    expect(finishStroke([[0.1, 0.1]])).toBeNull()
    const long = Array.from({ length: 500 }, (_, i) => [i / 500, 0.5] as [number, number])
    const stroke = finishStroke(long)
    expect(stroke?.points).toHaveLength(MAX_STROKE_POINTS)
    expect(stroke?.points[0]).toEqual([0, 0.5])
    expect(stroke?.points.at(-1)).toEqual([499 / 500, 0.5])
  })

  it('turns a stroke into rotated segments', () => {
    const [segment] = strokeSegments(
      [
        [0, 0],
        [0.5, 0.25],
      ],
      area,
    )
    expect(segment?.length).toBeCloseTo(Math.hypot(100, 100))
    expect(segment?.angle).toBeCloseTo(Math.PI / 4)
    expect(segment?.top).toBeCloseTo(50)
  })
})
