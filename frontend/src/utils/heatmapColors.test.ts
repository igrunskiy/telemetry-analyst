import { describe, it, expect } from 'vitest'
import {
  lerpColor,
  percentileSymmetricRange,
  buildSegments,
  N_BINS,
} from './heatmapColors'

// ---------------------------------------------------------------------------
// lerpColor
// ---------------------------------------------------------------------------

describe('lerpColor', () => {
  it('returns red at t=0 (not reversed)', () => {
    const c = lerpColor(0, false)
    expect(c).toBe('rgb(239,68,68)')
  })

  it('returns near-white at t=0.5 (not reversed)', () => {
    const c = lerpColor(0.5, false)
    // Midpoint: r=239, g=68+182=250, b=68+182=250
    expect(c).toBe('rgb(239,250,250)')
  })

  it('returns green at t=1 (not reversed)', () => {
    const c = lerpColor(1, false)
    // s=1: r=248-214=34, g=250-53=197, b=250-156=94
    expect(c).toBe('rgb(34,197,94)')
  })

  it('returns green at t=0 when reversed', () => {
    // reversed: u = 1-t = 1 → same as t=1 forward
    const c = lerpColor(0, true)
    expect(c).toBe('rgb(34,197,94)')
  })

  it('returns red at t=1 when reversed', () => {
    // reversed: u = 1-1 = 0 → same as t=0 forward
    const c = lerpColor(1, true)
    expect(c).toBe('rgb(239,68,68)')
  })

  it('clamps t below 0 to 0', () => {
    expect(lerpColor(-0.5, false)).toBe(lerpColor(0, false))
  })

  it('clamps t above 1 to 1', () => {
    expect(lerpColor(1.5, false)).toBe(lerpColor(1, false))
  })

  it('returns valid rgb string format', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const c = lerpColor(t, false)
      expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
    }
  })

  it('red-side channels are in [0,255]', () => {
    for (let t = 0; t <= 0.5; t += 0.1) {
      const [r, g, b] = lerpColor(t, false)
        .slice(4, -1)
        .split(',')
        .map(Number)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(255)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(255)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(255)
    }
  })

  it('green-side channels are in [0,255]', () => {
    for (let t = 0.5; t <= 1.0; t += 0.1) {
      const [r, g, b] = lerpColor(t, false)
        .slice(4, -1)
        .split(',')
        .map(Number)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(255)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(255)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(255)
    }
  })

  it('is symmetric around 0.5 when reversed flag flips', () => {
    // lerpColor(t, false) should equal lerpColor(1-t, true)
    for (const t of [0.1, 0.3, 0.7, 0.9]) {
      expect(lerpColor(t, false)).toBe(lerpColor(1 - t, true))
    }
  })
})

// ---------------------------------------------------------------------------
// percentileSymmetricRange
// ---------------------------------------------------------------------------

describe('percentileSymmetricRange', () => {
  it('returns [-1, 1] for empty array', () => {
    expect(percentileSymmetricRange([])).toEqual({ cmin: -1, cmax: 1 })
  })

  it('cmin === -cmax (symmetric)', () => {
    const data = Array.from({ length: 100 }, (_, i) => i - 50)
    const { cmin, cmax } = percentileSymmetricRange(data)
    expect(cmin).toBe(-cmax)
  })

  it('outliers do not dominate the range', () => {
    // 90 values are ±5, 10 values are ±500 (outliers)
    const data = [
      ...Array(90).fill(0).map((_, i) => i < 45 ? 5 : -5),
      ...Array(10).fill(500),
    ]
    const { cmax } = percentileSymmetricRange(data)
    // P90 of absolute values should be around 5, not 500
    expect(cmax).toBeLessThan(100)
  })

  it('range covers majority of typical values', () => {
    const data = Array.from({ length: 1000 }, (_, i) => (i - 500) / 100) // -5..+5
    const { cmax } = percentileSymmetricRange(data)
    // The range should capture most of the ±5 window
    expect(cmax).toBeGreaterThan(3)
  })

  it('all-zero input returns small non-zero range', () => {
    const { cmin, cmax } = percentileSymmetricRange(Array(100).fill(0))
    expect(cmax).toBeGreaterThan(0)
    expect(cmin).toBeLessThan(0)
  })

  it('single element array', () => {
    const { cmin, cmax } = percentileSymmetricRange([42])
    expect(cmax).toBeGreaterThan(0)
    expect(cmin).toBe(-cmax)
  })
})

// ---------------------------------------------------------------------------
// buildSegments
// ---------------------------------------------------------------------------

describe('buildSegments', () => {
  it('returns empty for empty inputs', () => {
    expect(buildSegments([], [], [], -1, 1, false)).toEqual([])
  })

  it('produces at least one segment for valid input', () => {
    const n = 50
    const lat = Array.from({ length: n }, (_, i) => 51 + i * 0.001)
    const lon = Array.from({ length: n }, (_, i) => -1 + i * 0.001)
    const values = Array.from({ length: n }, (_, i) => (i / n) * 2 - 1) // -1..1
    const segs = buildSegments(lat, lon, values, -1, 1, false)
    expect(segs.length).toBeGreaterThan(0)
  })

  it('each segment has points and a color', () => {
    const n = 40
    const lat = Array.from({ length: n }, (_, i) => 51 + i * 0.001)
    const lon = Array.from({ length: n }, (_, i) => -1 + i * 0.001)
    const values = Array.from({ length: n }, (_, i) => (i / n) * 2 - 1)
    const segs = buildSegments(lat, lon, values, -1, 1, false)
    for (const s of segs) {
      expect(s.points.length).toBeGreaterThanOrEqual(2)
      expect(s.color).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
    }
  })

  it('uses at most N_BINS distinct colors', () => {
    const n = 200
    const lat = Array.from({ length: n }, (_, i) => 51 + i * 0.001)
    const lon = Array.from({ length: n }, () => -1.0)
    const values = Array.from({ length: n }, (_, i) => (i / n) * 2 - 1)
    const segs = buildSegments(lat, lon, values, -1, 1, false)
    const uniqueColors = new Set(segs.map((s) => s.color))
    expect(uniqueColors.size).toBeLessThanOrEqual(N_BINS)
  })

  it('constant value produces a single segment', () => {
    const n = 30
    const lat = Array.from({ length: n }, (_, i) => 51 + i * 0.001)
    const lon = Array.from({ length: n }, () => -1.0)
    const values = Array(n).fill(0.5)
    const segs = buildSegments(lat, lon, values, -1, 1, false)
    expect(segs.length).toBe(1)
  })

  it('adjacent segments share a boundary point (no gap)', () => {
    const n = 60
    const lat = Array.from({ length: n }, (_, i) => 51 + i * 0.001)
    const lon = Array.from({ length: n }, () => -1.0)
    // Alternate between two bins
    const values = Array.from({ length: n }, (_, i) => (i % 20 < 10 ? -0.8 : 0.8))
    const segs = buildSegments(lat, lon, values, -1, 1, false)
    // Verify consecutive segments share a lat/lon point
    for (let i = 1; i < segs.length; i++) {
      const prevLast = segs[i - 1].points[segs[i - 1].points.length - 1]
      const currFirst = segs[i].points[0]
      expect(prevLast[0]).toBeCloseTo(currFirst[0], 10)
      expect(prevLast[1]).toBeCloseTo(currFirst[1], 10)
    }
  })

  it('reversed flag flips the color mapping', () => {
    // A value in the upper half [cmin,cmax] should give green normally, red when reversed
    const lat = [51, 51.01, 51.02]
    const lon = [-1, -1, -1]
    const values = [0.8, 0.8, 0.8]  // near top of range
    const [fwd] = buildSegments(lat, lon, values, -1, 1, false)
    const [rev] = buildSegments(lat, lon, values, -1, 1, true)
    expect(fwd.color).not.toBe(rev.color)
  })

  it('values outside [cmin, cmax] are clamped to bin extremes', () => {
    const lat = [51, 51.01, 51.02]
    const lon = [-1, -1, -1]
    // Value massively outside range
    const values = [9999, 9999, 9999]
    const segs = buildSegments(lat, lon, values, -1, 1, false)
    expect(segs.length).toBe(1)
    // Should be in the last bin (green end)
    expect(segs[0].color).toBe(lerpColor((N_BINS - 0.5) / N_BINS, false))
  })
})
