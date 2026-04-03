/**
 * Pure colour-mapping utilities used by HeatMap.
 * Extracted so they can be unit-tested without a DOM or React environment.
 */

/** Number of discrete colour bins used for GPS polyline segmentation. */
export const N_BINS = 16

/**
 * Map t ∈ [0, 1] to a diverging CSS rgb string:
 *   0   → red   (rgb(239,68,68))
 *   0.5 → near-white (rgb(248,250,250))
 *   1   → green (rgb(34,197,94))
 *
 * When `reversed` is true the scale is flipped so 0→green and 1→red.
 */
export function lerpColor(t: number, reversed: boolean): string {
  const u = reversed
    ? 1 - Math.max(0, Math.min(1, t))
    : Math.max(0, Math.min(1, t))

  if (u <= 0.5) {
    const s = u * 2
    // red → white: r stays 239, g/b ramp from 68 → 250
    return `rgb(239,${Math.round(68 + 182 * s)},${Math.round(68 + 182 * s)})`
  }
  const s = (u - 0.5) * 2
  // white → green: r ramps 248→34, g ramps 250→197, b ramps 250→94
  return `rgb(${Math.round(248 - 214 * s)},${Math.round(250 - 53 * s)},${Math.round(250 - 156 * s)})`
}

/**
 * Compute symmetric [cmin, cmax] clipped at the 90th-percentile of absolute
 * values in `data`. This keeps the colour scale sensitive to typical
 * differences while extreme outliers simply saturate to the end colour.
 *
 * Returns [-1, 1] for empty or all-zero input.
 */
export function percentileSymmetricRange(data: number[]): { cmin: number; cmax: number } {
  if (data.length === 0) return { cmin: -1, cmax: 1 }
  const sorted = [...data].map(Math.abs).sort((a, b) => a - b)
  const p90idx = Math.floor((sorted.length - 1) * 0.9)
  const maxAbs = Math.max(sorted[p90idx], 1e-6)
  return { cmin: -maxAbs, cmax: maxAbs }
}

export interface ColorSegment {
  points: [number, number][]
  color: string
  startIndex: number
  endIndex: number
}

/**
 * Split a GPS track into runs sharing the same colour bin.
 * Adjacent segments share their boundary point so the polyline is seamless.
 */
export function buildSegments(
  lat: number[],
  lon: number[],
  values: number[],
  cmin: number,
  cmax: number,
  reversed: boolean,
): ColorSegment[] {
  if (lat.length === 0) return []
  const range = Math.max(cmax - cmin, 1e-6)
  const result: ColorSegment[] = []
  let curBin = -1
  let curSeg: [number, number][] = []
  let curStartIndex = 0

  for (let i = 0; i < lat.length; i++) {
    const t = (values[i] - cmin) / range
    const binIdx = Math.min(N_BINS - 1, Math.max(0, Math.floor(Math.max(0, Math.min(1, t)) * N_BINS)))

    if (binIdx !== curBin) {
      if (curSeg.length >= 2) {
        result.push({
          points: curSeg,
          color: lerpColor((curBin + 0.5) / N_BINS, reversed),
          startIndex: curStartIndex,
          endIndex: i - 1,
        })
      }
      curSeg = curSeg.length > 0 ? [curSeg[curSeg.length - 1]] : []
      curBin = binIdx
      curStartIndex = Math.max(0, i - 1)
    }
    curSeg.push([lat[i], lon[i]])
  }

  if (curSeg.length >= 2) {
    result.push({
      points: curSeg,
      color: lerpColor((curBin + 0.5) / N_BINS, reversed),
      startIndex: curStartIndex,
      endIndex: lat.length - 1,
    })
  }
  return result
}
