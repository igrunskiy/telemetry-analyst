import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Globe, Map, EyeOff } from 'lucide-react'
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import {
  buildSegments,
  percentileSymmetricRange,
} from '../utils/heatmapColors'

interface HeatMapProps {
  lat: number[]
  lon: number[]
  speed: number[]
  refSpeed: number[]
  brake: number[]
  refBrake: number[]
  throttle: number[]
  refThrottle: number[]
  distances?: number[]
  xRange?: [number, number] | null
  isSolo?: boolean
}

type Metric = 'speedDelta' | 'brakeDelta' | 'throttleDelta'
type MapStyle = 'satellite' | 'street' | 'none'

/** Dims tile layer via CSS filter; re-applies whenever mapStyle changes. */
function TilePaneFader({ mapStyle }: { mapStyle: MapStyle }) {
  const map = useMap()
  useEffect(() => {
    const pane = map.getPane('tilePane')
    const isDarkMode = document.documentElement.classList.contains('dark')
    if (pane) pane.style.filter = mapStyle === 'none' || !isDarkMode ? '' : 'brightness(0.38) saturate(0.45)'
  }, [map, mapStyle])
  return null
}

/** Fits the map to the GPS bounding box once on mount. */
function FitBounds({ lat, lon }: { lat: number[]; lon: number[] }) {
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
    map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [24, 24] })
  }, [map, lat, lon])
  return null
}

interface MetricConfig {
  label: string
  soloLabel: string
  unit: string
  diverging: true
  reversed?: boolean
  /** Multiply raw delta by this for colorbar label display (e.g. 100 for 0–1 → %) */
  displayScale?: number
}

const METRIC_CONFIG: Record<Metric, MetricConfig> = {
  speedDelta:    { label: 'Speed Δ',    soloLabel: 'Speed Consistency',    unit: 'km/h', diverging: true },
  brakeDelta:    { label: 'Brake Δ',    soloLabel: 'Brake Consistency',    unit: '%',    diverging: true, reversed: true, displayScale: 100 },
  throttleDelta: { label: 'Throttle Δ', soloLabel: 'Throttle Consistency', unit: '%',    diverging: true, displayScale: 100 },
}

const ESRI_SAT_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'


export default function HeatMap({
  lat, lon, speed, refSpeed, brake, refBrake, throttle, refThrottle,
  distances, xRange, isSolo,
}: HeatMapProps) {
  const [metric, setMetric] = useState<Metric>('speedDelta')
  const [mapStyle, setMapStyle] = useState<MapStyle>('satellite')

  const hasGps = lat.length > 0 && lon.length > 0

  // Compute sliced indices when a sector range is active
  const { startIdx, endIdx } = useMemo(() => {
    if (!xRange || !distances || distances.length === 0) {
      return { startIdx: 0, endIdx: lat.length - 1 }
    }
    let start = 0
    let end = distances.length - 1
    for (let i = 0; i < distances.length; i++) {
      if (distances[i] >= xRange[0]) { start = i; break }
    }
    for (let i = distances.length - 1; i >= 0; i--) {
      if (distances[i] <= xRange[1]) { end = i; break }
    }
    return { startIdx: start, endIdx: end }
  }, [xRange, distances, lat.length])

  const activeLat = useMemo(
    () => (xRange && distances ? lat.slice(startIdx, endIdx + 1) : lat),
    [xRange, distances, lat, startIdx, endIdx],
  )
  const activeLon = useMemo(
    () => (xRange && distances ? lon.slice(startIdx, endIdx + 1) : lon),
    [xRange, distances, lon, startIdx, endIdx],
  )

  const speedDelta    = useMemo(() => speed.map((v, i) => v - (refSpeed[i] ?? v)),    [speed, refSpeed])
  const brakeDelta    = useMemo(() => brake.map((v, i) => v - (refBrake[i] ?? v)),    [brake, refBrake])
  const throttleDelta = useMemo(() => throttle.map((v, i) => v - (refThrottle[i] ?? v)), [throttle, refThrottle])

  const allValues: Record<Metric, number[]> = { speedDelta, brakeDelta, throttleDelta }
  const fullValues = allValues[metric]
  const activeValues = useMemo(
    () => (xRange && distances ? fullValues.slice(startIdx, endIdx + 1) : fullValues),
    [xRange, distances, fullValues, startIdx, endIdx],
  )
  const values = activeValues
  const config = METRIC_CONFIG[metric]

  const { cmin, cmax } = useMemo(() => percentileSymmetricRange(values), [values])

  const segments = useMemo(
    () =>
      hasGps
        ? buildSegments(activeLat, activeLon, values, cmin, cmax, config.reversed ?? false)
        : [],
    [hasGps, activeLat, activeLon, values, cmin, cmax, config.reversed],
  )

  const center = useMemo((): [number, number] => {
    if (!hasGps) return [0, 0]
    let sLat = 0, sLon = 0
    for (const v of activeLat) sLat += v
    for (const v of activeLon) sLon += v
    return [sLat / activeLat.length, sLon / activeLon.length]
  }, [hasGps, activeLat, activeLon])

  const gradientCss = config.reversed
    ? 'linear-gradient(to right, #22c55e, #f8fafc, #ef4444)'
    : 'linear-gradient(to right, #ef4444, #f8fafc, #22c55e)'

  const scale = config.displayScale ?? 1
  const activeLabel = isSolo ? config.soloLabel : config.label

  if (!hasGps) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-500">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
        </div>
        <p className="text-white font-medium mb-1">GPS data not available</p>
        <p className="text-slate-500 text-sm">Heatmap requires GPS coordinates.</p>
      </div>
    )
  }

  return (
    <div className="card p-0 overflow-hidden">
      {/* Controls row */}
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between flex-wrap gap-3 bg-slate-800/80">
        {/* Metric selector */}
        <div className="flex gap-1.5 flex-wrap">
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
              {isSolo ? METRIC_CONFIG[m].soloLabel : METRIC_CONFIG[m].label}
            </button>
          ))}
        </div>
        {/* Map style toggle — icon buttons */}
        <div className="flex gap-1.5">
          {([
            ['satellite', 'Satellite',     <Globe  className="w-3.5 h-3.5" />],
            ['street',    'Street map',    <Map    className="w-3.5 h-3.5" />],
            ['none',      'No background', <EyeOff className="w-3.5 h-3.5" />],
          ] as [MapStyle, string, React.ReactNode][]).map(([s, title, icon]) => (
            <button
              key={s}
              title={title}
              onClick={() => setMapStyle(s)}
              className={`px-2 py-1 rounded-lg font-medium transition-colors ${
                mapStyle === s
                  ? 'bg-slate-500 text-white'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      <MapContainer
        key={xRange ? `${xRange[0]}-${xRange[1]}` : 'full'}
        center={center}
        zoom={15}
        maxZoom={22}
        style={{ height: 624, background: '#0f172a' }}
        zoomControl
        attributionControl={false}
      >
        <TilePaneFader mapStyle={mapStyle} />
        <FitBounds lat={activeLat} lon={activeLon} />
        {mapStyle !== 'none' && (
          mapStyle === 'satellite'
            ? <TileLayer url={ESRI_SAT_URL} attribution="Tiles &copy; Esri" maxNativeZoom={18} maxZoom={22} />
            : <TileLayer url={OSM_URL} attribution="&copy; OpenStreetMap contributors" maxNativeZoom={19} maxZoom={22} />
        )}
        {segments.map((seg, i) => (
          <Polyline
            key={i}
            positions={seg.points}
            pathOptions={{ color: seg.color, weight: 2, opacity: 0.95 }}
          />
        ))}
      </MapContainer>

      {/* Colorbar */}
      <div className="px-4 py-2.5 bg-slate-800/80 border-t border-slate-700/50">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-14 text-right">
            {config.reversed ? `+${(cmax * scale).toFixed(scale === 1 ? 0 : 0)}` : `−${(Math.abs(cmin) * scale).toFixed(scale === 1 ? 0 : 0)}`}
          </span>
          <div className="flex-1 h-2.5 rounded-full" style={{ background: gradientCss }} />
          <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-14">
            {config.reversed ? `−${(Math.abs(cmin) * scale).toFixed(scale === 1 ? 0 : 0)}` : `+${(cmax * scale).toFixed(scale === 1 ? 0 : 0)}`}
          </span>
          <span className="text-xs text-slate-500 ml-2 flex-shrink-0">
            {activeLabel} ({config.unit})
          </span>
        </div>
        <p className="mt-1.5 text-slate-400 text-xs italic">
          {metric === 'speedDelta' && isSolo
            ? 'Green = consistent with your best lap here. Red = highest variance — where your lap times diverge most.'
            : metric === 'speedDelta'
            ? 'Green = faster than reference. Red = slower than reference.'
            : metric === 'brakeDelta' && isSolo
            ? 'Green = consistent braking. Red = highest variance in brake point or pressure.'
            : metric === 'brakeDelta'
            ? 'Green = lighter braking than reference. Red = heavier brake pressure than reference.'
            : metric === 'throttleDelta' && isSolo
            ? 'Green = consistent throttle application. Red = highest variance in throttle pickup.'
            : 'Green = more throttle than reference. Red = less throttle than reference.'}
        </p>
      </div>
    </div>
  )
}
