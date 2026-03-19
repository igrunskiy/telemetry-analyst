import { useState, useMemo, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface HeatMapProps {
  lat: number[]
  lon: number[]
  speed: number[]
  refSpeed: number[]
  brake: number[]
  throttle: number[]
}

type Metric = 'speedDelta' | 'speed' | 'brake' | 'throttle'
type MapStyle = 'satellite' | 'street' | 'none'

/** Dims tile layer via CSS filter; re-applies whenever mapStyle changes. */
function TilePaneFader({ mapStyle }: { mapStyle: MapStyle }) {
  const map = useMap()
  useEffect(() => {
    const pane = map.getPane('tilePane')
    if (pane) pane.style.filter = mapStyle === 'none' ? '' : 'brightness(0.38) saturate(0.45)'
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

const METRIC_CONFIG: Record<Metric, { label: string; unit: string; diverging?: boolean; reversed?: boolean }> = {
  speedDelta: { label: 'Speed Δ vs Ref', unit: 'km/h', diverging: true },
  speed:      { label: 'Speed',          unit: 'km/h' },
  brake:      { label: 'Brake',          unit: '%',   reversed: true },
  throttle:   { label: 'Throttle',       unit: '%' },
}

const N_BINS = 16

const ESRI_SAT_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

/** t ∈ [0, 1] → CSS rgb string */
function lerpColor(t: number, diverging: boolean): string {
  const u = Math.max(0, Math.min(1, t))
  if (diverging) {
    // red (0) → white (0.5) → green (1)
    if (u <= 0.5) {
      const s = u * 2
      return `rgb(239,${Math.round(68 + 182 * s)},${Math.round(68 + 182 * s)})`
    }
    const s = (u - 0.5) * 2
    return `rgb(${Math.round(248 - 214 * s)},${Math.round(250 - 53 * s)},${Math.round(250 - 156 * s)})`
  }
  // red (0) → yellow (0.5) → green (1)  RdYlGn
  if (u <= 0.5) {
    const s = u * 2
    return `rgb(239,${Math.round(68 + 183 * s)},0)`
  }
  const s = (u - 0.5) * 2
  return `rgb(${Math.round(239 - 205 * s)},251,${Math.round(34 * s)})`
}

/** Split track path into runs of the same colour bin, carrying over the boundary
 *  point between adjacent bins so the line stays visually continuous. */
function buildSegments(
  lat: number[],
  lon: number[],
  values: number[],
  cmin: number,
  cmax: number,
  diverging: boolean,
  reversed: boolean,
): { points: [number, number][]; color: string }[] {
  if (lat.length === 0) return []
  const range = Math.max(cmax - cmin, 1e-6)
  const result: { points: [number, number][]; color: string }[] = []
  let curBin = -1
  let curSeg: [number, number][] = []

  for (let i = 0; i < lat.length; i++) {
    let t = (values[i] - cmin) / range
    if (reversed) t = 1 - t
    const binIdx = Math.min(N_BINS - 1, Math.max(0, Math.floor(Math.max(0, Math.min(1, t)) * N_BINS)))

    if (binIdx !== curBin) {
      if (curSeg.length >= 2) {
        result.push({
          points: curSeg,
          color: lerpColor((curBin + 0.5) / N_BINS, diverging),
        })
      }
      // Carry last point over so segments share boundary (no gap)
      curSeg = curSeg.length > 0 ? [curSeg[curSeg.length - 1]] : []
      curBin = binIdx
    }
    curSeg.push([lat[i], lon[i]])
  }

  if (curSeg.length >= 2) {
    result.push({ points: curSeg, color: lerpColor((curBin + 0.5) / N_BINS, diverging) })
  }
  return result
}

export default function HeatMap({ lat, lon, speed, refSpeed, brake, throttle }: HeatMapProps) {
  const [metric, setMetric] = useState<Metric>('speedDelta')
  const [mapStyle, setMapStyle] = useState<MapStyle>('satellite')

  const hasGps = lat.length > 0 && lon.length > 0

  const speedDelta = useMemo(
    () => speed.map((s, i) => s - (refSpeed[i] ?? s)),
    [speed, refSpeed],
  )

  const allValues: Record<Metric, number[]> = { speedDelta, speed, brake, throttle }
  const values = allValues[metric]
  const config = METRIC_CONFIG[metric]

  const { cmin, cmax } = useMemo(() => {
    if (!values.length) return { cmin: 0, cmax: 1 }
    if (config.diverging) {
      let maxAbs = 1
      for (const v of values) {
        const a = Math.abs(v)
        if (a > maxAbs) maxAbs = a
      }
      return { cmin: -maxAbs, cmax: maxAbs }
    }
    let mn = values[0], mx = values[0]
    for (const v of values) {
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    return { cmin: mn, cmax: mx }
  }, [values, config.diverging])

  const segments = useMemo(
    () =>
      hasGps
        ? buildSegments(lat, lon, values, cmin, cmax, config.diverging ?? false, config.reversed ?? false)
        : [],
    [hasGps, lat, lon, values, cmin, cmax, config.diverging, config.reversed],
  )

  const center = useMemo((): [number, number] => {
    if (!hasGps) return [0, 0]
    let sLat = 0, sLon = 0
    for (const v of lat) sLat += v
    for (const v of lon) sLon += v
    return [sLat / lat.length, sLon / lon.length]
  }, [hasGps, lat, lon])

  const gradientCss = config.diverging
    ? 'linear-gradient(to right, #ef4444, #f8fafc, #22c55e)'
    : config.reversed
    ? 'linear-gradient(to right, #22c55e, #fbbf24, #ef4444)'
    : 'linear-gradient(to right, #ef4444, #fbbf24, #22c55e)'

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
              {METRIC_CONFIG[m].label}
            </button>
          ))}
        </div>
        {/* Map style toggle */}
        <div className="flex gap-1.5">
          {([['satellite', 'Satellite'], ['street', 'Street'], ['none', 'None']] as [MapStyle, string][]).map(([s, label]) => (
            <button
              key={s}
              onClick={() => setMapStyle(s)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                mapStyle === s
                  ? 'bg-slate-500 text-white'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={center}
        zoom={15}
        maxZoom={22}
        style={{ height: 624, background: '#0f172a' }}
        zoomControl
        attributionControl={false}
      >
        <TilePaneFader mapStyle={mapStyle} />
        <FitBounds lat={lat} lon={lon} />
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
      <div className="px-4 py-2.5 flex items-center gap-3 bg-slate-800/80 border-t border-slate-700/50">
        <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-14 text-right">
          {config.diverging ? `−${Math.abs(cmin).toFixed(0)}` : cmin.toFixed(0)}
        </span>
        <div className="flex-1 h-2.5 rounded-full" style={{ background: gradientCss }} />
        <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-14">
          +{cmax.toFixed(0)}
        </span>
        <span className="text-xs text-slate-500 ml-2 flex-shrink-0">
          {config.label} ({config.unit})
        </span>
      </div>
    </div>
  )
}
