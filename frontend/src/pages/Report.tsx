import { useState, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ArrowLeft, BarChart2, Trash2, Clock, Calendar, Layers, Lightbulb, TrendingDown, ChevronDown, ChevronUp, ExternalLink, User } from 'lucide-react'
import { getAnalysis, deleteAnalysis } from '../api/client'
import TrackMap from '../components/TrackMap'
import TelemetryChart from '../components/TelemetryChart'
import HeatMap from '../components/HeatMap'
import SectorDelta from '../components/SectorDelta'
import AnalysisCards from '../components/AnalysisCards'
import type { AnalysisReport, ImprovementArea, LapMeta, SectorData } from '../types'

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }

function TabInsights({ report, tab }: { report: AnalysisReport; tab: Tab }) {
  const areas = report.improvement_areas ?? []
  const sectors: SectorData[] = report.telemetry?.sectors ?? []

  const content = useMemo(() => {
    if (tab === 'summary') {
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

    if (tab === 'lines') {
      const relevant = areas.filter((a: ImprovementArea) =>
        ['racing_line', 'corner_speed'].includes(a.issue_type) || a.corner_refs.length > 0
      )
      if (!relevant.length) return null
      const corners = [...new Set(relevant.flatMap((a: ImprovementArea) => a.corner_refs))].sort((a, b) => a - b)
      return {
        heading: 'Racing Line Findings',
        items: relevant.map((a: ImprovementArea) => ({
          label: a.title,
          detail: a.technique || a.description,
          severity: a.severity,
        })),
        hint: corners.length > 0
          ? `Focus corners: ${corners.map((c) => `C${c}`).join(', ')}`
          : null,
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

    if (tab === 'sectors') {
      const deltas = sectors.map((s) => s.ref_time_ms - s.user_time_ms)
      const slowest = sectors
        .map((s, i) => ({ sector: s.sector, delta: deltas[i] }))
        .filter((s) => s.delta < 0)
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 3)
      const fastest = sectors
        .map((s, i) => ({ sector: s.sector, delta: deltas[i] }))
        .filter((s) => s.delta > 0)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 2)
      const notes = report.sector_notes ?? []
      if (!slowest.length && !notes.length) return null
      return {
        heading: 'Sector Analysis',
        items: [
          ...slowest.map((s) => ({
            label: `Sector ${s.sector} — needs work`,
            detail: `${Math.abs(s.delta).toFixed(0)}ms behind reference`,
            severity: 'high' as const,
          })),
          ...fastest.map((s) => ({
            label: `Sector ${s.sector} — strength`,
            detail: `${s.delta.toFixed(0)}ms ahead of reference`,
            severity: 'low' as const,
          })),
        ],
        hint: notes.length > 0 ? notes[0] : null,
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

function LapMetaTable({ laps, userLapId }: { laps: LapMeta[]; userLapId: string }) {
  const userLap = laps.find((l) => l.id === userLapId || l.role === 'user')
  const userTimeMs = normalizeLapTimeMs(userLap?.lap_time ?? 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-slate-700/50">
            <th className="text-left pb-2 pr-4 font-medium">Role</th>
            <th className="text-left pb-2 pr-4 font-medium">
              <span className="flex items-center gap-1"><User className="w-3 h-3" />Driver</span>
            </th>
            <th className="text-right pb-2 pr-4 font-medium">iRating</th>
            <th className="text-right pb-2 pr-4 font-medium">Lap Time</th>
            <th className="text-right pb-2 font-medium">Δ vs You</th>
            <th className="pb-2 pl-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/30">
          {laps.map((lap) => {
            const isUser = lap.role === 'user'
            const deltaMs = isUser ? null : normalizeLapTimeMs(lap.lap_time) - userTimeMs
            const deltaS = deltaMs != null ? deltaMs / 1000 : null
            // negative delta = reference is faster (bad for user) → red
            // positive delta = reference is slower (good for user) → green
            const deltaColor = deltaS == null ? '' : deltaS < 0 ? 'text-red-400' : 'text-emerald-400'
            const deltaLabel =
              deltaS == null ? '—'
              : deltaS < 0 ? `−${Math.abs(deltaS).toFixed(3)}s`
              : `+${deltaS.toFixed(3)}s`

            return (
              <tr key={lap.id} className="text-slate-300">
                <td className="py-2 pr-4">
                  {isUser
                    ? <span className="text-blue-400 font-medium">You</span>
                    : <span className="text-orange-400">Ref</span>}
                </td>
                <td className="py-2 pr-4 text-slate-200">
                  {lap.driver_name || <span className="text-slate-600 italic">unknown</span>}
                </td>
                <td className="py-2 pr-4 text-right">
                  {lap.irating != null ? <IRatingBadge value={lap.irating} /> : <span className="text-slate-600 font-mono">—</span>}
                </td>
                <td className="py-2 pr-4 text-right font-mono">
                  {lap.lap_time ? formatLapTime(lap.lap_time) : <span className="text-slate-600">—</span>}
                </td>
                <td className={`py-2 text-right font-mono ${deltaColor}`}>
                  {deltaLabel}
                </td>
                <td className="py-2 pl-3">
                  <a
                    href={`https://garage61.net/app/laps/${lap.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-600 hover:text-slate-400 transition-colors"
                    title="Open in Garage61"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type Tab = 'summary' | 'lines' | 'telemetry' | 'heatmap' | 'sectors'

const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'lines', label: 'Racing Lines' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'sectors', label: 'Sectors' },
]

export default function ReportPage() {
  const { analysisId } = useParams<{ analysisId: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('summary')
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selectedSector, setSelectedSector] = useState<number | null>(null)
  const [activeCornerNums, setActiveCornerNums] = useState<number[]>([])
  const [metaExpanded, setMetaExpanded] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => deleteAnalysis(analysisId!),
    onSuccess: () => navigate('/'),
  })

  const {
    data: report,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['analysis', analysisId],
    queryFn: () => getAnalysis(analysisId!),
    enabled: !!analysisId,
  })

  // Compute sector distance ranges from the distances array
  const sectorDistRanges = useMemo(() => {
    if (!report) return []
    const d = report.telemetry.distances
    const n = report.telemetry.sectors.length || 3
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

  const handleSectorClick = (sector: number | null) => {
    setSelectedSector(sector)
    // When sector selected, highlight corners in that range
    if (sector != null && report) {
      const range = sectorDistRanges[sector - 1]
      if (range) {
        const nums = report.telemetry.corners
          .filter((c) => c.dist_apex >= range[0] && c.dist_apex <= range[1])
          .map((c) => c.corner_num)
        setActiveCornerNums(nums)
      }
    } else {
      setActiveCornerNums([])
    }
  }

  const hasGps = (report?.telemetry.user_lat?.length ?? 0) > 0
  const trackLength =
    report && report.telemetry.distances.length > 0
      ? report.telemetry.distances[report.telemetry.distances.length - 1]
      : 3000

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-[80%] mx-auto px-4">
          <div className="h-14 flex items-center gap-3">
            <Link
              to="/"
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <BarChart2 className="w-4 h-4 text-slate-900" />
              </div>
              {report ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-white font-medium text-sm truncate">
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

            {/* Delete control */}
            {report && (
              confirmDelete ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-slate-400 text-xs hidden sm:inline">Delete this analysis?</span>
                  <button
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="px-2 py-1 rounded text-xs bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
                  >
                    {deleteMutation.isPending ? '…' : 'Delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="p-1.5 text-red-500 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
                  title="Delete analysis"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )
            )}
          </div>

        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-[80%] w-full mx-auto px-4 py-6">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Loading report...</span>
          </div>
        )}

        {isError && (
          <div className="card text-center py-12">
            <p className="text-red-400 mb-2">Failed to load analysis report.</p>
            <Link to="/" className="text-amber-500 hover:text-amber-400 text-sm">
              &larr; Back to lap selector
            </Link>
          </div>
        )}

        {report && (
          <>
            {/* Lap metadata bar — collapsed summary + expandable detail */}
            <div className="mb-5 card p-0 overflow-hidden">
              {/* Always-visible summary row */}
              <button
                onClick={() => setMetaExpanded((v) => !v)}
                className="w-full flex items-center gap-x-5 gap-y-1.5 flex-wrap px-3 py-2.5 text-xs text-slate-400 hover:bg-slate-800/60 transition-colors text-left"
              >
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  <span className="text-slate-300">
                    {new Date(report.created_at).toLocaleString(undefined, {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  <span className="text-slate-500">Your lap:</span>
                  <span className="font-mono text-blue-400">{report.lap_id.slice(0, 8)}</span>
                </span>
                {report.reference_lap_ids.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-500">
                      {report.reference_lap_ids.length === 1 ? '1 reference' : `${report.reference_lap_ids.length} references`}
                    </span>
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1 text-slate-500">
                  <span>{metaExpanded ? 'Less' : 'Details'}</span>
                  {metaExpanded
                    ? <ChevronUp className="w-3.5 h-3.5" />
                    : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
              </button>

              {/* Expanded detail */}
              {metaExpanded && (
                <div className="border-t border-slate-700/60 px-3 py-3">
                  {report.laps_metadata && report.laps_metadata.length > 0 ? (
                    <LapMetaTable
                      laps={report.laps_metadata}
                      userLapId={report.lap_id}
                    />
                  ) : (
                    /* Fallback: show raw IDs when metadata not stored (old analyses) */
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 w-20 flex-shrink-0">Your lap</span>
                        <a
                          href={`https://garage61.net/app/laps/${report.lap_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          {report.lap_id.slice(0, 8)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      {report.reference_lap_ids.map((id) => (
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

            {/* Control bar: sector pills (left) + tab buttons (right) */}
            <div className="sticky top-14 z-10 -mx-4 px-4 py-2 mb-4 bg-slate-900/95 backdrop-blur border-b border-slate-700/50 flex items-center gap-3 overflow-x-auto scrollbar-hide">
              {report.telemetry.sectors.length > 0 && (
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
                    All
                  </button>
                  {report.telemetry.sectors.map((s) => (
                    <button
                      key={s.sector}
                      onClick={() => handleSectorClick(selectedSector === Number(s.sector) ? null : Number(s.sector))}
                      className={`text-xs px-2.5 py-1 rounded-full transition-colors flex-shrink-0 ${
                        selectedSector === Number(s.sector)
                          ? 'bg-amber-500 text-slate-900 font-semibold'
                          : 'bg-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      S{s.sector}
                    </button>
                  ))}
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
                    userLat={report.telemetry.user_lat ?? []}
                    userLon={report.telemetry.user_lon ?? []}
                    refLat={report.telemetry.ref_lat ?? []}
                    refLon={report.telemetry.ref_lon ?? []}
                    userSpeed={report.telemetry.user_speed}
                    refSpeed={report.telemetry.ref_speed}
                    corners={report.telemetry.corners}
                    hoverIndex={hoverIdx}
                    height={480}
                    trackLength={trackLength}
                    highlightRange={activeSectorRange}
                    highlightCornerNums={activeCornerNums}
                  />
                </div>
              )}

              {/* Tab content */}
              <div>
                <TabInsights report={report} tab={activeTab} />

                {activeTab === 'summary' && (
                  <AnalysisCards
                    improvement_areas={report.improvement_areas}
                    strengths={report.strengths}
                    summary={report.summary}
                    estimated_time_gain={report.estimated_time_gain_seconds}
                    sector_notes={report.sector_notes}
                    telemetry={{
                      distances: report.telemetry.distances,
                      userLat: report.telemetry.user_lat,
                      userLon: report.telemetry.user_lon,
                      refLat: report.telemetry.ref_lat,
                      refLon: report.telemetry.ref_lon,
                      userSpeed: report.telemetry.user_speed,
                      refSpeed: report.telemetry.ref_speed,
                      userBrake: report.telemetry.user_brake,
                      userThrottle: report.telemetry.user_throttle,
                      corners: report.telemetry.corners,
                    }}
                    onActiveCorners={setActiveCornerNums}
                    onHoverIndex={setHoverIdx}
                  />
                )}

                {activeTab === 'lines' && (
                  <div className="w-full">
                    <TrackMap
                      userLat={report.telemetry.user_lat ?? []}
                      userLon={report.telemetry.user_lon ?? []}
                      refLat={report.telemetry.ref_lat ?? []}
                      refLon={report.telemetry.ref_lon ?? []}
                      userSpeed={report.telemetry.user_speed}
                      refSpeed={report.telemetry.ref_speed}
                      corners={report.telemetry.corners}
                      hoverIndex={hoverIdx}
                      height={624}
                      trackLength={trackLength}
                      highlightRange={activeSectorRange}
                      highlightCornerNums={activeCornerNums}
                    />
                  </div>
                )}

                {activeTab === 'telemetry' && (
                  <TelemetryChart
                    distances={report.telemetry.distances}
                    userSpeed={report.telemetry.user_speed}
                    refSpeed={report.telemetry.ref_speed}
                    userThrottle={report.telemetry.user_throttle}
                    refThrottle={report.telemetry.ref_throttle}
                    userBrake={report.telemetry.user_brake}
                    refBrake={report.telemetry.ref_brake}
                    deltaMs={report.telemetry.delta_ms}
                    corners={report.telemetry.corners}
                    onHoverIndex={setHoverIdx}
                    xRange={activeSectorRange}
                  />
                )}

                {activeTab === 'heatmap' && (
                  <HeatMap
                    lat={report.telemetry.user_lat ?? []}
                    lon={report.telemetry.user_lon ?? []}
                    speed={report.telemetry.user_speed}
                    refSpeed={report.telemetry.ref_speed}
                    brake={report.telemetry.user_brake}
                    throttle={report.telemetry.user_throttle}
                  />
                )}

                {activeTab === 'sectors' && (
                  <SectorDelta
                    sectors={report.telemetry.sectors}
                    selectedSector={selectedSector}
                    onSectorClick={handleSectorClick}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
