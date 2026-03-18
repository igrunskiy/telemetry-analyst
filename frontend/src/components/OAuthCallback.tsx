import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function OAuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    // Extract access_token from URL query params
    const params = new URLSearchParams(window.location.search)
    const accessToken = params.get('access_token')

    if (accessToken) {
      // Store token in localStorage
      localStorage.setItem('access_token', accessToken)
      // Clean up URL and navigate to app
      window.history.replaceState({}, '', '/callback')
      window.location.replace('/app')
      return
    } else {
      // No token in URL; if we already have one, go to app
      if (localStorage.getItem('access_token')) {
        window.location.replace('/app')
      } else {
        // No token found, redirect to login
        window.location.replace('/login')
      }
    }
  }, [navigate])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <p className="text-lg">Authenticating...</p>
        <div className="mt-4 w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin mx-auto" />
      </div>
    </div>
  )
}
