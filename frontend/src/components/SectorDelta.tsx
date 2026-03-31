import { useMemo } from 'react'
import Plot from '../lib/plotly'
import type * as Plotly from 'plotly.js'
import type { SectorData } from '../types'

interface SectorDeltaProps {
  sectors: SectorData[]
  selectedSector?: number | null
  onSectorClick?: (sector: number | null) => void
}

function formatMs(ms: number): string {
  const sign = ms >= 0 ? '+' : ''
  return `${sign}${ms.toFixed(0)}ms`
}

function formatSectorTime(ms: number): string {
  const totalSeconds = ms / 1000
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60)
    const secs = (totalSeconds % 60).toFixed(3).padStart(6, '0')
    return `${minutes}:${secs}`
  }
  return `${totalSeconds.toFixed(3)}s`
}

export default function SectorDelta({ sectors, selectedSector, onSectorClick }: SectorDeltaProps) {
  if (!sectors || sectors.length === 0) {
    return (
      <div className="card py-16 text-center">
        <p className="text-slate-400">No sector data available.</p>
      </div>
    )
  }

  // Positive delta = user faster (ref_time > user_time)
  const deltas = useMemo(
    () => sectors.map((s) => s.ref_time_ms - s.user_time_ms),
    [sectors],
  )

  const totalDelta = deltas.reduce((a, b) => a + b, 0)

  // For row color intensity: scale each sector's delta relative to the worst sector
  const maxAbsDelta = Math.max(...deltas.map(Math.abs), 1)
  const sectorRowStyle = (delta: number) => {
    const intensity = Math.min(Math.abs(delta) / maxAbsDelta, 1)
    if (delta > 0) {
      // You are faster — green tint, proportional to advantage
      return { borderLeftColor: `rgba(34,197,94,${0.3 + intensity * 0.5})`, borderLeftWidth: '3px', borderLeftStyle: 'solid' as const }
    }
    // You are slower — red tint, proportional to time loss
    return { borderLeftColor: `rgba(239,68,68,${0.3 + intensity * 0.5})`, borderLeftWidth: '3px', borderLeftStyle: 'solid' as const }
  }

  const barColors = deltas.map((d) =>
    d > 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)',
  )

  const barTrace: Plotly.Data = {
    type: 'bar',
    x: sectors.map((s) => `S${s.sector}`),
    y: deltas,
    marker: {
      color: barColors,
      line: {
        color: deltas.map((d) =>
          d > 0 ? 'rgba(34,197,94,1)' : 'rgba(239,68,68,1)',
        ),
        width: 1,
      },
    },
    text: deltas.map(formatMs),
    textposition: 'outside',
    textfont: { color: '#94a3b8', size: 11 },
    hovertemplate: 'Sector %{x}: %{text}<extra></extra>',
    showlegend: false,
  }

  const maxAbs = Math.max(...deltas.map(Math.abs), 100)

  return (
    <div className="space-y-5">
      {/* Bar chart card */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
          <div>
            <h3 className="text-white font-medium text-sm">Sector Delta</h3>
            <p className="text-slate-500 text-xs mt-0.5">
              Green = you faster, Red = reference faster
            </p>
          </div>
          <div
            className={`text-sm font-semibold px-3 py-1 rounded-full ${
              totalDelta > 0
                ? 'bg-emerald-500/15 text-emerald-400'
                : totalDelta < 0
                ? 'bg-red-500/15 text-red-400'
                : 'bg-slate-700 text-slate-400'
            }`}
          >
            Total: {formatMs(totalDelta)}
          </div>
        </div>

        <Plot
          data={[barTrace]}
          layout={{
            paper_bgcolor: '#0f172a',
            plot_bgcolor: '#1e293b',
            autosize: true,
            height: 280,
            margin: { t: 30, r: 20, b: 40, l: 60 },
            xaxis: {
              title: { text: 'Sector', font: { color: '#94a3b8', size: 11 } },
              gridcolor: 'rgba(148,163,184,0.08)',
              linecolor: 'rgba(148,163,184,0.15)',
              tickfont: { color: '#64748b', size: 11 },
            },
            yaxis: {
              title: { text: 'Delta (ms)', font: { color: '#94a3b8', size: 11 } },
              gridcolor: 'rgba(148,163,184,0.08)',
              linecolor: 'rgba(148,163,184,0.15)',
              tickfont: { color: '#64748b', size: 11 },
              range: [-maxAbs * 1.3, maxAbs * 1.3],
              zeroline: true,
              zerolinecolor: 'rgba(148,163,184,0.3)',
              zerolinewidth: 1,
            },
            bargap: 0.35,
          }}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: '100%' }}
          useResizeHandler
        />
      </div>

      {/* Data table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h3 className="text-white font-medium text-sm">Sector Times</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[400px]">
            <thead>
              <tr className="border-b border-slate-700 text-slate-500 text-xs">
                <th className="text-left px-4 py-2.5 font-medium">Sector</th>
                <th className="text-right px-4 py-2.5 font-medium">Your Time</th>
                <th className="text-right px-4 py-2.5 font-medium">Reference Time</th>
                <th className="text-right px-4 py-2.5 font-medium">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {sectors.map((s, i) => {
                const delta = deltas[i]
                const isSelected = selectedSector === s.sector
                return (
                  <tr
                    key={s.sector}
                    onClick={() => onSectorClick?.(isSelected ? null : Number(s.sector))}
                    className={`transition-colors cursor-pointer ${isSelected ? 'bg-amber-500/10' : 'hover:bg-slate-700/30'}`}
                    style={sectorRowStyle(delta)}
                  >
                    <td className={`px-4 py-2.5 font-medium ${isSelected ? 'text-amber-400' : 'text-slate-300'}`}>
                      S{s.sector}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-white">
                      {formatSectorTime(s.user_time_ms)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                      {formatSectorTime(s.ref_time_ms)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono font-semibold ${
                        delta > 0
                          ? 'text-emerald-400'
                          : delta < 0
                          ? 'text-red-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {formatMs(delta)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t border-slate-600">
              <tr className="text-sm">
                <td className="px-4 py-2.5 text-slate-400 font-medium" colSpan={3}>
                  Total
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-mono font-bold ${
                    totalDelta > 0
                      ? 'text-emerald-400'
                      : totalDelta < 0
                      ? 'text-red-400'
                      : 'text-slate-400'
                  }`}
                >
                  {formatMs(totalDelta)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
