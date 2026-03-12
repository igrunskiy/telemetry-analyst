import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BarChart2 } from 'lucide-react'
import { getAnalysis } from '../api/client'
import TrackMap from '../components/TrackMap'
import TelemetryChart from '../components/TelemetryChart'
import HeatMap from '../components/HeatMap'
import SectorDelta from '../components/SectorDelta'
import AnalysisCards from '../components/AnalysisCards'

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
  const [activeTab, setActiveTab] = useState<Tab>('summary')

  const {
    data: report,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['analysis', analysisId],
    queryFn: () => getAnalysis(analysisId!),
    enabled: !!analysisId,
  })

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
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
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 pb-3 overflow-x-auto scrollbar-hide">
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
      </header>

      {/* Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
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
            {activeTab === 'summary' && (
              <AnalysisCards
                improvement_areas={report.improvement_areas}
                strengths={report.strengths}
                summary={report.summary}
                estimated_time_gain={report.estimated_time_gain_seconds}
                sector_notes={report.sector_notes}
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
              />
            )}

            {activeTab === 'heatmap' && (
              <HeatMap
                lat={report.telemetry.user_lat ?? []}
                lon={report.telemetry.user_lon ?? []}
                speed={report.telemetry.user_speed}
                brake={report.telemetry.user_brake}
                throttle={report.telemetry.user_throttle}
              />
            )}

            {activeTab === 'sectors' && (
              <SectorDelta sectors={report.telemetry.sectors} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
