import { useState } from 'react'
import { Flag } from 'lucide-react'

export default function LoginPage() {
  const [isRedirecting, setIsRedirecting] = useState(false)

  function handleLogin() {
    setIsRedirecting(true)
    window.location.href = '/auth/login'
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
          <p className="text-slate-400 text-sm mb-6">
            Connect your Garage61 account to access your lap data and AI coaching.
          </p>

          <button
            onClick={handleLogin}
            disabled={isRedirecting}
            className="w-full btn-primary flex items-center justify-center gap-2 py-3 text-base"
          >
            {isRedirecting ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                <span>Redirecting...</span>
              </>
            ) : (
              <>
                {/* Garage61 icon — simple checkered flag SVG */}
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  className="flex-shrink-0"
                >
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
            Garage61 is an iRacing data platform. Your lap telemetry is fetched
            securely via OAuth — we never store your iRacing credentials.
          </p>
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
