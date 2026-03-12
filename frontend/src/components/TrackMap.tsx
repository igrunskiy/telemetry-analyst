import { useMemo } from 'react'
import Plot from 'react-plotly.js'
import type * as Plotly from 'plotly.js'
import type { Corner } from '../types'

interface TrackMapProps {
  userLat: number[]
  userLon: number[]
  refLat: number[]
  refLon: number[]
  userSpeed: number[]
  refSpeed: number[]
  corners: Corner[]
}

const DARK_LAYOUT = {
  paper_bgcolor: '#0f172a',
  plot_bgcolor: '#0f172a',
  font: { color: '#94a3b8' },
}

export default function TrackMap({
  userLat,
  userLon,
  refLat,
  refLon,
  userSpeed,
  refSpeed,
  corners,
}: TrackMapProps) {
  const hasGpsData =
    userLat.length > 0 && userLon.length > 0

  const cornerAnnotations = useMemo(() => {
    if (!hasGpsData) return []
    return corners.map((c) => {
      // Find the closest point on the user's line to this corner's apex distance
      // For annotation positioning, we'll use a rough index
      const idx = Math.min(
        Math.round((c.dist_apex / 100) * (userLat.length - 1)),
        userLat.length - 1,
      )
      return {
        x: userLon[idx],
        y: userLat[idx],
        text: `C${c.corner_num}`,
        showarrow: false,
        font: { size: 10, color: '#fbbf24' },
        bgcolor: 'rgba(15,23,42,0.7)',
        borderpad: 2,
      }
    })
  }, [corners, userLat, userLon, hasGpsData])

  if (!hasGpsData) {
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
        <p className="text-white font-medium mb-1">GPS data not available for this lap</p>
        <p className="text-slate-500 text-sm">
          Racing line visualization requires GPS coordinates from the session.
        </p>
      </div>
    )
  }

  const minSpeed = Math.min(...userSpeed, ...refSpeed)
  const maxSpeed = Math.max(...userSpeed, ...refSpeed)

  const userTrace: Plotly.Data = {
    type: 'scatter',
    mode: 'markers',
    x: userLon,
    y: userLat,
    name: 'You',
    marker: {
      color: userSpeed,
      colorscale: 'RdYlGn',
      cmin: minSpeed,
      cmax: maxSpeed,
      size: 3,
      colorbar: {
        title: { text: 'Speed (km/h)', font: { color: '#94a3b8' } },
        tickfont: { color: '#94a3b8' },
        bgcolor: 'rgba(15,23,42,0)',
        bordercolor: 'rgba(148,163,184,0.2)',
        len: 0.5,
        y: 0.75,
      },
      showscale: true,
    },
    showlegend: true,
  }

  const refTrace: Plotly.Data = {
    type: 'scatter',
    mode: 'markers',
    x: refLon,
    y: refLat,
    name: 'Reference',
    marker: {
      color: refSpeed,
      colorscale: 'RdYlGn',
      cmin: minSpeed,
      cmax: maxSpeed,
      size: 2,
      opacity: 0.5,
      showscale: false,
    },
    showlegend: true,
  }

  return (
    <div className="card p-2">
      <div className="flex items-center justify-between mb-2 px-2">
        <h3 className="text-white font-medium text-sm">Racing Lines</h3>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
            <span className="text-slate-400">You</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-orange-400 inline-block opacity-60" />
            <span className="text-slate-400">Reference</span>
          </span>
        </div>
      </div>
      <Plot
        data={[userTrace, refTrace]}
        layout={{
          ...DARK_LAYOUT,
          autosize: true,
          height: 480,
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
          annotations: cornerAnnotations,
          legend: {
            bgcolor: 'rgba(15,23,42,0.8)',
            bordercolor: 'rgba(148,163,184,0.2)',
            borderwidth: 1,
            font: { color: '#94a3b8', size: 11 },
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
