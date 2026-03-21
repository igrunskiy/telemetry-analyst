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
  carId: number,
  trackId: number,
  limit = 25,
  offset = 0,
): Promise<Lap[]> {
  const { data } = await api.get<Lap[]>('/api/laps/my-laps', {
    params: { car_id: carId, track_id: trackId, limit, offset },
  })
  return data
}

export async function getMySessions(
  carId: number,
  trackId: number,
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

export async function getReferenceLaps(carId: number, trackId: number, limit = 5): Promise<Lap[]> {
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
  })
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
  window.location.href = '/auth/garage61/connect'
}

export async function localLogin(username: string, password: string): Promise<string> {
  const { data } = await api.post<{ access_token: string }>('/auth/local/login', { username, password })
  return data.access_token
}

// Admin endpoints
export async function adminListUsers(): Promise<AdminUser[]> {
  const { data } = await api.get<AdminUser[]>('/admin/users')
  return data
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
  const { data } = await api.get<PromptMeta[]>('/admin/prompts')
  return data
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
