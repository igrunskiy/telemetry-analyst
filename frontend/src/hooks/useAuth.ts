import { useQuery } from '@tanstack/react-query'
import { getMe } from '../api/client'
import type { User } from '../types'

export function useAuth() {
  const hasToken = !!localStorage.getItem('access_token')

  const { data: user, isLoading, isError } = useQuery<User, Error>({
    queryKey: ['auth', 'me'],
    queryFn: getMe,
    retry: false,
    enabled: hasToken, // Only fetch if token exists
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  return {
    user: user ?? null,
    isLoading,
    isError,
    isAuthenticated: !!user && !isError,
  }
}
