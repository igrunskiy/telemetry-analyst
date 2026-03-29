import { useMemo, useEffect, useRef } from 'react'
import Plot from 'react-plotly.js'
import type * as Plotly from 'plotly.js'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
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
  issueType?: string
  onHoverIndex?: (globalIdx: number | null) => void
}

const DARK_BG = '#0f172a'
const USER_COLOR = '#3b82f6'
const REF_COLOR = '#f97316'
const PAD_M = 100 // metres padding around corner bounds
const ESRI_SAT_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

function TileFader() {
  const map = useMap()
  useEffect(() => {
    const pane = map.getPane('tilePane')
    if (pane) pane.style.filter = 'brightness(0.38) saturate(0.45)'
  }, [map])
  return null
}

function FitCorner({ lat, lon }: { lat: number[]; lon: number[] }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || lat.length === 0) return
    fitted.current = true
    let minLat = lat[0], maxLat = lat[0], minLon = lon[0], maxLon = lon[0]
    for (let i = 1; i < lat.length; i++) {
      if (lat[i] < minLat) minLat = lat[i]
      if (lat[i] > maxLat) maxLat = lat[i]
      if (lon[i] < minLon) minLon = lon[i]
      if (lon[i] > maxLon) maxLon = lon[i]
    }
    map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [18, 18] })
  }, [map, lat, lon])
  return null
}

// Map issue_type to which telemetry channel to show
function resolveChartChannel(issueType?: string): 'speed' | 'brake' | 'throttle' {
  switch (issueType) {
    case 'braking_point': return 'brake'
    case 'throttle_pickup': return 'throttle'
    case 'corner_speed':
    case 'exit_speed':
    case 'racing_line':
    default: return 'speed'
  }
}

const CHANNEL_LABELS: Record<string, { unit: string; title: string }> = {
  speed: { unit: 'km/h', title: 'Speed' },
  brake: { unit: '%', title: 'Brake' },
  throttle: { unit: '%', title: 'Throttle' },
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
  issueType,
  onHoverIndex,
}: CornerSnippetProps) {
  const chartChannel = resolveChartChannel(issueType)
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

  // Braking point: first index where brake >= 0.05 (0–1 scale) before apex
  const brakingIdx = useMemo(() => {
    for (let i = startIdx; i <= apexIdx; i++) {
      if ((userBrake[i] ?? 0) >= 0.05) return i
    }
    return null
  }, [startIdx, apexIdx, userBrake])

  // Throttle point: first index after apex where throttle >= 0.05 (0–1 scale)
  const throttleIdx = useMemo(() => {
    for (let i = apexIdx; i <= endIdx; i++) {
      if ((userThrottle[i] ?? 0) >= 0.05) return i
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

  // GPS slices for Leaflet — corner window (highlighted) and full track (dim background)
  const userLatSlice = useMemo(
    () => userLat?.slice(startIdx, endIdx + 1) ?? [],
    [userLat, startIdx, endIdx],
  )
  const userLonSlice = useMemo(
    () => userLon?.slice(startIdx, endIdx + 1) ?? [],
    [userLon, startIdx, endIdx],
  )
  const refLatSlice = useMemo(
    () => (hasRefGps && refLat ? refLat.slice(startIdx, endIdx + 1) : []),
    [hasRefGps, refLat, startIdx, endIdx],
  )
  const refLonSlice = useMemo(
    () => (hasRefGps && refLon ? refLon.slice(startIdx, endIdx + 1) : []),
    [hasRefGps, refLon, startIdx, endIdx],
  )
  const userPositions = useMemo(
    (): [number, number][] => userLatSlice.map((la, i) => [la, userLonSlice[i]]),
    [userLatSlice, userLonSlice],
  )
  const refPositions = useMemo(
    (): [number, number][] => refLatSlice.map((la, i) => [la, refLonSlice[i]]),
    [refLatSlice, refLonSlice],
  )
  // Full track traces (dim backdrop)
  const fullUserPositions = useMemo(
    (): [number, number][] => (userLat && userLon ? userLat.map((la, i) => [la, userLon[i]]) : []),
    [userLat, userLon],
  )
  const fullRefPositions = useMemo(
    (): [number, number][] =>
      hasRefGps && refLat && refLon ? refLat.map((la, i) => [la, refLon[i]]) : [],
    [hasRefGps, refLat, refLon],
  )
  const mapCenter = useMemo((): [number, number] => {
    if (userLatSlice.length === 0) return [0, 0]
    return [
      userLatSlice.reduce((s, v) => s + v, 0) / userLatSlice.length,
      userLonSlice.reduce((s, v) => s + v, 0) / userLonSlice.length,
    ]
  }, [userLatSlice, userLonSlice])

  // Chart data — pick channel based on issue type
  const slicedDist = distances.slice(startIdx, endIdx + 1)

  const { slicedUser, slicedRef } = useMemo(() => {
    if (chartChannel === 'brake') {
      return {
        slicedUser: userBrake.slice(startIdx, endIdx + 1).map((v) => v * 100),
        slicedRef: (refBrake ?? userBrake).slice(startIdx, endIdx + 1).map((v) => v * 100),
      }
    }
    if (chartChannel === 'throttle') {
      return {
        slicedUser: userThrottle.slice(startIdx, endIdx + 1).map((v) => v * 100),
        slicedRef: (refThrottle ?? userThrottle).slice(startIdx, endIdx + 1).map((v) => v * 100),
      }
    }
    return {
      slicedUser: userSpeed.slice(startIdx, endIdx + 1),
      slicedRef: refSpeed.slice(startIdx, endIdx + 1),
    }
  }, [chartChannel, startIdx, endIdx, userSpeed, refSpeed, userBrake, refBrake, userThrottle, refThrottle])

  const channelLabel = CHANNEL_LABELS[chartChannel]

  const { chartShapes, yMin, yMax } = useMemo(() => {
    const allVals = [...slicedUser, ...slicedRef]
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

    return { chartShapes: shapes, yMin: lo, yMax: hi }
  }, [distances, brakingIdx, apexIdx, throttleIdx, slicedUser, slicedRef])

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
        <span className="text-[10px] uppercase tracking-wide text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded">
          {channelLabel.title}
        </span>
        <div className="flex items-center gap-3 ml-auto text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 inline-block" style={{ backgroundColor: USER_COLOR }} />
            <span className="text-slate-500">You</span>
          </span>
          {hasRefGps && (
            <span className="flex items-center gap-1.5">
              <span
                className="w-5 h-0.5 inline-block"
                style={{ backgroundColor: REF_COLOR }}
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

      {/* GPS mini map with satellite background */}
      {hasGps && userPositions.length > 0 && (
        <div style={{ height: 200 }}>
          <MapContainer
            center={mapCenter}
            zoom={16}
            maxZoom={22}
            style={{ height: '100%', background: DARK_BG }}
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
          >
            <TileLayer
              url={ESRI_SAT_URL}
              attribution="Tiles &copy; Esri"
              maxNativeZoom={18}
              maxZoom={22}
            />
            <TileFader />
            <FitCorner lat={userLatSlice} lon={userLonSlice} />

            {/* Full track — dim backdrop */}
            {fullRefPositions.length > 0 && (
              <Polyline positions={fullRefPositions} pathOptions={{ color: REF_COLOR, weight: 1, opacity: 0.2 }} />
            )}
            <Polyline positions={fullUserPositions} pathOptions={{ color: USER_COLOR, weight: 1, opacity: 0.2 }} />

            {/* Corner window — highlighted overlay */}
            {refPositions.length > 0 && (
              <Polyline positions={refPositions} pathOptions={{ color: REF_COLOR, weight: 2.5, opacity: 0.9 }} />
            )}
            <Polyline positions={userPositions} pathOptions={{ color: USER_COLOR, weight: 3, opacity: 1 }} />

            {/* Braking point */}
            {brakingIdx !== null && userLat && userLon && (
              <CircleMarker center={[userLat[brakingIdx], userLon[brakingIdx]]} radius={6} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 1.5 }}>
                <Tooltip permanent direction="top" offset={[0, -8]} opacity={1}>
                  <span style={{ fontSize: 9, fontWeight: 600, color: '#ef4444' }}>Brake</span>
                </Tooltip>
              </CircleMarker>
            )}
            {/* Apex */}
            {userLat && userLon && (
              <CircleMarker center={[userLat[apexIdx], userLon[apexIdx]]} radius={6} pathOptions={{ color: '#fbbf24', fillColor: '#fbbf24', fillOpacity: 1, weight: 1.5 }}>
                <Tooltip permanent direction="top" offset={[0, -8]} opacity={1}>
                  <span style={{ fontSize: 9, fontWeight: 600, color: '#fbbf24' }}>Apex</span>
                </Tooltip>
              </CircleMarker>
            )}
            {/* Throttle point */}
            {throttleIdx !== null && userLat && userLon && (
              <CircleMarker center={[userLat[throttleIdx], userLon[throttleIdx]]} radius={6} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 1.5 }}>
                <Tooltip permanent direction="top" offset={[0, -8]} opacity={1}>
                  <span style={{ fontSize: 9, fontWeight: 600, color: '#22c55e' }}>Throttle</span>
                </Tooltip>
              </CircleMarker>
            )}
          </MapContainer>
        </div>
      )}

      {/* Telemetry mini chart — channel depends on issue type */}
      <Plot
        data={[
          {
            type: 'scatter',
            mode: 'lines',
            x: slicedDist,
            y: slicedUser,
            line: { color: USER_COLOR, width: 1 },
            showlegend: false,
            hovertemplate: `%{y:.0f} ${channelLabel.unit}<extra>You</extra>`,
          },
          {
            type: 'scatter',
            mode: 'lines',
            x: slicedDist,
            y: slicedRef,
            line: { color: REF_COLOR, width: 1 },
            showlegend: false,
            hovertemplate: `%{y:.0f} ${channelLabel.unit}<extra>Ref</extra>`,
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
            range: [yMin, yMax],
          },
          shapes: chartShapes,
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
