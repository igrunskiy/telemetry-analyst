import { useState } from 'react'
import { ChevronDown, ChevronUp, Gauge } from 'lucide-react'
import type { DrivingScores } from '../types'

interface Props {
  scores: DrivingScores
  isSolo: boolean
  selectedSector?: number | null
  sectorScores?: { sector: number; driving_scores: DrivingScores }[]
}

interface ScoreItemDef {
  key: keyof DrivingScores
  label: string
  soloLabel: string
  category: 'Brake' | 'Throttle' | 'Steering'
  bucket: 'Points' | 'Application'
}

const SCORE_ITEMS: ScoreItemDef[] = [
  {
    key: 'braking_points',
    label: 'Braking Points',
    soloLabel: 'Braking Points',
    category: 'Brake',
    bucket: 'Points',
  },
  {
    key: 'brake_application',
    label: 'Brake Application & Trail Braking',
    soloLabel: 'Brake Application',
    category: 'Brake',
    bucket: 'Application',
  },
  {
    key: 'throttle_pickup',
    label: 'Throttle Pickup',
    soloLabel: 'Throttle Pickup',
    category: 'Throttle',
    bucket: 'Points',
  },
  {
    key: 'steering',
    label: 'Steering Smoothness',
    soloLabel: 'Steering',
    category: 'Steering',
    bucket: 'Application',
  },
]

const CATEGORIES = ['Brake', 'Throttle', 'Steering'] as const

interface ScoreTier {
  color: string
  bg: string
  text: string
  label: string
}

function scoreTier(score: number): ScoreTier {
  if (score >= 85) return { color: '#22c55e', bg: 'bg-green-500/15',  text: 'text-green-400',  label: 'Excellent'  }
  if (score >= 75) return { color: '#84cc16', bg: 'bg-lime-500/15',   text: 'text-lime-400',   label: 'Good'       }
  if (score >= 65) return { color: '#f59e0b', bg: 'bg-amber-500/15',  text: 'text-amber-400',  label: 'Average'    }
  if (score >= 50) return { color: '#f97316', bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Below avg'  }
  return               { color: '#ef4444', bg: 'bg-red-500/15',    text: 'text-red-400',    label: 'Needs work' }
}

function ScoreCard({
  bucket,
  label,
  score,
  comment,
}: {
  bucket: 'Points' | 'Application'
  label: string
  score: number
  comment: string
}) {
  const tier = scoreTier(score)
  const pct = Math.min(100, Math.max(0, score))

  return (
    <div
      className="bg-slate-800 rounded-xl p-4 flex flex-col gap-2.5 border-l-4 border border-slate-700/60"
      style={{ borderLeftColor: tier.color }}
    >
      {/* Bucket tag + tier badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-700/60 px-1.5 py-0.5 rounded">
            {bucket}
          </span>
          <span className="text-sm font-medium text-slate-200 leading-snug truncate">{label}</span>
        </div>
        <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${tier.bg} ${tier.text}`}>
          {tier.label}
        </span>
      </div>

      {/* Bar + numeric score */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: tier.color }}
          />
        </div>
        <span
          className="text-sm font-bold font-mono w-8 text-right tabular-nums"
          style={{ color: tier.color }}
        >
          {score}
        </span>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">{comment}</p>
    </div>
  )
}

export default function TelemetryInsights({ scores, isSolo, selectedSector, sectorScores }: Props) {
  const [open, setOpen] = useState(true)

  const activeSectorEntry = selectedSector != null
    ? sectorScores?.find((s) => s.sector === selectedSector)
    : null
  const activeScores = activeSectorEntry?.driving_scores ?? scores
  const isSectorView = activeSectorEntry != null

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-slate-700/30 transition-colors text-left"
      >
        <Gauge className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-slate-200 flex-1">
          Telemetry Insights
          {isSectorView && (
            <span className="ml-2 text-xs font-normal text-amber-400">— Sector {selectedSector}</span>
          )}
        </span>
        <span className="text-xs text-slate-500 hidden sm:inline mr-2">
          {isSectorView
            ? `Sector ${selectedSector} scores`
            : isSolo
            ? 'Lap-to-lap variance scores'
            : 'Technique scores vs reference'}
        </span>
        {open
          ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4">
          {CATEGORIES.map((category) => {
            const items = SCORE_ITEMS.filter((i) => i.category === category)
            return (
              <div key={category}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                    {category}
                  </span>
                  <div className="flex-1 h-px bg-slate-700/60" />
                </div>
                <div className={`grid gap-3 ${items.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                  {items.map(({ key, label, soloLabel, bucket }) => (
                    <ScoreCard
                      key={key}
                      bucket={bucket}
                      label={isSolo ? soloLabel : label}
                      score={activeScores[key].score}
                      comment={activeScores[key].comment}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
