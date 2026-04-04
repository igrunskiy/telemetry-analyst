export interface LlmProviderAccess {
  provider: 'claude' | 'gemini' | 'openai'
  label: string
  has_custom_key: boolean
  has_shared_key: boolean
  key_source: 'custom' | 'shared' | 'none'
  uses_shared_quota: boolean
  can_generate: boolean
  disabled_reason?: 'no_key_configured' | 'shared_quota_exhausted' | null
  shared_reports_remaining_today: number
}

export interface LlmAccessState {
  shared_reports_per_day: number
  shared_reports_used_today: number
  shared_reports_remaining_today: number
  providers: Record<'claude' | 'gemini' | 'openai', LlmProviderAccess>
}

export interface User {
  id: string
  display_name: string
  avatar_url: string | null
  has_custom_claude_key: boolean
  has_custom_gemini_key: boolean
  has_custom_openai_key: boolean
  has_garage61: boolean
  role: 'admin' | 'moderator' | 'user'
  llm_access: LlmAccessState
}

export interface ReportFeedback {
  id: string
  analysis_id: string
  version_number?: number
  created_at: string
  user_id: string
  user_display_name?: string | null
  selected_text: string
  comment: string
  reviewed_at?: string | null
  report_user_display_name?: string
  car_name?: string
  track_name?: string
  analysis_mode?: string
}

export interface AdminReportFeedbackInbox {
  unread_count: number
  items: ReportFeedback[]
}

export interface AdminUser {
  id: string
  display_name: string
  username: string | null
  email: string | null
  role: 'admin' | 'moderator' | 'user'
  is_suspended: boolean
  garage61_user_id: string | null
  discord_user_id: string | null
  has_custom_claude_key: boolean
  has_custom_gemini_key: boolean
  has_custom_openai_key: boolean
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

export interface RecentActivity {
  id: string
  date: string
  car_name: string
  track_name: string
  car_id?: string | number
  track_id?: string | number
  recorded_at: string
  lap_count: number
  best_lap_time: number
  laps: Lap[]
  source?: 'garage61' | 'upload'
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
  download_path?: string
  garage61_url?: string
}

export interface LapConditions {
  summary?: string
  setup_type?: string
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
  user_id?: string
  version_group_id?: string
  version_number?: number
  is_default_version?: boolean
  available_versions?: AnalysisVersionSummary[]
  latest_valid_version_id?: string
  latest_valid_version_number?: number
  lap_id: string
  reference_lap_ids: string[]
  car_name: string
  track_name: string
  analysis_mode?: 'vs_reference' | 'solo'
  llm_provider?: 'claude' | 'gemini' | 'openai'
  model_name?: string
  prompt_version?: string
  llm_payload_bytes?: number
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
  telemetry_storage?: {
    analysis_id: string
    required_lap_count: number
    stored_lap_count: number
    required_lap_ids: string[]
    stored_lap_ids: string[]
    is_complete: boolean
  }
  laps_metadata?: LapMeta[]
  admin_retrospectives?: AdminRetrospective[]
  user_feedback_items?: ReportFeedback[]
  share_token?: string | null
  telemetry: {
    reference_laps?: {
      lap_id?: string | null
      speed: number[]
      throttle: number[]
      brake: number[]
      gear?: number[]
      lat?: number[]
      lon?: number[]
    }[]
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

export interface AnalysisVersionSummary {
  id: string
  version_number: number
  created_at: string
  status: 'enqueued' | 'processing' | 'completed' | 'failed'
  is_default_version: boolean
  llm_provider?: 'claude' | 'gemini' | 'openai' | string
  model_name?: string
  prompt_version?: string
  telemetry_storage_complete?: boolean | null
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
  original_created_at: string
  latest_regenerated_at: string
  version_group_id: string
  enqueued_at?: string | null
  error_message?: string | null
  telemetry_storage_complete?: boolean | null
  latest_valid_version_id?: string | null
  latest_valid_version_number?: number | null
  latest_retrospective?: AdminRetrospective | null
}

export interface AdminRetrospective {
  created_at: string
  analysis_id?: string
  version_number?: number
  feedback_text: string
  focus_areas: string
  summary?: string
  root_causes?: string[]
  feedback_alignment?: string[]
  suggested_prompt_patch?: string
  _meta?: {
    llm_provider?: string
    model_name?: string
    prompt_version?: string
    request_payload_bytes?: number
    response_bytes?: number
  }
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
  openai: string
}

export interface SharedReportLimitSettings {
  reports_per_day: number
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
  llm_provider?: 'claude' | 'gemini' | 'openai'
  model_name?: string
  prompt_version?: string
}
