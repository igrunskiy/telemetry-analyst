import { useMemo } from 'react'
import Plot from '../lib/plotly'
import type { Corner } from '../types'

interface DeltaHeatmapProps {
  distances: number[]
  delta_ms: number[]
  corners: Corner[]
  isSolo: boolean
  xRange?: [number, number] | null
  hoverIndex?: number | null
  onHoverIndex?: (idx: number | null) => void
}

const PAPER_BG = '#0f172a'
const PLOT_BG = '#1e293b'
const GRID_COLOR = 'rgba(148,163,184,0.08)'
const TICK_FONT = { color: '#64748b', size: 10 }

// Sample down to at most maxPts evenly-spaced points for strip performance
function downsample<T>(arr: T[], maxPts: number): T[] {
  if (arr.length <= maxPts) return arr
  const step = arr.length / maxPts
  return Array.from({ length: maxPts }, (_, i) => arr[Math.round(i * step)])
}

export default function DeltaHeatmap({
  distances,
  delta_ms,
  corners,
  isSolo,
  xRange,
  hoverIndex,
  onHoverIndex,
}: DeltaHeatmapProps) {
  const { posY, negY, rateValues, rateDist, maxAbsDelta } = useMemo(() => {
    if (!distances.length || !delta_ms.length) {
      return { posY: [], negY: [], rateValues: [], rateDist: [], maxAbsDelta: 1 }
    }

    // Split cumulative gap into above/below zero for diverging fill
    const posY = delta_ms.map((v) => (v >= 0 ? v : 0))
    const negY = delta_ms.map((v) => (v <= 0 ? v : 0))

    // Instantaneous rate of delta change (ms gained per 100 m of track)
    const rate: number[] = []
    const midDist: number[] = []
    for (let i = 1; i < distances.length; i++) {
      const dd = distances[i] - distances[i - 1]
      if (dd <= 0) continue
      rate.push(((delta_ms[i] - delta_ms[i - 1]) / dd) * 100)
      midDist.push((distances[i] + distances[i - 1]) / 2)
    }

    const maxAbsDelta = Math.max(...delta_ms.map(Math.abs), 1)

    const MAX_STRIP = 1200
    return {
      posY,
      negY,
      rateValues: downsample(rate, MAX_STRIP),
      rateDist: downsample(midDist, MAX_STRIP),
      maxAbsDelta,
    }
  }, [distances, delta_ms])

  const yRange = [-maxAbsDelta * 1.2, maxAbsDelta * 1.2]
  const refLabel = isSolo ? 'other session laps' : 'reference'

  const cornerShapes = corners.map((c) => ({
    type: 'line' as const,
    x0: c.dist_apex,
    x1: c.dist_apex,
    y0: yRange[0],
    y1: yRange[1],
    xref: 'x' as const,
    yref: 'y' as const,
    line: { color: 'rgba(251,191,36,0.2)', width: 1, dash: 'dash' as const },
  }))

  const cornerAnnotations = corners.map((c) => ({
    x: c.dist_apex,
    y: yRange[0],
    xref: 'x' as const,
    yref: 'y' as const,
    text: `T${c.corner_num}`,
    showarrow: false,
    font: { size: 9, color: '#fbbf24' },
    bgcolor: 'rgba(15,23,42,0.7)',
    borderpad: 1,
    yanchor: 'bottom' as const,
  }))

  if (!distances.length || !delta_ms.length) {
    return (
      <div className="card py-10 text-center text-slate-500 text-sm">
        No delta time data available.
      </div>
    )
  }

  return (
    <div className="card p-0 overflow-hidden">
      <Plot
        data={[
          // Positive fill — user ahead
          {
            type: 'scatter',
            x: distances,
            y: posY,
            mode: 'lines',
            fill: 'tozeroy',
            fillcolor: 'rgba(34,197,94,0.18)',
            line: { color: 'rgba(34,197,94,0.7)', width: 1.5 },
            name: 'Ahead',
            showlegend: false,
            hovertemplate: '%{y:.0f} ms ahead<extra></extra>',
            yaxis: 'y',
          },
          // Negative fill — user behind
          {
            type: 'scatter',
            x: distances,
            y: negY,
            mode: 'lines',
            fill: 'tozeroy',
            fillcolor: 'rgba(239,68,68,0.18)',
            line: { color: 'rgba(239,68,68,0.7)', width: 1.5 },
            name: 'Behind',
            showlegend: false,
            hovertemplate: '%{y:.0f} ms behind<extra></extra>',
            yaxis: 'y',
          },
          // Rate-of-change heatmap strip (1-row heatmap on y2)
          {
            type: 'heatmap',
            x: rateDist,
            z: [rateValues],
            colorscale: [
              [0, 'rgb(220,38,38)'],
              [0.35, 'rgb(252,165,165)'],
              [0.5, 'rgb(30,41,59)'],
              [0.65, 'rgb(134,239,172)'],
              [1, 'rgb(22,163,74)'],
            ],
            // @ts-expect-error — zmid not in react-plotly types but valid Plotly property
            zmid: 0,
            showscale: false,
            hovertemplate: '%{z:.1f} ms/100m<extra>rate</extra>',
            yaxis: 'y2',
            xgap: 0,
            ygap: 0,
          },
          ...(hoverIndex != null && hoverIndex >= 0 && hoverIndex < distances.length
            ? [{
                type: 'scatter' as const,
                x: [distances[hoverIndex]],
                y: [delta_ms[hoverIndex]],
                mode: 'markers' as const,
                marker: {
                  size: 9,
                  color: '#fbbf24',
                  line: { width: 2, color: '#0f172a' },
                },
                name: 'Hover',
                showlegend: false,
                hoverinfo: 'skip' as const,
                yaxis: 'y',
              }]
            : []),
        ]}
        layout={{
          paper_bgcolor: PAPER_BG,
          plot_bgcolor: PLOT_BG,
          height: 196,
          autosize: true,
          uirevision: xRange ? `${xRange[0].toFixed(1)}-${xRange[1].toFixed(1)}` : 'full',
          margin: { t: 18, r: 10, b: 20, l: 42 },
          showlegend: false,
          hovermode: 'x unified',
          xaxis: {
            showgrid: false,
            zeroline: false,
            tickfont: TICK_FONT,
            linecolor: 'rgba(148,163,184,0.15)',
            range: xRange ?? (distances.length > 0 ? [distances[0], distances[distances.length - 1]] : undefined),
            title: { text: 'Distance (m)', font: { color: '#64748b', size: 10 } },
          },
          yaxis: {
            domain: [0.34, 1],
            showgrid: true,
            gridcolor: GRID_COLOR,
            zeroline: true,
            zerolinecolor: 'rgba(148,163,184,0.3)',
            zerolinewidth: 1,
            tickfont: TICK_FONT,
            linecolor: 'rgba(148,163,184,0.15)',
            range: yRange,
            title: { text: 'gap (ms)', font: { color: '#94a3b8', size: 10 } },
          },
          yaxis2: {
            domain: [0.11, 0.19],
            showgrid: false,
            showticklabels: false,
            zeroline: false,
          },
          shapes: cornerShapes,
          annotations: [
            ...cornerAnnotations,
            {
              x: 0.5,
              y: 1,
              xref: 'paper',
              yref: 'paper',
              text: `Delta Time vs ${refLabel} &nbsp;(+ = you ahead)`,
              showarrow: false,
              font: { color: '#94a3b8', size: 9 },
              xanchor: 'center',
              yanchor: 'bottom',
            },
            {
              x: -0.055,
              y: 0.1,
              xref: 'paper',
              yref: 'paper',
              text: 'rate',
              showarrow: false,
              font: { color: '#64748b', size: 9 },
              xanchor: 'right',
              yanchor: 'middle',
            },
          ],
        }}
        onHover={(e) => {
          const pointIndex = e.points.find((point) => typeof point.pointIndex === 'number')?.pointIndex
          onHoverIndex?.(typeof pointIndex === 'number' ? pointIndex : null)
        }}
        onUnhover={() => onHoverIndex?.(null)}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  )
}
