export interface User {
  id: string
  display_name: string
  avatar_url: string | null
  has_custom_claude_key: boolean
  has_custom_gemini_key: boolean
  has_garage61: boolean
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
  id: string | number
  name: string
  source?: 'garage61' | 'upload'
  platform_id?: string
}

export interface Track {
  id: string | number
  name: string
  source?: 'garage61' | 'upload'
  config?: string
  variant?: string
  platform_id?: number | string
}

export interface Lap {
  id: string
  lap_time: number // milliseconds
  car_name: string
  track_name: string
  car_id?: string | number
  track_id?: string | number
  driver_name: string
  driver_key?: string
  recorded_at: string
  irating?: number
  season?: string
  source?: 'garage61' | 'upload'
  file_name?: string
  sample_count?: number
  track_length_m?: number | null
  conditions?: LapConditions | null
}

export interface RecentActivityEntry {
  date: string
  lap_count?: number
  source: 'garage61' | 'upload'
}

export interface RecentActivity {
  id: string
  car_name: string
  track_name: string
  car_id?: string | number
  track_id?: string | number
  recorded_at: string
  lap_count?: number
  source?: 'garage61' | 'upload' | 'mixed'
  entries: RecentActivityEntry[]
}

export interface Session {
  id: string
  date: string
  car_name: string
  track_name: string
  car_id?: string | number
  track_id?: string | number
  lap_count: number
  best_lap_time: number
  laps: Lap[]
  source?: 'garage61' | 'upload'
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
  source_driver_name?: string
  driver_key?: string
  lap_time: number   // milliseconds
  irating?: number
  file_name?: string
  recorded_at?: string
  source?: 'garage61' | 'custom'
  conditions?: LapConditions | null
}

export interface LapConditions {
  summary?: string
  weather?: string
  track_state?: string
  air_temp_c?: number
  track_temp_c?: number
  humidity_pct?: number
  wind_kph?: number
  wind_direction?: string | number
  time_of_day?: string
}

export interface UploadedTelemetryInput extends LapMeta {
  file_name: string
  csv_data: string
  car_name?: string
  track_name?: string
}

export interface UploadInspection {
  file_name: string
  valid: boolean
  error: string | null
  metadata: {
    car_name?: string
    track_name?: string
    driver_name?: string
    recorded_at?: string
    lap_time?: number | null
  }
  sample_count: number
  columns: string[]
  track_length_m?: number | null
}

export interface ImportedTelemetry {
  id: string
  file_name: string
  car_name: string
  track_name: string
  driver_name: string
  driver_key?: string
  lap_time: number
  recorded_at?: string | null
  sample_count: number
  track_length_m?: number | null
  air_temp_c?: number | null
  track_temp_c?: number | null
  created_at: string
  source: 'upload'
}

export interface ImportedTelemetryUpdateInput {
  car_name: string
  track_name: string
  driver_name: string
  lap_time: number
  recorded_at?: string | null
  air_temp_c?: number | null
  track_temp_c?: number | null
}

export interface Garage61DictionaryEntry {
  id: string
  entry_type: 'car' | 'track'
  name: string
  variant?: string | null
  display_name: string
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
  prompt_version?: string
  created_at: string
  enqueued_at?: string | null
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
  prompt_version?: string
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

export interface PromptMeta {
  name: string
  content: string
  default_for: string[]
}

export interface PromptsDefaults {
  claude: string
  gemini: string
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
  prompt_version?: string
}
