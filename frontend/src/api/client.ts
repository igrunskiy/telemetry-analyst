import axios from 'axios'
import type {
  User,
  AdminUser,
  AdminReport,
  Car,
  Track,
  Lap,
  Session,
  LapMeta,
  AnalysisReport,
  AnalysisHistoryItem,
  WorkerStatus,
  DbHealth,
  PromptMeta,
  PromptsDefaults,
  UploadedTelemetryInput,
  UploadInspection,
  ImportedTelemetry,
  ImportedTelemetryUpdateInput,
  Garage61DictionaryEntry,
} from '../types'

const api = axios.create({
  baseURL: '',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor: add Bearer token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: on 401, redirect to /login and clear token
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear the stored token
      localStorage.removeItem('access_token')
      // Avoid redirect loop on the login page itself
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me')
  return data
}

export async function getCars(): Promise<Car[]> {
  const { data } = await api.get<Car[]>('/api/laps/cars')
  return data
}

export async function getTracks(): Promise<Track[]> {
  const { data } = await api.get<Track[]>('/api/laps/tracks')
  return data
}

export async function getMyLaps(
  carId: string | number,
  trackId: string | number,
  limit = 25,
  offset = 0,
): Promise<Lap[]> {
  const { data } = await api.get<Lap[]>('/api/laps/my-laps', {
    params: { car_id: carId, track_id: trackId, limit, offset },
  })
  return data
}

export async function getMySessions(
  carId: string | number,
  trackId: string | number,
  limit = 20,
  offset = 0,
): Promise<Session[]> {
  const { data } = await api.get<Session[]>('/api/laps/my-sessions', {
    params: { car_id: carId, track_id: trackId, limit, offset },
  })
  return data
}

export async function getRecentLaps(limit = 5): Promise<Lap[]> {
  const { data } = await api.get<Lap[]>('/api/laps/recent', {
    params: { limit },
  })
  return data
}

export async function getReferenceLaps(carId: string | number, trackId: string | number, limit = 5): Promise<Lap[]> {
  const { data } = await api.get<Lap[]>('/api/laps/reference-laps', {
    params: { car_id: carId, track_id: trackId, limit },
  })
  return data
}

export async function runAnalysis(
  lapId: string,
  referenceLapIds: string[],
  carName: string,
  trackName: string,
  analysisMode: 'vs_reference' | 'solo' = 'vs_reference',
  lapsMetadata?: LapMeta[],
  llmProvider: 'claude' | 'gemini' = 'claude',
  promptVersion?: string | null,
  uploadedTelemetry?: UploadedTelemetryInput[],
): Promise<AnalysisReport> {
  const { data } = await api.post<AnalysisReport>('/api/analysis/run', {
    lap_id: lapId,
    reference_lap_ids: referenceLapIds,
    car_name: carName,
    track_name: trackName,
    analysis_mode: analysisMode,
    laps_metadata: lapsMetadata,
    llm_provider: llmProvider,
    prompt_version: promptVersion ?? null,
    uploaded_telemetry: uploadedTelemetry,
  })
  return data
}

export async function inspectTelemetryFiles(files: File[]): Promise<UploadInspection[]> {
  const formData = new FormData()
  files.forEach((file) => formData.append('files', file))
  const { data } = await api.post<UploadInspection[]>('/api/analysis/inspect-upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function importTelemetryFiles(
  files: File[],
  metadata: Array<Record<string, unknown>>,
): Promise<ImportedTelemetry[]> {
  const formData = new FormData()
  files.forEach((file) => formData.append('files', file))
  formData.append('metadata_json', JSON.stringify(metadata))
  const { data } = await api.post<ImportedTelemetry[]>('/api/telemetry/imports', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function getImportedTelemetry(): Promise<ImportedTelemetry[]> {
  const { data } = await api.get<ImportedTelemetry[]>('/api/telemetry/imports')
  return data
}

export async function updateImportedTelemetry(
  importId: string,
  payload: ImportedTelemetryUpdateInput,
): Promise<ImportedTelemetry> {
  const { data } = await api.patch<ImportedTelemetry>(`/api/telemetry/imports/${importId}`, payload)
  return data
}

export async function deleteImportedTelemetry(importId: string): Promise<void> {
  await api.delete(`/api/telemetry/imports/${importId}`)
}

export async function getGarage61Dictionary(entryType: 'car' | 'track'): Promise<Garage61DictionaryEntry[]> {
  const { data } = await api.get<Garage61DictionaryEntry[]>(`/api/telemetry/dictionary/${entryType}`)
  return data
}

export async function syncGarage61Dictionary(): Promise<{ cars: number; tracks: number }> {
  const { data } = await api.post<{ cars: number; tracks: number }>('/api/telemetry/dictionary/sync')
  return data
}

export async function getAnalysisHistory(): Promise<AnalysisHistoryItem[]> {
  const { data } = await api.get<AnalysisHistoryItem[]>('/api/analysis/history')
  return data
}

export async function getAnalysis(id: string): Promise<AnalysisReport> {
  const { data } = await api.get<AnalysisReport>(`/api/analysis/${id}`)
  return data
}

export async function deleteAnalysis(id: string): Promise<void> {
  await api.delete(`/api/analysis/${id}`)
}

export async function regenerateAnalysis(id: string): Promise<AnalysisReport> {
  const { data } = await api.post<AnalysisReport>(`/api/analysis/${id}/regenerate`)
  return data
}

export async function shareAnalysis(id: string): Promise<{ share_token: string }> {
  const { data } = await api.post<{ share_token: string }>(`/api/analysis/${id}/share`)
  return data
}

export async function getSharedAnalysis(shareToken: string): Promise<AnalysisReport> {
  // Public endpoint — no auth header needed
  const { data } = await api.get<AnalysisReport>(`/api/analysis/shared/${shareToken}`, {
    headers: { Authorization: undefined },
  })
  return data
}

export async function updateClaudeKey(apiKey: string): Promise<void> {
  await api.put('/api/profile/claude-key', { api_key: apiKey })
}

export async function updateGeminiKey(apiKey: string): Promise<void> {
  await api.put('/api/profile/gemini-key', { api_key: apiKey })
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout')
}

export function connectGarage61(): void {
  const token = localStorage.getItem('access_token')
  const qs = token ? `?token=${encodeURIComponent(token)}` : ''
  window.location.href = `/auth/garage61/connect${qs}`
}

export async function localLogin(username: string, password: string): Promise<string> {
  const { data } = await api.post<{ access_token: string }>('/auth/local/login', { username, password })
  return data.access_token
}

// Admin endpoints
export async function adminListUsers(): Promise<AdminUser[]> {
  const { data } = await api.get<AdminUser[] | { users?: AdminUser[]; items?: AdminUser[]; data?: AdminUser[] }>('/admin/users')

  if (Array.isArray(data)) {
    return data
  }

  if (Array.isArray(data?.users)) {
    return data.users
  }

  if (Array.isArray(data?.items)) {
    return data.items
  }

  if (Array.isArray(data?.data)) {
    return data.data
  }

  throw new Error('Invalid admin users response')
}

export async function adminSetSuspended(userId: string, suspended: boolean): Promise<void> {
  await api.patch(`/admin/users/${userId}/suspend`, { suspended })
}

export async function adminSetRole(userId: string, role: 'admin' | 'user'): Promise<void> {
  await api.patch(`/admin/users/${userId}/role`, { role })
}

export async function adminCreateUser(payload: {
  username: string
  password: string
  display_name: string
  email?: string
  role?: string
}): Promise<AdminUser> {
  const { data } = await api.post<AdminUser>('/admin/users', payload)
  return data
}

export async function adminGetConfig(): Promise<string> {
  const { data } = await api.get<{ content: string }>('/admin/config')
  return data.content
}

export async function adminSaveConfig(content: string): Promise<void> {
  await api.put('/admin/config', { content })
}

export async function adminListPrompts(): Promise<PromptMeta[]> {
  const { data } = await api.get<PromptMeta[] | { prompts?: PromptMeta[]; items?: PromptMeta[]; data?: PromptMeta[] }>('/admin/prompts')

  if (Array.isArray(data)) {
    return data
  }

  if (Array.isArray(data?.prompts)) {
    return data.prompts
  }

  if (Array.isArray(data?.items)) {
    return data.items
  }

  if (Array.isArray(data?.data)) {
    return data.data
  }

  throw new Error('Invalid admin prompts response')
}

export async function adminGetPromptDefaults(): Promise<PromptsDefaults> {
  const { data } = await api.get<PromptsDefaults>('/admin/prompts/defaults')
  return data
}

export async function adminSetPromptDefaults(defaults: PromptsDefaults): Promise<void> {
  await api.put('/admin/prompts/defaults', defaults)
}

export async function adminGetPrompt(name: string): Promise<string> {
  const { data } = await api.get<{ name: string; content: string }>(`/admin/prompts/${name}`)
  return data.content
}

export async function adminCreatePrompt(name: string, content: string): Promise<void> {
  await api.post('/admin/prompts', { name, content })
}

export async function adminSavePrompt(name: string, content: string): Promise<void> {
  await api.put(`/admin/prompts/${name}`, { content })
}

export async function adminDeletePrompt(name: string): Promise<void> {
  await api.delete(`/admin/prompts/${name}`)
}

export async function adminListReports(): Promise<AdminReport[]> {
  const { data } = await api.get<AdminReport[]>('/admin/reports')
  return data
}

export async function adminFailReport(id: string): Promise<void> {
  await api.post(`/admin/reports/${id}/fail`)
}

export async function adminGetDbHealth(): Promise<DbHealth> {
  const { data } = await api.get<DbHealth>('/admin/db/health')
  return data
}

export async function adminGetWorkerStatus(): Promise<WorkerStatus> {
  const { data } = await api.get<WorkerStatus>('/admin/worker/status')
  return data
}

export async function adminSetWorkerPoolSize(poolSize: number): Promise<void> {
  await api.patch('/admin/worker/pool-size', { pool_size: poolSize })
}

export default api
