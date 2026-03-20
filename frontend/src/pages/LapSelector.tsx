import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, User, ChevronRight, Clock, Calendar, Loader2, Car, MapPin, BarChart2, Trash2, Zap, ExternalLink } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'
import { useAuth } from '../hooks/useAuth'
import {
  getCars,
  getTracks,
  getMyLaps,
  getMySessions,
  getRecentLaps,
  getReferenceLaps,
  getAnalysisHistory,
  runAnalysis,
  deleteAnalysis,
  logout,
} from '../api/client'
import type { Lap, Session, AnalysisHistoryItem, Track } from '../types'

function normalizeLapTimeMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  // Heuristic: Garage61 can return seconds; treat sub-1000 values as seconds.
  if (value < 1000) {
    return value * 1000
  }
  return value
}

function parseLapTime(value: number | string): number {
  if (typeof value === 'number') {
    return normalizeLapTimeMs(value)
  }
  if (!value) {
    return 0
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return 0
  }
  // Support "M:SS.mmm" or "SS.mmm"
  const match = trimmed.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/)
  if (match) {
    const minutes = Number(match[1])
    const seconds = Number(match[2])
    const millis = match[3] ? Number(match[3].padEnd(3, '0')) : 0
    return (minutes * 60 + seconds) * 1000 + millis
  }
  const asNumber = Number(trimmed)
  if (Number.isFinite(asNumber)) {
    return normalizeLapTimeMs(asNumber)
  }
  return 0
}

function formatLapTime(value: number | string): string {
  const ms = parseLapTime(value)
  if (!ms) {
    return '—'
  }
  const totalSeconds = ms / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, '0')
  return `${minutes}:${seconds}`
}

function parseDate(value: string): Date | null {
  if (!value) {
    return null
  }
  if (/^\d+$/.test(value)) {
    const num = Number(value)
    if (Number.isFinite(num)) {
      return new Date(value.length >= 13 ? num : num * 1000)
    }
  }
  let parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parsed = new Date(`${value}T00:00:00Z`)
  } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    parsed = new Date(value.replace(' ', 'T') + 'Z')
  }
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDate(dateStr: string): string {
  const parsed = parseDate(dateStr)
  if (!parsed) {
    return '—'
  }
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(dateStr: string): string {
  const parsed = parseDate(dateStr)
  if (!parsed) return '—'
  const date = parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  // Only show time if the value contained a time component (not just a date string)
  const hasTime = /[T ]/.test(dateStr) && !/T00:00:00/.test(dateStr)
  if (!hasTime) return date
  const time = parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

function formatTrackName(track: Track): string {
  const variant = track.variant || track.config
  if (variant && variant.trim() && variant !== track.name) {
    return `${track.name} - ${variant}`
  }
  return track.name
}

export default function LapSelectorPage() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [analysisMode, setAnalysisMode] = useState<'vs_reference' | 'sessions'>('vs_reference')
  const [selectedCarId, setSelectedCarId] = useState<number | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [selectedLapId, setSelectedLapId] = useState<string | null>(null)
  const [selectedRefIds, setSelectedRefIds] = useState<Set<string>>(new Set())
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [myLapsLimit, setMyLapsLimit] = useState(10)
  const [myLapsPage, setMyLapsPage] = useState(0)
  const [mySessionsLimit, setMySessionsLimit] = useState(10)
  const [mySessionsPage, setMySessionsPage] = useState(0)
  const [recentPage, setRecentPage] = useState(0)
  const RECENT_PAGE_SIZE = 5
  const [historyPage, setHistoryPage] = useState(0)
  const HISTORY_PAGE_SIZE = 5

  // Data fetching
  const { data: cars = [], isLoading: carsLoading } = useQuery({
    queryKey: ['cars'],
    queryFn: getCars,
  })

  const { data: tracks = [], isLoading: tracksLoading } = useQuery({
    queryKey: ['tracks'],
    queryFn: getTracks,
  })

  const { data: myLaps = [], isLoading: myLapsLoading } = useQuery({
    queryKey: ['myLaps', selectedCarId, selectedTrackId, myLapsLimit, myLapsPage],
    queryFn: () =>
      getMyLaps(selectedCarId!, selectedTrackId!, myLapsLimit, myLapsPage * myLapsLimit),
    enabled: selectedCarId !== null && selectedTrackId !== null && analysisMode === 'vs_reference',
  })

  const { data: mySessions = [], isLoading: mySessionsLoading } = useQuery({
    queryKey: ['mySessions', selectedCarId, selectedTrackId, mySessionsLimit, mySessionsPage],
    queryFn: () =>
      getMySessions(selectedCarId!, selectedTrackId!, mySessionsLimit, mySessionsPage * mySessionsLimit),
    enabled: selectedCarId !== null && selectedTrackId !== null && analysisMode === 'sessions',
  })

  const { data: refLaps = [], isLoading: refLapsLoading } = useQuery({
    queryKey: ['refLaps', selectedCarId, selectedTrackId],
    queryFn: () => getReferenceLaps(selectedCarId!, selectedTrackId!),
    enabled: selectedCarId !== null && selectedTrackId !== null,
    select: (laps) => laps.slice(0, 5),
  })

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['analysisHistory'],
    queryFn: getAnalysisHistory,
  })

  const { data: recentLaps = [], isLoading: recentLoading } = useQuery({
    queryKey: ['recentLaps'],
    queryFn: () => getRecentLaps(25),
  })
  const filteredRecentLaps = recentLaps.filter((lap) => {
    if (selectedCarId && lap.car_id !== selectedCarId) return false
    if (selectedTrackId && lap.track_id !== selectedTrackId) return false
    return true
  })
  const recentPageLaps = filteredRecentLaps.slice(recentPage * RECENT_PAGE_SIZE, (recentPage + 1) * RECENT_PAGE_SIZE)
  const recentTotalPages = Math.ceil(filteredRecentLaps.length / RECENT_PAGE_SIZE)

  const recentCarIds = new Set(
    recentLaps
      .filter((l: Lap) => !selectedTrackId || l.track_id === selectedTrackId)
      .map((l: Lap) => l.car_id)
      .filter(Boolean)
  )
  const recentTrackIds = new Set(
    recentLaps
      .filter((l: Lap) => !selectedCarId || l.car_id === selectedCarId)
      .map((l: Lap) => l.track_id)
      .filter(Boolean)
  )

  const filteredHistory = history.filter((item: AnalysisHistoryItem) => {
    if (selectedCarId) {
      const car = cars.find((c) => c.id === selectedCarId)
      if (car && item.car_name !== car.name) return false
    }
    if (selectedTrackId) {
      const track = tracks.find((t) => t.id === selectedTrackId)
      if (track && item.track_name !== formatTrackName(track)) return false
    }
    return true
  })
  const historyTotalPages = Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE)
  const pagedHistory = filteredHistory.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE)

  // Auto-select top 5 reference laps when they load
  useEffect(() => {
    if (refLaps.length > 0) {
      setSelectedRefIds(new Set(refLaps.map((l) => l.id)))
    }
  }, [refLaps])

  // Reset lap/session selection when car/track change
  function handleCarChange(carId: number | null) {
    setSelectedCarId(carId)
    setSelectedLapId(null)
    setSelectedRefIds(new Set())
    setSelectedSessionId(null)
    setExpandedSessionId(null)
    setMyLapsPage(0)
    setMySessionsPage(0)
    setRecentPage(0)
    setHistoryPage(0)
  }

  function handleTrackChange(trackId: number | null) {
    setSelectedTrackId(trackId)
    setSelectedLapId(null)
    setSelectedRefIds(new Set())
    setSelectedSessionId(null)
    setExpandedSessionId(null)
    setMyLapsPage(0)
    setMySessionsPage(0)
    setRecentPage(0)
    setHistoryPage(0)
  }

  function applyRecentFilters(carId: number | null, trackId: number | null) {
    if (!carId || !trackId) {
      return
    }
    setSelectedCarId(carId)
    setSelectedTrackId(trackId)
    setSelectedLapId(null)
    setSelectedRefIds(new Set())
    setSelectedSessionId(null)
    setExpandedSessionId(null)
    setMyLapsPage(0)
    setMySessionsPage(0)
    setHistoryPage(0)
  }

  function resolveRecentIds(lap: Lap) {
    const carId = lap.car_id ?? cars.find((car) => car.name === lap.car_name)?.id ?? null
    const trackId =
      lap.track_id ??
      tracks.find((track) => formatTrackName(track) === lap.track_name)?.id ??
      null
    return { carId, trackId }
  }

  function toggleRefLap(lapId: string) {
    setSelectedRefIds((prev) => {
      const next = new Set(prev)
      if (next.has(lapId)) {
        next.delete(lapId)
      } else {
        next.add(lapId)
      }
      return next
    })
  }

  function handleModeChange(mode: 'vs_reference' | 'sessions') {
    setAnalysisMode(mode)
    setSelectedLapId(null)
    setSelectedRefIds(new Set())
    setSelectedSessionId(null)
    setExpandedSessionId(null)
  }

  // Analysis mutation
  const analysisMutation = useMutation({
    mutationFn: async () => {
      if (analysisMode === 'sessions') {
        const session = mySessions.find((s: Session) => s.id === selectedSessionId)!
        const sorted = [...session.laps].sort(
          (a, b) => parseLapTime(a.lap_time) - parseLapTime(b.lap_time)
        )
        const primary = sorted[0]
        const rest = sorted.slice(1)
        const lapsMetadata = [
          { id: primary.id, role: 'user' as const, driver_name: primary.driver_name, lap_time: parseLapTime(primary.lap_time) },
          ...rest.map((l) => ({ id: l.id, role: 'reference' as const, driver_name: l.driver_name, lap_time: parseLapTime(l.lap_time) })),
        ]
        return runAnalysis(primary.id, rest.map((l) => l.id), primary.car_name, primary.track_name, 'solo', lapsMetadata)
      } else {
        const lap = myLaps.find((l) => l.id === selectedLapId)!
        const lapsMetadata = [
          { id: lap.id, role: 'user' as const, driver_name: lap.driver_name, lap_time: parseLapTime(lap.lap_time) },
          ...Array.from(selectedRefIds).map((id) => {
            const ref = refLaps.find((r) => r.id === id)
            return { id, role: 'reference' as const, driver_name: ref?.driver_name ?? '', lap_time: parseLapTime(ref?.lap_time ?? 0), irating: ref?.irating }
          }),
        ]
        return runAnalysis(
          selectedLapId!,
          Array.from(selectedRefIds),
          lap.car_name,
          lap.track_name,
          'vs_reference',
          lapsMetadata,
        )
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysisHistory'] })
      // Reset lap/session selection so the user can queue another analysis
      setSelectedLapId(null)
      setSelectedRefIds(new Set())
      setSelectedSessionId(null)
      setExpandedSessionId(null)
    },
  })

  const queryClient = useQueryClient()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAnalysis(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysisHistory'] })
      setConfirmDeleteId(null)
    },
  })

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      window.location.href = '/login'
    }
  }

  const selectedSession = mySessions.find((s: Session) => s.id === selectedSessionId)
  const canAnalyse = analysisMode === 'sessions'
    ? selectedSessionId !== null && (selectedSession?.laps?.length ?? 0) >= 2 && !analysisMutation.isPending
    : selectedLapId !== null && selectedRefIds.size > 0 && !analysisMutation.isPending

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-[80%] mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center">
              <BarChart2 className="w-4 h-4 text-slate-900" />
            </div>
            <span className="font-semibold text-white text-sm">Telemetry Analyst</span>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <Link
                to="/profile"
                className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm px-2 py-1 rounded-lg hover:bg-slate-700"
              >
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.display_name}
                    className="w-7 h-7 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center">
                    <User className="w-4 h-4" />
                  </div>
                )}
                <span className="hidden sm:inline max-w-[140px] truncate">
                  {user.display_name}
                </span>
              </Link>
            )}
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[80%] mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column: Steps 1-4 */}
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">New Analysis</h2>
              {/* Mode toggle */}
              <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5 text-xs font-medium">
                <button
                  onClick={() => handleModeChange('vs_reference')}
                  className={`px-3 py-1.5 rounded-md transition-colors ${
                    analysisMode === 'vs_reference'
                      ? 'bg-amber-500 text-slate-900'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  vs Reference
                </button>
                <button
                  onClick={() => handleModeChange('sessions')}
                  className={`px-3 py-1.5 rounded-md transition-colors ${
                    analysisMode === 'sessions'
                      ? 'bg-amber-500 text-slate-900'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  My Sessions
                </button>
              </div>
            </div>

            {analysisMode === 'sessions' && (
              <p className="text-slate-500 text-xs -mt-2">
                Select one of your sessions. All laps from that session will be analysed together — the fastest becomes the baseline.
              </p>
            )}

            {/* Step 1: Car */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-amber-500 text-slate-900 text-xs font-bold flex items-center justify-center">
                  1
                </div>
                <span className="text-white font-medium text-sm flex items-center gap-1.5">
                  <Car className="w-4 h-4 text-slate-400" /> Select Car
                </span>
                {selectedCarId && (
                  <button
                    type="button"
                    onClick={() => handleCarChange(null)}
                    className="ml-auto text-xs text-slate-400 hover:text-white px-2 py-1 rounded-md hover:bg-slate-700 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              {carsLoading ? (
                <div className="h-10 bg-slate-700 rounded-lg animate-pulse" />
              ) : (
                <select
                  className="select"
                  value={selectedCarId ?? ''}
                  onChange={(e) => handleCarChange(e.target.value ? Number(e.target.value) : null)}
                  data-testid="car-select"
                >
                  <option value="">-- Choose a car --</option>
                  {cars.filter((c) => recentCarIds.has(c.id)).length > 0 && (
                    <optgroup label="Recent">
                      {cars.filter((c) => recentCarIds.has(c.id)).map((car) => (
                        <option key={car.id} value={car.id}>{car.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={cars.some((c) => recentCarIds.has(c.id)) ? 'All' : ''}>
                    {cars.filter((c) => !recentCarIds.has(c.id)).map((car) => (
                      <option key={car.id} value={car.id}>{car.name}</option>
                    ))}
                  </optgroup>
                </select>
              )}
            </div>

            {/* Step 2: Track */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-amber-500 text-slate-900 text-xs font-bold flex items-center justify-center">
                  2
                </div>
                <span className="text-white font-medium text-sm flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-slate-400" /> Select Track
                </span>
                {selectedTrackId && (
                  <button
                    type="button"
                    onClick={() => handleTrackChange(null)}
                    className="ml-auto text-xs text-slate-400 hover:text-white px-2 py-1 rounded-md hover:bg-slate-700 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              {tracksLoading ? (
                <div className="h-10 bg-slate-700 rounded-lg animate-pulse" />
              ) : (
                <select
                  className="select"
                  value={selectedTrackId ?? ''}
                  onChange={(e) => handleTrackChange(e.target.value ? Number(e.target.value) : null)}
                  data-testid="track-select"
                >
                  <option value="">-- Choose a track --</option>
                  {tracks.filter((t) => recentTrackIds.has(t.id)).length > 0 && (
                    <optgroup label="Recent">
                      {tracks.filter((t) => recentTrackIds.has(t.id)).map((track) => (
                        <option key={track.id} value={track.id}>{formatTrackName(track)}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={tracks.some((t) => recentTrackIds.has(t.id)) ? 'All' : ''}>
                    {tracks.filter((t) => !recentTrackIds.has(t.id)).map((track) => (
                      <option key={track.id} value={track.id}>{formatTrackName(track)}</option>
                    ))}
                  </optgroup>
                </select>
              )}
            </div>

            {/* Step 3: Sessions or Laps depending on mode */}
            {selectedCarId && selectedTrackId && (
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-amber-500 text-slate-900 text-xs font-bold flex items-center justify-center">
                    3
                  </div>
                  <span className="text-white font-medium text-sm">
                    {analysisMode === 'sessions' ? 'Select Session' : 'Your Laps'}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-slate-400 ml-auto">
                    <span>Rows</span>
                    <select
                      className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200"
                      value={analysisMode === 'sessions' ? mySessionsLimit : myLapsLimit}
                      onChange={(e) => {
                        if (analysisMode === 'sessions') {
                          setMySessionsLimit(Number(e.target.value))
                          setMySessionsPage(0)
                        } else {
                          setMyLapsLimit(Number(e.target.value))
                          setMyLapsPage(0)
                        }
                      }}
                    >
                      {[10, 25, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Sessions mode */}
                {analysisMode === 'sessions' && (
                  mySessionsLoading ? (
                    <div className="space-y-2">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-12 bg-slate-700 rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : mySessions.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-4">
                      No sessions found for this car &amp; track combination.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1">
                        {mySessions.map((session: Session) => {
                          const isSelected = selectedSessionId === session.id
                          const isExpanded = expandedSessionId === session.id
                          const hasEnoughLaps = session.laps.length >= 2
                          return (
                            <div key={session.id}>
                              <div
                                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors ${
                                  isSelected
                                    ? 'bg-amber-500/10 border border-amber-500/30'
                                    : 'bg-slate-700/40 border border-transparent hover:bg-slate-700/70'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={!hasEnoughLaps}
                                  onChange={() => {
                                    setSelectedSessionId(isSelected ? null : session.id)
                                    if (!isSelected) setExpandedSessionId(session.id)
                                  }}
                                  className="accent-amber-500 flex-shrink-0 cursor-pointer disabled:cursor-not-allowed"
                                />
                                <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                                  <span className="font-mono text-white text-sm">
                                    {formatLapTime(session.best_lap_time)}
                                  </span>
                                  <span className={`text-xs ${hasEnoughLaps ? 'text-slate-400' : 'text-slate-600'}`}>
                                    {session.lap_count} lap{session.lap_count !== 1 ? 's' : ''}
                                    {!hasEnoughLaps && ' (need ≥ 2)'}
                                  </span>
                                  <span className="text-slate-500 text-xs flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {formatDate(session.date)}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setExpandedSessionId(isExpanded ? null : session.id)}
                                  className="p-0.5 text-slate-500 hover:text-slate-300 flex-shrink-0"
                                >
                                  <ChevronRight
                                    className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                  />
                                </button>
                              </div>

                              {/* Expanded laps within session */}
                              {isExpanded && session.laps.length > 0 && (
                                <div className="ml-4 mt-1 mb-1 border-l border-slate-700 pl-3 space-y-0.5">
                                  {[...session.laps]
                                    .sort((a, b) => parseLapTime(a.lap_time) - parseLapTime(b.lap_time))
                                    .map((lap, idx) => (
                                      <div key={lap.id} className="flex items-center gap-3 py-1 text-xs">
                                        <span className="text-slate-600 w-4 text-right flex-shrink-0">{idx + 1}</span>
                                        <span className={`font-mono flex-shrink-0 ${idx === 0 ? 'text-amber-400' : 'text-slate-300'}`}>
                                          {formatLapTime(lap.lap_time)}
                                        </span>
                                        <span className="text-slate-500">
                                          {formatDateTime(lap.recorded_at)}
                                        </span>
                                      </div>
                                    ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-500 mt-3">
                        <button
                          type="button"
                          onClick={() => setMySessionsPage((prev) => Math.max(0, prev - 1))}
                          disabled={mySessionsPage === 0}
                          className="px-2 py-1 rounded-md border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                        >
                          Previous
                        </button>
                        <span>Page {mySessionsPage + 1}</span>
                        <button
                          type="button"
                          onClick={() => setMySessionsPage((prev) => prev + 1)}
                          disabled={mySessions.length < mySessionsLimit}
                          className="px-2 py-1 rounded-md border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                        >
                          Next
                        </button>
                      </div>
                    </>
                  )
                )}

                {/* vs_reference mode — individual lap selection */}
                {analysisMode === 'vs_reference' && (
                  myLapsLoading ? (
                    <div className="space-y-2">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-12 bg-slate-700 rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : myLaps.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-4">
                      No laps found for this car &amp; track combination.
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto -mx-4 px-4">
                        <table className="w-full text-sm min-w-[300px]">
                          <thead>
                            <tr className="text-slate-500 text-xs border-b border-slate-700">
                              <th className="text-left pb-2 font-medium">Select</th>
                              <th className="text-left pb-2 font-medium flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Lap Time
                              </th>
                              <th className="text-left pb-2 font-medium">
                                <Calendar className="w-3 h-3 inline mr-1" />Date
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/50">
                            {myLaps.map((lap: Lap) => {
                              const isSelected = selectedLapId === lap.id
                              return (
                                <tr
                                  key={lap.id}
                                  className={`cursor-pointer transition-colors ${
                                    isSelected ? 'bg-amber-500/10' : 'hover:bg-slate-700/50'
                                  }`}
                                  onClick={() => setSelectedLapId(lap.id)}
                                >
                                  <td className="py-2.5 pr-3">
                                    <input
                                      type="radio"
                                      name="userLap"
                                      checked={isSelected}
                                      onChange={() => setSelectedLapId(lap.id)}
                                      className="accent-amber-500"
                                    />
                                  </td>
                                  <td className="py-2.5 font-mono text-white">
                                    {formatLapTime(lap.lap_time)}
                                  </td>
                                  <td className="py-2.5 text-slate-400">
                                    {formatDate(lap.recorded_at)}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-500 mt-3">
                        <button
                          type="button"
                          onClick={() => setMyLapsPage((prev) => Math.max(0, prev - 1))}
                          disabled={myLapsPage === 0}
                          className="px-2 py-1 rounded-md border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                        >
                          Previous
                        </button>
                        <span>Page {myLapsPage + 1}</span>
                        <button
                          type="button"
                          onClick={() => setMyLapsPage((prev) => prev + 1)}
                          disabled={myLaps.length < myLapsLimit}
                          className="px-2 py-1 rounded-md border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                        >
                          Next
                        </button>
                      </div>
                    </>
                  )
                )}
              </div>
            )}

            {/* Step 4: Reference Laps — hidden in sessions mode */}
            {selectedCarId && selectedTrackId && analysisMode === 'vs_reference' && (
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-amber-500 text-slate-900 text-xs font-bold flex items-center justify-center">
                    4
                  </div>
                  <span className="text-white font-medium text-sm">Reference Laps</span>
                  <span className="text-slate-500 text-xs">(Top 5 fastest)</span>
                </div>

                {refLapsLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-10 bg-slate-700 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : refLaps.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-4">
                    No reference laps available.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {refLaps.map((lap: Lap, idx: number) => (
                      <label
                        key={lap.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                          selectedRefIds.has(lap.id)
                            ? 'bg-orange-500/10 border border-orange-500/30'
                            : 'bg-slate-700/40 border border-transparent hover:bg-slate-700/70'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedRefIds.has(lap.id)}
                          onChange={() => toggleRefLap(lap.id)}
                          className="accent-orange-500 flex-shrink-0"
                        />
                        <span className="text-slate-500 font-mono text-xs w-5 text-right flex-shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-orange-400 font-mono text-xs flex-shrink-0">
                          {formatLapTime(lap.lap_time)}
                        </span>
                        <span className="text-white text-xs truncate flex-1 min-w-0">
                          {lap.driver_name}
                        </span>
                        {lap.irating != null && (
                          <span className="text-slate-500 text-xs flex-shrink-0 font-mono">
                            iR {lap.irating.toLocaleString()}
                          </span>
                        )}
                        {lap.season && (
                          <span className="text-slate-600 text-xs flex-shrink-0 truncate max-w-[72px]">
                            {lap.season}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Analyse Button */}
            {selectedCarId && selectedTrackId && (
              <button
                onClick={() => analysisMutation.mutate()}
                disabled={!canAnalyse}
                className="btn-primary flex items-center justify-center gap-2 py-3 text-base w-full"
              >
                {analysisMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <BarChart2 className="w-5 h-5" />
                    <span>{analysisMode === 'sessions' ? 'Analyse Session' : 'Analyse Lap'}</span>
                  </>
                )}
              </button>
            )}

            {analysisMutation.isError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                Analysis failed. Please try again.
              </div>
            )}
          </div>

          {/* Right column: Recent Activity + Analysis History */}
          <div className="flex flex-col gap-4" data-testid="analysis-history">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
            </div>

            {recentLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-16 bg-slate-800 rounded-xl border border-slate-700 animate-pulse" />
                ))}
              </div>
            ) : recentLaps.length === 0 ? (
              <div className="card flex flex-col items-center py-8 text-center">
                <Calendar className="w-8 h-8 text-slate-600 mb-2" />
                <p className="text-slate-400 text-sm">No recent activity yet.</p>
                <p className="text-slate-500 text-xs mt-1">Your latest laps will show up here.</p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {recentPageLaps.map((lap) => {
                    const { carId, trackId } = resolveRecentIds(lap)
                    const canApply = Boolean(carId && trackId)
                    return (
                      <button
                        key={lap.id}
                        type="button"
                        onClick={() => applyRecentFilters(carId, trackId)}
                        disabled={!canApply}
                        title={
                          canApply
                            ? 'Use this car and track for filtering'
                            : 'Car or track not available for filtering'
                        }
                        className={`card text-left transition-colors w-full ${
                          canApply ? 'hover:bg-slate-700' : 'opacity-70 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm">
                              <Car className="w-4 h-4 text-slate-500" />
                              <span className="text-white truncate">{lap.car_name}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm mt-1">
                              <MapPin className="w-4 h-4 text-slate-500" />
                              <span className="text-slate-300 truncate">{lap.track_name}</span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            <span className="text-slate-500 text-xs text-right">
                              {formatDateTime(lap.recorded_at)}
                            </span>
                            <a
                              href={`https://garage61.net/app/laps`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 text-slate-500 hover:text-amber-400 text-xs transition-colors"
                              title="Open in Garage61"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Garage61</span>
                            </a>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
                {recentTotalPages > 1 && (
                  <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                    <button
                      type="button"
                      onClick={() => setRecentPage((p) => Math.max(0, p - 1))}
                      disabled={recentPage === 0}
                      className="px-2 py-1 rounded-md border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                    >
                      Previous
                    </button>
                    <span>Page {recentPage + 1} / {recentTotalPages}</span>
                    <button
                      type="button"
                      onClick={() => setRecentPage((p) => Math.min(recentTotalPages - 1, p + 1))}
                      disabled={recentPage >= recentTotalPages - 1}
                      className="px-2 py-1 rounded-md border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}

            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Analysis History</h2>
              {filteredHistory.length > 0 && (
                <span className="text-xs text-slate-500">{filteredHistory.length} total</span>
              )}
            </div>

            {historyLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-14 bg-slate-800 rounded-xl border border-slate-700 animate-pulse" />
                ))}
              </div>
            ) : filteredHistory.length === 0 ? (
              <div
                className="card flex flex-col items-center py-10 text-center"
                data-testid="analysis-history-empty"
              >
                <BarChart2 className="w-10 h-10 text-slate-600 mb-3" />
                <p className="text-slate-400 text-sm">No analyses yet.</p>
                <p className="text-slate-500 text-xs mt-1">
                  Run your first analysis to get started.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {pagedHistory.map((item: AnalysisHistoryItem) => {
                    const isSoloItem = item.analysis_mode === 'solo'
                    return (
                    <div key={item.id} className="relative group">
                      <button
                        data-testid="analysis-history-item"
                        onClick={() => navigate(`/report/${item.id}`)}
                        className={`w-full card text-left hover:bg-slate-700 transition-colors pr-10 py-2.5 border-l-2 ${
                          isSoloItem ? 'border-l-violet-500/50' : 'border-l-orange-500/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Row 1: badge · car @ track · time gain */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                                isSoloItem
                                  ? 'bg-violet-500/15 text-violet-400'
                                  : 'bg-orange-500/15 text-orange-400'
                              }`}>
                                {isSoloItem ? 'Session' : 'Reference'}
                              </span>
                              {item.status === 'enqueued' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-slate-600/40 text-slate-400 flex-shrink-0">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  In queue
                                </span>
                              )}
                              {item.status === 'processing' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400 flex-shrink-0">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  Processing
                                </span>
                              )}
                              {item.status === 'failed' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400 flex-shrink-0">
                                  Failed
                                </span>
                              )}
                              <span className="text-white font-medium text-sm truncate">
                                {item.car_name}
                              </span>
                              <span className="text-slate-500 text-xs">@</span>
                              <span className="text-slate-300 text-sm truncate">
                                {item.track_name}
                              </span>
                              {item.estimated_time_gain_seconds != null && item.estimated_time_gain_seconds > 0 && (
                                <span className="inline-flex items-center gap-1 bg-amber-500/20 border border-amber-500/30 text-amber-400 font-semibold text-xs px-2 py-0.5 rounded-full flex-shrink-0">
                                  <Zap className="w-3 h-3" />
                                  +{item.estimated_time_gain_seconds.toFixed(1)}s
                                </span>
                              )}
                            </div>
                            {/* Row 2: lap IDs · date */}
                            <div className="flex items-center gap-1.5 flex-wrap text-xs text-slate-500 mt-1">
                              {isSoloItem ? (
                                <>
                                  <span className="font-mono bg-slate-700/60 px-1.5 py-0.5 rounded text-slate-400">
                                    {item.lap_id.slice(0, 8)}
                                  </span>
                                  <span className="text-slate-600">·</span>
                                  <span>{item.reference_lap_ids.length + 1} laps from session</span>
                                </>
                              ) : (
                                <>
                                  <span className="font-mono bg-slate-700/60 px-1.5 py-0.5 rounded text-slate-400">
                                    {item.lap_id.slice(0, 8)}
                                  </span>
                                  {item.reference_lap_ids.length > 0 && (
                                    <>
                                      <span>vs</span>
                                      {item.reference_lap_ids.slice(0, 3).map((rid) => (
                                        <span key={rid} className="font-mono bg-slate-700/60 px-1.5 py-0.5 rounded text-slate-500">
                                          {rid.slice(0, 8)}
                                        </span>
                                      ))}
                                      {item.reference_lap_ids.length > 3 && (
                                        <span className="text-slate-600">+{item.reference_lap_ids.length - 3} more</span>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-600">{formatDateTime(item.created_at)}</span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-amber-500 flex-shrink-0 transition-colors" />
                        </div>
                      </button>

                      {/* Delete button — confirm on second click */}
                      {confirmDeleteId === item.id ? (
                        <div className="absolute top-2 right-2 flex items-center gap-1">
                          <button
                            onClick={() => deleteMutation.mutate(item.id)}
                            disabled={deleteMutation.isPending}
                            className="px-2 py-0.5 rounded text-xs bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
                          >
                            {deleteMutation.isPending ? '…' : 'Delete'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(item.id) }}
                          className="absolute top-2 right-2 p-1.5 rounded-md text-red-500 hover:text-red-400 hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete analysis"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    )
                  })}
                </div>

                {/* Pagination */}
                {historyTotalPages > 1 && (
                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                      disabled={historyPage === 0}
                      className="px-3 py-1 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-slate-500">
                      {historyPage + 1} / {historyTotalPages}
                    </span>
                    <button
                      onClick={() => setHistoryPage((p) => Math.min(historyTotalPages - 1, p + 1))}
                      disabled={historyPage >= historyTotalPages - 1}
                      className="px-3 py-1 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
