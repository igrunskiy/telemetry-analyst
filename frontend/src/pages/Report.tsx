import React, { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BarChart2, Trash2, Clock, Calendar, Layers, Lightbulb, TrendingDown, ChevronDown, ChevronUp, ExternalLink, User, RefreshCw, Share2, Check, Zap, FileText, Download, Shield, Sparkles, MessageSquare, ThermometerSun, Waves, Wind, HardDrive } from 'lucide-react'
import { getAnalysis, deleteAnalysis, regenerateAnalysis, shareAnalysis, getSharedAnalysis, setDefaultAnalysisVersion, adminRetrospectReport, submitAnalysisFeedback, deleteAnalysisFeedback } from '../api/client'
import TrackMap from '../components/TrackMap'
import TelemetryChart from '../components/TelemetryChart'
import HeatMap from '../components/HeatMap'
import DeltaHeatmap from '../components/DeltaHeatmap'
import AnalysisCards from '../components/AnalysisCards'
import { ThemeToggle } from '../components/ThemeToggle'
import TelemetryInsights from '../components/TelemetryInsights'
import { useAuth } from '../hooks/useAuth'
import type { AnalysisReport, ImprovementArea, LapConditions, LapMeta, SectorData, AdminRetrospective, ReportFeedback } from '../types'
import { normalizeFeedbackSelections, renderHighlightedText } from '../utils/feedbackHighlights'

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }
import type { FeedbackGroup } from '../utils/feedbackHighlights'

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

function RetrospectiveView({ retrospective }: { retrospective: AdminRetrospective }) {
  return (
    <div className="rounded-xl border border-sky-500/20 bg-slate-900/40 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          {retrospective.version_number != null && (
            <span className="text-amber-300">
              {`Report v${retrospective.version_number}`}
            </span>
          )}
          <span className="text-slate-500">
            {new Date(retrospective.created_at).toLocaleString()}
          </span>
        </div>
        {retrospective._meta?.model_name && (
          <span className="text-sky-300">{retrospective._meta.model_name}</span>
        )}
      </div>

      {retrospective.feedback_text && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Feedback / Comments</p>
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{retrospective.feedback_text}</p>
        </div>
      )}

      {retrospective.summary && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Summary</p>
          <p className="text-sm text-slate-200 leading-relaxed">{retrospective.summary}</p>
        </div>
      )}

      {retrospective.root_causes && retrospective.root_causes.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Root Causes</p>
          <div className="space-y-1">
            {retrospective.root_causes.map((item, idx) => (
              <p key={idx} className="text-sm text-slate-300">• {item}</p>
            ))}
          </div>
        </div>
      )}

      {retrospective.feedback_alignment && retrospective.feedback_alignment.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Feedback Alignment</p>
          <div className="space-y-1">
            {retrospective.feedback_alignment.map((item, idx) => (
              <p key={idx} className="text-sm text-slate-300">• {item}</p>
            ))}
          </div>
        </div>
      )}

      {retrospective.suggested_prompt_patch && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Suggested Prompt Patch</p>
          <pre className="text-xs text-slate-200 whitespace-pre-wrap break-words font-mono bg-slate-950/70 rounded p-2">{retrospective.suggested_prompt_patch}</pre>
        </div>
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

function getSelectedReportText(root: HTMLElement | null): string {
  if (!root) return ''
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return ''
  const text = selection.toString().trim()
  if (!text) return ''
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const element = container.nodeType === Node.ELEMENT_NODE ? container as Element : container.parentElement
  if (!element || !root.contains(element)) return ''
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return ''
  return text.slice(0, 4000)
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

function ConditionIconChip({ icon, label, title }: { icon: React.ReactNode, label: string, title?: string }) {
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

function renderConditionChips(conditions?: LapConditions | null) {
  if (!conditions) return <span className="text-slate-600">—</span>
  const air = formatTemperature(conditions.air_temp_c)
  const track = formatTemperature(conditions.track_temp_c)
  const wind = formatWind(conditions.wind_direction, conditions.wind_kph)
  if (!air && !track && !wind) return <span className="text-slate-600">—</span>
  return (
    <div className="flex flex-wrap items-center gap-1">
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

function getElapsedSeconds(startedAt?: string | null, nowMs?: number): number | null {
  if (!startedAt) return null
  const started = new Date(startedAt)
  if (Number.isNaN(started.getTime())) return null
  return Math.max(0, Math.floor(((nowMs ?? Date.now()) - started.getTime()) / 1000))
}

function LapMetaTable({ laps, userLapId, isSolo, allowDownloads = true }: { laps: LapMeta[]; userLapId: string; isSolo: boolean; allowDownloads?: boolean }) {
  const userLap = laps.find((l) => l.id === userLapId || l.role === 'user')
  const userTimeMs = normalizeLapTimeMs(userLap?.lap_time ?? 0)

  // In solo mode, count non-user laps to give them lap numbers
  let refLapIndex = 0

  return (
    <div className="space-y-2.5">
      {laps.map((lap) => {
        const garage61Url = getGarage61AnalyzeUrl(lap.id, lap.garage61_url)
        const isUser = lap.role === 'user'
        const deltaMs = isUser ? null : normalizeLapTimeMs(lap.lap_time) - userTimeMs
        const deltaS = deltaMs != null ? deltaMs / 1000 : null
        const deltaColor = deltaS == null ? 'text-slate-500' : deltaS > 0 ? 'text-red-400' : 'text-emerald-400'
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
          <div key={lap.id} className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-3 py-2">
            <div className="flex items-center gap-3 text-xs">
              <div className="min-w-0 flex flex-1 items-center gap-3 overflow-hidden">
                <span className="inline-flex flex-shrink-0 items-center rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px]">
                  {roleLabel}
                </span>
                {!isSolo && (
                  <span className="truncate text-sm text-slate-100">
                    {lap.driver_name || <span className="text-slate-600 italic">unknown</span>}
                  </span>
                )}
                {!isSolo && lap.irating != null && <IRatingBadge value={lap.irating} />}
                <span className="inline-flex flex-shrink-0 items-center gap-1.5">
                  <span className="text-slate-500">Lap</span>
                  <span className="font-mono text-slate-200">
                    {lap.lap_time ? formatLapTime(lap.lap_time) : <span className="text-slate-600">—</span>}
                  </span>
                </span>
                <span className="inline-flex flex-shrink-0 items-center gap-1.5">
                  <span className="text-slate-500">{isSolo ? 'Δ vs best' : 'Δ vs you'}</span>
                  <span className={`font-mono ${deltaColor}`}>{deltaLabel}</span>
                </span>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {renderConditionChips(lap.conditions)}
                  </div>
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center gap-1 text-slate-500">
                {allowDownloads && lap.download_path && (
                  <a
                    href={lap.download_path}
                    className="rounded-md p-1 text-slate-600 hover:bg-slate-800 hover:text-slate-300 transition-colors"
                    title="Download stored telemetry CSV"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                )}
                {garage61Url && (
                  <a
                    href={garage61Url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md p-1 text-slate-600 hover:bg-slate-800 hover:text-slate-300 transition-colors"
                    title="Open in Garage61 Analyze"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )
      })}
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
  const [selectedVersionId, setSelectedVersionId] = useState<string>('')
  const [showRetrospect, setShowRetrospect] = useState(false)
  const [retrospectFeedback, setRetrospectFeedback] = useState('')
  const [selectedFeedbackText, setSelectedFeedbackText] = useState('')
  const [feedbackComment, setFeedbackComment] = useState('')
  const [feedbackSuccess, setFeedbackSuccess] = useState('')
  const [activeFeedbackBubble, setActiveFeedbackBubble] = useState<{
    group: FeedbackGroup
    top: number
    left: number
  } | null>(null)
  const [optimisticRetrospective, setOptimisticRetrospective] = useState<{
    reportId: string
    data: AdminRetrospective
  } | null>(null)
  const reportContentRef = useRef<HTMLDivElement | null>(null)
  const feedbackPanelRef = useRef<HTMLDivElement | null>(null)
  const feedbackBubbleRef = useRef<HTMLDivElement | null>(null)
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['analysis', analysisId] })
      if (data?.id && !readOnly) {
        navigate(`/report/${data.id}`, { state: location.state })
      }
    },
  })

  const setDefaultVersionMutation = useMutation({
    mutationFn: (id: string) => setDefaultAnalysisVersion(id),
    onSuccess: async (_, versionId) => {
      await queryClient.invalidateQueries({ queryKey: ['analysis', versionId] })
      await queryClient.invalidateQueries({ queryKey: ['analysis', analysisId] })
      await queryClient.invalidateQueries({ queryKey: ['analysisHistory'] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] })
    },
  })

  const retrospectMutation = useMutation({
    mutationFn: () => adminRetrospectReport(analysisId!, {
      feedback_text: retrospectFeedback,
      focus_areas: '',
    }),
    onSuccess: (data) => {
      if (analysisId) {
        setOptimisticRetrospective({ reportId: analysisId, data })
      }
      setShowRetrospect(true)
      setRetrospectFeedback('')
      queryClient.invalidateQueries({ queryKey: ['analysis', analysisId] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] })
    },
  })

  const reportFeedbackMutation = useMutation({
    mutationFn: () => submitAnalysisFeedback(analysisId!, {
      selected_text: selectedFeedbackText,
      comment: feedbackComment,
    }),
    onSuccess: async () => {
      setFeedbackSuccess('Feedback sent to admin.')
      setSelectedFeedbackText('')
      setFeedbackComment('')
      window.getSelection()?.removeAllRanges()
      await queryClient.invalidateQueries({ queryKey: ['analysis', analysisId] })
      window.setTimeout(() => setFeedbackSuccess(''), 2500)
    },
  })

  const deleteFeedbackMutation = useMutation({
    mutationFn: (feedbackId: string) => deleteAnalysisFeedback(analysisId!, feedbackId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['analysis', analysisId] })
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
  const elapsedSeconds = isRegenerating ? getElapsedSeconds(elapsedStartAt, liveNowMs) : null
  const projectedRuntimeSeconds = 120
  const projectedProgress = elapsedSeconds == null
    ? 0
    : Math.min(97, Math.max(4, Math.round((elapsedSeconds / projectedRuntimeSeconds) * 100)))
  const regenerationTargetId = savedReport?.id

  // The report to render — fall back to the saved snapshot while regeneration is in flight
  const displayReport = savedReport ?? report

  useEffect(() => {
    if (displayReport?.id) {
      setSelectedVersionId(displayReport.id)
    }
  }, [displayReport?.id])

  useEffect(() => {
    if (readOnly || !displayReport || displayReport.status === 'enqueued' || displayReport.status === 'processing' || displayReport.status === 'failed') {
      return
    }

    const syncSelection = () => {
      if (reportFeedbackMutation.isPending) return
      const text = getSelectedReportText(reportContentRef.current)
      const active = document.activeElement
      const focusInsideFeedback =
        active instanceof HTMLElement &&
        feedbackPanelRef.current?.contains(active)

      if (!text && focusInsideFeedback) {
        return
      }

      setSelectedFeedbackText((prev) => (prev === text ? prev : text))
      if (!text) {
        setFeedbackComment((prev) => (prev ? prev : ''))
      }
    }

    document.addEventListener('selectionchange', syncSelection)
    return () => document.removeEventListener('selectionchange', syncSelection)
  }, [displayReport, readOnly, reportFeedbackMutation.isPending])

  useEffect(() => {
    if (!displayReport?.id) return
    if (optimisticRetrospective && optimisticRetrospective.reportId !== displayReport.id) {
      setOptimisticRetrospective(null)
    }
  }, [displayReport?.id, optimisticRetrospective])

  useEffect(() => {
    if (selectedFeedbackText) {
      setFeedbackSuccess('')
    }
  }, [selectedFeedbackText])

  useEffect(() => {
    if (readOnly || !regenerationTargetId || !report) return
    if (report.status === 'enqueued' || report.status === 'processing' || report.status === 'failed') return
    if (report.id === regenerationTargetId) return

    setSavedReport(null)
    navigate(`/report/${report.id}`, { state: location.state, replace: true })
  }, [readOnly, regenerationTargetId, report, navigate, location.state])

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
  const isStaff = user?.role === 'admin' || user?.role === 'moderator'
  const canDeleteOrShareReport = isAdmin || (!!displayReport?.user_id && displayReport.user_id === user?.id)
  const canSeeFeedbackHighlights = !readOnly && !!displayReport && (isStaff || displayReport.user_id === user?.id)
  const feedbackHighlights = useMemo(
    () => (canSeeFeedbackHighlights ? normalizeFeedbackSelections(displayReport?.user_feedback_items) : []),
    [canSeeFeedbackHighlights, displayReport?.user_feedback_items],
  )
  useEffect(() => {
    if (!activeFeedbackBubble) return
    const next = feedbackHighlights.find((item) => item.key === activeFeedbackBubble.group.key) ?? null
    setActiveFeedbackBubble((prev) => (prev && next ? { ...prev, group: next } : null))
  }, [feedbackHighlights, activeFeedbackBubble])

  useEffect(() => {
    if (!activeFeedbackBubble) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (feedbackBubbleRef.current?.contains(target)) return
      if ((target instanceof HTMLElement) && target.closest('button[title*="feedback item"]')) return
      setActiveFeedbackBubble(null)
    }
    const handleScroll = () => setActiveFeedbackBubble(null)
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [activeFeedbackBubble])

  const handleFeedbackClick = (group: FeedbackGroup, target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    const bubbleWidth = 360
    const gap = 10
    const preferredLeft = rect.right + gap
    const left = preferredLeft + bubbleWidth > window.innerWidth - 12
      ? Math.max(12, rect.left - bubbleWidth - gap)
      : preferredLeft
    const top = Math.min(
      window.innerHeight - 24,
      Math.max(16, rect.top + rect.height / 2),
    )
    setActiveFeedbackBubble({ group, top, left })
  }
  const persistedRetrospectives = displayReport?.admin_retrospectives ?? []
  const retrospectives = optimisticRetrospective && optimisticRetrospective.reportId === displayReport?.id
    ? [...persistedRetrospectives, optimisticRetrospective.data].filter(
        (item, index, array) =>
          array.findIndex(
            (candidate) =>
              candidate.created_at === item.created_at &&
              candidate.feedback_text === item.feedback_text,
          ) === index,
      )
    : persistedRetrospectives
  const hasRetrospectives = retrospectives.length > 0
  const versionOptions = displayReport?.available_versions ?? []
  const reportPhase = getReportPhase(report?.status)
  const telemetryStorage = displayReport?.telemetry_storage
  const telemetryStorageState = telemetryStorage
    ? {
        label: 'Telemetry',
        detail: `${telemetryStorage.stored_lap_count}/${telemetryStorage.required_lap_count}`,
        title: telemetryStorage.is_complete
          ? `Stored telemetry ready for rerun (${telemetryStorage.stored_lap_count}/${telemetryStorage.required_lap_count} laps)`
          : `Stored telemetry incomplete (${telemetryStorage.stored_lap_count}/${telemetryStorage.required_lap_count} laps)`,
        iconClass: telemetryStorage.is_complete ? 'text-emerald-400' : 'text-amber-400',
        pillClass: telemetryStorage.is_complete
          ? 'text-emerald-300 bg-emerald-400/10'
          : 'text-amber-300 bg-amber-400/10',
      }
    : displayReport
      ? {
          label: 'Telemetry',
          detail: 'unknown',
          title: 'This report does not include telemetry storage status. It was likely created before storage tracking was added.',
          iconClass: 'text-slate-400',
          pillClass: 'text-slate-300 bg-slate-400/10',
        }
      : null
  const soloUserLap = isSolo ? displayReport?.laps_metadata?.find((l) => l.role === 'user') : undefined
  const soloTotalLaps = displayReport ? displayReport.reference_lap_ids.length + 1 : 0
  const hasGps = (displayReport?.telemetry?.user_lat?.length ?? 0) > 0
  const showTrackGuide = hasGps && activeTab !== 'heatmap'
  const trackLength =
    displayReport && displayReport.telemetry?.distances?.length > 0
      ? displayReport.telemetry.distances[displayReport.telemetry.distances.length - 1]
      : 3000

  const renderVersionSelector = () => {
    if (!isAdmin || readOnly || !displayReport || versionOptions.length <= 1) {
      return null
    }
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-slate-500">Version</span>
        <select
          value={selectedVersionId || displayReport.id}
          onChange={(e) => {
            const nextId = e.target.value
            setSelectedVersionId(nextId)
            if (nextId !== displayReport.id) {
              navigate(`/report/${nextId}`, { state: location.state })
            }
          }}
          className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
        >
          {versionOptions.map((version) => (
            <option key={version.id} value={version.id}>
              {`v${version.version_number}${version.is_default_version ? ' default' : ''} · ${new Date(version.created_at).toLocaleDateString()}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => displayReport.id && setDefaultVersionMutation.mutate(displayReport.id)}
          disabled={displayReport.is_default_version || setDefaultVersionMutation.isPending}
          className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-300 hover:bg-slate-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {displayReport.is_default_version ? 'Default' : 'Make default'}
        </button>
      </span>
    )
  }

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
            {isStaff && !readOnly && (
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded px-2 py-0.5 flex-shrink-0">
                <Shield className="w-3 h-3" />
                {isAdmin ? 'Admin' : 'Moderator'}
              </span>
            )}
            <ThemeToggle />
          </div>

        </div>
      </header>

      {/* Content */}
      <main ref={reportContentRef} className="flex-1 max-w-[90%] w-full mx-auto px-4 py-6">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Loading report...</span>
          </div>
        )}

        {!isLoading && (report?.status === 'enqueued' || report?.status === 'processing') && (
          <div className="flex flex-col items-center justify-center py-24 gap-5">
            <div className="w-12 h-12 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-center w-full max-w-xl">
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
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
                  <span>Projected progress</span>
                  <span className="font-medium text-amber-300">{projectedProgress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 transition-[width] duration-700 ease-out"
                    style={{ width: `${projectedProgress}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Based on an expected analysis runtime of about {projectedRuntimeSeconds} seconds.
                </p>
              </div>
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

        {displayReport && (!displayReport.status || displayReport.status === 'completed') && isStaff && !readOnly && (
          <div className="mb-5 rounded-xl border border-sky-500/20 bg-sky-950/10 px-4 py-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-sky-300">LLM Retrospective</p>
                <p className="text-xs text-slate-400 mt-1">
                  Review prior retrospectives and send fresh follow-up comments back to the LLM to diagnose mistakes and suggest prompt changes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRetrospect((prev) => !prev)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-500/10 border border-sky-500/30 text-sky-300 hover:bg-sky-500/20 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                {showRetrospect ? 'Hide' : hasRetrospectives ? `Open (${retrospectives.length})` : 'Open'}
              </button>
            </div>

            {hasRetrospectives && !showRetrospect && (
              <div className="rounded-lg border border-slate-700/70 bg-slate-900/35 px-3 py-2">
                <p className="text-xs text-slate-400">
                  Latest retrospective from{' '}
                  <span className="text-slate-200">
                    {new Date(retrospectives[retrospectives.length - 1].created_at).toLocaleString()}
                  </span>
                </p>
              </div>
            )}

            {showRetrospect && (
              <>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Feedback / comments</label>
                  <textarea
                    value={retrospectFeedback}
                    onChange={(e) => setRetrospectFeedback(e.target.value)}
                    disabled={retrospectMutation.isPending}
                    rows={6}
                    placeholder="Add fresh follow-up comments, corrections, or nuance for the LLM to review."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-sky-400 resize-y disabled:opacity-60 disabled:cursor-wait"
                  />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => retrospectMutation.mutate()}
                    disabled={retrospectMutation.isPending}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 transition-colors"
                  >
                    <Sparkles className={`w-4 h-4 ${retrospectMutation.isPending ? 'animate-pulse' : ''}`} />
                    {retrospectMutation.isPending ? 'Running…' : 'Run retrospective'}
                  </button>
                  {retrospectMutation.isPending && (
                    <span className="text-xs text-sky-300">
                      Status: sending report payload to the LLM and waiting for feedback...
                    </span>
                  )}
                  {!retrospectMutation.isPending && !retrospectMutation.isError && hasRetrospectives && (
                    <span className="text-xs text-slate-500">
                      Status: ready
                    </span>
                  )}
                  {retrospectMutation.isError && (
                    <span className="text-xs text-red-400">Retrospective failed. Check provider/API key availability and try again.</span>
                  )}
                </div>

                {hasRetrospectives && (
                  <div className="space-y-3">
                    {[...retrospectives].reverse().map((retrospective) => (
                      <RetrospectiveView
                        key={`${retrospective.created_at}-${retrospective.feedback_text}`}
                        retrospective={retrospective}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {displayReport && (!displayReport.status || displayReport.status === 'completed') && (
          <>
            {/* Lap metadata bar */}
            {isSolo ? (
              /* Driving-pattern analysis — compact non-expandable header */
              <div className="mb-5 card p-0 overflow-hidden">
                <div className="flex items-center gap-x-5 gap-y-1.5 flex-wrap px-3 py-2.5 text-xs text-slate-400">
                  {/* Mode badge */}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium border bg-violet-500/15 border-violet-500/30 text-violet-300">
                    Driving Patterns
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
                  {isStaff && telemetryStorageState && (
                    <span
                      className="flex items-center gap-1.5"
                      title={telemetryStorageState.title}
                    >
                      <HardDrive className={`w-3.5 h-3.5 flex-shrink-0 ${telemetryStorageState.iconClass}`} />
                      <span className="text-slate-500">{telemetryStorageState.label}</span>
                      <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${telemetryStorageState.pillClass}`}>
                        {telemetryStorageState.detail}
                      </span>
                    </span>
                  )}
                  {renderVersionSelector()}
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
                      {canDeleteOrShareReport && (
                        <>
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
                        </>
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
                  {isStaff && telemetryStorageState && (
                    <span
                      className="flex items-center gap-1.5"
                      title={telemetryStorageState.title}
                    >
                      <HardDrive className={`w-3.5 h-3.5 flex-shrink-0 ${telemetryStorageState.iconClass}`} />
                      <span className="text-slate-500">{telemetryStorageState.label}</span>
                      <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${telemetryStorageState.pillClass}`}>
                        {telemetryStorageState.detail}
                      </span>
                    </span>
                  )}
                  {renderVersionSelector()}
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
                        {canDeleteOrShareReport && (
                          <>
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
                    Analyzing <span className="text-slate-300">{n} sampled laps</span> by {userLap?.driver_name || 'you'}
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
            <div className={showTrackGuide ? 'grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4 items-start' : ''}>

              {/* Persistent sticky TrackMap */}
              {showTrackGuide && (
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
                      <p className="text-slate-300 text-sm leading-relaxed">{renderHighlightedText(displayReport.summary, feedbackHighlights, handleFeedbackClick)}</p>
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
                              {renderHighlightedText(strength, feedbackHighlights, handleFeedbackClick)}
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
                              <p className="text-sm text-slate-300 leading-relaxed">{renderHighlightedText(note, feedbackHighlights, handleFeedbackClick)}</p>
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
                      userGear: displayReport.telemetry.user_gear,
                      refGear: displayReport.telemetry.ref_gear,
                      corners: displayReport.telemetry.corners,
                    }}
                    onActiveCorners={setActiveCornerNums}
                    onHoverIndex={setHoverIdx}
                    feedbackHighlights={feedbackHighlights}
                    onFeedbackClick={handleFeedbackClick}
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
                          <span className="text-slate-300 font-medium">Driving-pattern mode — </span>
                          your fastest sampled lap is shown as <span className="text-amber-400 font-medium">You</span>.
                          The <span className="text-orange-400 font-medium">Ref</span> line is the point-by-point median of your other sampled laps,
                          showing where your best attempt deviates from your repeatable habits across sessions.
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
                  <div className="space-y-3">
                    <DeltaHeatmap
                      distances={displayReport.telemetry.distances}
                      delta_ms={displayReport.telemetry.delta_ms}
                      corners={displayReport.telemetry.corners}
                      isSolo={isSolo}
                      xRange={activeSectorRange}
                      hoverIndex={hoverIdx}
                      onHoverIndex={setHoverIdx}
                    />
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
                      hoverIndex={hoverIdx}
                      onHoverIndex={setHoverIdx}
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {!readOnly && displayReport && (!displayReport.status || displayReport.status === 'completed') && (selectedFeedbackText || feedbackSuccess) && (
          <div
            ref={feedbackPanelRef}
            className="fixed bottom-5 right-5 z-20 w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900/95 shadow-2xl shadow-black/40 backdrop-blur"
          >
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-amber-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">Send Feedback to Admin</p>
                <p className="text-xs text-slate-400">Selected report text plus your comment will be sent for review.</p>
              </div>
            </div>
            <div className="px-4 py-3 space-y-3">
              {feedbackSuccess ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                  {feedbackSuccess}
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Selected text</p>
                    <div className="max-h-28 overflow-auto rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 whitespace-pre-wrap">
                      {selectedFeedbackText}
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wide text-slate-500 mb-1 block">Comment</label>
                    <textarea
                      value={feedbackComment}
                      onChange={(e) => setFeedbackComment(e.target.value)}
                      disabled={reportFeedbackMutation.isPending}
                      rows={4}
                      placeholder="What do you disagree with or want the admin to review?"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 resize-y disabled:opacity-60 disabled:cursor-wait"
                    />
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFeedbackText('')
                        setFeedbackComment('')
                        window.getSelection()?.removeAllRanges()
                      }}
                      className="px-3 py-2 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => reportFeedbackMutation.mutate()}
                      disabled={reportFeedbackMutation.isPending || !selectedFeedbackText}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500 text-slate-900 text-sm font-medium hover:bg-amber-400 disabled:opacity-50 transition-colors"
                    >
                      <MessageSquare className="w-4 h-4" />
                      {reportFeedbackMutation.isPending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                  {reportFeedbackMutation.isError && (
                    <p className="text-xs text-red-400">Failed to send feedback. Try again.</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

      </main>
      {canSeeFeedbackHighlights && activeFeedbackBubble && (
        <div
          ref={feedbackBubbleRef}
          className="fixed z-30 w-[22rem] max-w-[calc(100vw-1.5rem)] -translate-y-1/2 rounded-2xl border border-fuchsia-400/30 bg-slate-900/96 shadow-2xl shadow-black/50 backdrop-blur"
          style={{ top: activeFeedbackBubble.top, left: activeFeedbackBubble.left }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-fuchsia-400/20 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Feedback Details</p>
              <p className="text-xs text-slate-400">Comments attached to this highlighted passage.</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveFeedbackBubble(null)}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800"
            >
              Close
            </button>
          </div>
          <div className="space-y-3 px-4 py-3">
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Highlighted text</p>
              <div className="rounded-lg border border-fuchsia-400/25 bg-fuchsia-500/10 px-3 py-2 text-sm text-slate-200 whitespace-pre-wrap">
                {activeFeedbackBubble.group.key}
              </div>
            </div>
            <div className="max-h-80 space-y-2 overflow-auto pr-1">
              {activeFeedbackBubble.group.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-700/70 bg-slate-950/60 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <div className="flex items-center gap-2">
                      <span>{item.user_display_name || 'User feedback'}</span>
                      <span>{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    {(isStaff || item.user_id === user?.id) && (
                      <button
                        type="button"
                        onClick={() => deleteFeedbackMutation.mutate(item.id)}
                        disabled={deleteFeedbackMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[11px] text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-slate-200 whitespace-pre-wrap">
                    {item.comment || 'No comment provided.'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
