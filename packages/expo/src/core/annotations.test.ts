import { describe, expect, it } from 'vitest'
import { boxFromDrag } from './annotations.js'

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
