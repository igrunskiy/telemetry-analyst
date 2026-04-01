import React, { useEffect, useState, useMemo } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BarChart2, Trash2, Clock, Calendar, Layers, Lightbulb, TrendingDown, ChevronDown, ChevronUp, ExternalLink, User, RefreshCw, Share2, Check, Zap, FileText, Download } from 'lucide-react'
import { getAnalysis, deleteAnalysis, regenerateAnalysis, shareAnalysis, getSharedAnalysis } from '../api/client'
import TrackMap from '../components/TrackMap'
import TelemetryChart from '../components/TelemetryChart'
import HeatMap from '../components/HeatMap'
import DeltaHeatmap from '../components/DeltaHeatmap'
import AnalysisCards from '../components/AnalysisCards'
import { ThemeToggle } from '../components/ThemeToggle'
import TelemetryInsights from '../components/TelemetryInsights'
import { useAuth } from '../hooks/useAuth'
import type { AnalysisReport, ImprovementArea, LapConditions, LapMeta, SectorData } from '../types'

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }

function TabInsights({ report, tab }: { report: AnalysisReport; tab: Tab }) {
  const areas = report.improvement_areas ?? []
  const sectors: SectorData[] = report.telemetry?.sectors ?? []

  const content = useMemo(() => {
    if (tab === 'focus') {
      const top = [...areas].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, 3)
      if (!top.length) return null
      return {
        heading: 'Priority Focus Areas',
        items: top.map((a: ImprovementArea) => ({
          label: `#${a.rank} ${a.title}`,
          detail: `${(a.time_loss_ms / 1000).toFixed(2)}s — ${a.description}`,
          severity: a.severity,
        })),
        hint: areas.length > 3 ? `+${areas.length - 3} more areas in the full list below.` : null,
      }
    }

    if (tab === 'telemetry') {
      const relevant = areas.filter((a: ImprovementArea) =>
        ['braking_point', 'throttle_pickup', 'exit_speed'].includes(a.issue_type)
      )
      const fallback = relevant.length === 0 ? areas.slice(0, 3) : relevant
      if (!fallback.length) return null
      return {
        heading: 'Driving Input Insights',
        items: fallback.map((a: ImprovementArea) => ({
          label: a.title,
          detail: a.telemetry_evidence || a.description,
          severity: a.severity,
        })),
        hint: 'Use the delta trace to identify where gaps open — look for braking and throttle divergence.',
      }
    }

    if (tab === 'heatmap') {
      const top = [...areas]
        .sort((a, b) => b.time_loss_ms - a.time_loss_ms)
        .slice(0, 3)
      if (!top.length) return null
      return {
        heading: 'Where You\'re Losing Time',
        items: top.map((a: ImprovementArea) => ({
          label: a.title,
          detail: `${(a.time_loss_ms / 1000).toFixed(2)}s lost — ${a.description}`,
          severity: a.severity,
        })),
        hint: 'Red/orange zones on the heatmap mark low-speed areas. Cross-reference with the corners above.',
      }
    }

    return null
  }, [tab, areas, sectors, report.sector_notes])

  if (!content) return null

  const severityColor: Record<string, string> = {
    high: 'text-red-400',
    medium: 'text-orange-400',
    low: 'text-emerald-400',
  }
  const severityDot: Record<string, string> = {
    high: 'bg-red-500',
    medium: 'bg-orange-400',
    low: 'bg-emerald-400',
  }

  return (
    <div className="mb-5 card border-slate-700/80 bg-slate-800/60">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span className="text-white font-medium text-sm">{content.heading}</span>
      </div>
      <div className="space-y-2">
        {content.items.map((item: { label: string; detail: string | null; severity: string }, i: number) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${severityDot[item.severity]}`} />
            <div className="min-w-0">
              <span className={`text-xs font-semibold ${severityColor[item.severity]}`}>{item.label}</span>
              {item.detail && (
                <p className="text-xs text-slate-400 leading-relaxed mt-0.5">{item.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      {content.hint && (
        <p className="mt-3 pt-3 border-t border-slate-700/50 text-xs text-slate-500 leading-relaxed flex items-start gap-1.5">
          <TrendingDown className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-slate-600" />
          {content.hint}
        </p>
      )}
    </div>
  )
}

function normalizeLapTimeMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value < 1000 ? value * 1000 : value  // Garage61 may return seconds
}

function formatLapTime(raw: number): string {
  const ms = normalizeLapTimeMs(raw)
  if (!ms) return '—'
  const totalSec = ms / 1000
  const mins = Math.floor(totalSec / 60)
  const secs = (totalSec % 60).toFixed(3).padStart(6, '0')
  return `${mins}:${secs}`
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0 B'
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function getGarage61AnalyzeUrl(lapId: string, explicitUrl?: string): string | null {
  if (explicitUrl) return explicitUrl
  if (!lapId.startsWith('garage61:')) return null
  const rawId = lapId.split(':', 2)[1]
  return rawId ? `https://garage61.net/app/analyze;t=${rawId}` : null
}

function getReportPhase(status?: string | null): { state: string; phase: string; detail: string } {
  switch (status) {
    case 'enqueued':
      return {
        state: 'Queued',
        phase: 'Waiting for worker',
        detail: 'Your analysis is in the queue and will start as soon as a worker is free.',
      }
    case 'processing':
      return {
        state: 'Running',
        phase: 'Telemetry + AI analysis',
        detail: 'Fetching data, processing laps, and generating the coaching report.',
      }
    case 'failed':
      return {
        state: 'Failed',
        phase: 'Stopped',
        detail: 'The report did not complete successfully.',
      }
    case 'completed':
    default:
      return {
        state: 'Complete',
        phase: 'Ready',
        detail: 'The report is ready to review.',
      }
  }
}

async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()

  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) {
    throw new Error('Copy failed')
  }
}

function IRatingBadge({ value }: { value: number }) {
  // iRacing iRating tiers with colour + label
  const tiers = [
    { min: 6000, label: 'Pro',      bg: 'bg-rose-500/20',    border: 'border-rose-400/60',    text: 'text-rose-300'    },
    { min: 4500, label: 'Elite',    bg: 'bg-orange-500/20',  border: 'border-orange-400/60',  text: 'text-orange-300'  },
    { min: 3500, label: 'Expert',   bg: 'bg-amber-500/20',   border: 'border-amber-400/60',   text: 'text-amber-300'   },
    { min: 2500, label: 'Advanced', bg: 'bg-yellow-500/20',  border: 'border-yellow-400/60',  text: 'text-yellow-300'  },
    { min: 1500, label: 'Inter',    bg: 'bg-emerald-500/20', border: 'border-emerald-400/60', text: 'text-emerald-300' },
    { min: 750,  label: 'Novice',   bg: 'bg-sky-500/20',     border: 'border-sky-400/60',     text: 'text-sky-300'     },
    { min: 0,    label: 'Rookie',   bg: 'bg-slate-600/30',   border: 'border-slate-500/50',   text: 'text-slate-400'   },
  ]
  const tier = tiers.find((t) => value >= t.min) ?? tiers[tiers.length - 1]
  return (
    <span
      title={tier.label}
      className={`inline-flex items-center px-2 py-0.5 rounded border font-mono font-semibold cursor-default ${tier.bg} ${tier.border} ${tier.text}`}
    >
      {value.toLocaleString()}
    </span>
  )
}

function formatLapConditions(conditions?: LapConditions | null): string {
  if (!conditions) return '—'

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
  if (conditions.summary) parts.push(conditions.summary)
  if (conditions.setup_type) parts.push(`Setup ${conditions.setup_type}`)
  if (conditions.weather) parts.push(conditions.weather)
  if (conditions.track_state) parts.push(`Track ${conditions.track_state}`)
  if (conditions.air_temp_c != null) parts.push(`Air ${conditions.air_temp_c.toFixed(1)}C`)
  if (conditions.track_temp_c != null) parts.push(`Track ${conditions.track_temp_c.toFixed(1)}C`)
  if (conditions.humidity_pct != null) parts.push(`Humidity ${conditions.humidity_pct.toFixed(0)}%`)
  const windDirection = formatWindDirection(conditions.wind_direction)
  if (conditions.wind_kph != null) {
    const direction = windDirection ? ` ${windDirection}` : ''
    parts.push(`Wind ${conditions.wind_kph.toFixed(1)} kph${direction}`)
  } else if (windDirection) {
    parts.push(`Wind ${windDirection}`)
  }
  if (conditions.time_of_day) parts.push(conditions.time_of_day)

  return parts.length > 0 ? parts.join(' • ') : '—'
}

function formatElapsedLabel(startedAt?: string | null, nowMs?: number): string | null {
  if (!startedAt) return null
  const started = new Date(startedAt)
  if (Number.isNaN(started.getTime())) return null

  const elapsedSeconds = Math.max(0, Math.floor(((nowMs ?? Date.now()) - started.getTime()) / 1000))
  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
  }
  return `${seconds}s`
}

function LapMetaTable({ laps, userLapId, isSolo, allowDownloads = true }: { laps: LapMeta[]; userLapId: string; isSolo: boolean; allowDownloads?: boolean }) {
  const userLap = laps.find((l) => l.id === userLapId || l.role === 'user')
  const userTimeMs = normalizeLapTimeMs(userLap?.lap_time ?? 0)

  // In solo mode, count non-user laps to give them lap numbers
  let refLapIndex = 0

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-slate-700/50">
            <th className="text-left pb-2 pr-4 font-medium">{isSolo ? 'Lap' : 'Role'}</th>
            {!isSolo && (
              <th className="text-left pb-2 pr-4 font-medium">
                <span className="flex items-center gap-1"><User className="w-3 h-3" />Driver</span>
              </th>
            )}
            {!isSolo && <th className="text-right pb-2 pr-4 font-medium">iRating</th>}
            <th className="text-right pb-2 pr-4 font-medium">Lap Time</th>
            <th className="text-right pb-2 font-medium">{isSolo ? 'Δ vs Best' : 'Δ vs You'}</th>
            <th className="text-left pb-2 pl-4 font-medium">Conditions</th>
            <th className="pb-2 pl-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/30">
          {laps.map((lap) => {
            const garage61Url = getGarage61AnalyzeUrl(lap.id, lap.garage61_url)
            const isUser = lap.role === 'user'
            const deltaMs = isUser ? null : normalizeLapTimeMs(lap.lap_time) - userTimeMs
            const deltaS = deltaMs != null ? deltaMs / 1000 : null
            // positive delta = this lap is slower than baseline (bad) → red
            // negative delta = this lap is faster than baseline → shouldn't happen in solo (baseline is fastest)
            const deltaColor = deltaS == null ? '' : deltaS > 0 ? 'text-red-400' : 'text-emerald-400'
            const deltaLabel =
              deltaS == null ? '—'
              : deltaS > 0 ? `+${deltaS.toFixed(3)}s`
              : `−${Math.abs(deltaS).toFixed(3)}s`

            let roleLabel: React.ReactNode
            if (isSolo) {
              if (isUser) {
                roleLabel = <span className="text-amber-400 font-medium">Best</span>
              } else {
                refLapIndex++
                roleLabel = <span className="text-slate-400">Lap {refLapIndex + 1}</span>
              }
            } else {
              roleLabel = isUser
                ? <span className="text-blue-400 font-medium">You</span>
                : <span className="text-orange-400">Ref</span>
            }

            return (
              <tr key={lap.id} className="text-slate-300">
                <td className="py-2 pr-4">{roleLabel}</td>
                {!isSolo && (
                  <td className="py-2 pr-4 text-slate-200">
                    {lap.driver_name || <span className="text-slate-600 italic">unknown</span>}
                  </td>
                )}
                {!isSolo && (
                  <td className="py-2 pr-4 text-right">
                    {lap.irating != null ? <IRatingBadge value={lap.irating} /> : <span className="text-slate-600 font-mono">—</span>}
                  </td>
                )}
                <td className="py-2 pr-4 text-right font-mono">
                  {lap.lap_time ? formatLapTime(lap.lap_time) : <span className="text-slate-600">—</span>}
                </td>
                <td className={`py-2 text-right font-mono ${deltaColor}`}>
                  {deltaLabel}
                </td>
                <td className="py-2 pl-4 text-slate-400 max-w-[24rem]">
                  {formatLapConditions(lap.conditions)}
                </td>
                <td className="py-2 pl-3">
                  <div className="flex items-center gap-2">
                    {allowDownloads && lap.download_path && (
                      <a
                        href={lap.download_path}
                        className="text-slate-600 hover:text-slate-300 transition-colors"
                        title="Download stored telemetry CSV"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                    )}
                    {garage61Url && (
                      <a
                        href={garage61Url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-600 hover:text-slate-400 transition-colors"
                        title="Open in Garage61 Analyze"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type Tab = 'summary' | 'focus' | 'telemetry' | 'heatmap'

const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'focus', label: 'Focus Areas' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'heatmap', label: 'Heatmap' },
]

function formatSectorDelta(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs === 0) return '0.00s'
  const seconds = Math.abs(deltaMs) / 1000
  return deltaMs > 0 ? `+${seconds.toFixed(2)}s` : `-${seconds.toFixed(2)}s`
}

export default function ReportPage({ readOnly = false }: { readOnly?: boolean }) {
  const { analysisId, shareToken } = useParams<{ analysisId?: string; shareToken?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('summary')
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selectedSector, setSelectedSector] = useState<number | null>(null)
  const [activeCornerNums, setActiveCornerNums] = useState<number[]>([])
  const [metaExpanded, setMetaExpanded] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'loading' | 'copied'>('idle')
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now())
  // Snapshot of the report before regeneration starts — kept visible until the user dismisses
  const [savedReport, setSavedReport] = useState<typeof report | null>(null)
  const backTo = (location.state as { backTo?: { pathname: string; state?: unknown } } | null)?.backTo
  const backHref = backTo?.pathname ?? '/app'
  const goBack = () => {
    if (backTo) {
      navigate(backTo.pathname, { state: backTo.state })
      return
    }
    navigate('/app')
  }

  const deleteMutation = useMutation({
    mutationFn: () => deleteAnalysis(analysisId!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['analysisHistory'] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] })
      goBack()
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: () => regenerateAnalysis(analysisId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysis', analysisId] })
    },
  })

  const handleRegenerate = () => {
    if (report && (!report.status || report.status === 'completed')) {
      setSavedReport(report)
    }
    regenerateMutation.mutate()
  }

  const handleShare = async () => {
    if (shareState !== 'idle' || !analysisId) return
    setShareState('loading')
    try {
      // If already shared, use existing token from report; otherwise generate one
      const token = report?.share_token ?? (await shareAnalysis(analysisId)).share_token
      const url = `${window.location.origin}/shared/${token}`
      await copyText(url)
      setShareState('copied')
      setTimeout(() => setShareState('idle'), 2000)
    } catch {
      setShareState('idle')
    }
  }

  const {
    data: report,
    isLoading,
    isError,
  } = useQuery({
    queryKey: readOnly ? ['shared-analysis', shareToken] : ['analysis', analysisId],
    queryFn: () => readOnly ? getSharedAnalysis(shareToken!) : getAnalysis(analysisId!),
    enabled: readOnly ? !!shareToken : !!analysisId,
    // Poll every 2 seconds while the job is still queued or being processed
    refetchInterval: (query) => {
      const s = query.state.data?.status
      if (!s || s === 'enqueued' || s === 'processing') return 2000
      return false
    },
  })

  const isRegenerating =
    regenerateMutation.isPending ||
    report?.status === 'enqueued' ||
    report?.status === 'processing'

  useEffect(() => {
    if (!isRegenerating) {
      return
    }
    setLiveNowMs(Date.now())
    const timer = window.setInterval(() => {
      setLiveNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isRegenerating])

  const elapsedStartAt = report?.enqueued_at ?? report?.created_at
  const elapsedLabel = isRegenerating ? formatElapsedLabel(elapsedStartAt, liveNowMs) : null

  // The report to render — fall back to the saved snapshot while regeneration is in flight
  const displayReport = savedReport ?? report

  // The new report has landed — show a "ready" banner so the user can switch to it
  const newVersionReady = savedReport != null && report?.status === 'completed' && report.id === savedReport.id

  // Compute sector distance ranges from the distances array
  const sectorDistRanges = useMemo(() => {
    if (!displayReport) return []
    const d = displayReport.telemetry?.distances ?? []
    const n = displayReport.telemetry?.sectors?.length || 3
    if (d.length === 0) return []
    const step = Math.floor(d.length / n)
    return Array.from({ length: n }, (_, i) => [
      d[i * step],
      i === n - 1 ? d[d.length - 1] : d[Math.min((i + 1) * step, d.length - 1)],
    ] as [number, number])
  }, [report])

  const activeSectorRange: [number, number] | null =
    selectedSector != null && sectorDistRanges[selectedSector - 1]
      ? sectorDistRanges[selectedSector - 1]
      : null
  const sectorDeltas = useMemo(
    () => (displayReport?.telemetry?.sectors ?? []).map((s) => ({
      sector: Number(s.sector),
      deltaMs: s.ref_time_ms - s.user_time_ms,
    })),
    [displayReport],
  )
  const totalSectorDelta = useMemo(
    () => sectorDeltas.reduce((sum, item) => sum + item.deltaMs, 0),
    [sectorDeltas],
  )

  const handleSectorClick = (sector: number | null) => {
    setSelectedSector(sector)
    // When sector selected, highlight corners in that range
    if (sector != null && displayReport) {
      const range = sectorDistRanges[sector - 1]
      if (range) {
        const nums = displayReport.telemetry?.corners
          .filter((c) => c.dist_apex >= range[0] && c.dist_apex <= range[1])
          .map((c) => c.corner_num)
        setActiveCornerNums(nums)
      }
    } else {
      setActiveCornerNums([])
    }
  }

  const isSolo = displayReport?.analysis_mode === 'solo'
  const isAdmin = user?.role === 'admin'
  const reportPhase = getReportPhase(report?.status)
  const soloUserLap = isSolo ? displayReport?.laps_metadata?.find((l) => l.role === 'user') : undefined
  const soloTotalLaps = displayReport ? displayReport.reference_lap_ids.length + 1 : 0
  const hasGps = (displayReport?.telemetry?.user_lat?.length ?? 0) > 0
  const trackLength =
    displayReport && displayReport.telemetry?.distances?.length > 0
      ? displayReport.telemetry.distances[displayReport.telemetry.distances.length - 1]
      : 3000

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-[90%] mx-auto px-4">
          <div className="h-14 flex items-center gap-3">
            {!readOnly && (
              <Link
                to={backHref}
                state={backTo?.state}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
            )}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <BarChart2 className="w-4 h-4 text-slate-900" />
              </div>
              {report ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-amber-400 font-semibold text-sm truncate">
                    {report.car_name}
                  </span>
                  <span className="text-slate-500 text-xs hidden sm:inline">@</span>
                  <span className="text-slate-300 text-sm truncate hidden sm:inline">
                    {report.track_name}
                  </span>
                </div>
              ) : (
                <span className="text-white font-medium text-sm">Analysis Report</span>
              )}
            </div>

            {readOnly && (
              <span className="text-xs text-slate-500 border border-slate-700 rounded px-2 py-0.5 flex-shrink-0">
                Read-only
              </span>
            )}
            <ThemeToggle />
          </div>

        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-[90%] w-full mx-auto px-4 py-6">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Loading report...</span>
          </div>
        )}

        {!isLoading && (report?.status === 'enqueued' || report?.status === 'processing') && (
          <div className="flex flex-col items-center justify-center py-24 gap-5">
            <div className="w-12 h-12 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-white font-medium mb-1">
                {report.status === 'enqueued' ? 'Waiting in queue…' : 'Analysing telemetry…'}
              </p>
              <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs">
                <span className="text-slate-400">State</span>
                <span className="font-semibold text-amber-300">{reportPhase.state}</span>
                <span className="text-slate-600">/</span>
                <span className="text-slate-400">Phase</span>
                <span className="font-semibold text-white">{reportPhase.phase}</span>
              </div>
              <p className="text-slate-500 text-sm mt-3">
                {reportPhase.detail}
              </p>
              {elapsedLabel && (
                <p className="text-amber-400 text-sm font-medium mt-3">
                  Time elapsed: {elapsedLabel}
                </p>
              )}
            </div>
            <Link to={backHref} state={backTo?.state} className="text-slate-500 hover:text-slate-300 text-sm transition-colors">
              &larr; Back to lap selector
            </Link>
          </div>
        )}

        {!isLoading && report?.status === 'failed' && (
          <div className="card text-center py-12">
            <p className="text-red-400 font-medium mb-2">Analysis failed</p>
            <p className="text-slate-500 text-sm mb-4">{report.error_message?.split('\n')[0] || 'An unexpected error occurred.'}</p>
            <div className="flex items-center justify-center gap-3">
              {!readOnly && (
                <button
                  onClick={() => handleRegenerate()}
                  disabled={regenerateMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-medium text-sm transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
                  {regenerateMutation.isPending ? 'Re-running…' : 'Re-run analysis'}
                </button>
              )}
              <Link to={backHref} state={backTo?.state} className="text-amber-500 hover:text-amber-400 text-sm">
                &larr; Back to lap selector
              </Link>
            </div>
          </div>
        )}

        {isError && (
          <div className="card text-center py-12">
            <p className="text-red-400 mb-2">Failed to load analysis report.</p>
            <Link to={backHref} state={backTo?.state} className="text-amber-500 hover:text-amber-400 text-sm">
              &larr; Back to lap selector
            </Link>
          </div>
        )}

        {newVersionReady && (
          <div className="mb-4 flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <span className="text-emerald-300 text-sm flex-1">New analysis is ready.</span>
            <button
              onClick={() => setSavedReport(null)}
              className="px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium transition-colors flex-shrink-0"
            >
              View new version
            </button>
          </div>
        )}

        {displayReport && (!displayReport.status || displayReport.status === 'completed') && (
          <>
            {/* Lap metadata bar */}
            {isSolo ? (
              /* Session analysis — compact non-expandable header */
              <div className="mb-5 card p-0 overflow-hidden">
                <div className="flex items-center gap-x-5 gap-y-1.5 flex-wrap px-3 py-2.5 text-xs text-slate-400">
                  {/* Mode badge */}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium border bg-violet-500/15 border-violet-500/30 text-violet-300">
                    Session Analysis
                  </span>
                  {/* Timestamp */}
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-300">
                      {new Date(displayReport.created_at).toLocaleString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </span>
                  {/* Best lap time */}
                  {soloUserLap && (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                      <span className="text-slate-500">Best lap:</span>
                      <span className="font-mono text-amber-400">{formatLapTime(soloUserLap.lap_time)}</span>
                    </span>
                  )}
                  {/* Total laps */}
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-500">{soloTotalLaps} {soloTotalLaps === 1 ? 'lap' : 'laps'} analyzed</span>
                  </span>
                  {/* Generation time + model */}
                  {(displayReport.generation_time_s != null || displayReport.model_name || displayReport.llm_provider || (isAdmin && displayReport.prompt_version) || (isAdmin && displayReport.llm_payload_bytes != null)) && (
                    <span className="flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                      <span className="text-slate-500">Generated{displayReport.generation_time_s != null ? ` in ${displayReport.generation_time_s}s` : ''}</span>
                      {(displayReport.model_name || displayReport.llm_provider) && (
                        <>
                          <span className="text-slate-600">by</span>
                          <span className="font-mono text-xs text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded">{displayReport.model_name ?? displayReport.llm_provider}</span>
                        </>
                      )}
                      {isAdmin && displayReport.prompt_version && (
                        <>
                          <span className="text-slate-600">with</span>
                          <span className="font-mono text-xs text-sky-300/90 bg-sky-400/10 px-1.5 py-0.5 rounded">{displayReport.prompt_version}</span>
                        </>
                      )}
                      {isAdmin && displayReport.llm_payload_bytes != null && (
                        <>
                          <span className="text-slate-600">payload</span>
                          <span className="font-mono text-xs text-fuchsia-300/90 bg-fuchsia-400/10 px-1.5 py-0.5 rounded">{formatBytes(displayReport.llm_payload_bytes)}</span>
                        </>
                      )}
                    </span>
                  )}
                  {/* Link to best lap on Garage61 */}
                  <a
                    href={`https://garage61.net/app/laps/${displayReport.lap_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    <span>View session lap</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  {/* Control buttons */}
                  {!readOnly && (
                    <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleRegenerate()}
                        disabled={isRegenerating}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded-lg transition-colors disabled:opacity-50"
                        title="Regenerate analysis"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={handleShare}
                        disabled={shareState === 'loading'}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded-lg transition-colors disabled:opacity-50"
                        title="Copy share link"
                      >
                        {shareState === 'copied'
                          ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                          : <Share2 className="w-3.5 h-3.5" />}
                      </button>
                      {confirmDelete ? (
                        <>
                          <button
                            onClick={() => deleteMutation.mutate()}
                            disabled={deleteMutation.isPending}
                            className="px-2 py-0.5 rounded text-xs bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
                          >
                            {deleteMutation.isPending ? '…' : 'Delete'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(false)}
                            className="px-2 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(true)}
                          className="p-1.5 text-red-500 hover:text-red-400 hover:bg-slate-700/60 rounded-lg transition-colors"
                          title="Delete analysis"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Comparative analysis — collapsed summary + expandable detail */
              <div className="mb-5 card p-0 overflow-hidden">
                {/* Always-visible summary row */}
                <button
                  onClick={() => setMetaExpanded((v) => !v)}
                  className="w-full flex items-center gap-x-5 gap-y-1.5 flex-wrap px-3 py-2.5 text-xs text-slate-400 hover:bg-slate-800/60 transition-colors text-left"
                >
                  {/* Mode badge */}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium border bg-orange-500/15 border-orange-500/30 text-orange-300">
                    vs Reference
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-300">
                      {new Date(displayReport.created_at).toLocaleString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-500">Your lap:</span>
                    <span className="font-mono text-blue-400">
                      {displayReport.lap_id.slice(0, 8)}
                    </span>
                  </span>
                  {displayReport.reference_lap_ids.length > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                      <span className="text-slate-500">
                        {displayReport.reference_lap_ids.length === 1 ? '1 reference' : `${displayReport.reference_lap_ids.length} references`}
                      </span>
                    </span>
                  )}
                  {(displayReport.generation_time_s != null || displayReport.model_name || displayReport.llm_provider || (isAdmin && displayReport.prompt_version) || (isAdmin && displayReport.llm_payload_bytes != null)) && (
                    <span className="flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                      <span className="text-slate-500">Generated{displayReport.generation_time_s != null ? ` in ${displayReport.generation_time_s}s` : ''}</span>
                      {(displayReport.model_name || displayReport.llm_provider) && (
                        <>
                          <span className="text-slate-600">by</span>
                          <span className="font-mono text-xs text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded">{displayReport.model_name ?? displayReport.llm_provider}</span>
                        </>
                      )}
                      {isAdmin && displayReport.prompt_version && (
                        <>
                          <span className="text-slate-600">with</span>
                          <span className="font-mono text-xs text-sky-300/90 bg-sky-400/10 px-1.5 py-0.5 rounded">{displayReport.prompt_version}</span>
                        </>
                      )}
                      {isAdmin && displayReport.llm_payload_bytes != null && (
                        <>
                          <span className="text-slate-600">payload</span>
                          <span className="font-mono text-xs text-fuchsia-300/90 bg-fuchsia-400/10 px-1.5 py-0.5 rounded">{formatBytes(displayReport.llm_payload_bytes)}</span>
                        </>
                      )}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                    {!readOnly && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRegenerate() }}
                          disabled={regenerateMutation.isPending}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded-lg transition-colors disabled:opacity-50"
                          title="Regenerate analysis"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleShare() }}
                          disabled={shareState === 'loading'}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded-lg transition-colors disabled:opacity-50"
                          title="Copy share link"
                        >
                          {shareState === 'copied'
                            ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                            : <Share2 className="w-3.5 h-3.5" />}
                        </button>
                        {confirmDelete ? (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteMutation.mutate() }}
                              disabled={deleteMutation.isPending}
                              className="px-2 py-0.5 rounded text-xs bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
                            >
                              {deleteMutation.isPending ? '…' : 'Delete'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
                              className="px-2 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
                            className="p-1.5 text-red-500 hover:text-red-400 hover:bg-slate-700/60 rounded-lg transition-colors"
                            title="Delete analysis"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <span className="w-px h-4 bg-slate-700 mx-1" />
                      </>
                    )}
                    <span className="flex items-center gap-1 text-slate-500">
                      <span>{metaExpanded ? 'Less' : 'Details'}</span>
                      {metaExpanded
                        ? <ChevronUp className="w-3.5 h-3.5" />
                        : <ChevronDown className="w-3.5 h-3.5" />}
                    </span>
                  </div>
                </button>

                {/* Expanded detail */}
                {metaExpanded && (
                  <div className="border-t border-slate-700/60 px-3 py-3">
                    {displayReport.laps_metadata && displayReport.laps_metadata.length > 0 ? (
                      <LapMetaTable
                        laps={displayReport.laps_metadata}
                        userLapId={displayReport.lap_id}
                        isSolo={false}
                        allowDownloads={!readOnly}
                      />
                    ) : (
                      /* Fallback: show raw IDs when metadata not stored (old analyses) */
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 w-20 flex-shrink-0">Your lap</span>
                          <a
                            href={`https://garage61.net/app/laps/${displayReport.lap_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                          >
                            {displayReport.lap_id.slice(0, 8)}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        {displayReport.reference_lap_ids.map((id) => (
                          <div key={id} className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 w-20 flex-shrink-0">Reference</span>
                            <a
                              href={`https://garage61.net/app/laps/${id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1"
                            >
                              {id.slice(0, 8)}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Comparison description */}
            {(() => {
              const meta = displayReport.laps_metadata
              if (isSolo) {
                const userLap = meta?.find((l) => l.role === 'user')
                const refLaps = meta?.filter((l) => l.role === 'reference') ?? []
                const n = soloTotalLaps
                return (
                  <p className="text-xs text-slate-500 mb-4 px-0.5">
                    Analyzing <span className="text-slate-300">{n} session laps</span> by {userLap?.driver_name || 'you'}
                    {userLap?.lap_time ? <> — fastest <span className="font-mono text-amber-400">{formatLapTime(userLap.lap_time)}</span></> : null}
                    {refLaps.length > 0 ? <> compared point-by-point against the <span className="text-slate-300">median of {refLaps.length} other {refLaps.length === 1 ? 'lap' : 'laps'}</span></> : null}.
                  </p>
                )
              }
              // vs_reference
              const userLap = meta?.find((l) => l.role === 'user')
              const refLaps = meta?.filter((l) => l.role === 'reference') ?? []
              const bestRef = refLaps.sort((a, b) => a.lap_time - b.lap_time)[0]
              if (!userLap && refLaps.length === 0) return null
              return (
                <p className="text-xs text-slate-500 mb-4 px-0.5">
                  {userLap ? (
                    <>
                      <span className="text-slate-300">{userLap.driver_name || 'Your'}</span> lap
                      {userLap.lap_time ? <> <span className="font-mono text-blue-400">{formatLapTime(userLap.lap_time)}</span></> : null}
                    </>
                  ) : 'Your lap'}
                  {' '}vs.{' '}
                  {refLaps.length === 1 && bestRef ? (
                    <>
                      <span className="text-slate-300">{bestRef.driver_name || 'reference'}</span>
                      {bestRef.lap_time ? <> <span className="font-mono text-orange-400">{formatLapTime(bestRef.lap_time)}</span></> : null}
                    </>
                  ) : (
                    <><span className="text-slate-300">{refLaps.length} reference laps</span>{bestRef?.lap_time ? <>, fastest <span className="font-mono text-orange-400">{formatLapTime(bestRef.lap_time)}</span></> : null}</>
                  )}
                  {' '}on <span className="text-slate-300">{displayReport.track_name}</span>.
                </p>
              )
            })()}

            {/* Control bar: sector pills (left) + tab buttons (right) */}
            <div className="sticky top-14 z-10 -mx-4 px-4 py-2 mb-4 bg-slate-900/95 backdrop-blur border-b border-slate-700/50 flex items-center gap-3 overflow-x-auto scrollbar-hide">
              {displayReport.telemetry.sectors.length > 0 && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-slate-500 text-xs mr-1">Sector:</span>
                  <button
                    onClick={() => handleSectorClick(null)}
                    className={`text-xs px-2.5 py-1 rounded-full transition-colors flex-shrink-0 ${
                      selectedSector === null
                        ? 'bg-amber-500 text-slate-900 font-semibold'
                        : 'bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span>All</span>
                      <span className="font-mono opacity-80">{formatSectorDelta(totalSectorDelta)}</span>
                    </span>
                  </button>
                  {displayReport.telemetry.sectors.map((s, index) => {
                    const deltaMs = sectorDeltas[index]?.deltaMs ?? 0
                    const deltaTone =
                      deltaMs > 0
                        ? (selectedSector === Number(s.sector) ? 'text-slate-900/80' : 'text-emerald-400')
                        : deltaMs < 0
                          ? (selectedSector === Number(s.sector) ? 'text-slate-900/80' : 'text-red-400')
                          : (selectedSector === Number(s.sector) ? 'text-slate-900/70' : 'text-slate-500')
                    return (
                    <button
                      key={s.sector}
                      onClick={() => handleSectorClick(selectedSector === Number(s.sector) ? null : Number(s.sector))}
                      className={`text-xs px-2.5 py-1 rounded-full transition-colors flex-shrink-0 ${
                        selectedSector === Number(s.sector)
                          ? 'bg-amber-500 text-slate-900 font-semibold'
                          : 'bg-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span>S{s.sector}</span>
                        <span className={`font-mono ${deltaTone}`}>{formatSectorDelta(deltaMs)}</span>
                      </span>
                    </button>
                  )})}
                  <span className="w-px h-4 bg-slate-700 mx-1 flex-shrink-0" />
                </div>
              )}
              <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`tab-btn flex-shrink-0 ${
                      activeTab === tab.id ? 'tab-btn-active' : 'tab-btn-inactive'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Two-column layout when GPS available */}
            <div className={hasGps ? 'grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4 items-start' : ''}>

              {/* Persistent sticky TrackMap */}
              {hasGps && (
                <div className="xl:sticky xl:top-20">
                  <TrackMap
                    userLat={displayReport.telemetry.user_lat ?? []}
                    userLon={displayReport.telemetry.user_lon ?? []}
                    refLat={displayReport.telemetry.ref_lat ?? []}
                    refLon={displayReport.telemetry.ref_lon ?? []}
                    userSpeed={displayReport.telemetry.user_speed}
                    refSpeed={displayReport.telemetry.ref_speed}
                    corners={displayReport.telemetry.corners}
                    hoverIndex={hoverIdx}
                    height={480}
                    trackLength={trackLength}
                    highlightRange={activeSectorRange}
                    highlightCornerNums={activeCornerNums}
                    title="Track Guide"
                    showRef={false}
                  />
                </div>
              )}

              {/* Tab content */}
              <div>
                <TabInsights report={displayReport} tab={activeTab} />

                {activeTab === 'summary' && (
                  <div className="space-y-4">
                    <div className="card">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <h2 className="text-white font-semibold">Overall Assessment</h2>
                        {displayReport.estimated_time_gain_seconds > 0 && (
                          <div className="flex-shrink-0 bg-amber-500/20 border border-amber-500/30 text-amber-400 font-semibold text-sm px-3 py-1.5 rounded-full flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5" />
                            +{displayReport.estimated_time_gain_seconds.toFixed(1)}s available
                          </div>
                        )}
                      </div>
                      <p className="text-slate-300 text-sm leading-relaxed">{displayReport.summary}</p>
                    </div>

                    {displayReport.strengths.length > 0 && (
                      <div>
                        <h2 className="text-white font-semibold mb-3">Strengths</h2>
                        <div className="space-y-2">
                          {displayReport.strengths.map((strength, index) => (
                            <div
                              key={index}
                              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-sm text-slate-300"
                            >
                              {strength}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {displayReport.sector_notes.length > 0 && (
                      <div>
                        <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
                          <FileText className="w-4 h-4 text-slate-400" />
                          Sector Notes
                        </h2>
                        <div className="card space-y-2.5">
                          {displayReport.sector_notes.map((note, index) => (
                            <div key={index} className="flex items-start gap-2">
                              <span className="flex-shrink-0 text-xs text-slate-500 font-mono mt-0.5">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                              <p className="text-sm text-slate-300 leading-relaxed">{note}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'focus' && (
                  <AnalysisCards
                    improvement_areas={displayReport.improvement_areas}
                    telemetry={{
                      distances: displayReport.telemetry.distances,
                      userLat: displayReport.telemetry.user_lat,
                      userLon: displayReport.telemetry.user_lon,
                      refLat: displayReport.telemetry.ref_lat,
                      refLon: displayReport.telemetry.ref_lon,
                      userSpeed: displayReport.telemetry.user_speed,
                      refSpeed: displayReport.telemetry.ref_speed,
                      userBrake: displayReport.telemetry.user_brake,
                      refBrake: displayReport.telemetry.ref_brake,
                      userThrottle: displayReport.telemetry.user_throttle,
                      refThrottle: displayReport.telemetry.ref_throttle,
                      corners: displayReport.telemetry.corners,
                    }}
                    onActiveCorners={setActiveCornerNums}
                    onHoverIndex={setHoverIdx}
                  />
                )}

                {activeTab === 'telemetry' && (
                  <div className="space-y-3">
                    {isSolo && (
                      <div className="flex items-start gap-2.5 bg-slate-800/60 border border-slate-700/50 rounded-xl px-3.5 py-2.5 text-xs text-slate-400">
                        <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <span>
                          <span className="text-slate-300 font-medium">Session mode — </span>
                          your fastest lap from the session is shown as <span className="text-amber-400 font-medium">You</span>.
                          The <span className="text-orange-400 font-medium">Ref</span> line is the point-by-point median of all your other session laps,
                          showing where your fastest lap deviates from your typical driving.
                        </span>
                      </div>
                    )}

                    {displayReport.driving_scores && (
                      <TelemetryInsights
                        scores={displayReport.driving_scores}
                        isSolo={isSolo}
                        selectedSector={selectedSector}
                        sectorScores={displayReport.sector_scores}
                      />
                    )}

                    <TelemetryChart
                      distances={displayReport.telemetry.distances}
                      userSpeed={displayReport.telemetry.user_speed}
                      refSpeed={displayReport.telemetry.ref_speed}
                      userThrottle={displayReport.telemetry.user_throttle}
                      refThrottle={displayReport.telemetry.ref_throttle}
                      userBrake={displayReport.telemetry.user_brake}
                      refBrake={displayReport.telemetry.ref_brake}
                      userGear={displayReport.telemetry.user_gear}
                      refGear={displayReport.telemetry.ref_gear}
                      deltaMs={displayReport.telemetry.delta_ms}
                      corners={displayReport.telemetry.corners}
                      onHoverIndex={setHoverIdx}
                      xRange={activeSectorRange}
                    />
                  </div>
                )}

                {activeTab === 'heatmap' && (
                  <div className="space-y-4">
                    {isSolo && (
                      <DeltaHeatmap
                        distances={displayReport.telemetry.distances}
                        delta_ms={displayReport.telemetry.delta_ms}
                        corners={displayReport.telemetry.corners}
                        isSolo={isSolo}
                        xRange={activeSectorRange}
                      />
                    )}
                    <HeatMap
                      lat={displayReport.telemetry.user_lat ?? []}
                      lon={displayReport.telemetry.user_lon ?? []}
                      speed={displayReport.telemetry.user_speed}
                      refSpeed={displayReport.telemetry.ref_speed}
                      brake={displayReport.telemetry.user_brake}
                      refBrake={displayReport.telemetry.ref_brake}
                      throttle={displayReport.telemetry.user_throttle}
                      refThrottle={displayReport.telemetry.ref_throttle}
                      xRange={activeSectorRange}
                      distances={displayReport.telemetry.distances}
                      isSolo={isSolo}
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
