import { useMemo } from 'react'
import Plot from 'react-plotly.js'
import type * as Plotly from 'plotly.js'
import type { Corner } from '../types'

interface CornerSnippetProps {
  corner: Corner
  distances: number[]
  userLat?: number[]
  userLon?: number[]
  refLat?: number[]
  refLon?: number[]
  userSpeed: number[]
  refSpeed: number[]
  userBrake: number[]
  userThrottle: number[]
  onHoverIndex?: (globalIdx: number | null) => void
}

const DARK_BG = '#0f172a'
const USER_COLOR = '#3b82f6'
const REF_COLOR = '#f97316'
const PAD_M = 100 // metres padding around corner bounds

export default function CornerSnippet({
  corner,
  distances,
  userLat,
  userLon,
  refLat,
  refLon,
  userSpeed,
  refSpeed,
  userBrake,
  userThrottle,
  onHoverIndex,
}: CornerSnippetProps) {
  // Slice indices for this corner (with padding), distances are in metres
  const { startIdx, endIdx } = useMemo(() => {
    const trackMax = distances.length > 0 ? distances[distances.length - 1] : 1
    const lo = Math.max(0, corner.dist_start - PAD_M)
    const hi = Math.min(trackMax, corner.dist_end + PAD_M)
    let s = 0
    let e = distances.length - 1
    for (let i = 0; i < distances.length; i++) {
      if (distances[i] >= lo) { s = i; break }
    }
    for (let i = distances.length - 1; i >= 0; i--) {
      if (distances[i] <= hi) { e = i; break }
    }
    return { startIdx: s, endIdx: Math.max(s, e) }
  }, [distances, corner])

  // Apex: index of minimum speed in the window
  const apexIdx = useMemo(() => {
    let minSpeed = Infinity
    let idx = startIdx
    for (let i = startIdx; i <= endIdx; i++) {
      if ((userSpeed[i] ?? Infinity) < minSpeed) {
        minSpeed = userSpeed[i]
        idx = i
      }
    }
    return idx
  }, [startIdx, endIdx, userSpeed])

  // Braking point: first index where brake > 5% before apex
  const brakingIdx = useMemo(() => {
    for (let i = startIdx; i <= apexIdx; i++) {
      if ((userBrake[i] ?? 0) > 5) return i
    }
    return null
  }, [startIdx, apexIdx, userBrake])

  // Throttle point: first index after apex where throttle > 5%
  const throttleIdx = useMemo(() => {
    for (let i = apexIdx; i <= endIdx; i++) {
      if ((userThrottle[i] ?? 0) > 5) return i
    }
    return null
  }, [apexIdx, endIdx, userThrottle])

  const hasGps =
    (userLat?.length ?? 0) > endIdx &&
    (userLon?.length ?? 0) > endIdx
  const hasRefGps =
    hasGps &&
    (refLat?.length ?? 0) > endIdx &&
    (refLon?.length ?? 0) > endIdx

  // GPS traces
  const gpsTraces = useMemo((): Plotly.Data[] => {
    if (!hasGps || !userLat || !userLon) return []

    const traces: Plotly.Data[] = [
      {
        type: 'scatter',
        mode: 'lines',
        x: userLon.slice(startIdx, endIdx + 1),
        y: userLat.slice(startIdx, endIdx + 1),
        line: { color: USER_COLOR, width: 2 },
        showlegend: false,
        hoverinfo: 'skip',
      },
    ]

    if (hasRefGps && refLat && refLon) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: refLon.slice(startIdx, endIdx + 1),
        y: refLat.slice(startIdx, endIdx + 1),
        line: { color: REF_COLOR, width: 1.5, dash: 'dot' },
        showlegend: false,
        hoverinfo: 'skip',
      })
    }

    // Key point markers — one trace per point type to avoid array type issues
    if (brakingIdx !== null) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: [userLon[brakingIdx]],
        y: [userLat[brakingIdx]],
        text: ['Braking'],
        hovertemplate: '%{text}<extra></extra>',
        marker: { color: '#ef4444', size: 9, symbol: 'circle', line: { color: '#0f172a', width: 1.5 } },
        showlegend: false,
      })
    }

    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: [userLon[apexIdx]],
      y: [userLat[apexIdx]],
      text: ['Apex'],
      hovertemplate: '%{text}<extra></extra>',
      marker: { color: '#fbbf24', size: 10, symbol: 'diamond', line: { color: '#0f172a', width: 1.5 } },
      showlegend: false,
    })

    if (throttleIdx !== null) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: [userLon[throttleIdx]],
        y: [userLat[throttleIdx]],
        text: ['Throttle'],
        hovertemplate: '%{text}<extra></extra>',
        marker: { color: '#22c55e', size: 9, symbol: 'circle', line: { color: '#0f172a', width: 1.5 } },
        showlegend: false,
      })
    }

    return traces
  }, [hasGps, hasRefGps, userLat, userLon, refLat, refLon, startIdx, endIdx, brakingIdx, apexIdx, throttleIdx])

  // Speed mini-chart data
  const slicedDist = distances.slice(startIdx, endIdx + 1)
  const slicedUserSpeed = userSpeed.slice(startIdx, endIdx + 1)
  const slicedRefSpeed = refSpeed.slice(startIdx, endIdx + 1)

  const { speedShapes, yMin, yMax } = useMemo(() => {
    const lo = Math.min(...slicedUserSpeed, ...slicedRefSpeed) * 0.95
    const hi = Math.max(...slicedUserSpeed, ...slicedRefSpeed) * 1.05
    const shapes: Partial<Plotly.Shape>[] = []

    if (brakingIdx !== null) {
      shapes.push({
        type: 'line',
        x0: distances[brakingIdx], x1: distances[brakingIdx],
        y0: lo, y1: hi,
        line: { color: 'rgba(239,68,68,0.5)', width: 1, dash: 'dot' },
      })
    }
    shapes.push({
      type: 'line',
      x0: distances[apexIdx], x1: distances[apexIdx],
      y0: lo, y1: hi,
      line: { color: 'rgba(251,191,36,0.5)', width: 1, dash: 'dot' },
    })
    if (throttleIdx !== null) {
      shapes.push({
        type: 'line',
        x0: distances[throttleIdx], x1: distances[throttleIdx],
        y0: lo, y1: hi,
        line: { color: 'rgba(34,197,94,0.5)', width: 1, dash: 'dot' },
      })
    }

    return { speedShapes: shapes, yMin: lo, yMax: hi }
  }, [distances, brakingIdx, apexIdx, throttleIdx, slicedUserSpeed, slicedRefSpeed])

  const xRange = [
    Math.max(0, corner.dist_start - PAD_M),
    Math.min(distances.length > 0 ? distances[distances.length - 1] : Infinity, corner.dist_end + PAD_M),
  ]

  return (
    <div className="rounded-lg overflow-hidden bg-slate-900/60 border border-slate-700/40">
      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-slate-700/40">
        <span className="text-amber-400 font-mono text-xs font-bold">C{corner.corner_num}</span>
        {corner.label && (
          <span className="text-slate-400 text-xs">{corner.label}</span>
        )}
        <div className="flex items-center gap-3 ml-auto text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 inline-block" style={{ backgroundColor: USER_COLOR }} />
            <span className="text-slate-500">You</span>
          </span>
          {hasRefGps && (
            <span className="flex items-center gap-1.5">
              <span
                className="w-5 h-0.5 inline-block"
                style={{
                  backgroundColor: REF_COLOR,
                  backgroundImage: 'repeating-linear-gradient(90deg,transparent,transparent 3px,#0f172a 3px,#0f172a 5px)',
                }}
              />
              <span className="text-slate-500">Ref</span>
            </span>
          )}
          {brakingIdx !== null && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              <span className="text-slate-500">Brake</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            <span className="text-slate-500">Apex</span>
          </span>
          {throttleIdx !== null && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              <span className="text-slate-500">Throttle</span>
            </span>
          )}
        </div>
      </div>

      {/* GPS map */}
      {hasGps && (
        <Plot
          data={gpsTraces}
          layout={{
            paper_bgcolor: DARK_BG,
            plot_bgcolor: DARK_BG,
            autosize: true,
            height: 200,
            margin: { t: 6, r: 6, b: 6, l: 6 },
            xaxis: {
              showgrid: false,
              zeroline: false,
              showticklabels: false,
              scaleanchor: 'y',
              scaleratio: 1,
            },
            yaxis: {
              showgrid: false,
              zeroline: false,
              showticklabels: false,
            },
            showlegend: false,
            hovermode: 'closest',
          }}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: '100%' }}
          useResizeHandler
        />
      )}

      {/* Speed mini chart */}
      <Plot
        data={[
          {
            type: 'scatter',
            mode: 'lines',
            x: slicedDist,
            y: slicedUserSpeed,
            line: { color: USER_COLOR, width: 1 },
            showlegend: false,
            hovertemplate: '%{y:.0f} km/h<extra>You</extra>',
          },
          {
            type: 'scatter',
            mode: 'lines',
            x: slicedDist,
            y: slicedRefSpeed,
            line: { color: REF_COLOR, width: 1, dash: 'dot' },
            showlegend: false,
            hovertemplate: '%{y:.0f} km/h<extra>Ref</extra>',
          },
        ]}
        layout={{
          paper_bgcolor: DARK_BG,
          plot_bgcolor: '#1e293b',
          autosize: true,
          height: 110,
          margin: { t: 6, r: 8, b: 22, l: 42 },
          xaxis: {
            showgrid: false,
            zeroline: false,
            tickfont: { color: '#475569', size: 9 },
            ticksuffix: ' m',
            tickformat: 'd',
            range: xRange,
          },
          yaxis: {
            title: { text: 'km/h', font: { color: '#475569', size: 9 } },
            gridcolor: 'rgba(148,163,184,0.08)',
            zeroline: false,
            tickfont: { color: '#475569', size: 9 },
            range: [yMin, yMax],
          },
          shapes: speedShapes,
          showlegend: false,
          hovermode: 'x unified',
        }}
        onHover={(e: Plotly.PlotMouseEvent) => onHoverIndex?.(startIdx + (e.points[0]?.pointIndex ?? 0))}
        onUnhover={() => onHoverIndex?.(null)}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  )
}
