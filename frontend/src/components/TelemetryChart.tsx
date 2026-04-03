import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import Plot from '../lib/plotly'
import type * as Plotly from 'plotly.js'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import type { Corner } from '../types'

interface TelemetryChartProps {
  distances: number[]
  userSpeed: number[]
  refSpeed: number[]
  userThrottle: number[]
  refThrottle: number[]
  userBrake: number[]
  refBrake: number[]
  userGear?: number[]
  refGear?: number[]
  deltaMs: number[]
  corners: Corner[]
  onHoverIndex?: (idx: number | null) => void
  xRange?: [number, number] | null
}

const DARK = {
  paper_bgcolor: '#0f172a',
  plot_bgcolor: '#1e293b',
  gridcolor: 'rgba(148,163,184,0.08)',
  linecolor: 'rgba(148,163,184,0.15)',
  tickfont: { color: '#64748b', size: 10 },
  titlefont: { color: '#94a3b8', size: 11 },
}

const USER_COLOR = '#3b82f6' // blue-500
const REF_COLOR = '#f97316' // orange-500

function cleanGearSeries(values?: number[]): number[] {
  if (!values || values.length === 0) return []

  const cleaned = values.map((value, idx, arr) => {
    if (!Number.isFinite(value)) {
      return idx > 0 ? arr[idx - 1] : 0
    }
    return Math.round(value)
  })

  const clampSingleStepShifts = (input: number[]) => {
    const output = [...input]
    for (let i = 1; i < output.length; i += 1) {
      const jump = output[i] - output[i - 1]
      if (Math.abs(jump) > 1) {
        output[i] = output[i - 1] + (jump > 0 ? 1 : -1)
      }
    }
    return output
  }

  const majorityFilter = (input: number[], radius = 4) => {
    if (input.length < 3) return input
    return input.map((_, idx) => {
      const lo = Math.max(0, idx - radius)
      const hi = Math.min(input.length, idx + radius + 1)
      const counts = new Map<number, number>()
      for (const gear of input.slice(lo, hi)) {
        counts.set(gear, (counts.get(gear) ?? 0) + 1)
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
    })
  }

  if (cleaned.length < 3) return clampSingleStepShifts(cleaned)

  for (let pass = 0; pass < 3; pass += 1) {
    let runStart = 0
    while (runStart < cleaned.length) {
      let runEnd = runStart
      while (runEnd + 1 < cleaned.length && cleaned[runEnd + 1] === cleaned[runStart]) {
        runEnd += 1
      }

      const runLength = runEnd - runStart + 1
      const prevValue = runStart > 0 ? cleaned[runStart - 1] : null
      const nextValue = runEnd + 1 < cleaned.length ? cleaned[runEnd + 1] : null
      const runValue = cleaned[runStart]

      const isShortNoiseRun = runLength <= 4 && prevValue !== null && nextValue !== null
      const surroundingGear = prevValue !== null && nextValue !== null
        ? Math.max(prevValue, nextValue)
        : null
      const neighboursAgree = prevValue !== null && nextValue !== null && Math.abs(prevValue - nextValue) <= 1
      const impossibleLowBlip = (
        isShortNoiseRun
        && surroundingGear !== null
        && surroundingGear >= 3
        && runValue <= Math.min(prevValue!, nextValue!, 1)
        && surroundingGear - runValue >= 2
      )

      if (
        isShortNoiseRun
        && (
          (prevValue === nextValue && runValue !== prevValue)
          || (neighboursAgree && runValue < Math.min(prevValue!, nextValue!) && Math.min(prevValue!, nextValue!) - runValue >= 2)
          || impossibleLowBlip
        )
      ) {
        const replacement = prevValue === nextValue
          ? prevValue
          : Math.round(((prevValue ?? 0) + (nextValue ?? 0)) / 2)
        for (let i = runStart; i <= runEnd; i += 1) {
          cleaned[i] = replacement
        }
      }

      runStart = runEnd + 1
    }
  }

  return clampSingleStepShifts(majorityFilter(clampSingleStepShifts(cleaned)))
}

function cornerShapes(corners: Corner[], yMin: number, yMax: number) {
  return corners.map((c) => ({
    type: 'line' as const,
    x0: c.dist_apex,
    x1: c.dist_apex,
    y0: yMin,
    y1: yMax,
    line: {
      color: 'rgba(251,191,36,0.25)',
      width: 1,
      dash: 'dash' as const,
    },
  }))
}

function cornerAnnotations(corners: Corner[], y: number, yref: 'y' | 'y2' | 'y3' = 'y') {
  return corners.map((c) => ({
    x: c.dist_apex,
    y,
    yref,
    text: `T${c.corner_num}`,
    showarrow: false,
    font: { size: 9, color: '#fbbf24' },
    bgcolor: 'rgba(15,23,42,0.7)',
    borderpad: 1,
    yanchor: 'bottom' as const,
  }))
}

interface SingleChartProps {
  title: string
  yLabel: string
  distances: number[]
  userValues: number[]
  refValues?: number[]
  corners: Corner[]
  isDelta?: boolean
  isStep?: boolean
  height?: number
  onHoverIndex?: (idx: number | null) => void
  hoverIndex?: number | null
  xRange?: [number, number] | null
  onRangeChange?: (range: [number, number] | null) => void
  deltaMode?: 'ahead' | 'lost'
  valueScale?: number
}

export function SingleChart({
  title,
  yLabel,
  distances,
  userValues,
  refValues,
  corners,
  isDelta = false,
  isStep = false,
  height = 180,
  onHoverIndex,
  hoverIndex,
  xRange,
  onRangeChange,
  deltaMode = 'ahead',
  valueScale = 1,
}: SingleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const fullRange: [number, number] = useMemo(() => {
    if (distances.length === 0) return [0, 1]
    const min = distances[0]
    const max = distances[distances.length - 1]
    const span = Math.max(max - min, 1)
    const pad = Math.max(10, span * 0.02)
    return [Math.max(0, min - pad), max + pad]
  }, [distances])
  const fullRangeRef = useRef(fullRange)
  useEffect(() => { fullRangeRef.current = fullRange }, [fullRange[0], fullRange[1]])
  // When isDelta the displayed values are converted to seconds. "ahead" flips the
  // backend sign so positive means user ahead; "lost" preserves backend sign so
  // positive means user behind / time lost.
  const scaledUserValues = useMemo(
    () => userValues.map((value) => value * valueScale),
    [userValues, valueScale],
  )
  const scaledRefValues = useMemo(
    () => refValues?.map((value) => value * valueScale),
    [refValues, valueScale],
  )
  const displayValues = isDelta
    ? userValues.map((v) => (deltaMode === 'ahead' ? -v : v) / 1000)
    : scaledUserValues
  const yMin = useMemo(
    () =>
      Math.min(
        ...displayValues,
        ...(scaledRefValues ?? []),
        isDelta ? -0.05 : 0,
      ),
    [displayValues, scaledRefValues, isDelta],
  )
  const yMax = useMemo(
    () =>
      Math.max(
        ...displayValues,
        ...(scaledRefValues ?? []),
        isDelta ? 0.05 : 1,
      ),
    [displayValues, scaledRefValues, isDelta],
  )

  const shapes = useMemo(
    () => cornerShapes(corners, yMin, yMax),
    [corners, yMin, yMax],
  )

  const hoverLineShape = useMemo(() => {
    if (hoverIndex == null || hoverIndex < 0 || hoverIndex >= distances.length) return []
    const x = distances[hoverIndex]
    if (!Number.isFinite(x)) return []
    return [{
      type: 'line' as const,
      x0: x,
      x1: x,
      y0: yMin,
      y1: yMax,
      line: { color: 'rgba(226,232,240,0.65)', width: 1 },
    }]
  }, [hoverIndex, distances, yMin, yMax])

  const annotations = useMemo(
    () => cornerAnnotations(corners, yMin),
    [corners, yMin],
  )

  const traces: Plotly.Data[] = useMemo(() => {
    if (isDelta) {
      // Backend delta_ms: positive = user slower (behind). "ahead" flips so + = user ahead.
      // "lost" preserves the sign so + = time lost / behind.
      const corrected = userValues.map((v) => (deltaMode === 'ahead' ? -v : v) / 1000)
      const posY = corrected.map((v) => (v >= 0 ? v : 0))
      const negY = corrected.map((v) => (v < 0 ? v : 0))
      const positiveLabel = deltaMode === 'ahead' ? 'You ahead' : 'Time lost'
      const negativeLabel = deltaMode === 'ahead' ? 'You behind' : 'Time gained'
      const positiveFill = deltaMode === 'ahead' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'
      const positiveLine = deltaMode === 'ahead' ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'
      const negativeFill = deltaMode === 'ahead' ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.25)'
      const negativeLine = deltaMode === 'ahead' ? 'rgba(239,68,68,0.6)' : 'rgba(34,197,94,0.6)'

      return [
        {
          type: 'scatter',
          mode: 'lines',
          x: distances,
          y: posY,
          fill: 'tozeroy',
          fillcolor: positiveFill,
          line: { color: positiveLine, width: 1 },
          name: positiveLabel,
          showlegend: false,
          hovertemplate: `%{y:.2f} s<extra>${positiveLabel}</extra>`,
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: distances,
          y: negY,
          fill: 'tozeroy',
          fillcolor: negativeFill,
          line: { color: negativeLine, width: 1 },
          name: negativeLabel,
          showlegend: false,
          hovertemplate: `%{y:.2f} s<extra>${negativeLabel}</extra>`,
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: distances,
          y: corrected,
          line: { color: '#94a3b8', width: 1 },
          name: 'Delta',
          showlegend: false,
          hovertemplate: '%{y:.2f} s<extra>Delta</extra>',
        },
      ]
    }

    const result: Plotly.Data[] = [
      {
        type: 'scatter',
        mode: 'lines',
        x: distances,
        y: scaledUserValues,
        name: 'You',
        line: { color: USER_COLOR, width: 1.5, shape: isStep ? 'hv' : 'linear' },
        hovertemplate: isStep ? `%{y:.0f}<extra>You</extra>` : `%{y:.1f}<extra>You</extra>`,
      },
    ]

    if (scaledRefValues) {
      result.push({
        type: 'scatter',
        mode: 'lines',
        x: distances,
        y: scaledRefValues,
        name: 'Reference',
        line: { color: REF_COLOR, width: 1.5, shape: isStep ? 'hv' : 'linear' },
        hovertemplate: isStep ? `%{y:.0f}<extra>Reference</extra>` : `%{y:.1f}<extra>Reference</extra>`,
      })
    }

    return result
  }, [distances, userValues, scaledUserValues, scaledRefValues, isDelta, isStep, deltaMode])

  return (
    <div ref={containerRef}>
      <div className="flex items-center gap-2 px-2 pt-2 pb-0">
        <span className="text-slate-400 text-xs font-medium">{title}</span>
        {!isDelta && (
          <div className="flex items-center gap-3 ml-auto text-xs">
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-5 h-0.5 rounded"
                style={{ backgroundColor: USER_COLOR }}
              />
              <span className="text-slate-500">You</span>
            </span>
            {refValues && (
              <span className="flex items-center gap-1">
                <span
                  className="inline-block w-5 h-0.5 rounded"
                  style={{ backgroundColor: REF_COLOR }}
                />
                <span className="text-slate-500">Reference</span>
              </span>
            )}
          </div>
        )}
      </div>
      <Plot
        data={traces}
        layout={{
          paper_bgcolor: DARK.paper_bgcolor,
          plot_bgcolor: DARK.plot_bgcolor,
          autosize: true,
          height,
          dragmode: 'zoom',
          uirevision: xRange ? `${xRange[0].toFixed(1)}-${xRange[1].toFixed(1)}` : 'full',
          margin: { t: 4, r: 12, b: 28, l: 48 },
          xaxis: {
            title: { text: '', font: DARK.titlefont },
            gridcolor: DARK.gridcolor,
            linecolor: DARK.linecolor,
            tickfont: DARK.tickfont,
            range: xRange ?? (distances.length > 0 ? [distances[0], distances[distances.length - 1]] : undefined),
            ticksuffix: ' m',
            tickformat: 'd',
          },
          yaxis: {
            title: { text: yLabel, font: DARK.titlefont },
            gridcolor: DARK.gridcolor,
            linecolor: DARK.linecolor,
            tickfont: DARK.tickfont,
            range: [yMin, yMax],
          },
          shapes: [...shapes, ...hoverLineShape],
          annotations,
          showlegend: false,
          hovermode: 'x unified',
        }}
        onHover={(e) => onHoverIndex?.(e.points[0]?.pointIndex ?? null)}
        onUnhover={() => onHoverIndex?.(null)}
        onRelayout={(e) => {
          const ev = e as Record<string, number | boolean | undefined>
          const lo = ev['xaxis.range[0]']
          const hi = ev['xaxis.range[1]']
          if (typeof lo === 'number' && typeof hi === 'number') {
            onRangeChange?.([lo, hi])
          } else if (ev['xaxis.autorange'] === true) {
            onRangeChange?.(null)
          }
        }}
        config={{ responsive: true, displayModeBar: false, scrollZoom: true }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  )
}

export default function TelemetryChart({
  distances,
  userSpeed,
  refSpeed,
  userThrottle,
  refThrottle,
  userBrake,
  refBrake,
  userGear,
  refGear,
  deltaMs,
  corners,
  onHoverIndex,
  xRange,
}: TelemetryChartProps) {
  const cleanedUserGear = useMemo(() => cleanGearSeries(userGear), [userGear])
  const cleanedRefGear = useMemo(() => cleanGearSeries(refGear), [refGear])
  const fullRange: [number, number] = distances.length > 0
    ? [distances[0], distances[distances.length - 1]]
    : [0, 1]

  const [controlledRange, setControlledRange] = useState<[number, number] | null>(xRange ?? null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  // Sync with external xRange (sector filter) changes
  useEffect(() => {
    setControlledRange(xRange ?? null)
  }, [xRange])

  // Receives pan/scroll zoom events from any SingleChart; value-equality check breaks feedback loops
  const handleRangeChange = useCallback((range: [number, number] | null) => {
    setControlledRange((prev) => {
      if (!prev && !range) return prev
      if (prev && range &&
        Math.abs(prev[0] - range[0]) < 0.5 &&
        Math.abs(prev[1] - range[1]) < 0.5) return prev
      return range
    })
  }, [])

  const effectiveRange = controlledRange ?? fullRange

  const handleZoomIn = () => {
    const [lo, hi] = effectiveRange
    const center = (lo + hi) / 2
    const halfSpan = (hi - lo) / 2 * 0.65
    setControlledRange([center - halfSpan, center + halfSpan])
  }

  const handleZoomOut = () => {
    const [lo, hi] = effectiveRange
    const center = (lo + hi) / 2
    const halfSpan = (hi - lo) / 2 / 0.65
    setControlledRange([
      Math.max(fullRange[0], center - halfSpan),
      Math.min(fullRange[1], center + halfSpan),
    ])
  }

  const handleReset = () => {
    setControlledRange(xRange ?? null)
  }

  if (distances.length === 0) {
    return (
      <div className="card py-16 text-center">
        <p className="text-slate-400">No telemetry data available.</p>
      </div>
    )
  }

  const sharedProps = {
    distances,
    corners,
    onHoverIndex: (idx: number | null) => {
      setHoveredIndex(idx)
      onHoverIndex?.(idx)
    },
    hoverIndex: hoveredIndex,
    xRange: controlledRange,
    onRangeChange: handleRangeChange,
  }

  return (
    <div className="card p-0 overflow-hidden divide-y divide-slate-700/50">
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <div>
          <h3 className="text-white font-medium text-sm">Telemetry Traces</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            Left-drag to zoom · scroll to zoom · double-click to reset
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleZoomIn}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleReset}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            title="Reset zoom"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <SingleChart
        title="Speed"
        yLabel="km/h"
        userValues={userSpeed}
        refValues={refSpeed}
        height={180}
        {...sharedProps}
      />

      <SingleChart
        title="Throttle"
        yLabel="%"
        userValues={userThrottle}
        refValues={refThrottle}
        height={150}
        valueScale={100}
        {...sharedProps}
      />

      <SingleChart
        title="Brake"
        yLabel="%"
        userValues={userBrake}
        refValues={refBrake}
        height={150}
        valueScale={100}
        {...sharedProps}
      />

      {cleanedUserGear.length > 0 && (
        <SingleChart
          title="Gear"
          yLabel="gear"
          userValues={cleanedUserGear}
          refValues={cleanedRefGear.length > 0 ? cleanedRefGear : undefined}
          isStep
          height={120}
          {...sharedProps}
        />
      )}

      <SingleChart
        title="Delta Time (+ = you ahead)"
        yLabel="s"
        userValues={deltaMs}
        isDelta
        deltaMode="ahead"
        height={150}
        {...sharedProps}
      />
    </div>
  )
}
