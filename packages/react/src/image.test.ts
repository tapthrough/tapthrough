import { describe, expect, it } from 'vitest'
import { base64Of, canCaptureTab, fitWithin } from './image.js'

describe('fitWithin', () => {
  it('scales the longest side down and keeps the shape', () => {
    expect(fitWithin(3200, 1800)).toEqual({ width: 1600, height: 900 })
    expect(fitWithin(1000, 4000)).toEqual({ width: 400, height: 1600 })
  })

  it('never enlarges, and never returns a zero side', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(20000, 3)).toEqual({ width: 1600, height: 1 })
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 })
  })
})

describe('base64Of', () => {
  it('takes the data out of a data URL', () => {
    expect(base64Of('data:image/jpeg;base64,/9j/4AAQ')).toBe('/9j/4AAQ')
  })
})

describe('canCaptureTab', () => {
  it('is false where the browser has no screen capture', () => {
    expect(canCaptureTab({} as Navigator)).toBe(false)
    expect(
      canCaptureTab({
        mediaDevices: { getDisplayMedia: async () => ({}) },
      } as unknown as Navigator),
    ).toBe(true)
  })
})
