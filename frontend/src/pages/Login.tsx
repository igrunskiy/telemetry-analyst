import { useState, useEffect } from 'react'
import { Flag } from 'lucide-react'
import { localLogin } from '../api/client'
import { useQueryClient } from '@tanstack/react-query'

export default function LoginPage() {
  const [redirecting, setRedirecting] = useState<'garage61' | 'discord' | null>(null)
  const [showLocal, setShowLocal] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const queryClient = useQueryClient()

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

  function handleGarage61Login() {
    setRedirecting('garage61')
    window.location.href = '/auth/login'
  }

  function handleDiscordLogin() {
    setRedirecting('discord')
    window.location.href = '/auth/discord/login'
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
          <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-amber-500/25">
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

          {/* Divider */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-slate-500 text-xs">or</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>

          {/* Discord button */}
          <button
            onClick={handleDiscordLogin}
            disabled={redirecting !== null}
            className="w-full flex items-center justify-center gap-2 py-3 text-base font-medium rounded-xl bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-60 disabled:cursor-not-allowed text-white transition-colors"
          >
            {redirecting === 'discord' ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Redirecting...</span>
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.030zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
                <span>Login with Discord</span>
              </>
            )}
          </button>

          <p className="mt-4 text-xs text-slate-500 text-center leading-relaxed">
            Garage61 users get full iRacing telemetry access. Discord login provides
            basic access — connect Garage61 later from your profile.
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
