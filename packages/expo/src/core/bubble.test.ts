import { describe, expect, it } from 'vitest'
import { type Bounds, defaultPosition, isTap, snapToEdge } from './bubble.js'

const bounds: Bounds = { width: 400, height: 800, insetTop: 50, insetBottom: 30 }

describe('snapToEdge', () => {
  it('snaps to the nearer side', () => {
    expect(snapToEdge({ x: 100, y: 300 }, bounds).x).toBe(8)
    expect(snapToEdge({ x: 260, y: 300 }, bounds).x).toBe(400 - 48 - 8)
  })

  it('keeps the bubble clear of the status bar and home indicator', () => {
    expect(snapToEdge({ x: 0, y: -40 }, bounds).y).toBe(50)
    expect(snapToEdge({ x: 0, y: 900 }, bounds).y).toBe(800 - 30 - 48)
  })

  it('stays on screen when the window is too short for the insets', () => {
    expect(snapToEdge({ x: 0, y: 10 }, { ...bounds, height: 100 }).y).toBe(50)
  })
})

describe('defaultPosition', () => {
  it('starts on the right edge above the bottom', () => {
    expect(defaultPosition(bounds)).toEqual({ x: 344, y: 800 - 30 - 48 - 96 })
  })
})

describe('isTap', () => {
  it('treats small movements as taps', () => {
    expect(isTap(3, -4)).toBe(true)
    expect(isTap(0, 12)).toBe(false)
  })
})
