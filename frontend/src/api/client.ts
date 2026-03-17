import axios from 'axios'
import type {
  User,
  Car,
  Track,
  Lap,
  AnalysisReport,
  AnalysisHistoryItem,
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

export async function getMyLaps(carId: number, trackId: number): Promise<Lap[]> {
  const { data } = await api.get<Lap[]>('/api/laps/my-laps', {
    params: { car_id: carId, track_id: trackId },
  })
  return data
}

export async function getReferenceLaps(carId: number, trackId: number): Promise<Lap[]> {
  const { data } = await api.get<Lap[]>('/api/laps/reference-laps', {
    params: { car_id: carId, track_id: trackId },
  })
  return data
}

export async function runAnalysis(
  lapId: string,
  referenceLapIds: string[],
  carName: string,
  trackName: string,
): Promise<AnalysisReport> {
  const { data } = await api.post<AnalysisReport>('/api/analysis/run', {
    lap_id: lapId,
    reference_lap_ids: referenceLapIds,
    car_name: carName,
    track_name: trackName,
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

export async function updateClaudeKey(apiKey: string): Promise<void> {
  await api.put('/api/profile/claude-key', { api_key: apiKey })
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout')
}

export default api
