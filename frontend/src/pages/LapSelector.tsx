import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, User, ChevronRight, Clock, Calendar, Loader2, Car, MapPin, BarChart2, Trash2, Zap, Activity, History, Shield, Upload, FileText, Pencil, Save, X } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'
import { useAuth } from '../hooks/useAuth'
import { adminListPrompts } from '../api/client'
import type { PromptMeta } from '../types'
import {
  getCars,
  getTracks,
  getMyLaps,
  getMySessions,
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
import type { Lap, Session, AnalysisHistoryItem, Car as CarType, Track, UploadInspection, ImportedTelemetry, Garage61DictionaryEntry, RecentActivity } from '../types'

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

function formatLapConditionsCompact(lap: Lap): string {
  const conditions = lap.conditions
  if (!conditions) {
    return '—'
  }

  const formatWindDirection = (value?: string | number): string | null => {
    if (value == null || value === '') return null
    if (typeof value === 'string') return value
    const degrees = Math.abs(value) <= Math.PI * 2 + 0.001 ? (value * 180) / Math.PI : value
    const normalized = ((degrees % 360) + 360) % 360
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    const label = labels[Math.round(normalized / 45) % labels.length]
    return `${label} ${normalized.toFixed(0)}deg`
  }

  const parts: string[] = []
  if (conditions.setup_type) parts.push(`Setup ${conditions.setup_type}`)
  if (conditions.weather) parts.push(conditions.weather)
  if (conditions.track_temp_c != null) parts.push(`Track ${conditions.track_temp_c.toFixed(0)}C`)
  if (conditions.air_temp_c != null) parts.push(`Air ${conditions.air_temp_c.toFixed(0)}C`)
  if (conditions.wind_kph != null) {
    const windDirection = formatWindDirection(conditions.wind_direction)
    parts.push(`Wind ${conditions.wind_kph.toFixed(0)}${windDirection ? ` ${windDirection}` : ''}`)
  } else {
    const windDirection = formatWindDirection(conditions.wind_direction)
    if (windDirection) parts.push(`Wind ${windDirection}`)
  }
  if (conditions.time_of_day) parts.push(conditions.time_of_day)

  return parts.length > 0 ? parts.join(' • ') : '—'
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

function getLapSourceLabel(lapId: string): 'csv' | 'g61' {
  return lapId.startsWith('upload:') ? 'csv' : 'g61'
}

function sortSessionLapsChronologically(laps: Lap[]): Lap[] {
  return [...laps].sort((a, b) => {
    const aTime = parseDate(a.recorded_at)?.getTime()
    const bTime = parseDate(b.recorded_at)?.getTime()
    if (aTime != null && bTime != null) {
      return aTime - bTime
    }
    if (aTime != null) return -1
    if (bTime != null) return 1
    return 0
  })
}

function pickSessionConsecutiveWindow(laps: Lap[], windowSize = 5): Lap[] {
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

function buildSessionAnalysisLaps(laps: Lap[], windowSize = 5): { consecutiveLaps: Lap[], analysisLaps: Lap[], fastestLap: Lap | null } {
  const ordered = sortSessionLapsChronologically(laps)
  if (ordered.length === 0) {
    return { consecutiveLaps: [], analysisLaps: [], fastestLap: null }
  }
  const consecutiveLaps = pickSessionConsecutiveWindow(ordered, windowSize)
  const fastestLap = ordered.reduce((best, lap) => (
    parseLapTime(lap.lap_time) < parseLapTime(best.lap_time) ? lap : best
  ), ordered[0])

  const included = new Set(consecutiveLaps.map((lap) => lap.id))
  const analysisLaps = included.has(fastestLap.id)
    ? consecutiveLaps
    : [...consecutiveLaps, fastestLap]

  return { consecutiveLaps, analysisLaps, fastestLap }
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
  const { user } = useAuth()
  const accountOwnerName = normalizeDriverName(user?.display_name ?? '')

  const [pageTab, setPageTab] = useState<PageTab>('analysis')
  const [analysisMode, setAnalysisMode] = useState<'vs_reference' | 'sessions'>('vs_reference')
  const [uploadTab, setUploadTab] = useState<UploadTab>('files')
  const [llmModel, setLlmModel] = useState<'claude' | 'gemini'>('claude')
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [myLapsLimit, setMyLapsLimit] = useState(5)
  const [myLapsPage, setMyLapsPage] = useState(0)
  const [mySessionsLimit, setMySessionsLimit] = useState(10)
  const [mySessionsPage, setMySessionsPage] = useState(0)
  const [recentPage, setRecentPage] = useState(0)
  const [expandedRecentIds, setExpandedRecentIds] = useState<Set<string>>(new Set())
  const [recentSourceFilter, setRecentSourceFilter] = useState<'all' | 'garage61' | 'upload'>('all')
  const RECENT_PAGE_SIZE = 5
  const [historyPage, setHistoryPage] = useState(0)
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
    queryKey: ['refLaps', selectedCarId, selectedTrackId, refLapLimit],
    queryFn: () => getReferenceLaps(selectedCarId!, selectedTrackId!, refLapLimit),
    enabled: selectedCarId !== null && selectedTrackId !== null,
  })

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['analysisHistory'],
    queryFn: getAnalysisHistory,
    staleTime: 30 * 1000,
  })

  const isAdmin = user?.role === 'admin'
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

  // Clear reference lap selection when new ref laps load
  useEffect(() => {
    setSelectedRefIds(new Set())
  }, [refLaps])

  useEffect(() => {
    const selectedCar = cars.find((car) => car.id === selectedCarId)
    setCarQuery(selectedCar ? selectedCar.name : '')
  }, [cars, selectedCarId])

  useEffect(() => {
    const selectedTrack = tracks.find((track) => track.id === selectedTrackId)
    setTrackQuery(selectedTrack ? formatTrackName(selectedTrack) : '')
  }, [tracks, selectedTrackId])

  // Reset lap/session selection when car/track change
  function handleCarChange(carId: string | number | null) {
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

  function handleTrackChange(trackId: string | number | null) {
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

  function applyRecentFilters(carId: string | number | null, trackId: string | number | null) {
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

  function toggleRecentCard(id: string) {
    setExpandedRecentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
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
        if (analysisMode === 'vs_reference' && index === 0 && uploadedLaps.length === 0) {
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
      if (analysisMode === 'vs_reference' && next.length > 0 && !next.some((lap) => lap.role === 'user')) {
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
        queryClient.invalidateQueries({ queryKey: ['mySessions', selectedCarId, selectedTrackId] })
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
        queryClient.invalidateQueries({ queryKey: ['mySessions', selectedCarId, selectedTrackId] })
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
        queryClient.invalidateQueries({ queryKey: ['mySessions', selectedCarId, selectedTrackId] })
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

  // Analysis mutation
  const analysisMutation = useMutation({
    mutationFn: async () => {
      if (analysisMode === 'sessions') {
        const session = mySessions.find((s: Session) => s.id === selectedSessionId)
        if (!session) throw new Error('Selected session not found')
        const { analysisLaps } = buildSessionAnalysisLaps(session.laps, 5)
        if (analysisLaps.length === 0) throw new Error('Selected session has no laps')
        const sorted = [...analysisLaps].sort(
          (a, b) => parseLapTime(a.lap_time) - parseLapTime(b.lap_time)
        )
        const primary = sorted[0]
        const rest = sorted.slice(1)
        const lapsMetadata = [
          { id: primary.id, role: 'user' as const, driver_name: normalizeDriverName(primary.driver_name), source_driver_name: primary.driver_name, driver_key: primary.driver_key ?? buildDriverKey(primary.driver_name), lap_time: parseLapTime(primary.lap_time), conditions: primary.conditions ?? undefined },
          ...rest.map((l) => ({ id: l.id, role: 'reference' as const, driver_name: normalizeDriverName(l.driver_name), source_driver_name: l.driver_name, driver_key: l.driver_key ?? buildDriverKey(l.driver_name), lap_time: parseLapTime(l.lap_time), conditions: l.conditions ?? undefined })),
        ]
        const pv = isAdmin && promptVersion !== 'default' ? promptVersion : null
        return runAnalysis(primary.id, rest.map((l) => l.id), primary.car_name, primary.track_name, 'solo', lapsMetadata, llmModel, pv)
      } else {
        const lap = myLaps.find((l) => l.id === selectedLapId)
        if (!lap) throw new Error('Selected lap not found')
        const lapsMetadata = [
          { id: lap.id, role: 'user' as const, driver_name: normalizeDriverName(lap.driver_name), source_driver_name: lap.driver_name, driver_key: lap.driver_key ?? buildDriverKey(lap.driver_name), lap_time: parseLapTime(lap.lap_time), conditions: lap.conditions ?? undefined },
          ...Array.from(selectedRefIds).map((id) => {
            const ref = refLaps.find((r) => r.id === id)
            return { id, role: 'reference' as const, driver_name: normalizeDriverName(ref?.driver_name ?? ''), source_driver_name: ref?.driver_name ?? '', driver_key: ref?.driver_key ?? buildDriverKey(ref?.driver_name ?? ''), lap_time: parseLapTime(ref?.lap_time ?? 0), irating: ref?.irating, conditions: ref?.conditions ?? undefined }
          }),
        ]
        const pv = isAdmin && promptVersion !== 'default' ? promptVersion : null
        return runAnalysis(
          selectedLapId!,
          Array.from(selectedRefIds),
          lap.car_name,
          lap.track_name,
          'vs_reference',
          lapsMetadata,
          llmModel,
          pv,
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
  const llmAccess = user?.llm_access
  const selectedProviderAccess = llmAccess?.providers?.[llmModel]
  const alternateProvider = llmModel === 'claude' ? 'gemini' : 'claude'
  const alternateProviderAccess = llmAccess?.providers?.[alternateProvider]
  const hasPersonalLlmKey = Boolean(user?.has_custom_claude_key || user?.has_custom_gemini_key)
  const personalProviderOptions = (['claude', 'gemini'] as const).filter(
    (provider) => llmAccess?.providers?.[provider]?.has_custom_key,
  )
  const hasSharedFreeReports = Boolean(
    llmAccess?.providers?.claude?.has_shared_key || llmAccess?.providers?.gemini?.has_shared_key,
  )
  const baseCanAnalyse = analysisMode === 'sessions'
    ? selectedSessionId !== null && (selectedSession?.laps?.length ?? 0) >= 2 && !analysisMutation.isPending
    : selectedLapId !== null && selectedRefIds.size > 0 && !analysisMutation.isPending
  const canAnalyse = baseCanAnalyse && Boolean(selectedProviderAccess?.can_generate)

  useEffect(() => {
    if (!selectedProviderAccess?.can_generate && alternateProviderAccess?.can_generate) {
      setLlmModel(alternateProvider)
    }
  }, [alternateProvider, alternateProviderAccess?.can_generate, selectedProviderAccess?.can_generate])

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
            {user?.role === 'admin' && (
              <Link
                to="/admin"
                title="Admin Panel"
                className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300 transition-colors text-sm px-2 py-1 rounded-lg hover:bg-slate-700"
              >
                <Shield className="w-4 h-4" />
                <span className="hidden sm:inline text-xs font-medium">Admin</span>
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
              Garage61 not connected — you can still upload and analyse CSV telemetry files.
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
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {pageTab === 'analysis' ? 'Analysis' : 'Data Import'}
              </h2>
            </div>

            {pageTab === 'analysis' && (
              <>
                <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5 text-xs font-medium w-fit">
                  <button
                    onClick={() => handleModeChange('vs_reference')}
                    className={`px-3 py-1.5 rounded-md transition-colors ${
                      analysisMode === 'vs_reference'
                        ? 'bg-amber-500 text-slate-900'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Reference
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

                <p className="text-slate-500 text-xs -mt-2">
                  {analysisMode === 'sessions'
                    ? 'Select a stored session from any connected telemetry source. The fastest lap becomes the baseline automatically.'
                    : 'Pick your lap and compare it against any other stored lap from Garage61 or imported telemetry.'}
                </p>

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
                    className="select"
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
                  <p className="mt-2 text-[11px] text-slate-500">
                    Type to search, then pick a matching car from the suggestions.
                  </p>
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
                    className="select"
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
                  <p className="mt-2 text-[11px] text-slate-500">
                    Type to search, then pick a matching track from the suggestions.
                  </p>
                </div>
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
                      {[5, 10, 25].map((size) => (
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
                          const { consecutiveLaps, analysisLaps, fastestLap } = buildSessionAnalysisLaps(session.laps, 5)
                          const fastestOutsideWindow = fastestLap != null && !consecutiveLaps.some((lap) => lap.id === fastestLap.id)
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
                                  {session.laps.length > 5 && (
                                    <span className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                                      {fastestOutsideWindow ? 'uses 5 consecutive laps + fastest lap' : 'uses 5 consecutive laps'}
                                    </span>
                                  )}
                                  <span className="text-slate-500 text-xs flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {formatDate(session.date)}
                                  </span>
                                  {session.source && (
                                    <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                                      session.source === 'upload' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                                    }`}>
                                      {session.source === 'upload' ? 'csv' : 'g61'}
                                    </span>
                                  )}
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
                                  {consecutiveLaps.map((lap, idx) => (
                                    <div key={lap.id} className="flex items-center gap-3 py-1 text-xs">
                                      <span className="text-slate-600 w-4 text-right flex-shrink-0">{idx + 1}</span>
                                      <span className={`font-mono flex-shrink-0 ${lap.id === fastestLap?.id ? 'text-amber-400' : 'text-slate-300'}`}>
                                        {formatLapTime(lap.lap_time)}
                                      </span>
                                      <span className="text-slate-500">
                                        {formatDateTime(lap.recorded_at)}
                                      </span>
                                      {lap.id === fastestLap?.id && (
                                        <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                                          fastest
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                  {fastestOutsideWindow && fastestLap && (
                                    <div className="pt-1">
                                      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                                        Added fastest lap
                                      </div>
                                      <div className="flex items-center gap-3 py-1 text-xs">
                                        <span className="text-slate-600 w-4 text-right flex-shrink-0">{analysisLaps.length}</span>
                                        <span className="font-mono flex-shrink-0 text-amber-400">
                                          {formatLapTime(fastestLap.lap_time)}
                                        </span>
                                        <span className="text-slate-500">
                                          {formatDateTime(fastestLap.recorded_at)}
                                        </span>
                                        <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                                          fastest
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                  {session.laps.length > 5 && (
                                    <div className="pt-1 text-[11px] text-slate-500">
                                      {fastestOutsideWindow
                                        ? 'Showing the 5-lap consecutive run plus the session fastest lap used for analysis.'
                                        : 'Showing the 5-lap consecutive run used for analysis.'}
                                    </div>
                                  )}
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
                              <th className="text-left pb-2 font-medium">Conditions</th>
                              <th className="text-left pb-2 font-medium">Src</th>
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
                                  <td className="py-2.5 text-xs text-slate-400 max-w-[18rem]">
                                    <span className="block truncate" title={formatLapConditionsCompact(lap)}>
                                      {formatLapConditionsCompact(lap)}
                                    </span>
                                  </td>
                                  <td className="py-2.5">
                                    {lap.source === 'upload' ? (
                                      <span className="text-[10px] uppercase tracking-wide text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">csv</span>
                                    ) : lap.source === 'garage61' ? (
                                      <span className="text-[10px] uppercase tracking-wide text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">g61</span>
                                    ) : null}
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
                  <span className="text-slate-500 text-xs">(Top {refLapLimit} fastest)</span>
                  <div className="ml-auto flex items-center gap-1">
                    {[5, 10, 15, 20].map((n) => (
                      <button
                        key={n}
                        onClick={() => setRefLapLimit(n)}
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
                      onClick={() => setSelectedRefIds(new Set(refLaps.map((l: Lap) => l.id)))}
                      className="text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Select all
                    </button>
                    <span className="text-slate-700">·</span>
                    <button
                      onClick={() => setSelectedRefIds(new Set())}
                      className="text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Unselect all
                    </button>
                    <span className="text-slate-600 text-xs ml-auto">{selectedRefIds.size} selected</span>
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
                        {lap.source && (
                          <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                            lap.source === 'upload' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                          }`}>
                            {lap.source === 'upload' ? 'csv' : 'g61'}
                          </span>
                        )}
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

              </>
            )}

            {pageTab === 'import' && (
              <>
                <p className="text-slate-500 text-xs -mt-2">
                  Import telemetry files, review the extracted metadata, override anything you need, and store the compressed CSVs in the database for later analysis.
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
                            Select both car and track from the Garage61 dictionary before importing CSV telemetry.
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
                      onChange={(e) => setLlmModel(e.target.value as 'claude' | 'gemini')}
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
                    <span>{analysisMode === 'sessions' ? 'Analyse Session' : 'Analyse Lap'}</span>
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
                    {src === 'all' ? 'All' : src === 'garage61' ? 'G61' : 'CSV'}
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
                    const canApply = Boolean(carId && trackId)
                    const isExpanded = expandedRecentIds.has(lap.id)
                    return (
                      <div
                        key={lap.id}
                        className={`card text-left transition-colors w-full px-3 py-2.5 ${
                          canApply ? 'hover:bg-slate-700' : 'opacity-70'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => toggleRecentCard(lap.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 min-w-0 text-sm">
                                <ChevronRight className={`w-3.5 h-3.5 text-slate-500 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
                                <Car className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                                <span className="text-amber-400 font-semibold truncate">{lap.car_name}</span>
                                <span className="text-slate-600 flex-shrink-0">·</span>
                                <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                                <span className="text-slate-300 truncate">{lap.track_name}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-5 text-[11px]">
                                <span className="rounded-md bg-slate-800 px-2 py-0.5 text-slate-300">
                                  {lap.lap_count ?? 0} laps
                                </span>
                                <span className="rounded-md bg-slate-800 px-2 py-0.5 text-slate-400">
                                  {lap.entries.length} date{lap.entries.length === 1 ? '' : 's'}
                                </span>
                                {lap.source && (
                                  <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-md ${
                                    lap.source === 'upload'
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : lap.source === 'garage61'
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : 'bg-slate-600/40 text-slate-300'
                                  }`}>
                                    {lap.source === 'upload' ? 'csv' : lap.source === 'garage61' ? 'g61' : 'mix'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                          <div className="flex items-start gap-2 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => canApply && applyRecentFilters(carId, trackId)}
                              disabled={!canApply}
                              className="text-[11px] px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-200 font-semibold hover:bg-amber-500 hover:text-slate-950 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-500/15 disabled:hover:text-amber-200 transition-colors"
                              title={
                                canApply
                                  ? 'Select this car and track'
                                  : 'Car or track not available for selection'
                              }
                            >
                              Select
                            </button>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="mt-2 border-t border-slate-700/50 pt-2">
                            <div className="space-y-1.5">
                              {lap.entries.map((entry, idx) => (
                                <div
                                  key={`${lap.id}-${entry.date}-${idx}`}
                                  className="flex items-center justify-between gap-3 rounded-md bg-slate-800/70 px-2.5 py-1.5 text-[11px]"
                                >
                                  <span className="text-slate-300">{formatDate(entry.date)}</span>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-slate-400">{entry.lap_count ?? 0} laps</span>
                                    <span className={`uppercase tracking-wide font-semibold ${
                                      entry.source === 'upload' ? 'text-emerald-400' : 'text-blue-400'
                                    }`}>
                                      {entry.source === 'upload' ? 'csv' : 'g61'}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
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

            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2"><History className="w-5 h-5 text-amber-500" />Analysis History</h2>
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
                    const isQueued = item.status === 'enqueued'
                    const isProcessing = item.status === 'processing'
                    const isActive = isQueued || isProcessing
                    const sourceLabel = getLapSourceLabel(item.lap_id)
                    return (
                    <div key={item.id} className="relative group">
                      <button
                        data-testid="analysis-history-item"
                        onClick={() => navigate(`/report/${item.id}`, {
                          state: { backTo: { pathname: '/app' } },
                        })}
                        className={`w-full card text-left hover:bg-slate-700 transition-colors pr-10 py-2 border-l-2 ${
                          isSoloItem ? 'border-l-violet-500/50' : 'border-l-orange-500/50'
                        } ${
                          isActive ? 'bg-slate-800/55 border-slate-700/70' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className={`flex-1 min-w-0 transition-opacity ${isActive ? 'opacity-75' : 'opacity-100'}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                                isSoloItem
                                  ? 'bg-violet-500/15 text-violet-400'
                                  : 'bg-orange-500/15 text-orange-400'
                              }`}>
                                {isSoloItem ? 'Session' : 'Reference'}
                              </span>
                              {isQueued && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/30 shadow-[0_0_0_1px_rgba(56,189,248,0.08)] flex-shrink-0 opacity-100">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  In queue
                                </span>
                              )}
                              {isProcessing && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-400/20 text-amber-300 ring-1 ring-amber-300/35 shadow-[0_0_0_1px_rgba(251,191,36,0.08)] flex-shrink-0 opacity-100">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Processing
                                </span>
                              )}
                              {item.status === 'failed' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400 flex-shrink-0">
                                  Failed
                                </span>
                              )}
                              <span className="text-amber-400 font-semibold text-sm truncate">
                                {item.car_name}
                              </span>
                              <span className="text-slate-500 text-xs">@</span>
                              <span className="text-slate-300 text-sm truncate">
                                {item.track_name}
                              </span>
                              {item.estimated_time_gain_seconds != null && item.estimated_time_gain_seconds > 0 && (
                                <span className={`inline-flex items-center gap-1 bg-amber-500/20 border border-amber-500/30 text-amber-400 font-semibold text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                                  isActive ? 'opacity-70' : ''
                                }`}>
                                  <Zap className="w-3 h-3" />
                                  +{item.estimated_time_gain_seconds.toFixed(1)}s
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 mt-1">
                              <span className={`uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                                sourceLabel === 'csv'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-blue-500/15 text-blue-400'
                              }`}>
                                {sourceLabel}
                              </span>
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
