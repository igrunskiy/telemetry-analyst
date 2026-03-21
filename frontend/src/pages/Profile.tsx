import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Save, Key, User, CheckCircle, AlertCircle, Link2, Link2Off } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { updateClaudeKey, updateGeminiKey, connectGarage61 } from '../api/client'

export default function ProfilePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [claudeKey, setClaudeKey] = useState('')
  const [claudeSaveSuccess, setClaudeSaveSuccess] = useState(false)
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiSaveSuccess, setGeminiSaveSuccess] = useState(false)
  const garage61JustConnected = searchParams.get('garage61') === 'connected'

  useEffect(() => {
    if (garage61JustConnected) {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const claudeMutation = useMutation({
    mutationFn: () => updateClaudeKey(claudeKey),
    onSuccess: () => {
      setClaudeSaveSuccess(true)
      setTimeout(() => setClaudeSaveSuccess(false), 3000)
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })

  const geminiMutation = useMutation({
    mutationFn: () => updateGeminiKey(geminiKey),
    onSuccess: () => {
      setGeminiSaveSuccess(true)
      setTimeout(() => setGeminiSaveSuccess(false), 3000)
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link
            to="/"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <span className="text-white font-medium text-sm">Profile</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* User info card */}
        <div className="card">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide mb-4">
            Account
          </h2>
          <div className="flex items-center gap-4">
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.display_name}
                className="w-16 h-16 rounded-full object-cover border-2 border-slate-600"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center border-2 border-slate-600">
                <User className="w-8 h-8 text-slate-400" />
              </div>
            )}
            <div>
              <p className="text-white font-semibold text-lg">
                {user?.display_name ?? '—'}
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {user?.has_custom_claude_key && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                    <CheckCircle className="w-3 h-3" />
                    Claude key active
                  </span>
                )}
                {user?.has_custom_gemini_key && (
                  <span className="inline-flex items-center gap-1 text-xs text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">
                    <CheckCircle className="w-3 h-3" />
                    Gemini key active
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Garage61 connection card */}
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            {user?.has_garage61 ? (
              <Link2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <Link2Off className="w-4 h-4 text-slate-500" />
            )}
            <h2 className="text-white font-medium">Garage61 Connection</h2>
          </div>

          {garage61JustConnected && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-400/10 border border-emerald-400/20 rounded-lg p-3 mb-3">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>Garage61 account connected successfully.</span>
            </div>
          )}

          {user?.has_garage61 ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-slate-400 text-sm">
                Your Garage61 account is connected. You can browse and analyse your laps.
              </p>
              <button
                onClick={connectGarage61}
                className="btn-secondary flex-shrink-0 flex items-center gap-2"
              >
                <Link2 className="w-4 h-4" />
                Reconnect
              </button>
            </div>
          ) : (
            <>
              <p className="text-slate-500 text-sm mb-4">
                Connect your Garage61 account to browse laps and run telemetry analysis.
              </p>
              <button
                onClick={connectGarage61}
                className="btn-primary flex items-center gap-2"
              >
                <Link2 className="w-4 h-4" />
                Connect Garage61
              </button>
            </>
          )}
        </div>

        {/* Claude API Key card */}
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <Key className="w-4 h-4 text-amber-500" />
            <h2 className="text-white font-medium">Claude API Key</h2>
          </div>
          <p className="text-slate-500 text-sm mb-4">
            Optionally provide your own Anthropic Claude API key to use for AI analysis.
            Leave empty to use the shared API key.
          </p>

          <div className="space-y-3">
            <div>
              <label htmlFor="claude-key" className="block text-xs text-slate-400 mb-1.5">
                API Key
              </label>
              <input
                id="claude-key"
                type="password"
                className="input font-mono text-sm"
                placeholder="sk-ant-..."
                value={claudeKey}
                onChange={(e) => setClaudeKey(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            {claudeMutation.isError && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>Failed to save API key. Please try again.</span>
              </div>
            )}
            {claudeSaveSuccess && (
              <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-400/10 border border-emerald-400/20 rounded-lg p-3">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>Claude API key saved successfully.</span>
              </div>
            )}

            <button
              onClick={() => claudeMutation.mutate()}
              disabled={claudeMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {claudeMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Claude Key</span>
                </>
              )}
            </button>
          </div>

          <div className="mt-4 p-3 bg-slate-700/50 rounded-lg border border-slate-600/50">
            <p className="text-slate-400 text-xs leading-relaxed">
              <strong className="text-slate-300">Note:</strong> Your API key is stored
              securely on the server and used only for generating analysis reports.
              Get a key at{' '}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noreferrer"
                className="text-amber-500 hover:text-amber-400"
              >
                console.anthropic.com
              </a>
              .
            </p>
          </div>
        </div>

        {/* Gemini API Key card */}
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <Key className="w-4 h-4 text-blue-400" />
            <h2 className="text-white font-medium">Gemini API Key</h2>
          </div>
          <p className="text-slate-500 text-sm mb-4">
            Optionally provide your own Google AI (Gemini) API key to use Gemini for analysis.
            Leave empty to use the shared API key.
          </p>

          <div className="space-y-3">
            <div>
              <label htmlFor="gemini-key" className="block text-xs text-slate-400 mb-1.5">
                API Key
              </label>
              <input
                id="gemini-key"
                type="password"
                className="input font-mono text-sm"
                placeholder="AIza..."
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            {geminiMutation.isError && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>Failed to save API key. Please try again.</span>
              </div>
            )}
            {geminiSaveSuccess && (
              <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-400/10 border border-emerald-400/20 rounded-lg p-3">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>Gemini API key saved successfully.</span>
              </div>
            )}

            <button
              onClick={() => geminiMutation.mutate()}
              disabled={geminiMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors text-sm"
            >
              {geminiMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Gemini Key</span>
                </>
              )}
            </button>
          </div>

          <div className="mt-4 p-3 bg-slate-700/50 rounded-lg border border-slate-600/50">
            <p className="text-slate-400 text-xs leading-relaxed">
              <strong className="text-slate-300">Note:</strong> Your API key is stored
              securely on the server and used only for generating analysis reports.
              Get a key at{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:text-blue-300"
              >
                aistudio.google.com
              </a>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
