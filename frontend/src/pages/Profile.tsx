import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Save, Key, User, CheckCircle, AlertCircle, Link2, Link2Off } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { updateClaudeKey, updateGeminiKey, updateOpenAiKey, connectGarage61 } from '../api/client'
import type { LlmProviderAccess } from '../types'

function providerStatusSummary(access?: LlmProviderAccess) {
  if (!access) {
    return { label: 'Unknown', tone: 'text-slate-300 bg-slate-500/10 border-slate-500/20', detail: 'Provider status is unavailable right now.' }
  }
  if (access.has_custom_key) {
    return { label: 'Configured', tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', detail: `Your personal ${access.label} API key is configured.` }
  }
  if (access.has_shared_key && access.can_generate) {
    return {
      label: 'Shared Access',
      tone: 'text-amber-200 bg-amber-500/10 border-amber-500/20',
      detail: `You can use the shared free ${access.label} quota for now. Add your own key to avoid quota limits.`,
    }
  }
  if (access.has_shared_key && access.disabled_reason === 'shared_quota_exhausted') {
    return {
      label: 'Quota Reached',
      tone: 'text-red-300 bg-red-500/10 border-red-500/20',
      detail: `The shared free ${access.label} quota was used up in the last 24 hours. Add your own key or wait for quota to refresh.`,
    }
  }
  return { label: 'Required', tone: 'text-red-300 bg-red-500/10 border-red-500/20', detail: `${access.label} requires your personal API key before you can use it.` }
}

export default function ProfilePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [claudeKey, setClaudeKey] = useState('')
  const [claudeSaveSuccess, setClaudeSaveSuccess] = useState(false)
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiSaveSuccess, setGeminiSaveSuccess] = useState(false)
  const [openAiKey, setOpenAiKey] = useState('')
  const [openAiSaveSuccess, setOpenAiSaveSuccess] = useState(false)
  const garage61JustConnected = searchParams.get('garage61') === 'connected'
  const claudeAccess = user?.llm_access?.providers?.claude
  const geminiAccess = user?.llm_access?.providers?.gemini
  const openAiAccess = user?.llm_access?.providers?.openai
  const claudeStatus = providerStatusSummary(claudeAccess)
  const geminiStatus = providerStatusSummary(geminiAccess)
  const openAiStatus = providerStatusSummary(openAiAccess)
  const hasAnyAvailableProvider = Boolean(
    user?.llm_access?.providers?.claude?.can_generate
    || user?.llm_access?.providers?.gemini?.can_generate
    || user?.llm_access?.providers?.openai?.can_generate,
  )
  const hasSharedFallback = Boolean(
    (!user?.has_custom_claude_key && user?.llm_access?.providers?.claude?.has_shared_key) ||
    (!user?.has_custom_gemini_key && user?.llm_access?.providers?.gemini?.has_shared_key) ||
    (!user?.has_custom_openai_key && user?.llm_access?.providers?.openai?.has_shared_key),
  )

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

  const openAiMutation = useMutation({
    mutationFn: () => updateOpenAiKey(openAiKey),
    onSuccess: () => {
      setOpenAiSaveSuccess(true)
      setTimeout(() => setOpenAiSaveSuccess(false), 3000)
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
            LLM Access
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-white font-medium">Claude</p>
                  <p className="text-slate-400 text-sm mt-1">{claudeStatus.detail}</p>
                </div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${claudeStatus.tone}`}>
                  {claudeStatus.label}
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-white font-medium">Gemini</p>
                  <p className="text-slate-400 text-sm mt-1">{geminiStatus.detail}</p>
                </div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${geminiStatus.tone}`}>
                  {geminiStatus.label}
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-white font-medium">OpenAI</p>
                  <p className="text-slate-400 text-sm mt-1">{openAiStatus.detail}</p>
                </div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${openAiStatus.tone}`}>
                  {openAiStatus.label}
                </span>
              </div>
            </div>
          </div>
        </div>

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
                {user?.has_custom_openai_key && (
                  <span className="inline-flex items-center gap-1 text-xs text-cyan-300 bg-cyan-400/10 px-2 py-0.5 rounded-full">
                    <CheckCircle className="w-3 h-3" />
                    OpenAI key active
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {user && !hasAnyAvailableProvider && (
          <div className="flex items-start gap-3 text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Report generation is unavailable right now. Add your personal Claude, Gemini, or OpenAI API key below, or wait for the shared free-report quota to refresh.
            </span>
          </div>
        )}
        {user && !user.has_custom_claude_key && !user.has_custom_gemini_key && !user.has_custom_openai_key && hasSharedFallback && hasAnyAvailableProvider && (
          <div className="flex items-start gap-3 text-amber-200 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Personal LLM API keys are not configured. You can still use the shared free-report quota for the last 24 hours, or add your own key below for uninterrupted access.
            </span>
          </div>
        )}

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
            Provide your Anthropic Claude API key to enable Claude-powered analysis for your account.
          </p>
          {claudeAccess && (
            <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              claudeAccess.can_generate
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/20 bg-red-500/10 text-red-300'
            }`}>
              <div className="font-medium mb-1">Claude status: {claudeStatus.label}</div>
              <div>
                {claudeAccess.has_custom_key
                  ? 'Your personal Claude API key is configured and will be used for reports.'
                  : claudeAccess.has_shared_key
                    ? claudeAccess.can_generate
                      ? `Claude can use the shared free-report quota. ${claudeAccess.shared_reports_remaining_today} shared report${claudeAccess.shared_reports_remaining_today === 1 ? '' : 's'} remaining in the last 24 hours.`
                      : 'Claude shared free-report quota is exhausted for the last 24 hours. Add your own Claude API key below to keep generating reports.'
                    : 'Claude is not configured. Add your own Claude API key below to enable it.'}
              </div>
            </div>
          )}

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
            Provide your Google AI Gemini API key to enable Gemini-powered analysis for your account.
          </p>
          {geminiAccess && (
            <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              geminiAccess.can_generate
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/20 bg-red-500/10 text-red-300'
            }`}>
              <div className="font-medium mb-1">Gemini status: {geminiStatus.label}</div>
              <div>
                {geminiAccess.has_custom_key
                  ? 'Your personal Gemini API key is configured and will be used for reports.'
                  : geminiAccess.has_shared_key
                    ? geminiAccess.can_generate
                      ? `Gemini can use the shared free-report quota. ${geminiAccess.shared_reports_remaining_today} shared report${geminiAccess.shared_reports_remaining_today === 1 ? '' : 's'} remaining in the last 24 hours.`
                      : 'Gemini shared free-report quota is exhausted for the last 24 hours. Add your own Gemini API key below to keep generating reports.'
                    : 'Gemini is not configured. Add your own Gemini API key below to enable it.'}
              </div>
            </div>
          )}

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

        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <Key className="w-4 h-4 text-cyan-300" />
            <h2 className="text-white font-medium">OpenAI API Key</h2>
          </div>
          <p className="text-slate-500 text-sm mb-4">
            Provide your OpenAI API key to enable OpenAI-powered analysis for your account.
          </p>
          {openAiAccess && (
            <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              openAiAccess.can_generate
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/20 bg-red-500/10 text-red-300'
            }`}>
              <div className="font-medium mb-1">OpenAI status: {openAiStatus.label}</div>
              <div>
                {openAiAccess.has_custom_key
                  ? 'Your personal OpenAI API key is configured and will be used for reports.'
                  : openAiAccess.has_shared_key
                    ? openAiAccess.can_generate
                      ? `OpenAI can use the shared free-report quota. ${openAiAccess.shared_reports_remaining_today} shared report${openAiAccess.shared_reports_remaining_today === 1 ? '' : 's'} remaining in the last 24 hours.`
                      : 'OpenAI shared free-report quota is exhausted for the last 24 hours. Add your own OpenAI API key below to keep generating reports.'
                    : 'OpenAI is not configured. Add your own OpenAI API key below to enable it.'}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="openai-key" className="block text-xs text-slate-400 mb-1.5">
                API Key
              </label>
              <input
                id="openai-key"
                type="password"
                className="input font-mono text-sm"
                placeholder="sk-..."
                value={openAiKey}
                onChange={(e) => setOpenAiKey(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            {openAiMutation.isError && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>Failed to save API key. Please try again.</span>
              </div>
            )}
            {openAiSaveSuccess && (
              <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-400/10 border border-emerald-400/20 rounded-lg p-3">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>OpenAI API key saved successfully.</span>
              </div>
            )}

            <button
              onClick={() => openAiMutation.mutate()}
              disabled={openAiMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-60 disabled:cursor-not-allowed text-slate-950 font-medium rounded-xl transition-colors text-sm"
            >
              {openAiMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save OpenAI Key</span>
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
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 hover:text-cyan-200"
              >
                platform.openai.com
              </a>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
