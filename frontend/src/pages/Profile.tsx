import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Save, Key, User, CheckCircle, AlertCircle } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { updateClaudeKey } from '../api/client'

export default function ProfilePage() {
  const { user } = useAuth()
  const [apiKey, setApiKey] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  const saveMutation = useMutation({
    mutationFn: () => updateClaudeKey(apiKey),
    onSuccess: () => {
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
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
              <p className="text-slate-500 text-sm">
                Connected via Garage61
              </p>
              {user?.has_custom_claude_key && (
                <span className="inline-flex items-center gap-1 mt-1 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                  <CheckCircle className="w-3 h-3" />
                  Custom API key active
                </span>
              )}
            </div>
          </div>
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
              <label
                htmlFor="claude-key"
                className="block text-xs text-slate-400 mb-1.5"
              >
                API Key
              </label>
              <input
                id="claude-key"
                type="password"
                className="input font-mono text-sm"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            {/* Status messages */}
            {saveMutation.isError && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>Failed to save API key. Please try again.</span>
              </div>
            )}
            {saveSuccess && (
              <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-400/10 border border-emerald-400/20 rounded-lg p-3">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>API key saved successfully.</span>
              </div>
            )}

            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {saveMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save API Key</span>
                </>
              )}
            </button>
          </div>

          <div className="mt-4 p-3 bg-slate-700/50 rounded-lg border border-slate-600/50">
            <p className="text-slate-400 text-xs leading-relaxed">
              <strong className="text-slate-300">Note:</strong> Your API key is stored
              securely on the server and used only for generating analysis reports.
              You can obtain a Claude API key from{' '}
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
      </main>
    </div>
  )
}
