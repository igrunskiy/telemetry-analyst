import { useState, useEffect, useRef } from 'react'
import { Flag } from 'lucide-react'
import { localLogin } from '../api/client'
import { useQueryClient } from '@tanstack/react-query'

export default function LoginPage() {
  const [redirecting, setRedirecting] = useState<'garage61' | null>(null)
  const [showLocal, setShowLocal] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const queryClient = useQueryClient()

  // F12 on desktop to toggle local login
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F12') {
        e.preventDefault()
        setShowLocal(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Double-tap on logo to toggle local login (mobile-friendly)
  const lastTapRef = useRef(0)
  function handleLogoTap() {
    const now = Date.now()
    if (now - lastTapRef.current < 400) {
      setShowLocal(v => !v)
    }
    lastTapRef.current = now
  }

  function handleGarage61Login() {
    setRedirecting('garage61')
    window.location.href = '/auth/login'
  }

  async function handleLocalLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoggingIn(true)
    try {
      const token = await localLogin(username, password)
      localStorage.setItem('access_token', token)
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      window.location.replace('/app')
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Login failed')
    } finally {
      setLoggingIn(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4">
      {/* Background accent */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo / Icon area */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-amber-500/25 cursor-pointer select-none"
            onClick={handleLogoTap}
          >
            <Flag className="w-8 h-8 text-slate-900" strokeWidth={2.5} />
          </div>

          <h1 className="text-3xl font-bold text-white tracking-tight">
            Telemetry Analyst
          </h1>
          <p className="mt-2 text-slate-400 text-center text-sm leading-relaxed">
            AI-powered lap analysis for iRacing drivers
          </p>
        </div>

        {/* Login card */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-xl">
          <h2 className="text-lg font-semibold text-white mb-1">
            Sign in to continue
          </h2>
          <p className="text-slate-400 text-sm mb-5">
            Connect your account to access your lap data and AI coaching.
          </p>

          {/* Garage61 button */}
          <button
            onClick={handleGarage61Login}
            disabled={redirecting !== null}
            className="w-full btn-primary flex items-center justify-center gap-2 py-3 text-base"
          >
            {redirecting === 'garage61' ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                <span>Redirecting...</span>
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="flex-shrink-0">
                  <rect x="2" y="2" width="4" height="4" fill="currentColor" />
                  <rect x="10" y="2" width="4" height="4" fill="currentColor" />
                  <rect x="6" y="6" width="4" height="4" fill="currentColor" />
                  <rect x="14" y="6" width="4" height="4" fill="currentColor" />
                  <rect x="2" y="10" width="4" height="4" fill="currentColor" />
                  <rect x="10" y="10" width="4" height="4" fill="currentColor" />
                  <rect x="6" y="14" width="4" height="4" fill="currentColor" />
                  <rect x="14" y="14" width="4" height="4" fill="currentColor" />
                </svg>
                <span>Login with Garage61</span>
              </>
            )}
          </button>

          <p className="mt-4 text-xs text-slate-500 text-center leading-relaxed">
            Sign in with Garage61 to access your telemetry data and AI coaching.
          </p>

          {/* Hidden local login — revealed by F12 */}
          {showLocal && (
            <form onSubmit={handleLocalLogin} className="space-y-4 mt-6 pt-6 border-t border-slate-700">
              <div>
                <label className="block text-sm text-slate-400 mb-1" htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors text-sm"
                  placeholder="admin"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors text-sm"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loggingIn}
                className="w-full btn-primary flex items-center justify-center gap-2 py-3 text-base"
              >
                {loggingIn ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <span>Sign in</span>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Features list */}
        <div className="mt-6 grid grid-cols-3 gap-4 text-center">
          {[
            { label: 'Corner Analysis', icon: '⟳' },
            { label: 'AI Coaching', icon: '✦' },
            { label: 'Delta Charts', icon: '△' },
          ].map(({ label, icon }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <span className="text-amber-500 text-lg">{icon}</span>
              <span className="text-slate-500 text-xs">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
