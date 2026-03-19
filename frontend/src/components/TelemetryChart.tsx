import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import Plot from 'react-plotly.js'
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
    text: `C${c.corner_num}`,
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
  height?: number
  onHoverIndex?: (idx: number | null) => void
  xRange?: [number, number] | null
  onRangeChange?: (range: [number, number] | null) => void
}

function SingleChart({
  title,
  yLabel,
  distances,
  userValues,
  refValues,
  corners,
  isDelta = false,
  height = 180,
  onHoverIndex,
  xRange,
  onRangeChange,
}: SingleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const panState = useRef<{ startX: number; startRange: [number, number]; ppu: number } | null>(null)
  const rafRef = useRef<number | null>(null)

  const fullRange: [number, number] = distances.length > 0
    ? [distances[0], distances[distances.length - 1]]
    : [0, 1]
  const fullRangeRef = useRef(fullRange)
  useEffect(() => { fullRangeRef.current = fullRange }, [fullRange[0], fullRange[1]])

  // Right-click drag → pan
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    type PlotlyDiv = HTMLElement & { _fullLayout?: { xaxis: { range: number[]; _length: number } } }
    const getPlotDiv = (): PlotlyDiv | null => container.querySelector('.js-plotly-plot')

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return
      e.preventDefault()
      e.stopPropagation() // prevent Plotly from handling right-click
      const pd = getPlotDiv()
      if (!pd?._fullLayout?.xaxis) return
      const xa = pd._fullLayout.xaxis
      panState.current = {
        startX: e.clientX,
        startRange: [xa.range[0], xa.range[1]],
        ppu: xa._length / (xa.range[1] - xa.range[0]),
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      const ps = panState.current
      if (!ps) return
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const deltaData = -(e.clientX - ps.startX) / ps.ppu
        const span = ps.startRange[1] - ps.startRange[0]
        const [flo, fhi] = fullRangeRef.current
        let lo = ps.startRange[0] + deltaData
        let hi = ps.startRange[1] + deltaData
        if (lo < flo) { lo = flo; hi = lo + span }
        if (hi > fhi) { hi = fhi; lo = hi - span }
        onRangeChange?.([lo, hi])
      })
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) panState.current = null
    }

    const onContextMenu = (e: Event) => e.preventDefault()

    // Capture phase so we run before Plotly's internal handlers
    container.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    container.addEventListener('contextmenu', onContextMenu, true)

    return () => {
      container.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      container.removeEventListener('contextmenu', onContextMenu, true)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [onRangeChange])
  const yMin = useMemo(
    () =>
      Math.min(
        ...userValues,
        ...(refValues ?? []),
        isDelta ? -50 : 0,
      ),
    [userValues, refValues, isDelta],
  )
  const yMax = useMemo(
    () =>
      Math.max(
        ...userValues,
        ...(refValues ?? []),
        isDelta ? 50 : 1,
      ),
    [userValues, refValues, isDelta],
  )

  const shapes = useMemo(
    () => cornerShapes(corners, yMin, yMax),
    [corners, yMin, yMax],
  )

  const annotations = useMemo(
    () => cornerAnnotations(corners, yMin),
    [corners, yMin],
  )

  const traces: Plotly.Data[] = useMemo(() => {
    if (isDelta) {
      // Delta: split into green (user ahead) and red (user behind) filled areas
      const posY = userValues.map((v) => (v >= 0 ? v : 0))
      const negY = userValues.map((v) => (v < 0 ? v : 0))

      return [
        {
          type: 'scatter',
          mode: 'lines',
          x: distances,
          y: posY,
          fill: 'tozeroy',
          fillcolor: 'rgba(34,197,94,0.25)',
          line: { color: 'rgba(34,197,94,0.6)', width: 1 },
          name: 'User ahead',
          showlegend: false,
          hovertemplate: '%{y:.0f} ms<extra>User ahead</extra>',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: distances,
          y: negY,
          fill: 'tozeroy',
          fillcolor: 'rgba(239,68,68,0.25)',
          line: { color: 'rgba(239,68,68,0.6)', width: 1 },
          name: 'User behind',
          showlegend: false,
          hovertemplate: '%{y:.0f} ms<extra>User behind</extra>',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: distances,
          y: userValues,
          line: { color: '#94a3b8', width: 1 },
          name: 'Delta',
          showlegend: false,
          hovertemplate: '%{y:.0f} ms<extra>Delta</extra>',
        },
      ]
    }

    const result: Plotly.Data[] = [
      {
        type: 'scatter',
        mode: 'lines',
        x: distances,
        y: userValues,
        name: 'You',
        line: { color: USER_COLOR, width: 1 },
        hovertemplate: `%{y:.1f}<extra>You</extra>`,
      },
    ]

    if (refValues) {
      result.push({
        type: 'scatter',
        mode: 'lines',
        x: distances,
        y: refValues,
        name: 'Reference',
        line: { color: REF_COLOR, width: 1, dash: 'dot' },
        hovertemplate: `%{y:.1f}<extra>Reference</extra>`,
      })
    }

    return result
  }, [distances, userValues, refValues, isDelta])

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
                  style={{
                    backgroundColor: REF_COLOR,
                    backgroundImage:
                      'repeating-linear-gradient(90deg,transparent,transparent 3px,#1e293b 3px,#1e293b 5px)',
                  }}
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
          shapes,
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
  deltaMs,
  corners,
  onHoverIndex,
  xRange,
}: TelemetryChartProps) {
  const fullRange: [number, number] = distances.length > 0
    ? [distances[0], distances[distances.length - 1]]
    : [0, 1]

  const [controlledRange, setControlledRange] = useState<[number, number] | null>(xRange ?? null)

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
    onHoverIndex,
    xRange: controlledRange,
    onRangeChange: handleRangeChange,
  }

  return (
    <div className="card p-0 overflow-hidden divide-y divide-slate-700/50">
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <div>
          <h3 className="text-white font-medium text-sm">Telemetry Traces</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            Left-drag to zoom · right-drag to pan · scroll to zoom · double-click to reset
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
        {...sharedProps}
      />

      <SingleChart
        title="Brake"
        yLabel="%"
        userValues={userBrake}
        refValues={refBrake}
        height={150}
        {...sharedProps}
      />

      <SingleChart
        title="Delta Time (+ = you ahead)"
        yLabel="ms"
        userValues={deltaMs}
        isDelta
        height={150}
        {...sharedProps}
      />
    </div>
  )
}
