import { useMemo, useState } from 'react'
import Plot from '../lib/plotly'
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
  refBrake?: number[]
  userThrottle: number[]
  refThrottle?: number[]
  userGear?: number[]
  refGear?: number[]
  issueType?: string
  issueText?: string
  onHoverIndex?: (globalIdx: number | null) => void
}

const DARK_BG = '#0f172a'
const USER_COLOR = '#3b82f6'
const REF_COLOR = '#f97316'
const PAD_M = 100 // metres padding around corner bounds

// Map issue_type to which telemetry channel to show
function resolveChartChannel(issueType?: string, issueText?: string): 'speed' | 'brake' | 'throttle' | 'gear' {
  const issue = `${issueType ?? ''} ${issueText ?? ''}`.toLowerCase()
  if (issue === 'braking_point' || issue.includes('brake')) return 'brake'
  if (issue === 'throttle_pickup' || issue.includes('throttle') || issue.includes('exit')) return 'throttle'
  if (issue.includes('gear') || issue.includes('shift')) return 'gear'
  return 'speed'
}

const CHANNEL_LABELS: Record<string, { unit: string; title: string }> = {
  speed: { unit: 'km/h', title: 'Speed' },
  brake: { unit: '%', title: 'Brake' },
  throttle: { unit: '%', title: 'Throttle' },
  gear: { unit: '', title: 'Gear' },
}

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
  refBrake,
  userThrottle,
  refThrottle,
  userGear,
  refGear,
  issueType,
  issueText,
  onHoverIndex,
}: CornerSnippetProps) {
  const [hoveredLocalIndex, setHoveredLocalIndex] = useState<number | null>(null)
  const secondaryChannel = resolveChartChannel(issueType, issueText)
  const hasGearData = (userGear?.length ?? 0) > 0
  const hasBrakeData = userBrake.length > 0
  const hasThrottleData = userThrottle.length > 0
  const secondarySupported =
    secondaryChannel === 'gear' ? hasGearData
    : secondaryChannel === 'brake' ? hasBrakeData
    : secondaryChannel === 'throttle' ? hasThrottleData
    : false

  const chartChannels: Array<'speed' | 'brake' | 'throttle' | 'gear'> = secondaryChannel === 'speed' || !secondarySupported
    ? ['speed']
    : ['speed', secondaryChannel]
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

  // Braking point: first index where brake >= 0.01 (0–1 scale) before apex
  const brakingIdx = useMemo(() => {
    for (let i = startIdx; i <= apexIdx; i++) {
      if ((userBrake[i] ?? 0) >= 0.01) return i
    }
    return null
  }, [startIdx, apexIdx, userBrake])

  // Throttle point: first index after apex where throttle >= 0.01 (0–1 scale)
  const throttleIdx = useMemo(() => {
    for (let i = apexIdx; i <= endIdx; i++) {
      if ((userThrottle[i] ?? 0) >= 0.01) return i
    }
    return null
  }, [apexIdx, endIdx, userThrottle])

  // Chart data — always show speed, plus a second issue-relevant channel when useful
  const slicedDist = distances.slice(startIdx, endIdx + 1)

  const getChannelSeries = (channel: 'speed' | 'brake' | 'throttle' | 'gear') => {
    if (channel === 'brake') {
      return {
        slicedUser: userBrake.slice(startIdx, endIdx + 1).map((v) => v * 100),
        slicedRef: (refBrake ?? userBrake).slice(startIdx, endIdx + 1).map((v) => v * 100),
      }
    }
    if (channel === 'throttle') {
      return {
        slicedUser: userThrottle.slice(startIdx, endIdx + 1).map((v) => v * 100),
        slicedRef: (refThrottle ?? userThrottle).slice(startIdx, endIdx + 1).map((v) => v * 100),
      }
    }
    if (channel === 'gear') {
      return {
        slicedUser: (userGear ?? []).slice(startIdx, endIdx + 1).map((v) => Math.round(v ?? 0)),
        slicedRef: (refGear ?? userGear ?? []).slice(startIdx, endIdx + 1).map((v) => Math.round(v ?? 0)),
      }
    }
    return {
      slicedUser: userSpeed.slice(startIdx, endIdx + 1),
      slicedRef: refSpeed.slice(startIdx, endIdx + 1),
    }
  }

  const { chartShapes } = useMemo(() => {
    const speedSeries = getChannelSeries('speed')
    const allVals = [...speedSeries.slicedUser, ...speedSeries.slicedRef]
    const lo = Math.min(...allVals) * 0.95
    const hi = Math.max(...allVals) * 1.05
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

    return { chartShapes: shapes }
  }, [distances, brakingIdx, apexIdx, throttleIdx, startIdx, endIdx, userSpeed, refSpeed])

  const xRange = [
    Math.max(0, corner.dist_start - PAD_M),
    Math.min(distances.length > 0 ? distances[distances.length - 1] : Infinity, corner.dist_end + PAD_M),
  ]

  return (
    <div className="rounded-lg overflow-hidden bg-slate-900/60 border border-slate-700/40">
      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-slate-700/40">
        <span className="text-amber-400 font-mono text-xs font-bold">T{corner.corner_num}</span>
        {corner.label && (
          <span className="text-slate-400 text-xs">{corner.label}</span>
        )}
        <div className="flex items-center gap-1 flex-wrap">
          {chartChannels.map((channel) => (
            <span key={channel} className="text-[10px] uppercase tracking-wide text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded">
              {CHANNEL_LABELS[channel].title}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 ml-auto text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 inline-block" style={{ backgroundColor: USER_COLOR }} />
            <span className="text-slate-500">You</span>
          </span>
          {refSpeed.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span
                className="w-5 h-0.5 inline-block"
                style={{ backgroundColor: REF_COLOR }}
              />
              <span className="text-slate-500">Ref</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            <span className="text-slate-500">Apex</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {chartChannels.map((channel) => {
          const { slicedUser, slicedRef } = getChannelSeries(channel)
          const channelLabel = CHANNEL_LABELS[channel]
          const allVals = [...slicedUser, ...slicedRef]
          const yMin = Math.min(...allVals) * 0.95
          const yMax = Math.max(...allVals) * 1.05
          const hoverX =
            hoveredLocalIndex != null && hoveredLocalIndex >= 0 && hoveredLocalIndex < slicedDist.length
              ? slicedDist[hoveredLocalIndex]
              : null
          return (
            <Plot
              key={channel}
              data={[
                {
                  type: 'scatter',
                  mode: 'lines',
                  x: slicedDist,
                  y: slicedUser,
                  line: { color: USER_COLOR, width: 1 },
                  showlegend: false,
                  hovertemplate: channel === 'gear'
                    ? '%{y:.0f}<extra>You</extra>'
                    : `%{y:.0f} ${channelLabel.unit}<extra>You</extra>`,
                },
                {
                  type: 'scatter',
                  mode: 'lines',
                  x: slicedDist,
                  y: slicedRef,
                  line: { color: REF_COLOR, width: 1, shape: channel === 'gear' ? 'hv' : 'linear' },
                  showlegend: false,
                  hovertemplate: channel === 'gear'
                    ? '%{y:.0f}<extra>Ref</extra>'
                    : `%{y:.0f} ${channelLabel.unit}<extra>Ref</extra>`,
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
                  title: { text: channelLabel.unit, font: { color: '#475569', size: 9 } },
                  gridcolor: 'rgba(148,163,184,0.08)',
                  zeroline: false,
                  tickfont: { color: '#475569', size: 9 },
                  dtick: channel === 'gear' ? 1 : undefined,
                  range: [yMin, yMax],
                },
                shapes: [
                  ...(channel === 'speed' ? chartShapes : []),
                  ...(hoverX != null ? [{
                    type: 'line' as const,
                    x0: hoverX,
                    x1: hoverX,
                    y0: yMin,
                    y1: yMax,
                    line: { color: 'rgba(226,232,240,0.7)', width: 1 },
                  }] : []),
                ],
                showlegend: false,
                hovermode: 'x unified',
              }}
              onHover={(e: Plotly.PlotMouseEvent) => {
                const localIndex = e.points[0]?.pointIndex ?? null
                setHoveredLocalIndex(typeof localIndex === 'number' ? localIndex : null)
                onHoverIndex?.(startIdx + (localIndex ?? 0))
              }}
              onUnhover={() => {
                setHoveredLocalIndex(null)
                onHoverIndex?.(null)
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: '100%' }}
              useResizeHandler
            />
          )
        })}
      </div>
    </div>
  )
}
