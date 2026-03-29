import { useState } from 'react'
import { ChevronDown, ChevronUp, AlertTriangle, Info, Zap, CheckCircle, TrendingDown, FileText } from 'lucide-react'
import type { ImprovementArea, Corner } from '../types'
import CornerSnippet from './CornerSnippet'

interface Telemetry {
  distances: number[]
  userLat?: number[]
  userLon?: number[]
  refLat?: number[]
  refLon?: number[]
  userSpeed: number[]
  refSpeed: number[]
  userBrake: number[]
  refBrake: number[]
  userThrottle: number[]
  refThrottle: number[]
  corners: Corner[]
}

interface AnalysisCardsProps {
  improvement_areas: ImprovementArea[]
  strengths: string[]
  summary: string
  estimated_time_gain: number
  sector_notes: string[]
  telemetry: Telemetry
  onActiveCorners?: (corners: number[]) => void
  onHoverIndex?: (idx: number | null) => void
}

const SEVERITY_CONFIG = {
  high: {
    border: 'border-red-500/40',
    bg: 'bg-red-500/10',
    badge: 'bg-red-500/20 text-red-400',
    dot: 'bg-red-500',
    icon: <AlertTriangle className="w-4 h-4 text-red-400" />,
  },
  medium: {
    border: 'border-orange-500/40',
    bg: 'bg-orange-500/10',
    badge: 'bg-orange-500/20 text-orange-400',
    dot: 'bg-orange-400',
    icon: <Zap className="w-4 h-4 text-orange-400" />,
  },
  low: {
    border: 'border-yellow-500/40',
    bg: 'bg-yellow-500/10',
    badge: 'bg-yellow-500/20 text-yellow-400',
    dot: 'bg-yellow-400',
    icon: <Info className="w-4 h-4 text-yellow-400" />,
  },
}

interface ImprovementCardProps {
  area: ImprovementArea
  telemetry: Telemetry
  onActiveCorners?: (corners: number[]) => void
  onHoverIndex?: (idx: number | null) => void
}

function ImprovementCard({ area, telemetry, onActiveCorners, onHoverIndex }: ImprovementCardProps) {
  const [expanded, setExpanded] = useState(false)
  const sev = SEVERITY_CONFIG[area.severity]

  // Resolve Corner objects for each referenced corner number
  const referencedCorners = area.corner_refs
    .map((num) => telemetry.corners.find((c) => c.corner_num === num))
    .filter((c): c is Corner => c !== undefined)

  return (
    <div
      className={`rounded-xl border ${sev.border} ${sev.bg} overflow-hidden transition-all duration-200`}
    >
      <button
        className="w-full text-left p-4"
        onClick={() => {
          const next = !expanded
          setExpanded(next)
          onActiveCorners?.(next ? area.corner_refs : [])
        }}
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">{sev.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-white">
                #{area.rank} {area.title}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${sev.badge}`}
              >
                {area.severity.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {area.corner_refs.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {area.corner_refs.map((c) => (
                    <button
                      key={c}
                      className="text-xs text-slate-400 hover:text-amber-400 hover:bg-amber-500/15 px-1.5 py-0.5 rounded transition-colors cursor-pointer font-mono"
                      onClick={(e) => {
                        e.stopPropagation()
                        onActiveCorners?.([c])
                      }}
                    >
                      T{c}
                    </button>
                  ))}
                </div>
              )}
              <span className="flex items-center gap-1 text-xs text-red-400">
                <TrendingDown className="w-3 h-3" />
                {(area.time_loss_ms / 1000).toFixed(2)}s lost
              </span>
            </div>
          </div>
          <div className="flex-shrink-0 text-slate-500">
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-700/50 pt-3">
          {/* Corner visual snippets */}
          {referencedCorners.length > 0 && (
            <div className={`grid gap-3 ${referencedCorners.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
              {referencedCorners.map((corner) => (
                <CornerSnippet
                  key={corner.corner_num}
                  corner={corner}
                  distances={telemetry.distances}
                  userLat={telemetry.userLat}
                  userLon={telemetry.userLon}
                  refLat={telemetry.refLat}
                  refLon={telemetry.refLon}
                  userSpeed={telemetry.userSpeed}
                  refSpeed={telemetry.refSpeed}
                  userBrake={telemetry.userBrake}
                  refBrake={telemetry.refBrake}
                  userThrottle={telemetry.userThrottle}
                  refThrottle={telemetry.refThrottle}
                  issueType={area.issue_type}
                  onHoverIndex={onHoverIndex}
                />
              ))}
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
              Description
            </p>
            <p className="text-sm text-slate-300 leading-relaxed">{area.description}</p>
          </div>

          {area.technique && (
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                Technique
              </p>
              <p className="text-sm text-slate-300 leading-relaxed">{area.technique}</p>
            </div>
          )}

          {area.telemetry_evidence && (
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                Telemetry Evidence
              </p>
              <p className="text-xs text-slate-400 leading-relaxed font-mono">
                {area.telemetry_evidence}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AnalysisCards({
  improvement_areas,
  strengths,
  summary,
  estimated_time_gain,
  sector_notes,
  telemetry,
  onActiveCorners,
  onHoverIndex,
}: AnalysisCardsProps) {
  return (
    <div className="space-y-6">
      {/* Overall Assessment */}
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 className="text-white font-semibold">Overall Assessment</h2>
          {estimated_time_gain > 0 && (
            <div className="flex-shrink-0 bg-amber-500/20 border border-amber-500/30 text-amber-400 font-semibold text-sm px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              +{estimated_time_gain.toFixed(1)}s available
            </div>
          )}
        </div>
        <p className="text-slate-300 text-sm leading-relaxed">{summary}</p>
      </div>

      {/* Improvement Areas */}
      {improvement_areas.length > 0 && (
        <div>
          <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-red-400" />
            Improvement Areas
            <span className="text-slate-500 text-sm font-normal">
              ({improvement_areas.length})
            </span>
          </h2>
          <div className="space-y-3">
            {improvement_areas.map((area) => (
              <ImprovementCard key={area.rank} area={area} telemetry={telemetry} onActiveCorners={onActiveCorners} onHoverIndex={onHoverIndex} />
            ))}
          </div>
        </div>
      )}

      {/* Strengths */}
      {strengths.length > 0 && (
        <div>
          <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            Your Strengths
            <span className="text-slate-500 text-sm font-normal">
              ({strengths.length})
            </span>
          </h2>
          <div className="space-y-2">
            {strengths.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5"
              >
                <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-slate-300 leading-relaxed">{s}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sector Notes */}
      {sector_notes.length > 0 && (
        <div>
          <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" />
            Sector Notes
          </h2>
          <div className="card space-y-2.5">
            {sector_notes.map((note, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="flex-shrink-0 text-xs text-slate-500 font-mono mt-0.5">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-sm text-slate-300 leading-relaxed">{note}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {improvement_areas.length === 0 && strengths.length === 0 && (
        <div className="card py-12 text-center">
          <p className="text-slate-400">No detailed analysis data available.</p>
        </div>
      )}
    </div>
  )
}
