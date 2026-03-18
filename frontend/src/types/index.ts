export interface User {
  id: string
  display_name: string
  avatar_url: string | null
  has_custom_claude_key: boolean
}

export interface Car {
  id: number
  name: string
  platform_id?: string
}

export interface Track {
  id: number
  name: string
  config?: string
  variant?: string
  platform_id?: number | string
}

export interface Lap {
  id: string
  lap_time: number // milliseconds
  car_name: string
  track_name: string
  car_id?: number
  track_id?: number
  driver_name: string
  recorded_at: string
}

export interface Corner {
  corner_num: number
  dist_start: number
  dist_apex: number
  dist_end: number
  min_speed: number
  label: string
}

export interface WeakZone {
  zone_type: string
  corner_num: number
  dist: number
  severity: 'low' | 'medium' | 'high'
  metric: string
  user_value: number
  ref_value: number
  delta: number
}

export interface ImprovementArea {
  rank: number
  title: string
  corner_refs: number[]
  issue_type: string
  severity: 'high' | 'medium' | 'low'
  time_loss_ms: number
  description: string
  technique: string
  telemetry_evidence: string
}

export interface SectorData {
  sector: number | string
  user_time_ms: number
  ref_time_ms: number
  delta_ms: number
}

export interface AnalysisReport {
  id: string
  car_name: string
  track_name: string
  created_at: string
  summary: string
  estimated_time_gain_seconds: number
  improvement_areas: ImprovementArea[]
  strengths: string[]
  sector_notes: string[]
  telemetry: {
    distances: number[]
    user_speed: number[]
    ref_speed: number[]
    user_throttle: number[]
    ref_throttle: number[]
    user_brake: number[]
    ref_brake: number[]
    delta_ms: number[]
    user_lat?: number[]
    user_lon?: number[]
    ref_lat?: number[]
    ref_lon?: number[]
    corners: Corner[]
    sectors: SectorData[]
  }
}

export interface AnalysisHistoryItem {
  id: string
  car_name: string
  track_name: string
  created_at: string
  summary: string
  estimated_time_gain_seconds: number | null
}
