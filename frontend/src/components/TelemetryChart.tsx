import { useMemo } from 'react'
import Plot from 'react-plotly.js'
import type * as Plotly from 'plotly.js'
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

function cornerAnnotations(corners: Corner[], y: number, yref = 'y') {
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
}: SingleChartProps) {
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
          line: { color: '#94a3b8', width: 1.5 },
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
        line: { color: USER_COLOR, width: 2 },
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
        line: { color: REF_COLOR, width: 2, dash: 'dot' },
        hovertemplate: `%{y:.1f}<extra>Reference</extra>`,
      })
    }

    return result
  }, [distances, userValues, refValues, isDelta])

  return (
    <div>
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
          margin: { t: 4, r: 12, b: 28, l: 48 },
          xaxis: {
            title: { text: '', font: DARK.titlefont },
            gridcolor: DARK.gridcolor,
            linecolor: DARK.linecolor,
            tickfont: DARK.tickfont,
            range: distances.length > 0 ? [distances[0], distances[distances.length - 1]] : undefined,
            ticksuffix: '%',
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
        config={{ responsive: true, displayModeBar: false }}
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
}: TelemetryChartProps) {
  if (distances.length === 0) {
    return (
      <div className="card py-16 text-center">
        <p className="text-slate-400">No telemetry data available.</p>
      </div>
    )
  }

  return (
    <div className="card p-0 overflow-hidden divide-y divide-slate-700/50">
      <div className="px-4 py-3 border-b border-slate-700/50">
        <h3 className="text-white font-medium text-sm">Telemetry Traces</h3>
        <p className="text-slate-500 text-xs mt-0.5">
          X axis: track distance (%). Corner markers shown as dashed lines.
        </p>
      </div>

      <SingleChart
        title="Speed"
        yLabel="km/h"
        distances={distances}
        userValues={userSpeed}
        refValues={refSpeed}
        corners={corners}
        height={180}
      />

      <SingleChart
        title="Throttle"
        yLabel="%"
        distances={distances}
        userValues={userThrottle}
        refValues={refThrottle}
        corners={corners}
        height={150}
      />

      <SingleChart
        title="Brake"
        yLabel="%"
        distances={distances}
        userValues={userBrake}
        refValues={refBrake}
        corners={corners}
        height={150}
      />

      <SingleChart
        title="Delta Time (+ = you ahead)"
        yLabel="ms"
        distances={distances}
        userValues={deltaMs}
        corners={corners}
        isDelta
        height={150}
      />
    </div>
  )
}
