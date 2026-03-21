export interface User {
  id: string
  display_name: string
  avatar_url: string | null
  has_custom_claude_key: boolean
  has_custom_gemini_key: boolean
  role: 'admin' | 'user'
}

export interface AdminUser {
  id: string
  display_name: string
  username: string | null
  email: string | null
  role: 'admin' | 'user'
  is_suspended: boolean
  garage61_user_id: string | null
  discord_user_id: string | null
  created_at: string
  last_login_at: string
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
  irating?: number
  season?: string
}

export interface Session {
  id: string
  date: string
  car_name: string
  track_name: string
  car_id?: number
  track_id?: number
  lap_count: number
  best_lap_time: number
  laps: Lap[]
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

export interface DrivingScoreItem {
  score: number
  comment: string
}

export interface DrivingScores {
  braking_points: DrivingScoreItem
  brake_application: DrivingScoreItem
  throttle_pickup: DrivingScoreItem
  steering: DrivingScoreItem
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

export interface LapMeta {
  id: string
  role: 'user' | 'reference'
  driver_name: string
  lap_time: number   // milliseconds
  irating?: number
}

export interface AnalysisReport {
  id: string
  lap_id: string
  reference_lap_ids: string[]
  car_name: string
  track_name: string
  analysis_mode?: 'vs_reference' | 'solo'
  llm_provider?: 'claude' | 'gemini'
  model_name?: string
  created_at: string
  status?: 'enqueued' | 'processing' | 'completed' | 'failed'
  error_message?: string
  summary: string
  estimated_time_gain_seconds: number
  improvement_areas: ImprovementArea[]
  strengths: string[]
  sector_notes: string[]
  driving_scores?: DrivingScores
  sector_scores?: { sector: number; driving_scores: DrivingScores }[]
  generation_time_s?: number
  laps_metadata?: LapMeta[]
  share_token?: string | null
  telemetry: {
    distances: number[]
    user_speed: number[]
    ref_speed: number[]
    user_throttle: number[]
    ref_throttle: number[]
    user_brake: number[]
    ref_brake: number[]
    user_gear?: number[]
    ref_gear?: number[]
    delta_ms: number[]
    user_lat?: number[]
    user_lon?: number[]
    ref_lat?: number[]
    ref_lon?: number[]
    corners: Corner[]
    sectors: SectorData[]
  }
}

export interface AdminReport {
  id: string
  user_id: string
  username: string | null
  display_name: string
  car_name: string
  track_name: string
  analysis_mode: string
  status: string
  llm_provider?: string
  model_name?: string
  created_at: string
  enqueued_at?: string | null
  error_message?: string | null
}

export interface DbHealth {
  ok: boolean
  latency_ms: number
  error?: string | null
  total_users?: number
  total_analyses?: number
  analyses_by_status?: Record<string, number>
}

export interface WorkerTask {
  job_id: string
  started_at: string
  elapsed_seconds: number
  timeout_seconds: number
}

export interface WorkerStatus {
  pool_size: number
  active_workers: number
  queue_depth: number
  tasks: WorkerTask[]
}

export interface AnalysisHistoryItem {
  id: string
  lap_id: string
  reference_lap_ids: string[]
  car_name: string
  track_name: string
  created_at: string
  estimated_time_gain_seconds: number | null
  analysis_mode?: 'vs_reference' | 'solo'
  status?: string
  llm_provider?: 'claude' | 'gemini'
  model_name?: string
}
