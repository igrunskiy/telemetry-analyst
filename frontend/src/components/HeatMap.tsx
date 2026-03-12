import { useState, useMemo } from 'react'
import Plot from 'react-plotly.js'
import type * as Plotly from 'plotly.js'

interface HeatMapProps {
  lat: number[]
  lon: number[]
  speed: number[]
  brake: number[]
  throttle: number[]
}

type Metric = 'speed' | 'brake' | 'throttle'

const METRIC_CONFIG: Record<
  Metric,
  { label: string; colorscale: string; reversed: boolean; unit: string }
> = {
  speed: {
    label: 'Speed',
    colorscale: 'RdYlGn',
    reversed: false,
    unit: 'km/h',
  },
  brake: {
    label: 'Brake Pressure',
    colorscale: 'RdYlGn',
    reversed: true, // red = heavy brake
    unit: '%',
  },
  throttle: {
    label: 'Throttle',
    colorscale: 'RdYlGn',
    reversed: false,
    unit: '%',
  },
}

export default function HeatMap({ lat, lon, speed, brake, throttle }: HeatMapProps) {
  const [metric, setMetric] = useState<Metric>('speed')

  const hasGps = lat.length > 0 && lon.length > 0

  const metricValues: Record<Metric, number[]> = {
    speed,
    brake,
    throttle,
  }

  const values = metricValues[metric]
  const config = METRIC_CONFIG[metric]

  const colorscale = config.reversed
    ? ([[0, '#22c55e'], [0.5, '#fbbf24'], [1, '#ef4444']] as Plotly.ColorScale)
    : ([[0, '#ef4444'], [0.5, '#fbbf24'], [1, '#22c55e']] as Plotly.ColorScale)

  // Highlight braking zones where brake > 50%
  const brakingZones = useMemo(() => {
    if (!hasGps) return { lon: [], lat: [] }
    const bLon: number[] = []
    const bLat: number[] = []
    brake.forEach((b, i) => {
      if (b > 50) {
        bLon.push(lon[i])
        bLat.push(lat[i])
      }
    })
    return { lon: bLon, lat: bLat }
  }, [brake, lat, lon, hasGps])

  if (!hasGps) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center mb-4">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-slate-500"
          >
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
        </div>
        <p className="text-white font-medium mb-1">GPS data not available</p>
        <p className="text-slate-500 text-sm">Heatmap requires GPS coordinates.</p>
      </div>
    )
  }

  const mainTrace: Plotly.Data = {
    type: 'scatter',
    mode: 'markers',
    x: lon,
    y: lat,
    name: config.label,
    marker: {
      color: values,
      colorscale,
      cmin: Math.min(...values),
      cmax: Math.max(...values),
      size: 4,
      colorbar: {
        title: {
          text: `${config.label} (${config.unit})`,
          font: { color: '#94a3b8', size: 11 },
        },
        tickfont: { color: '#94a3b8', size: 10 },
        bgcolor: 'rgba(15,23,42,0)',
        bordercolor: 'rgba(148,163,184,0.2)',
        len: 0.6,
      },
      showscale: true,
    },
    showlegend: false,
    hovertemplate: `${config.label}: %{marker.color:.1f} ${config.unit}<extra></extra>`,
  }

  const brakingTrace: Plotly.Data = {
    type: 'scatter',
    mode: 'markers',
    x: brakingZones.lon,
    y: brakingZones.lat,
    name: 'Braking zone (>50%)',
    marker: {
      color: 'rgba(239,68,68,0.5)',
      size: 7,
      symbol: 'circle-open',
      line: { color: 'rgba(239,68,68,0.8)', width: 2 },
    },
    showlegend: brakingZones.lon.length > 0,
    hoverinfo: 'skip',
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-white font-medium text-sm">Track Heatmap</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            Colored by selected metric. Braking zones highlighted as circles.
          </p>
        </div>
        <div className="flex gap-1.5">
          {(Object.keys(METRIC_CONFIG) as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                metric === m
                  ? 'bg-amber-500 text-slate-900'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {METRIC_CONFIG[m].label}
            </button>
          ))}
        </div>
      </div>

      <Plot
        data={[mainTrace, brakingTrace]}
        layout={{
          paper_bgcolor: '#0f172a',
          plot_bgcolor: '#0f172a',
          autosize: true,
          height: 500,
          margin: { t: 10, r: 80, b: 10, l: 10 },
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
          legend: {
            bgcolor: 'rgba(15,23,42,0.8)',
            bordercolor: 'rgba(148,163,184,0.2)',
            borderwidth: 1,
            font: { color: '#94a3b8', size: 11 },
            x: 0.01,
            y: 0.99,
          },
          hovermode: 'closest',
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  )
}
