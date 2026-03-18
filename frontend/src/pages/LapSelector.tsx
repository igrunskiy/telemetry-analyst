import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { LogOut, User, ChevronRight, Clock, Calendar, Loader2, Car, MapPin, BarChart2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  getCars,
  getTracks,
  getMyLaps,
  getRecentLaps,
  getReferenceLaps,
  getAnalysisHistory,
  runAnalysis,
  logout,
} from '../api/client'
import type { Lap, AnalysisHistoryItem, Track } from '../types'

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

function formatTrackName(track: Track): string {
  const variant = track.variant || track.config
  if (variant && variant.trim() && variant !== track.name) {
    return `${track.name} - ${variant}`
  }
  return track.name
}

const ANALYSIS_STEPS = [
  'Fetching telemetry data...',
  'Processing lap channels...',
  'Comparing racing lines...',
  'Running AI analysis...',
  'Generating coaching report...',
]

export default function LapSelectorPage() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [selectedCarId, setSelectedCarId] = useState<number | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [selectedLapId, setSelectedLapId] = useState<string | null>(null)
  const [selectedRefIds, setSelectedRefIds] = useState<Set<string>>(new Set())
  const [analysisStep, setAnalysisStep] = useState(0)
  const [myLapsLimit, setMyLapsLimit] = useState(25)
  const [myLapsPage, setMyLapsPage] = useState(0)

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
    enabled: selectedCarId !== null && selectedTrackId !== null,
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
    queryFn: () => getRecentLaps(5),
  })

  // Auto-select top 5 reference laps when they load
  useEffect(() => {
    if (refLaps.length > 0) {
      setSelectedRefIds(new Set(refLaps.map((l) => l.id)))
    }
  }, [refLaps])

  // Reset lap selection when car/track change
  function handleCarChange(carId: number | null) {
    setSelectedCarId(carId)
    setSelectedLapId(null)
    setSelectedRefIds(new Set())
    setMyLapsPage(0)
  }

  function handleTrackChange(trackId: number | null) {
    setSelectedTrackId(trackId)
    setSelectedLapId(null)
    setSelectedRefIds(new Set())
    setMyLapsPage(0)
  }

  function applyRecentFilters(carId: number | null, trackId: number | null) {
    if (!carId || !trackId) {
      return
    }
    setSelectedCarId(carId)
    setSelectedTrackId(trackId)
    setSelectedLapId(null)
    setSelectedRefIds(new Set())
    setMyLapsPage(0)
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

  // Analysis mutation
  const analysisMutation = useMutation({
    mutationFn: async () => {
      const lap = myLaps.find((l) => l.id === selectedLapId)!
      // Cycle through status messages while waiting
      let step = 0
      const interval = setInterval(() => {
        step = Math.min(step + 1, ANALYSIS_STEPS.length - 1)
        setAnalysisStep(step)
      }, 3500)

      try {
        const result = await runAnalysis(
          selectedLapId!,
          Array.from(selectedRefIds),
          lap.car_name,
          lap.track_name,
        )
        clearInterval(interval)
        return result
      } catch (e) {
        clearInterval(interval)
        throw e
      }
    },
    onSuccess: (report) => {
      navigate(`/report/${report.id}`)
    },
    onMutate: () => {
      setAnalysisStep(0)
    },
  })

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      window.location.href = '/login'
    }
  }

  const canAnalyse =
    selectedLapId !== null && selectedRefIds.size > 0 && !analysisMutation.isPending

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
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

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column: Steps 1-4 */}
          <div className="flex flex-col gap-5">
            <h2 className="text-lg font-semibold text-white">New Analysis</h2>

            {/* Step 1: Car */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-amber-500 text-slate-900 text-xs font-bold flex items-center justify-center">
                  1
                </div>
                <span className="text-white font-medium text-sm flex items-center gap-1.5">
                  <Car className="w-4 h-4 text-slate-400" /> Select Car
                </span>
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
                  {cars.map((car) => (
                    <option key={car.id} value={car.id}>
                      {car.name}
                    </option>
                  ))}
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
                  {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {formatTrackName(track)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Step 3: Your Laps */}
            {selectedCarId && selectedTrackId && (
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-amber-500 text-slate-900 text-xs font-bold flex items-center justify-center">
                    3
                  </div>
                  <span className="text-white font-medium text-sm">Your Laps</span>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>Rows</span>
                    <select
                      className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200"
                      value={myLapsLimit}
                      onChange={(e) => {
                        setMyLapsLimit(Number(e.target.value))
                        setMyLapsPage(0)
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

                {myLapsLoading ? (
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
                          {myLaps.map((lap: Lap) => (
                            <tr
                              key={lap.id}
                              className={`cursor-pointer transition-colors ${
                                selectedLapId === lap.id
                                  ? 'bg-amber-500/10'
                                  : 'hover:bg-slate-700/50'
                              }`}
                              onClick={() => setSelectedLapId(lap.id)}
                            >
                              <td className="py-2.5 pr-3">
                                <input
                                  type="radio"
                                  name="userLap"
                                  checked={selectedLapId === lap.id}
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
                          ))}
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
                )}
              </div>
            )}

            {/* Step 4: Reference Laps */}
            {selectedCarId && selectedTrackId && (
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
                  <div className="space-y-2">
                    {refLaps.map((lap: Lap, idx: number) => (
                      <label
                        key={lap.id}
                        className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                          selectedRefIds.has(lap.id)
                            ? 'bg-orange-500/10 border border-orange-500/30'
                            : 'bg-slate-700/50 border border-transparent hover:bg-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedRefIds.has(lap.id)}
                          onChange={() => toggleRefLap(lap.id)}
                          className="accent-orange-500 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 font-mono">
                              #{idx + 1}
                            </span>
                            <span className="text-white text-sm truncate">
                              {lap.driver_name}
                            </span>
                          </div>
                          <span className="text-orange-400 font-mono text-xs">
                            {formatLapTime(lap.lap_time)}
                          </span>
                        </div>
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
                    <span>{ANALYSIS_STEPS[analysisStep]}</span>
                  </>
                ) : (
                  <>
                    <BarChart2 className="w-5 h-5" />
                    <span>Analyse Lap</span>
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
              <div className="space-y-3">
                {recentLaps.map((lap) => {
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
                      className={`card text-left transition-colors ${
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
                      <span className="text-slate-500 text-xs flex-shrink-0">
                        {formatDate(lap.recorded_at)}
                      </span>
                    </div>
                  </button>
                  )
                })}
              </div>
            )}

            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Analysis History</h2>
            </div>

            {historyLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-20 bg-slate-800 rounded-xl border border-slate-700 animate-pulse" />
                ))}
              </div>
            ) : history.length === 0 ? (
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
              <div className="space-y-3">
                {history.map((item: AnalysisHistoryItem) => (
                  <button
                    key={item.id}
                    data-testid="analysis-history-item"
                    onClick={() => navigate(`/report/${item.id}`)}
                    className="w-full card text-left hover:bg-slate-700 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white font-medium text-sm truncate">
                            {item.car_name}
                          </span>
                          <span className="text-slate-500 text-xs">@</span>
                          <span className="text-slate-300 text-sm truncate">
                            {item.track_name}
                          </span>
                        </div>
                        <p className="text-slate-500 text-xs line-clamp-2 leading-relaxed">
                          {item.summary}
                        </p>
                        <span className="text-slate-600 text-xs mt-1 block">
                          {formatDate(item.created_at)}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-amber-500 flex-shrink-0 mt-1 transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

