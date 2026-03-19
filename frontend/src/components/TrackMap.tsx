import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Globe, Map, EyeOff } from 'lucide-react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Corner } from '../types'

interface TrackMapProps {
  userLat: number[]
  userLon: number[]
  refLat: number[]
  refLon: number[]
  userSpeed: number[]
  refSpeed: number[]
  corners: Corner[]
  hoverIndex?: number | null
  height?: number
  trackLength?: number
  highlightRange?: [number, number] | null
  highlightCornerNums?: number[]
  title?: string
  showRef?: boolean
}

type MapStyle = 'satellite' | 'street' | 'none'

function TilePaneFader({ mapStyle }: { mapStyle: MapStyle }) {
  const map = useMap()
  useEffect(() => {
    const pane = map.getPane('tilePane')
    if (pane) pane.style.filter = mapStyle === 'none' ? '' : 'brightness(0.38) saturate(0.45)'
  }, [map, mapStyle])
  return null
}

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

function RightClickPan() {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    let state: { startX: number; startY: number; startCenter: [number, number] } | null = null
    let rafId: number | null = null

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return
      e.preventDefault()
      e.stopPropagation()
      const c = map.getCenter()
      state = { startX: e.clientX, startY: e.clientY, startCenter: [c.lat, c.lng] }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!state) return
      const { clientX, clientY } = e
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        if (!state) return
        const startPoint = map.latLngToContainerPoint(state.startCenter)
        const dx = clientX - state.startX
        const dy = clientY - state.startY
        const newCenter = map.containerPointToLatLng([startPoint.x - dx, startPoint.y - dy])
        map.setView(newCenter, map.getZoom(), { animate: false })
      })
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) state = null
    }

    const onContextMenu = (e: Event) => e.preventDefault()

    container.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    container.addEventListener('contextmenu', onContextMenu, true)

    return () => {
      container.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      container.removeEventListener('contextmenu', onContextMenu, true)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [map])

  return null
}

const ESRI_SAT_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

export default function TrackMap({
  userLat,
  userLon,
  refLat,
  refLon,
  userSpeed,
  refSpeed,
  corners,
  hoverIndex,
  height = 576,
  trackLength = 3000,
  highlightRange,
  highlightCornerNums = [],
  title = 'Racing Lines',
  showRef = true,
}: TrackMapProps) {
  const [mapStyle, setMapStyle] = useState<MapStyle>('satellite')

  const hasGpsData = userLat.length > 0 && userLon.length > 0

  const center = useMemo((): [number, number] => {
    if (!hasGpsData) return [0, 0]
    let sLat = 0, sLon = 0
    for (const v of userLat) sLat += v
    for (const v of userLon) sLon += v
    return [sLat / userLat.length, sLon / userLon.length]
  }, [hasGpsData, userLat, userLon])

  // User racing line — split into dim/bright/dim when a highlight range is active
  const userSegments = useMemo(() => {
    if (!hasGpsData) return []
    const n = userLat.length
    const all: [number, number][] = userLat.map((la, i) => [la, userLon[i]])
    if (!highlightRange) {
      return [{ positions: all, opacity: 0.9, weight: 1.5 }]
    }
    const rStart = Math.max(0, Math.round((highlightRange[0] / trackLength) * (n - 1)))
    const rEnd = Math.min(n - 1, Math.round((highlightRange[1] / trackLength) * (n - 1)))
    const segs: { positions: [number, number][]; opacity: number; weight: number }[] = []
    if (rStart > 0)   segs.push({ positions: all.slice(0, rStart + 1), opacity: 0.18, weight: 1 })
    segs.push({ positions: all.slice(rStart, rEnd + 1), opacity: 1.0, weight: 2.5 })
    if (rEnd < n - 1) segs.push({ positions: all.slice(rEnd), opacity: 0.18, weight: 1 })
    return segs
  }, [hasGpsData, userLat, userLon, highlightRange, trackLength])

  const refPositions = useMemo(
    (): [number, number][] => refLat.map((la, i) => [la, refLon[i]]),
    [refLat, refLon],
  )

  // Map dist_apex of each corner to a GPS index
  const cornerData = useMemo(() => {
    if (!hasGpsData) return []
    return corners.map((c) => {
      const idx = Math.min(
        Math.round((c.dist_apex / trackLength) * (userLat.length - 1)),
        userLat.length - 1,
      )
      return { lat: userLat[idx], lon: userLon[idx], num: c.corner_num }
    })
  }, [corners, userLat, userLon, hasGpsData, trackLength])

  // Speed-delta gradient segments — user line coloured by (userSpeed − refSpeed):
  // red = user slower, slate-grey = matched, green = user faster.
  const speedDeltaSegments = useMemo(() => {
    const BUCKETS = 16
    const n = Math.min(userLat.length, userSpeed.length, refSpeed.length)
    if (!hasGpsData || n < 2) return []

    // Find symmetric range for diverging scale
    let maxAbs = 1
    for (let i = 0; i < n; i++) {
      const d = Math.abs(userSpeed[i] - refSpeed[i])
      if (d > maxAbs) maxAbs = d
    }

    function deltaColor(delta: number): string {
      // t=0 → red, t=0.5 → slate, t=1 → green
      const t = Math.max(0, Math.min(1, (delta + maxAbs) / (2 * maxAbs)))
      if (t <= 0.5) {
        const s = t * 2
        // red rgb(239,68,68) → slate rgb(148,163,184)
        return `rgb(${Math.round(239 - 91 * s)},${Math.round(68 + 95 * s)},${Math.round(68 + 116 * s)})`
      }
      const s = (t - 0.5) * 2
      // slate rgb(148,163,184) → green rgb(34,197,94)
      return `rgb(${Math.round(148 - 114 * s)},${Math.round(163 + 34 * s)},${Math.round(184 - 90 * s)})`
    }

    const segs: { positions: [number, number][]; color: string }[] = []
    let curBucket = Math.floor(Math.max(0, Math.min(1, (userSpeed[0] - refSpeed[0] + maxAbs) / (2 * maxAbs))) * BUCKETS)
    curBucket = Math.min(BUCKETS - 1, curBucket)
    let run: [number, number][] = [[userLat[0], userLon[0]]]
    let runDelta = userSpeed[0] - refSpeed[0]

    for (let i = 1; i < n; i++) {
      const delta = userSpeed[i] - refSpeed[i]
      const b = Math.min(BUCKETS - 1, Math.floor(Math.max(0, Math.min(1, (delta + maxAbs) / (2 * maxAbs))) * BUCKETS))
      if (b === curBucket) {
        run.push([userLat[i], userLon[i]])
        runDelta = delta
      } else {
        run.push([userLat[i], userLon[i]])
        segs.push({ positions: run, color: deltaColor(runDelta) })
        run = [[userLat[i - 1], userLon[i - 1]], [userLat[i], userLon[i]]]
        runDelta = delta
        curBucket = b
      }
    }
    if (run.length >= 2) segs.push({ positions: run, color: deltaColor(runDelta) })
    return segs
  }, [hasGpsData, userLat, userLon, userSpeed, refSpeed])

  if (!hasGpsData) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-500">
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

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 bg-slate-800/80">
        <div className="flex items-center gap-4 text-xs">
          <h3 className="text-white font-medium text-sm">{title}</h3>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-12 rounded-full"
              style={{ background: 'linear-gradient(to right, #ef4444, #94a3b8, #22c55e)' }} />
            <span className="text-slate-400">You (Δ speed)</span>
          </span>
          {showRef && (
            <span className="flex items-center gap-1.5">
              <span className="w-5 h-0.5 bg-green-500 inline-block opacity-70" />
              <span className="text-slate-400">Reference</span>
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {([
            ['satellite', 'Satellite',   <Globe  className="w-3.5 h-3.5" />],
            ['street',    'Street map',  <Map    className="w-3.5 h-3.5" />],
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

      <MapContainer
        center={center}
        zoom={15}
        maxZoom={22}
        style={{ height, background: '#0f172a' }}
        zoomControl
        attributionControl={false}
      >
        <TilePaneFader mapStyle={mapStyle} />
        <FitBounds lat={userLat} lon={userLon} />
        <RightClickPan />
        {mapStyle !== 'none' && (
          mapStyle === 'satellite'
            ? <TileLayer url={ESRI_SAT_URL} attribution="Tiles &copy; Esri" maxNativeZoom={18} maxZoom={22} />
            : <TileLayer url={OSM_URL} attribution="&copy; OpenStreetMap contributors" maxNativeZoom={19} maxZoom={22} />
        )}

        {/* Reference line — solid green */}
        {showRef && refPositions.length > 0 && (
          <Polyline positions={refPositions} pathOptions={{ color: '#22c55e', weight: 1.5, opacity: 0.7 }} />
        )}

        {/* User line — speed-delta diverging gradient (red=slower, grey=matched, green=faster) */}
        {speedDeltaSegments.length > 0
          ? speedDeltaSegments.map((seg, i) => (
              <Polyline key={`ud-${i}`} positions={seg.positions}
                pathOptions={{ color: seg.color, weight: 2.5, opacity: 0.95 }} />
            ))
          : userSegments.map((seg, i) => (
              <Polyline key={i} positions={seg.positions}
                pathOptions={{ color: '#f59e0b', weight: seg.weight, opacity: seg.opacity }} />
            ))
        }

        {/* Corner labels */}
        {cornerData.map((c) => {
          const highlighted = highlightCornerNums.includes(c.num)
          return (
            <CircleMarker
              key={c.num}
              center={[c.lat, c.lon]}
              radius={highlighted ? 8 : 5}
              pathOptions={{
                color: highlighted ? '#f97316' : '#fbbf24',
                fillColor: highlighted ? '#f97316' : '#fbbf24',
                fillOpacity: highlighted ? 0.9 : 0.7,
                weight: highlighted ? 2 : 1,
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -8]} opacity={1}>
                <span style={{ fontSize: 10, fontWeight: 600, color: highlighted ? '#f97316' : '#fbbf24' }}>
                  T{c.num}
                </span>
              </Tooltip>
            </CircleMarker>
          )
        })}

        {/* Hover cursor */}
        {hoverIndex != null && hoverIndex >= 0 && hoverIndex < userLat.length && (
          <CircleMarker
            center={[userLat[hoverIndex], userLon[hoverIndex]]}
            radius={7}
            pathOptions={{ color: '#0f172a', fillColor: '#ffffff', fillOpacity: 1, weight: 2 }}
          />
        )}
      </MapContainer>
    </div>
  )
}
