import { useState, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, User, ChevronRight, Calendar, Loader2, Car, MapPin, BarChart2, Trash2, Zap, Activity, History, Shield, Upload, FileText, Pencil, Save, X, ThermometerSun, Waves, Wind, Filter } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'
import { useAuth } from '../hooks/useAuth'
import { adminListPrompts } from '../api/client'
import type { PromptMeta } from '../types'
import {
  getCars,
  getTracks,
  getMyLaps,
  getRecentLaps,
  getReferenceLaps,
  getAnalysisHistory,
  inspectTelemetryFiles,
  importTelemetryFiles,
  getImportedTelemetry,
  updateImportedTelemetry,
  deleteImportedTelemetry,
  getGarage61Dictionary,
  syncGarage61Dictionary,
  runAnalysis,
  deleteAnalysis,
  logout,
} from '../api/client'
import type { Lap, AnalysisHistoryItem, Car as CarType, Track, UploadInspection, ImportedTelemetry, Garage61DictionaryEntry, RecentActivity } from '../types'

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

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatDateTime(dateStr: string): string {
  const parsed = parseDate(dateStr)
  if (!parsed) return '—'
  const date = parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  // Only show time if the value contained a time component (not just a date string)
  const hasTime = /[T ]/.test(dateStr) && !/T00:00:00/.test(dateStr)
  if (!hasTime) return date
  const time = parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase()
  return `${date} ${time}`
}

function formatTemperature(value?: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null
  return `${Math.round(value)}°C`
}

function normalizeWindDegrees(value?: string | number | null): number | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) return null
    value = parsed
  }
  if (!Number.isFinite(value)) return null
  if (Math.abs(value) <= Math.PI * 2 + 0.001) {
    const deg = (value * 180) / Math.PI
    return ((deg % 360) + 360) % 360
  }
  return ((value % 360) + 360) % 360
}

function windDirectionLabel(value?: string | number | null): string | null {
  const deg = normalizeWindDegrees(value)
  if (deg == null) return null
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const index = Math.round(deg / 45) % 8
  return directions[index]
}

function formatWind(value?: string | number | null, speedKph?: number | null): string | null {
  const direction = windDirectionLabel(value)
  const speed = speedKph != null && Number.isFinite(speedKph) ? `${Math.round(speedKph)}` : null
  if (direction && speed) return `${direction} ${speed} kph`
  if (speed) return `${speed} kph`
  return direction
}

function ConditionIconChip({ icon, label, title }: { icon: ReactNode, label: string, title?: string }) {
  return (
    <span
      title={title ?? label}
      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300"
    >
      {icon}
      <span>{label}</span>
    </span>
  )
}

function renderConditionChips(conditions?: Lap['conditions'] | null, compact = false) {
  if (!conditions) return null
  const air = formatTemperature(conditions.air_temp_c)
  const track = formatTemperature(conditions.track_temp_c)
  const wind = formatWind(conditions.wind_direction, conditions.wind_kph)
  if (!air && !track && !wind) return null
  return (
    <div className={`${compact ? '' : 'mt-1 '}flex flex-wrap items-center gap-1`}>
      {track ? (
        <ConditionIconChip
          icon={<Waves className="w-3 h-3 text-amber-300" />}
          label={track}
          title={`Track ${track}`}
        />
      ) : null}
      {air ? (
        <ConditionIconChip
          icon={<ThermometerSun className="w-3 h-3 text-orange-300" />}
          label={air}
          title={`Air ${air}`}
        />
      ) : null}
      {wind ? (
        <ConditionIconChip
          icon={<Wind className="w-3 h-3 text-sky-300" />}
          label={wind}
          title={`Wind ${wind}`}
        />
      ) : null}
    </div>
  )
}

function pickBestLapFromRecentActivity(activity: RecentActivity): Lap | null {
  if (!activity.laps?.length) return null
  return activity.laps.reduce((best, lap) => (
    parseLapTime(lap.lap_time) < parseLapTime(best.lap_time) ? lap : best
  ), activity.laps[0])
}

function formatTrackName(track: Track): string {
  const variant = track.variant || track.config
  if (variant && variant.trim() && variant !== track.name) {
    return `${track.name} - ${variant}`
  }
  return track.name
}

function normalizeDriverName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function buildDriverKey(value: string): string | undefined {
  const key = normalizeDriverName(value).toLowerCase().replace(/[^a-z0-9]/g, '')
  return key || undefined
}

function getLapSourceLabel(lapId: string): 'upload' | 'g61' {
  return lapId.startsWith('upload:') ? 'upload' : 'g61'
}

function sortSessionLapsChronologically(laps: Lap[]): Lap[] {
  return [...laps].sort((a, b) => {
    const aTime = parseDate(a.recorded_at)?.getTime()
    const bTime = parseDate(b.recorded_at)?.getTime()
    if (aTime != null && bTime != null) return aTime - bTime
    if (aTime != null) return -1
    if (bTime != null) return 1
    return 0
  })
}

function pickSessionConsecutiveWindow(laps: Lap[], windowSize = 6): Lap[] {
  const ordered = sortSessionLapsChronologically(laps)
  if (ordered.length <= windowSize) {
    return ordered
  }

  const fastestIndex = ordered.reduce((bestIdx, lap, idx, arr) => (
    parseLapTime(lap.lap_time) < parseLapTime(arr[bestIdx].lap_time) ? idx : bestIdx
  ), 0)

  let bestStart = 0
  let bestSpan = Number.POSITIVE_INFINITY
  let bestDistanceToFastest = Number.POSITIVE_INFINITY

  for (let start = 0; start <= ordered.length - windowSize; start += 1) {
    const window = ordered.slice(start, start + windowSize)
    const firstTime = parseDate(window[0].recorded_at)?.getTime()
    const lastTime = parseDate(window[window.length - 1].recorded_at)?.getTime()
    const span = firstTime != null && lastTime != null ? lastTime - firstTime : windowSize
    const distanceToFastest = fastestIndex < start
      ? start - fastestIndex
      : fastestIndex >= start + windowSize
        ? fastestIndex - (start + windowSize - 1)
        : 0

    if (
      span < bestSpan
      || (span === bestSpan && distanceToFastest < bestDistanceToFastest)
      || (span === bestSpan && distanceToFastest === bestDistanceToFastest && start < bestStart)
    ) {
      bestStart = start
      bestSpan = span
      bestDistanceToFastest = distanceToFastest
    }
  }

  return ordered.slice(bestStart, bestStart + windowSize)
}

function buildSessionAnalysisLaps(
  laps: Lap[],
  windowSize = 6,
): { primary: Lap | null, references: Lap[], consecutiveLaps: Lap[] } {
  const ordered = sortSessionLapsChronologically(laps)
  if (ordered.length === 0) {
    return { primary: null, references: [], consecutiveLaps: [] }
  }

  const consecutiveLaps = pickSessionConsecutiveWindow(ordered, windowSize)
  const fastestLap = ordered.reduce((best, lap) => (
    parseLapTime(lap.lap_time) < parseLapTime(best.lap_time) ? lap : best
  ), ordered[0])

  const references = consecutiveLaps
    .filter((lap) => lap.id !== fastestLap.id)
    .slice(0, Math.max(windowSize - 1, 0))

  return {
    primary: fastestLap ?? null,
    references,
    consecutiveLaps,
  }
}

type UploadTab = 'files' | 'metadata'
type PageTab = 'analysis' | 'import'

type UploadedLapDraft = {
  localId: string
  file: File
  fileName: string
  detectedCarName: string
  detectedTrackName: string
  role: 'user' | 'reference'
  driver_name: string
  lap_time: string
  recorded_at: string
  air_temp_c: string
  track_temp_c: string
  source: 'custom'
  valid: boolean
  error: string | null
  sample_count: number
  track_length_m?: number | null
}

type ImportedTelemetryEditDraft = {
  car_name: string
  track_name: string
  driver_name: string
  lap_time: string
  recorded_at: string
}

function buildUploadDraft(file: File, accountOwnerName: string, inspection?: UploadInspection): UploadedLapDraft {
  const meta = inspection?.metadata ?? {}
  return {
    localId: `${file.name}-${file.size}-${file.lastModified}`,
    file,
    fileName: file.name,
    detectedCarName: meta.car_name ?? '',
    detectedTrackName: meta.track_name ?? '',
    role: 'reference',
    driver_name: accountOwnerName || meta.driver_name || '',
    lap_time: meta.lap_time ? formatLapTime(meta.lap_time) : '',
    recorded_at: meta.recorded_at ?? '',
    air_temp_c: '',
    track_temp_c: '',
    source: 'custom',
    valid: inspection?.valid ?? true,
    error: inspection?.error ?? null,
    sample_count: inspection?.sample_count ?? 0,
    track_length_m: inspection?.track_length_m,
  }
}

export default function LapSelectorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const accountOwnerName = normalizeDriverName(user?.display_name ?? '')
  const restoredFilterState = location.state as { selectedCarId?: string | number | null; selectedTrackId?: string | number | null } | null

  const [pageTab, setPageTab] = useState<PageTab>('analysis')
  const [uploadTab, setUploadTab] = useState<UploadTab>('files')
  const [llmModel, setLlmModel] = useState<'claude' | 'gemini' | 'openai'>('claude')
  const [promptVersion, setPromptVersion] = useState<string>('default')
  const [uploadCarName, setUploadCarName] = useState('')
  const [uploadTrackName, setUploadTrackName] = useState('')
  const [carQuery, setCarQuery] = useState('')
  const [trackQuery, setTrackQuery] = useState('')
  const [showCarSuggestions, setShowCarSuggestions] = useState(false)
  const [showTrackSuggestions, setShowTrackSuggestions] = useState(false)
  const [uploadedLaps, setUploadedLaps] = useState<UploadedLapDraft[]>([])
  const [isInspectingUploads, setIsInspectingUploads] = useState(false)
  const [editingImportedId, setEditingImportedId] = useState<string | null>(null)
  const [importedEditDraft, setImportedEditDraft] = useState<ImportedTelemetryEditDraft | null>(null)
  const [selectedCarId, setSelectedCarId] = useState<string | number | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<string | number | null>(null)
  const [selectedLapId, setSelectedLapId] = useState<string | null>(null)
  const [selectedRefIds, setSelectedRefIds] = useState<Set<string>>(new Set())
  const [refLapLimit, setRefLapLimit] = useState(5)
  const MAX_SELECTED_REFERENCE_LAPS = 3
  const [refLapsPage, setRefLapsPage] = useState(0)
  const REF_LAPS_PAGE_SIZE = 5
  const [myLapsPage, setMyLapsPage] = useState(0)
  const [myLapsSort, setMyLapsSort] = useState<'time' | 'date'>('time')
  const MY_LAPS_PAGE_SIZE = 5
  const [recentPage, setRecentPage] = useState(0)
  const [recentSourceFilter, setRecentSourceFilter] = useState<'all' | 'garage61' | 'upload'>('all')
  const RECENT_PAGE_SIZE = 5
  const [historyPage, setHistoryPage] = useState(0)
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | 'reference' | 'patterns'>('all')
  const HISTORY_PAGE_SIZE = 5

  // Data fetching
  const { data: cars = [], isLoading: carsLoading } = useQuery({
    queryKey: ['cars'],
    queryFn: getCars,
    enabled: true,
    staleTime: 5 * 60 * 1000,
  })

  const { data: tracks = [], isLoading: tracksLoading } = useQuery({
    queryKey: ['tracks'],
    queryFn: getTracks,
    enabled: true,
    staleTime: 5 * 60 * 1000,
  })

  const { data: myLaps = [], isLoading: myLapsLoading } = useQuery({
    queryKey: ['myLaps', selectedCarId, selectedTrackId, myLapsPage],
    queryFn: () =>
      getMyLaps(selectedCarId!, selectedTrackId!, 100, 0),
    enabled: selectedCarId !== null && selectedTrackId !== null,
  })

  const { data: refLaps = [], isLoading: refLapsLoading } = useQuery({
    queryKey: ['refLaps', selectedCarId, selectedTrackId, refLapLimit],
    queryFn: () =>
      getReferenceLaps(selectedCarId!, selectedTrackId!, refLapLimit),
    enabled: selectedCarId !== null && selectedTrackId !== null,
  })

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['analysisHistory'],
    queryFn: getAnalysisHistory,
    staleTime: 30 * 1000,
  })

  const isAdmin = user?.role === 'admin'
  const isStaff = user?.role === 'admin' || user?.role === 'moderator'
  const { data: availablePrompts = [] } = useQuery<PromptMeta[]>({
    queryKey: ['admin', 'prompts'],
    queryFn: adminListPrompts,
    enabled: isAdmin,
  })

  const { data: recentLaps = [], isLoading: recentLoading } = useQuery<RecentActivity[]>({
    queryKey: ['recentLaps', selectedCarId, selectedTrackId, recentSourceFilter],
    queryFn: () =>
      getRecentLaps(100, {
        carId: selectedCarId,
        trackId: selectedTrackId,
        source: recentSourceFilter,
      }),
    staleTime: 60 * 1000,
  })

  const { data: importedTelemetry = [] } = useQuery({
    queryKey: ['importedTelemetry'],
    queryFn: getImportedTelemetry,
    staleTime: 60 * 1000,
  })
  const { data: garage61CarDictionary = [] } = useQuery({
    queryKey: ['garage61Dictionary', 'car'],
    queryFn: () => getGarage61Dictionary('car'),
    staleTime: 10 * 60 * 1000,
  })
  const { data: garage61TrackDictionary = [] } = useQuery({
    queryKey: ['garage61Dictionary', 'track'],
    queryFn: () => getGarage61Dictionary('track'),
    staleTime: 10 * 60 * 1000,
  })
  const garage61CarNames = new Set(garage61CarDictionary.map((entry) => entry.name))
  const garage61TrackNames = new Set(garage61TrackDictionary.map((entry) => entry.display_name))
  const filteredRecentLaps = recentLaps
  const recentPageLaps = filteredRecentLaps.slice(recentPage * RECENT_PAGE_SIZE, (recentPage + 1) * RECENT_PAGE_SIZE)
  const recentTotalPages = Math.ceil(filteredRecentLaps.length / RECENT_PAGE_SIZE)

  const recentCarIds = new Set(
    recentLaps
      .filter((l: RecentActivity) => !selectedTrackId || l.track_id === selectedTrackId)
      .map((l: RecentActivity) => l.car_id)
      .filter(Boolean)
  )
  const recentTrackIds = new Set(
    recentLaps
      .filter((l: RecentActivity) => !selectedCarId || l.car_id === selectedCarId)
      .map((l: RecentActivity) => l.track_id)
      .filter(Boolean)
  )

  const filteredHistory = history.filter((item: AnalysisHistoryItem) => {
    if (historyTypeFilter === 'reference' && item.analysis_mode !== 'vs_reference') {
      return false
    }
    if (historyTypeFilter === 'patterns' && item.analysis_mode !== 'solo') {
      return false
    }
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
  const sortedMyLaps = useMemo(() => {
    const next = [...myLaps]
    if (myLapsSort === 'date') {
      next.sort((a, b) => {
        const aTime = parseDate(a.recorded_at)?.getTime() ?? 0
        const bTime = parseDate(b.recorded_at)?.getTime() ?? 0
        return bTime - aTime
      })
      return next
    }
    next.sort((a, b) => parseLapTime(a.lap_time) - parseLapTime(b.lap_time))
    return next
  }, [myLaps, myLapsSort])
  const pagedMyLaps = sortedMyLaps.slice(myLapsPage * MY_LAPS_PAGE_SIZE, (myLapsPage + 1) * MY_LAPS_PAGE_SIZE)
  const pagedRefLaps = refLaps.slice(refLapsPage * REF_LAPS_PAGE_SIZE, (refLapsPage + 1) * REF_LAPS_PAGE_SIZE)
  const refLapsTotalPages = Math.ceil(refLaps.length / REF_LAPS_PAGE_SIZE)
  const recentCars = cars.filter((c) => recentCarIds.has(c.id))
  const otherCars = cars.filter((c) => !recentCarIds.has(c.id))
  const recentTracks = tracks.filter((t) => recentTrackIds.has(t.id))
  const otherTracks = tracks.filter((t) => !recentTrackIds.has(t.id))
  const filteredRecentCars = useMemo(() => {
    const query = carQuery.trim().toLowerCase()
    if (!query) return recentCars
    return recentCars.filter((car) => car.name.toLowerCase().includes(query))
  }, [carQuery, recentCars])
  const filteredOtherCars = useMemo(() => {
    const query = carQuery.trim().toLowerCase()
    if (!query) return otherCars
    return otherCars.filter((car) => car.name.toLowerCase().includes(query))
  }, [carQuery, otherCars])
  const filteredRecentTracks = useMemo(() => {
    const query = trackQuery.trim().toLowerCase()
    if (!query) return recentTracks
    return recentTracks.filter((track) => formatTrackName(track).toLowerCase().includes(query))
  }, [trackQuery, recentTracks])
  const filteredOtherTracks = useMemo(() => {
    const query = trackQuery.trim().toLowerCase()
    if (!query) return otherTracks
    return otherTracks.filter((track) => formatTrackName(track).toLowerCase().includes(query))
  }, [trackQuery, otherTracks])

  useEffect(() => {
    const selectedCar = cars.find((car) => car.id === selectedCarId)
    setCarQuery(selectedCar ? selectedCar.name : '')
  }, [cars, selectedCarId])

  useEffect(() => {
    const selectedTrack = tracks.find((track) => track.id === selectedTrackId)
    setTrackQuery(selectedTrack ? formatTrackName(selectedTrack) : '')
  }, [tracks, selectedTrackId])

  useEffect(() => {
    const nextCarId = restoredFilterState?.selectedCarId
    const nextTrackId = restoredFilterState?.selectedTrackId
    if (nextCarId == null && nextTrackId == null) return
    setSelectedCarId(nextCarId ?? null)
    setSelectedTrackId(nextTrackId ?? null)
    navigate(location.pathname, { replace: true, state: null })
  }, [restoredFilterState, navigate, location.pathname])

  // Reset lap/session selection when car/track change
  function handleCarChange(carId: string | number | null) {
    setSelectedCarId(carId)
    setSelectedLapId(null)
    setSelectedRefIds(new Set())
    setRefLapsPage(0)
    setMyLapsPage(0)
    setRecentPage(0)
    setHistoryPage(0)
  }

  function handleTrackChange(trackId: string | number | null) {
    setSelectedTrackId(trackId)
    setSelectedLapId(null)
    setSelectedRefIds(new Set())
    setRefLapsPage(0)
    setMyLapsPage(0)
    setRecentPage(0)
    setHistoryPage(0)
  }

  function handleCarInputChange(value: string) {
    setCarQuery(value)
    const trimmed = value.trim()
    if (!trimmed) {
      handleCarChange(null)
      return
    }
    const matchedCar = cars.find((car) => car.name.toLowerCase() === trimmed.toLowerCase())
    if (matchedCar) {
      handleCarChange(matchedCar.id)
      return
    }
    if (selectedCarId !== null) {
      handleCarChange(null)
    }
  }

  function handleTrackInputChange(value: string) {
    setTrackQuery(value)
    const trimmed = value.trim()
    if (!trimmed) {
      handleTrackChange(null)
      return
    }
    const matchedTrack = tracks.find((track) => formatTrackName(track).toLowerCase() === trimmed.toLowerCase())
    if (matchedTrack) {
      handleTrackChange(matchedTrack.id)
      return
    }
    if (selectedTrackId !== null) {
      handleTrackChange(null)
    }
  }

  function selectCarOption(car: CarType) {
    setCarQuery(car.name)
    handleCarChange(car.id)
    setShowCarSuggestions(false)
  }

  function selectTrackOption(track: Track) {
    setTrackQuery(formatTrackName(track))
    handleTrackChange(track.id)
    setShowTrackSuggestions(false)
  }

  async function applyRecentFilters(
    carId: string | number | null,
    trackId: string | number | null,
    sourceOverride: 'all' | 'garage61' | 'upload' = 'all',
  ) {
    if (!carId || !trackId) {
      return
    }
    setSelectedCarId(carId)
    setSelectedTrackId(trackId)
    setRecentSourceFilter(sourceOverride)
    setSelectedLapId(null)
    setSelectedRefIds(new Set())
    setRefLapsPage(0)
    setMyLapsPage(0)
    setRecentPage(0)
    setHistoryPage(0)

    await Promise.allSettled([
      queryClient.fetchQuery({
        queryKey: ['myLaps', carId, trackId, 0],
        queryFn: () => getMyLaps(carId, trackId, 100, 0),
      }),
      queryClient.fetchQuery({
        queryKey: ['refLaps', carId, trackId, refLapLimit],
        queryFn: () => getReferenceLaps(carId, trackId, refLapLimit),
      }),
      queryClient.fetchQuery({
        queryKey: ['recentLaps', carId, trackId, sourceOverride],
        queryFn: () => getRecentLaps(100, {
          carId,
          trackId,
          source: sourceOverride,
        }),
      }),
    ])
  }

  function resolveRecentIds(lap: RecentActivity) {
    const carIds = new Set(cars.map((c: CarType) => c.id))
    const trackIds = new Set(tracks.map((t: Track) => t.id))
    const carId =
      (lap.car_id && carIds.has(lap.car_id) ? lap.car_id : null) ??
      cars.find((c: CarType) => c.name === lap.car_name)?.id ??
      null
    const trackId =
      (lap.track_id && trackIds.has(lap.track_id) ? lap.track_id : null) ??
      tracks.find((track) => formatTrackName(track) === lap.track_name)?.id ??
      null
    return { carId, trackId }
  }

  async function handleUploadFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter((file) => file.name.toLowerCase().endsWith('.csv'))
    if (files.length === 0) {
      return
    }

    setIsInspectingUploads(true)
    try {
      const inspections = await inspectTelemetryFiles(files)
      const drafts = files.map((file, index) => {
        const inspection = inspections.find((item) => item.file_name === file.name) ?? inspections[index]
        const draft = buildUploadDraft(file, accountOwnerName, inspection)
        if (index === 0 && uploadedLaps.length === 0) {
          draft.role = 'user'
        }
        return draft
      })
      setUploadedLaps((prev) => {
        const next = [...prev, ...drafts]
        const firstTrack = uploadTrackName || inspections.find((item) => item.metadata.track_name)?.metadata.track_name || ''
        const firstCar = uploadCarName || inspections.find((item) => item.metadata.car_name)?.metadata.car_name || ''
        if (firstTrack && !uploadTrackName) {
          setUploadTrackName(firstTrack)
        }
        if (firstCar && !uploadCarName) {
          setUploadCarName(firstCar)
        }
        return next
      })
      setUploadTab('metadata')
    } finally {
      setIsInspectingUploads(false)
    }
  }

  function updateUploadedLap(localId: string, patch: Partial<UploadedLapDraft>) {
    setUploadedLaps((prev) => prev.map((lap) => (lap.localId === localId ? { ...lap, ...patch } : lap)))
  }

  function removeUploadedLap(localId: string) {
    setUploadedLaps((prev) => {
      const next = prev.filter((lap) => lap.localId !== localId)
      if (next.length > 0 && !next.some((lap) => lap.role === 'user')) {
        next[0] = { ...next[0], role: 'user' }
      }
      return next
    })
  }

  const normalizedUploadedLaps = uploadedLaps.map((lap) => ({
    ...lap,
    driver_name: normalizeDriverName(lap.driver_name),
    driver_key: buildDriverKey(lap.driver_name),
    parsedLapTime: parseLapTime(lap.lap_time),
  }))

  useEffect(() => {
    if (!accountOwnerName) {
      return
    }
    setUploadedLaps((prev) => {
      const next = prev.map((lap) => (
        !normalizeDriverName(lap.driver_name)
          ? { ...lap, driver_name: accountOwnerName }
          : lap
      ))
      return next.some((lap, index) => lap !== prev[index]) ? next : prev
    })
  }, [accountOwnerName])
  const uploadCarMatchesDictionary = garage61CarNames.has(uploadCarName.trim())
  const uploadTrackMatchesDictionary = garage61TrackNames.has(uploadTrackName.trim())
  const uploadHasRequiredMetadata = uploadCarMatchesDictionary && uploadTrackMatchesDictionary
  const uploadHasLapTimes = normalizedUploadedLaps.every((lap) => lap.parsedLapTime > 0)
  const uploadFilesAreValid = normalizedUploadedLaps.length > 0 && normalizedUploadedLaps.every((lap) => lap.valid)
  const canImportTelemetry = uploadHasRequiredMetadata && uploadHasLapTimes && uploadFilesAreValid && normalizedUploadedLaps.length > 0 && !isInspectingUploads

  const queryClient = useQueryClient()
  const reportBackState = {
    backTo: {
      pathname: '/app',
      state: {
        selectedCarId,
        selectedTrackId,
      },
    },
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      const metadataPayload = normalizedUploadedLaps.map((lap) => ({
        file_name: lap.fileName,
        car_name: uploadCarName,
        track_name: uploadTrackName,
        driver_name: lap.driver_name || accountOwnerName,
        source_driver_name: lap.driver_name || accountOwnerName,
        driver_key: lap.driver_key,
        lap_time: lap.parsedLapTime,
        recorded_at: lap.recorded_at || undefined,
        air_temp_c: parseOptionalNumber(lap.air_temp_c),
        track_temp_c: parseOptionalNumber(lap.track_temp_c),
        sample_count: lap.sample_count,
      }))
      return importTelemetryFiles(
        normalizedUploadedLaps.map((lap) => lap.file),
        metadataPayload,
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cars'] })
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      queryClient.invalidateQueries({ queryKey: ['recentLaps'] })
      queryClient.invalidateQueries({ queryKey: ['importedTelemetry'] })
      if (selectedCarId && selectedTrackId) {
        queryClient.invalidateQueries({ queryKey: ['myLaps', selectedCarId, selectedTrackId] })
        queryClient.invalidateQueries({ queryKey: ['refLaps', selectedCarId, selectedTrackId] })
      }
      setUploadedLaps([])
      setUploadCarName('')
      setUploadTrackName('')
      setUploadTab('files')
      setPageTab('analysis')
    },
  })

  const syncDictionaryMutation = useMutation({
    mutationFn: syncGarage61Dictionary,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['garage61Dictionary', 'car'] })
      queryClient.invalidateQueries({ queryKey: ['garage61Dictionary', 'track'] })
      queryClient.invalidateQueries({ queryKey: ['cars'] })
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
    },
  })

  const updateImportMutation = useMutation({
    mutationFn: async () => {
      if (!editingImportedId || !importedEditDraft) {
        throw new Error('Nothing to save')
      }
      return updateImportedTelemetry(editingImportedId, {
        car_name: importedEditDraft.car_name.trim(),
        track_name: importedEditDraft.track_name.trim(),
        driver_name: normalizeDriverName(importedEditDraft.driver_name),
        lap_time: parseLapTime(importedEditDraft.lap_time),
        recorded_at: importedEditDraft.recorded_at.trim() || null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cars'] })
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      queryClient.invalidateQueries({ queryKey: ['recentLaps'] })
      queryClient.invalidateQueries({ queryKey: ['importedTelemetry'] })
      if (selectedCarId && selectedTrackId) {
        queryClient.invalidateQueries({ queryKey: ['myLaps', selectedCarId, selectedTrackId] })
        queryClient.invalidateQueries({ queryKey: ['refLaps', selectedCarId, selectedTrackId] })
      }
      setEditingImportedId(null)
      setImportedEditDraft(null)
    },
  })

  const deleteImportMutation = useMutation({
    mutationFn: (id: string) => deleteImportedTelemetry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['importedTelemetry'] })
      queryClient.invalidateQueries({ queryKey: ['cars'] })
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      queryClient.invalidateQueries({ queryKey: ['recentLaps'] })
      if (selectedCarId && selectedTrackId) {
        queryClient.invalidateQueries({ queryKey: ['myLaps', selectedCarId, selectedTrackId] })
        queryClient.invalidateQueries({ queryKey: ['refLaps', selectedCarId, selectedTrackId] })
      }
    },
  })

  function startEditingImport(item: ImportedTelemetry) {
    setEditingImportedId(item.id)
    setImportedEditDraft({
      car_name: item.car_name,
      track_name: item.track_name,
      driver_name: item.driver_name,
      lap_time: formatLapTime(item.lap_time),
      recorded_at: item.recorded_at ?? '',
    })
  }

  function cancelEditingImport() {
    setEditingImportedId(null)
    setImportedEditDraft(null)
  }

  const carSuggestions = garage61CarDictionary.map((item: Garage61DictionaryEntry) => item.display_name)
  const trackSuggestions = garage61TrackDictionary.map((item: Garage61DictionaryEntry) => item.display_name)

  useEffect(() => {
    if (!selectedLapId && sortedMyLaps.length > 0) {
      setSelectedLapId(sortedMyLaps[0].id)
      return
    }
    if (selectedLapId && !sortedMyLaps.some((lap) => lap.id === selectedLapId)) {
      setSelectedLapId(sortedMyLaps[0]?.id ?? null)
    }
  }, [sortedMyLaps, selectedLapId])

  useEffect(() => {
    setSelectedRefIds((prev) => {
      const availableIds = new Set(refLaps.map((lap) => lap.id))
      return new Set([...prev].filter((id) => availableIds.has(id)))
    })
  }, [refLaps])

  function toggleRefLap(lapId: string) {
    setSelectedRefIds((prev) => {
      const next = new Set(prev)
      if (next.has(lapId)) {
        next.delete(lapId)
      } else {
        if (next.size >= MAX_SELECTED_REFERENCE_LAPS) {
          return prev
        }
        next.add(lapId)
      }
      return next
    })
  }

  // Analysis mutation
  const analysisMutation = useMutation({
    mutationFn: async () => {
      const primary = myLaps.find((lap) => lap.id === selectedLapId)
      const references = refLaps.filter((lap) => selectedRefIds.has(lap.id))
      if (!primary) throw new Error('Select one of your laps')
      if (references.length === 0) throw new Error('Select at least one reference lap')
      const lapsMetadata = [
        {
          id: primary.id,
          role: 'user' as const,
          driver_name: normalizeDriverName(primary.driver_name),
          source_driver_name: primary.driver_name,
          driver_key: primary.driver_key ?? buildDriverKey(primary.driver_name),
          lap_time: parseLapTime(primary.lap_time),
          recorded_at: primary.recorded_at,
          conditions: primary.conditions ?? undefined,
        },
        ...references.map((lap) => ({
          id: lap.id,
          role: 'reference' as const,
          driver_name: normalizeDriverName(lap.driver_name),
          source_driver_name: lap.driver_name,
          driver_key: lap.driver_key ?? buildDriverKey(lap.driver_name),
          lap_time: parseLapTime(lap.lap_time),
          recorded_at: lap.recorded_at,
          conditions: lap.conditions ?? undefined,
        })),
      ]
      const pv = isAdmin && promptVersion !== 'default' ? promptVersion : null
      return runAnalysis(
        primary.id,
        references.map((lap) => lap.id),
        primary.car_name,
        primary.track_name,
        'vs_reference',
        lapsMetadata,
        llmModel,
        pv,
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysisHistory'] })
    },
  })

  const sessionAnalysisMutation = useMutation({
    mutationFn: async (activity: RecentActivity) => {
      let sessionLaps = activity.laps
      let sessionSample = buildSessionAnalysisLaps(sessionLaps)

      if ((!sessionSample.primary || sessionSample.references.length === 0) && activity.car_id && activity.track_id) {
        const fetchedLaps = await getMyLaps(activity.car_id, activity.track_id, 100, 0)
        const sessionDay = String(activity.recorded_at || activity.date || '').slice(0, 10)
        const sameDayLaps = sessionDay
          ? fetchedLaps.filter((lap) => String(lap.recorded_at || '').slice(0, 10) === sessionDay)
          : []
        sessionLaps = sameDayLaps.length >= 2 ? sameDayLaps : fetchedLaps
        sessionSample = buildSessionAnalysisLaps(sessionLaps)
      }

      if (!sessionSample.primary) throw new Error('No laps available for this session')
      if (sessionSample.references.length === 0) throw new Error('Need at least two laps in the session')
      const lapsMetadata = [
        {
          id: sessionSample.primary.id,
          role: 'user' as const,
          driver_name: normalizeDriverName(sessionSample.primary.driver_name),
          source_driver_name: sessionSample.primary.driver_name,
          driver_key: sessionSample.primary.driver_key ?? buildDriverKey(sessionSample.primary.driver_name),
          lap_time: parseLapTime(sessionSample.primary.lap_time),
          recorded_at: sessionSample.primary.recorded_at,
          conditions: sessionSample.primary.conditions ?? undefined,
        },
        ...sessionSample.references.map((lap) => ({
          id: lap.id,
          role: 'reference' as const,
          driver_name: normalizeDriverName(lap.driver_name),
          source_driver_name: lap.driver_name,
          driver_key: lap.driver_key ?? buildDriverKey(lap.driver_name),
          lap_time: parseLapTime(lap.lap_time),
          recorded_at: lap.recorded_at,
          conditions: lap.conditions ?? undefined,
        })),
      ]
      const pv = isAdmin && promptVersion !== 'default' ? promptVersion : null
      return runAnalysis(
        sessionSample.primary.id,
        sessionSample.references.map((lap) => lap.id),
        activity.car_name,
        activity.track_name,
        'solo',
        lapsMetadata,
        llmModel,
        pv,
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysisHistory'] })
    },
  })
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

  const llmAccess = user?.llm_access
  const selectedProviderAccess = llmAccess?.providers?.[llmModel]
  const providerPriority = ['claude', 'gemini', 'openai'] as const
  const alternateProvider = providerPriority.find(
    (provider) => provider !== llmModel && llmAccess?.providers?.[provider]?.can_generate,
  )
  const hasPersonalLlmKey = Boolean(user?.has_custom_claude_key || user?.has_custom_gemini_key || user?.has_custom_openai_key)
  const personalProviderOptions = providerPriority.filter(
    (provider) => llmAccess?.providers?.[provider]?.has_custom_key,
  )
  const hasSharedFreeReports = Boolean(
    llmAccess?.providers?.claude?.has_shared_key
    || llmAccess?.providers?.gemini?.has_shared_key
    || llmAccess?.providers?.openai?.has_shared_key,
  )
  const baseCanAnalyse = Boolean(
    selectedCarId
    && selectedTrackId
    && selectedLapId
    && selectedRefIds.size > 0
    && !analysisMutation.isPending,
  )
  const canAnalyse = baseCanAnalyse && Boolean(selectedProviderAccess?.can_generate)

  function canRunSessionReport(activity: RecentActivity): boolean {
    const sample = buildSessionAnalysisLaps(activity.laps)
    return Boolean(
      (sample.primary && sample.references.length > 0)
      || (activity.car_id && activity.track_id),
    )
  }

  useEffect(() => {
    if (!selectedProviderAccess?.can_generate && alternateProvider) {
      setLlmModel(alternateProvider)
    }
  }, [alternateProvider, selectedProviderAccess?.can_generate])

  useEffect(() => {
    if (!hasPersonalLlmKey) {
      return
    }
    if (!selectedProviderAccess?.has_custom_key && personalProviderOptions.length > 0) {
      setLlmModel(personalProviderOptions[0])
    }
  }, [hasPersonalLlmKey, personalProviderOptions, selectedProviderAccess?.has_custom_key])

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-[90%] mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center">
              <BarChart2 className="w-4 h-4 text-slate-900" />
            </div>
            <span className="font-semibold text-white text-sm">Telemetry Analyst</span>
          </div>
          <div className="flex items-center gap-2">
            {isStaff && (
              <Link
                to="/admin"
                title={isAdmin ? 'Admin Panel' : 'Moderation Panel'}
                className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300 transition-colors text-sm px-2 py-1 rounded-lg hover:bg-slate-700"
              >
                <Shield className="w-4 h-4" />
                <span className="hidden sm:inline text-xs font-medium">{isAdmin ? 'Admin' : 'Mod'}</span>
              </Link>
            )}
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

      {user && !user.has_garage61 && (
        <div className="border-b border-red-500/20 bg-red-500/10">
          <div className="max-w-[90%] mx-auto px-4 py-2 flex items-center justify-between gap-4">
            <p className="text-red-200 text-xs">
              Garage61 not connected — you can still upload and analyse uploaded telemetry files.
            </p>
            <Link
              to="/profile"
              className="flex-shrink-0 text-xs font-medium text-red-200 hover:text-white underline underline-offset-2"
            >
              Connect Garage61
            </Link>
          </div>
        </div>
      )}

      {user && !hasPersonalLlmKey && hasSharedFreeReports && (
        <div className="border-b border-amber-500/20 bg-amber-500/10">
          <div className="max-w-[90%] mx-auto px-4 py-2 flex items-center justify-between gap-4">
            <p className="text-amber-100 text-xs">
              Personal LLM API keys not connected — you can still use shared free reports in the rolling 24-hour window.
              {typeof llmAccess?.shared_reports_remaining_today === 'number' ? ` ${llmAccess.shared_reports_remaining_today} remaining.` : ''}
            </p>
            <Link
              to="/profile"
              className="flex-shrink-0 text-xs font-medium text-amber-100 hover:text-white underline underline-offset-2"
              >
              Add API key
            </Link>
          </div>
        </div>
      )}

      {user && !hasPersonalLlmKey && !hasSharedFreeReports && (
        <div className="border-b border-red-500/20 bg-red-500/10">
          <div className="max-w-[90%] mx-auto px-4 py-2 flex items-center justify-between gap-4">
            <p className="text-red-200 text-xs">
              Personal LLM API keys not connected, and no shared free-report keys are available right now.
            </p>
            <Link
              to="/profile"
              className="flex-shrink-0 text-xs font-medium text-red-200 hover:text-white underline underline-offset-2"
            >
              Add API key
            </Link>
          </div>
        </div>
      )}

      <div className="border-b border-slate-800/80 bg-slate-900/95">
        <div className="max-w-[90%] mx-auto px-4">
          <div className="flex items-center gap-6 py-3">
            <button
              type="button"
              onClick={() => setPageTab('analysis')}
              className={`relative pb-2 text-sm font-medium transition-colors ${
                pageTab === 'analysis'
                  ? 'text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Analysis
              <span
                className={`absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-colors ${
                  pageTab === 'analysis' ? 'bg-amber-400' : 'bg-transparent'
                }`}
              />
            </button>
            <button
              type="button"
              onClick={() => setPageTab('import')}
              className={`relative pb-2 text-sm font-medium transition-colors ${
                pageTab === 'import'
                  ? 'text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Data Import
              <span
                className={`absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-colors ${
                  pageTab === 'import' ? 'bg-amber-400' : 'bg-transparent'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[90%] mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column: Steps 1-4 */}
          <div className="flex flex-col gap-5">
            {pageTab === 'import' && (
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Data Import</h2>
              </div>
            )}

            {pageTab === 'analysis' && (
              <>
            <div className="flex items-center gap-2 -mb-1">
              <Filter className="w-4 h-4 text-amber-500" />
              <span className="text-lg font-semibold text-white">Filter</span>
            </div>
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
                <div className="relative">
                  <input
                    className="select py-2 text-sm"
                    value={carQuery}
                    onChange={(e) => handleCarInputChange(e.target.value)}
                    onFocus={() => setShowCarSuggestions(true)}
                    onBlur={() => window.setTimeout(() => setShowCarSuggestions(false), 120)}
                    placeholder="Start typing a car name"
                    autoComplete="off"
                    data-testid="car-select"
                  />
                  {showCarSuggestions && (filteredRecentCars.length > 0 || filteredOtherCars.length > 0) && (
                    <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
                      {filteredRecentCars.length > 0 && (
                        <div>
                          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-800/90 border-b border-slate-700/60">
                            Recent
                          </div>
                          {filteredRecentCars.map((car) => (
                            <button
                              key={`recent-${car.id}`}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                selectCarOption(car)
                              }}
                              className="w-full px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                            >
                              {car.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {filteredOtherCars.length > 0 && (
                        <div>
                          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-800/90 border-y border-slate-700/60">
                            All
                          </div>
                          {filteredOtherCars.map((car) => (
                            <button
                              key={`all-${car.id}`}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                selectCarOption(car)
                              }}
                              className="w-full px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                            >
                              {car.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
                <div className="relative">
                  <input
                    className="select py-2 text-sm"
                    value={trackQuery}
                    onChange={(e) => handleTrackInputChange(e.target.value)}
                    onFocus={() => setShowTrackSuggestions(true)}
                    onBlur={() => window.setTimeout(() => setShowTrackSuggestions(false), 120)}
                    placeholder="Start typing a track name"
                    autoComplete="off"
                    data-testid="track-select"
                  />
                  {showTrackSuggestions && (filteredRecentTracks.length > 0 || filteredOtherTracks.length > 0) && (
                    <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
                      {filteredRecentTracks.length > 0 && (
                        <div>
                          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-800/90 border-b border-slate-700/60">
                            Recent
                          </div>
                          {filteredRecentTracks.map((track) => (
                            <button
                              key={`recent-${track.id}`}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                selectTrackOption(track)
                              }}
                              className="w-full px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                            >
                              {formatTrackName(track)}
                            </button>
                          ))}
                        </div>
                      )}
                      {filteredOtherTracks.length > 0 && (
                        <div>
                          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-800/90 border-y border-slate-700/60">
                            All
                          </div>
                          {filteredOtherTracks.map((track) => (
                            <button
                              key={`all-${track.id}`}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                selectTrackOption(track)
                              }}
                              className="w-full px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                            >
                              {formatTrackName(track)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedCarId && selectedTrackId && (
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-amber-500 text-slate-900 text-xs font-bold flex items-center justify-center">
                    3
                  </div>
                  <span className="text-white font-medium text-sm">Your Laps</span>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">Sort</span>
                    <select
                      value={myLapsSort}
                      onChange={(e) => {
                        setMyLapsSort(e.target.value as 'time' | 'date')
                        setMyLapsPage(0)
                      }}
                      className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value="time">Time</option>
                      <option value="date">Date</option>
                    </select>
                  </div>
                </div>

                {myLapsLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-12 bg-slate-700 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : sortedMyLaps.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-4">
                    No laps found for this car &amp; track combination.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {pagedMyLaps.map((lap) => {
                      const isSelected = selectedLapId === lap.id
                      return (
                        <button
                          key={lap.id}
                          type="button"
                          onClick={() => setSelectedLapId(lap.id)}
                          className={`w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                            isSelected
                              ? 'border border-amber-500/30 bg-amber-500/10'
                              : 'border border-slate-700/60 bg-slate-800/50 hover:bg-slate-700/60'
                          }`}
                        >
                          <div className="min-w-0 flex items-center gap-3 flex-1">
                            <div className={`h-4 w-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                              isSelected ? 'border-amber-400' : 'border-slate-500'
                            }`}>
                              {isSelected ? <div className="h-2 w-2 rounded-full bg-amber-400" /> : null}
                            </div>
                            <span className={`font-mono text-xs flex-shrink-0 ${isSelected ? 'text-amber-300' : 'text-slate-200'}`}>
                              {formatLapTime(lap.lap_time)}
                            </span>
                            <span className="text-xs text-slate-300 truncate min-w-0">
                              {lap.driver_name || 'You'}
                            </span>
                          </div>
                          <div className="flex items-center justify-end gap-1.5 flex-shrink-0 min-w-0">
                            <span className="text-xs text-slate-500 flex-shrink-0">
                              {formatDateTime(lap.recorded_at)}
                            </span>
                            {renderConditionChips(lap.conditions, true)}
                            {lap.source && (
                              <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                                lap.source === 'upload' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                              }`}>
                                {getLapSourceLabel(lap.id)}
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
                {!myLapsLoading && sortedMyLaps.length > 0 && (
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
                      disabled={(myLapsPage + 1) * MY_LAPS_PAGE_SIZE >= sortedMyLaps.length}
                      className="px-2 py-1 rounded-md border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}

            {selectedCarId && selectedTrackId && (
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-amber-500 text-slate-900 text-xs font-bold flex items-center justify-center">
                    4
                  </div>
                  <span className="text-white font-medium text-sm">Reference Laps</span>
                  <div className="ml-auto flex items-center gap-1">
                    {[5, 10, 15, 20].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          setRefLapLimit(n)
                          setRefLapsPage(0)
                        }}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          refLapLimit === n
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                            : 'text-slate-500 hover:text-slate-300 border border-transparent'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {!refLapsLoading && refLaps.length > 0 && (
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setSelectedRefIds(new Set(refLaps.slice(0, MAX_SELECTED_REFERENCE_LAPS).map((lap) => lap.id)))}
                      className="text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Select top 3
                    </button>
                    <span className="text-slate-700">·</span>
                    <button
                      type="button"
                      onClick={() => setSelectedRefIds(new Set())}
                      className="text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Clear
                    </button>
                    <span className="text-slate-600 text-xs ml-auto">{selectedRefIds.size}/{MAX_SELECTED_REFERENCE_LAPS} selected</span>
                  </div>
                )}

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
                    {pagedRefLaps.map((lap, idx) => (
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
                          {refLapsPage * REF_LAPS_PAGE_SIZE + idx + 1}
                        </span>
                        <span className="text-orange-400 font-mono text-xs flex-shrink-0">
                          {formatLapTime(lap.lap_time)}
                        </span>
                        <div className="min-w-0 flex-1 flex items-center justify-between gap-2 overflow-hidden">
                          <span className="text-white text-xs truncate min-w-0 flex-1">
                            {lap.driver_name}
                          </span>
                          <div className="flex items-center justify-end gap-1.5 flex-shrink-0 min-w-0">
                            {typeof lap.irating === 'number' && lap.irating > 0 ? (
                              <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300 flex-shrink-0">
                                {lap.irating.toLocaleString()} iR
                              </span>
                            ) : null}
                            {renderConditionChips(lap.conditions, true)}
                            {lap.source && (
                              <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                                lap.source === 'upload' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                              }`}>
                                {getLapSourceLabel(lap.id)}
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    ))}
                    {refLapsTotalPages > 1 && (
                      <div className="flex items-center justify-between text-xs text-slate-500 pt-2">
                        <button
                          type="button"
                          onClick={() => setRefLapsPage((prev) => Math.max(0, prev - 1))}
                          disabled={refLapsPage === 0}
                          className="px-2 py-1 rounded-md border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                        >
                          Previous
                        </button>
                        <span>Page {refLapsPage + 1} / {refLapsTotalPages}</span>
                        <button
                          type="button"
                          onClick={() => setRefLapsPage((prev) => Math.min(refLapsTotalPages - 1, prev + 1))}
                          disabled={refLapsPage >= refLapsTotalPages - 1}
                          className="px-2 py-1 rounded-md border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

              </>
            )}

            {pageTab === 'import' && (
              <>
                <p className="text-slate-500 text-xs -mt-2">
                  Import telemetry files, review the extracted metadata, override anything you need, and store the compressed uploads in the database for later analysis.
                </p>
                <div className="card">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <Upload className="w-4 h-4 text-slate-400" />
                      <span className="text-white font-medium text-sm">Data Import</span>
                    </div>
                    <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5 text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => setUploadTab('files')}
                        className={`px-3 py-1.5 rounded-md transition-colors ${
                          uploadTab === 'files'
                            ? 'bg-amber-500 text-slate-900'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Files
                      </button>
                      <button
                        type="button"
                        onClick={() => setUploadTab('metadata')}
                        className={`px-3 py-1.5 rounded-md transition-colors ${
                          uploadTab === 'metadata'
                            ? 'bg-amber-500 text-slate-900'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Review Metadata
                      </button>
                    </div>
                  </div>
                  {uploadTab === 'files' ? (
                    <div className="space-y-4">
                      <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 bg-slate-800/60 px-4 py-6 text-center cursor-pointer hover:border-amber-500/50 transition-colors">
                        <Upload className="w-6 h-6 text-amber-400" />
                        <span className="text-sm text-slate-200">Choose one or more `.csv` telemetry files</span>
                        <span className="text-xs text-slate-500">We inspect the file contents and filename, then prefill editable metadata before import.</span>
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            handleUploadFiles(e.target.files)
                            e.currentTarget.value = ''
                          }}
                        />
                      </label>
                      {isInspectingUploads && (
                        <div className="text-xs text-slate-400 flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Inspecting uploads...
                        </div>
                      )}
                      {uploadedLaps.length > 0 && (
                        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm text-white">Files ready for metadata review</p>
                              <p className="text-xs text-slate-500">{uploadedLaps.length} file{uploadedLaps.length === 1 ? '' : 's'} staged</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setUploadTab('metadata')}
                              className="px-3 py-1.5 rounded-md bg-amber-500 text-slate-900 text-xs font-medium hover:bg-amber-400 transition-colors"
                            >
                              Review Metadata
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="card bg-slate-900/40 border border-slate-700">
                        <div className="flex items-center gap-2 mb-3">
                          <Car className="w-4 h-4 text-slate-400" />
                          <span className="text-white font-medium text-sm">Shared Metadata</span>
                          <button
                            type="button"
                            onClick={() => syncDictionaryMutation.mutate()}
                            disabled={!user?.has_garage61 || syncDictionaryMutation.isPending}
                            className="ml-auto px-2.5 py-1 rounded-md border border-slate-600 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {syncDictionaryMutation.isPending ? 'Syncing…' : 'Sync Garage61 Dictionary'}
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <label className="text-xs text-slate-400">
                            Car
                            <input className="select mt-1" list="garage61-car-options" value={uploadCarName} onChange={(e) => setUploadCarName(e.target.value)} placeholder="Ferrari 296 GT3" />
                          </label>
                          <label className="text-xs text-slate-400">
                            Track
                            <input className="select mt-1" list="garage61-track-options" value={uploadTrackName} onChange={(e) => setUploadTrackName(e.target.value)} placeholder="Spa-Francorchamps" />
                          </label>
                        </div>
                        {(!uploadCarMatchesDictionary || !uploadTrackMatchesDictionary) && (
                          <p className="text-xs text-amber-300 mt-3">
                            Select both car and track from the Garage61 dictionary before importing uploaded telemetry.
                          </p>
                        )}
                        <p className="text-xs text-slate-500 mt-3">These batch-level values are extracted from file content or file name when possible. You can override them manually or pick a canonical Garage61 value from the dictionary.</p>
                      </div>

                      <div className="card bg-slate-900/40 border border-slate-700">
                        <div className="flex items-center gap-2 mb-3">
                          <FileText className="w-4 h-4 text-slate-400" />
                          <span className="text-white font-medium text-sm">Files To Import</span>
                          {uploadedLaps.length > 0 && (
                            <span className="ml-auto text-xs text-slate-500">{uploadedLaps.length} file{uploadedLaps.length === 1 ? '' : 's'}</span>
                          )}
                        </div>
                        {uploadedLaps.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/30 px-4 py-6 text-center">
                            <p className="text-slate-400 text-sm">No files uploaded yet.</p>
                            <button
                              type="button"
                              onClick={() => setUploadTab('files')}
                              className="mt-3 px-3 py-1.5 rounded-md border border-slate-600 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                            >
                              Go To Files
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {normalizedUploadedLaps.map((lap) => (
                              <div key={lap.localId} className={`rounded-xl border px-3 py-3 ${lap.valid ? 'border-slate-700 bg-slate-800/50' : 'border-red-500/30 bg-red-500/5'}`}>
                                <div className="flex items-start gap-3">
                                  <FileText className="w-4 h-4 mt-0.5 text-slate-400 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="space-y-2">
                                      <p className="text-sm text-white break-all" title={lap.fileName}>{lap.fileName}</p>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {lap.sample_count > 0 && <span className="text-xs text-slate-500">{lap.sample_count} samples</span>}
                                        {lap.track_length_m ? <span className="text-xs text-slate-500">{Math.round(lap.track_length_m)} m</span> : null}
                                      </div>
                                      {(lap.detectedCarName || lap.detectedTrackName) && (
                                        <div className="flex flex-wrap gap-2">
                                          {lap.detectedCarName && (
                                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
                                              Detected car: {lap.detectedCarName}
                                            </span>
                                          )}
                                          {lap.detectedTrackName && (
                                            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-200">
                                              Detected track: {lap.detectedTrackName}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    {lap.error && <p className="text-xs text-red-400 mt-1">{lap.error}</p>}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                      <label className="text-xs text-slate-400">
                                        Driver
                                        <input className="select mt-1" value={lap.driver_name} onChange={(e) => updateUploadedLap(lap.localId, { driver_name: e.target.value })} placeholder={accountOwnerName || 'Driver name'} />
                                      </label>
                                      <label className="text-xs text-slate-400">
                                        Lap Time
                                        <input className="select mt-1 font-mono" value={lap.lap_time} onChange={(e) => updateUploadedLap(lap.localId, { lap_time: e.target.value })} placeholder="1:58.123" />
                                      </label>
                                      <label className="text-xs text-slate-400">
                                        Session Date / Time
                                        <input className="select mt-1" value={lap.recorded_at} onChange={(e) => updateUploadedLap(lap.localId, { recorded_at: e.target.value })} placeholder="2026-03-28 21:15:00" />
                                      </label>
                                      <label className="text-xs text-slate-400">
                                        Air Temp C
                                        <input className="select mt-1" value={lap.air_temp_c} onChange={(e) => updateUploadedLap(lap.localId, { air_temp_c: e.target.value })} placeholder="24" />
                                      </label>
                                      <label className="text-xs text-slate-400">
                                        Track Temp C
                                        <input className="select mt-1" value={lap.track_temp_c} onChange={(e) => updateUploadedLap(lap.localId, { track_temp_c: e.target.value })} placeholder="38" />
                                      </label>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeUploadedLap(lap.localId)}
                                    className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                                    title="Remove file"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => importMutation.mutate()}
                  disabled={!canImportTelemetry || importMutation.isPending}
                  className="btn-primary flex items-center justify-center gap-2 py-3 text-base w-full"
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Importing...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      <span>Upload To Database</span>
                    </>
                  )}
                </button>

                {importMutation.isError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                    Import failed. Please review the metadata and try again.
                  </div>
                )}
              </>
            )}

            {/* Model Selector */}
            {pageTab === 'analysis' && selectedCarId && selectedTrackId && (
              <div className="space-y-3">
                {llmAccess && !selectedProviderAccess?.can_generate && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">
                    {selectedProviderAccess?.disabled_reason === 'shared_quota_exhausted'
                      ? `The free shared ${selectedProviderAccess?.label ?? 'selected model'} quota has been reached for the last 24 hours. Add your personal API key in Profile or wait for quota to refresh.`
                      : `${selectedProviderAccess?.label ?? 'Selected model'} is not available. Add your personal API key in Profile before generating reports.`}
                  </div>
                )}
                {hasPersonalLlmKey && personalProviderOptions.length > 0 && (
                  <div className="space-y-1">
                    <label htmlFor="llm-model" className="block text-xs text-slate-500">
                      Model
                    </label>
                    <select
                      id="llm-model"
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value as 'claude' | 'gemini' | 'openai')}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-amber-500"
                    >
                      {personalProviderOptions.map((provider) => (
                        <option key={provider} value={provider}>
                          {llmAccess?.providers?.[provider]?.label ?? provider}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Admin: prompt version selector */}
            {pageTab === 'analysis' && isAdmin && availablePrompts.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Prompt</span>
                <select
                  value={promptVersion}
                  onChange={e => setPromptVersion(e.target.value)}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                >
                  <option value="default">default</option>
                  {availablePrompts.map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Analyse Button */}
            {pageTab === 'analysis' && selectedCarId && selectedTrackId && (
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
                    <span>Analyse Lap vs Reference</span>
                  </>
                )}
              </button>
            )}

            {pageTab === 'analysis' && analysisMutation.isError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                Analysis failed. Please try again.
              </div>
            )}
          </div>

          {/* Right column: Recent Activity + Analysis History */}
          <div className="flex flex-col gap-4" data-testid="analysis-history">
            {pageTab === 'analysis' ? (
              <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Activity className="w-5 h-5 text-amber-500" />Recent Activity</h2>
              <div className="flex gap-1">
                {(['all', 'garage61', 'upload'] as const).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => { setRecentSourceFilter(src); setRecentPage(0) }}
                    className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded transition-colors ${
                      recentSourceFilter === src
                        ? src === 'garage61' ? 'bg-blue-500/30 text-blue-400'
                          : src === 'upload' ? 'bg-emerald-500/30 text-emerald-400'
                          : 'bg-slate-600/50 text-white'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'
                    }`}
                  >
                    {src === 'all' ? 'All' : src === 'garage61' ? 'G61' : 'Upload'}
                  </button>
                ))}
              </div>
            </div>

            {recentLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-12 bg-slate-800 rounded-xl border border-slate-700 animate-pulse" />
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
                <div className="space-y-2">
                  {recentPageLaps.map((lap) => {
                    const { carId, trackId } = resolveRecentIds(lap)
                    const bestLap = pickBestLapFromRecentActivity(lap)
                    const canApply = Boolean(carId && trackId)
                    const canRunSession = canRunSessionReport(lap) && Boolean(selectedProviderAccess?.can_generate) && !sessionAnalysisMutation.isPending
                    return (
                      <div
                        key={lap.id}
                        className={`card text-left transition-colors w-full px-2.5 py-2 ${
                          canApply ? 'hover:bg-slate-700' : 'opacity-70'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-1.5 min-w-0 text-[13px] leading-tight">
                              <Car className="w-3 h-3 text-slate-500 flex-shrink-0" />
                              <span className="text-amber-400 font-semibold truncate">{lap.car_name}</span>
                              <span className="text-slate-600 flex-shrink-0">·</span>
                              <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0" />
                              <span className="text-slate-300 truncate">{lap.track_name}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] leading-tight">
                              <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-slate-300">
                                {lap.lap_count ?? 0} laps
                              </span>
                              <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-slate-400">
                                best {formatLapTime(lap.best_lap_time)}
                              </span>
                              <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-slate-400">
                                {formatDateTime(lap.recorded_at || lap.date)}
                              </span>
                              {lap.source && (
                                <span className={`text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-md ${
                                  lap.source === 'upload'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-blue-500/20 text-blue-400'
                                }`}>
                                  {lap.source === 'upload' ? 'upload' : 'g61'}
                                </span>
                              )}
                            </div>
                            {renderConditionChips(bestLap?.conditions)}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => canApply && applyRecentFilters(carId, trackId)}
                              disabled={!canApply}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500 hover:text-slate-950 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-500/15 disabled:hover:text-amber-200 transition-colors"
                              title={
                                canApply
                                  ? 'Filter by this car and track combo'
                                  : 'Car or track not available for selection'
                              }
                              aria-label="Filter"
                            >
                              <Filter className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => sessionAnalysisMutation.mutate(lap)}
                              disabled={!canRunSession}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-blue-500/40 bg-blue-500/10 text-blue-200 hover:bg-blue-500 hover:text-slate-950 hover:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-500/10 disabled:hover:text-blue-200 transition-colors"
                              title={
                                canRunSession
                                  ? 'Analyze this recent session directly'
                                  : !selectedProviderAccess?.can_generate
                                    ? 'Selected model is not available'
                                    : 'Need at least two laps with telemetry in this recent activity'
                              }
                              aria-label="Analyze"
                            >
                              <BarChart2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
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

            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2"><History className="w-5 h-5 text-amber-500" />Analysis History</h2>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {([
                    { key: 'all', label: 'All' },
                    { key: 'reference', label: 'Reference' },
                    { key: 'patterns', label: 'Patterns' },
                  ] as const).map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setHistoryTypeFilter(option.key)
                        setHistoryPage(0)
                      }}
                      className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded transition-colors ${
                        historyTypeFilter === option.key
                          ? option.key === 'reference'
                            ? 'bg-orange-500/30 text-orange-300'
                            : option.key === 'patterns'
                              ? 'bg-violet-500/30 text-violet-300'
                              : 'bg-slate-600/50 text-white'
                          : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {filteredHistory.length > 0 && (
                  <span className="text-xs text-slate-500">{filteredHistory.length} total</span>
                )}
              </div>
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
                    const isQueued = item.status === 'enqueued'
                    const isProcessing = item.status === 'processing'
                    const isActive = isQueued || isProcessing
                    const sourceLabel = getLapSourceLabel(item.lap_id)
                    return (
                    <div key={item.id} className="relative group">
                      <button
                        data-testid="analysis-history-item"
                        onClick={() => navigate(`/report/${item.id}`, {
                          state: reportBackState,
                        })}
                        className={`w-full card text-left hover:bg-slate-700 transition-colors pr-10 py-2 border-l-2 ${
                          isSoloItem ? 'border-l-violet-500/50' : 'border-l-orange-500/50'
                        } ${
                          isActive ? 'bg-slate-800/55 border-slate-700/70' : ''
                        }`}
                      >
                        <div className="flex flex-col gap-1.5">
                          <div className={`flex-1 min-w-0 transition-opacity ${isActive ? 'opacity-75' : 'opacity-100'}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex items-center gap-2">
                              <span className="text-amber-400 font-semibold text-sm truncate">
                                {item.car_name}
                              </span>
                              <span className="text-slate-500 text-xs">@</span>
                              <span className="text-slate-300 text-sm truncate">
                                {item.track_name}
                              </span>
                              </div>
                              <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-amber-500 flex-shrink-0 transition-colors" />
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 leading-4">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium flex-shrink-0 ${
                                isSoloItem
                                  ? 'bg-violet-500/15 text-violet-400'
                                  : 'bg-orange-500/15 text-orange-400'
                              }`}>
                                {isSoloItem ? 'Patterns' : 'Reference'}
                              </span>
                              {isQueued && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/30 flex-shrink-0 opacity-100">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Queue
                                </span>
                              )}
                              {isProcessing && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-400/20 text-amber-300 ring-1 ring-amber-300/35 flex-shrink-0 opacity-100">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Processing
                                </span>
                              )}
                              {item.status === 'failed' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-500/15 text-red-400 flex-shrink-0">
                                  Failed
                                </span>
                              )}
                              <span className={`uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                                sourceLabel === 'upload'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-blue-500/15 text-blue-400'
                              }`}>
                                {sourceLabel}
                              </span>
                              {item.estimated_time_gain_seconds != null && item.estimated_time_gain_seconds > 0 && (
                                <span className={`inline-flex items-center gap-1 bg-amber-500/20 border border-amber-500/30 text-amber-400 font-semibold text-[11px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                                  isActive ? 'opacity-70' : ''
                                }`}>
                                  <Zap className="w-3 h-3" />
                                  +{item.estimated_time_gain_seconds.toFixed(1)}s
                                </span>
                              )}
                              {isSoloItem && (
                                <>
                                  <span className="text-slate-600">·</span>
                                  <span>{item.reference_lap_ids.length + 1} laps</span>
                                </>
                              )}
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-600">{formatDateTime(item.created_at)}</span>
                            </div>
                          </div>
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
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2"><FileText className="w-5 h-5 text-amber-500" />Imported Telemetry</h2>
                  {importedTelemetry.length > 0 && (
                    <span className="text-xs text-slate-500">{importedTelemetry.length} stored</span>
                  )}
                </div>
                {importedTelemetry.length === 0 ? (
                  <div className="card flex flex-col items-center py-10 text-center">
                    <Upload className="w-10 h-10 text-slate-600 mb-3" />
                    <p className="text-slate-400 text-sm">No imported telemetry yet.</p>
                    <p className="text-slate-500 text-xs mt-1">Uploaded files will appear here after they are stored in the database.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {importedTelemetry.slice(0, 12).map((item: ImportedTelemetry) => (
                      <div key={item.id} className="card py-3">
                        {editingImportedId === item.id && importedEditDraft ? (
                          <div className="space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm text-white break-all">{item.file_name}</p>
                                <p className="text-xs text-slate-500 mt-1">
                                  Stored {formatDateTime(item.created_at)}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => updateImportMutation.mutate()}
                                  disabled={
                                    updateImportMutation.isPending ||
                                    !importedEditDraft.car_name.trim() ||
                                    !importedEditDraft.track_name.trim() ||
                                    !normalizeDriverName(importedEditDraft.driver_name) ||
                                    parseLapTime(importedEditDraft.lap_time) <= 0
                                  }
                                  className="p-1.5 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  title="Save metadata"
                                >
                                  {updateImportMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Save className="w-4 h-4" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditingImport}
                                  disabled={updateImportMutation.isPending}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                                  title="Cancel editing"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <label className="text-xs text-slate-400">
                                Car
                                <input
                                  className="select mt-1"
                                  list="garage61-car-options"
                                  value={importedEditDraft.car_name}
                                  onChange={(e) => setImportedEditDraft((prev) => prev ? { ...prev, car_name: e.target.value } : prev)}
                                />
                              </label>
                              <label className="text-xs text-slate-400">
                                Track
                                <input
                                  className="select mt-1"
                                  list="garage61-track-options"
                                  value={importedEditDraft.track_name}
                                  onChange={(e) => setImportedEditDraft((prev) => prev ? { ...prev, track_name: e.target.value } : prev)}
                                />
                              </label>
                              <label className="text-xs text-slate-400">
                                Driver
                                <input
                                  className="select mt-1"
                                  value={importedEditDraft.driver_name}
                                  onChange={(e) => setImportedEditDraft((prev) => prev ? { ...prev, driver_name: e.target.value } : prev)}
                                />
                              </label>
                              <label className="text-xs text-slate-400">
                                Lap Time
                                <input
                                  className="select mt-1"
                                  value={importedEditDraft.lap_time}
                                  onChange={(e) => setImportedEditDraft((prev) => prev ? { ...prev, lap_time: e.target.value } : prev)}
                                  placeholder="1:32.456"
                                />
                              </label>
                              <label className="text-xs text-slate-400 md:col-span-2">
                                Session Date / Time
                                <input
                                  className="select mt-1"
                                  value={importedEditDraft.recorded_at}
                                  onChange={(e) => setImportedEditDraft((prev) => prev ? { ...prev, recorded_at: e.target.value } : prev)}
                                  placeholder="2026-03-28 21:15:00"
                                />
                              </label>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                              {item.sample_count > 0 && <span>{item.sample_count} samples</span>}
                              {item.track_length_m ? <span>· {Math.round(item.track_length_m)} m</span> : null}
                            </div>
                            {updateImportMutation.isError && (
                              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                                Metadata update failed. Please check the values and try again.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm text-white break-all">{item.file_name}</p>
                              <div className="flex items-center gap-2 text-xs text-slate-400 mt-2 flex-wrap">
                                <span className="text-amber-400">{item.car_name}</span>
                                <span>@</span>
                                <span>{item.track_name}</span>
                                <span>·</span>
                                <span>{formatLapTime(item.lap_time)}</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-slate-500 mt-1 flex-wrap">
                                <span>{item.driver_name || accountOwnerName || 'Driver'}</span>
                                {item.sample_count > 0 && <span>· {item.sample_count} samples</span>}
                                {item.track_length_m ? <span>· {Math.round(item.track_length_m)} m</span> : null}
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="text-xs text-slate-500 whitespace-nowrap">{formatDateTime(item.created_at)}</span>
                              <button
                                type="button"
                                onClick={() => startEditingImport(item)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                                title="Edit metadata"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteImportMutation.mutate(item.id)}
                                disabled={deleteImportMutation.isPending}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Delete imported file"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
      <datalist id="garage61-car-options">
        {carSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="garage61-track-options">
        {trackSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  )
}
