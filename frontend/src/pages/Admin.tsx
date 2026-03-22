import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, Users, Settings, ChevronLeft, Check, X, RefreshCw, Plus, Save, AlertTriangle, Activity, BarChart2, ChevronRight, Loader2, FileText, Trash2, Star } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import {
  adminListUsers,
  adminSetSuspended,
  adminSetRole,
  adminCreateUser,
  adminGetConfig,
  adminSaveConfig,
  adminListPrompts,
  adminGetPrompt,
  adminGetPromptDefaults,
  adminSetPromptDefaults,
  adminCreatePrompt,
  adminSavePrompt,
  adminDeletePrompt,
  adminGetWorkerStatus,
  adminSetWorkerPoolSize,
  adminListReports,
  adminFailReport,
  adminGetDbHealth,
  regenerateAnalysis,
} from '../api/client'
import type { AdminUser, AdminReport, PromptMeta, PromptsDefaults } from '../types'

type Section = 'users' | 'config' | 'prompt' | 'workers' | 'reports'

export default function AdminPage() {
  const [section, setSection] = useState<Section>('users')

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center gap-4">
        <Link to="/app" className="text-slate-400 hover:text-white transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <Shield className="w-5 h-5 text-amber-500" />
        <h1 className="text-lg font-semibold">Admin Panel</h1>
      </header>

      <div className="flex h-[calc(100vh-65px)]">
        {/* Sidebar */}
        <nav className="w-52 border-r border-slate-800 p-4 flex flex-col gap-1">
          <button
            onClick={() => setSection('users')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left ${
              section === 'users'
                ? 'bg-amber-500/10 text-amber-500'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            User Management
          </button>
          <button
            onClick={() => setSection('config')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left ${
              section === 'config'
                ? 'bg-amber-500/10 text-amber-500'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Settings className="w-4 h-4" />
            Server Config
          </button>
          <button
            onClick={() => setSection('prompt')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left ${
              section === 'prompt'
                ? 'bg-amber-500/10 text-amber-500'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <FileText className="w-4 h-4" />
            System Prompt
          </button>
          <button
            onClick={() => setSection('workers')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left ${
              section === 'workers'
                ? 'bg-amber-500/10 text-amber-500'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Activity className="w-4 h-4" />
            Worker Monitor
          </button>
          <button
            onClick={() => setSection('reports')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left ${
              section === 'reports'
                ? 'bg-amber-500/10 text-amber-500'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            All Reports
          </button>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">
          {section === 'users' && <UserManagement />}
          {section === 'config' && <ConfigEditor />}
          {section === 'prompt' && <PromptsManager />}
          {section === 'workers' && <WorkerMonitor />}
          {section === 'reports' && <ReportsView />}
        </main>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// User Management section
// ---------------------------------------------------------------------------

function UserManagement() {
  const [showCreate, setShowCreate] = useState(false)
  const qc = useQueryClient()

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: adminListUsers,
  })

  const suspendMutation = useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      adminSetSuspended(id, suspended),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'admin' | 'user' }) =>
      adminSetRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">User Management</h2>
          <p className="text-slate-400 text-sm mt-1">{users?.length ?? 0} accounts</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-medium rounded-xl text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          New User
        </button>
      </div>

      {showCreate && (
        <CreateUserForm
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['admin', 'users'] })
            setShowCreate(false)
          }}
        />
      )}

      <div className="space-y-2">
        {users?.map(user => (
          <UserRow
            key={user.id}
            user={user}
            onSuspend={(suspended) => suspendMutation.mutate({ id: user.id, suspended })}
            onRoleChange={(role) => roleMutation.mutate({ id: user.id, role })}
          />
        ))}
      </div>
    </div>
  )
}

function UserRow({
  user,
  onSuspend,
  onRoleChange,
}: {
  user: AdminUser
  onSuspend: (suspended: boolean) => void
  onRoleChange: (role: 'admin' | 'user') => void
}) {
  const authMethods: string[] = []
  if (user.username) authMethods.push('local')
  if (user.garage61_user_id) authMethods.push('garage61')
  if (user.discord_user_id) authMethods.push('discord')

  return (
    <div className={`bg-slate-800 border rounded-xl px-4 py-3 flex items-center gap-4 ${
      user.is_suspended ? 'border-red-500/30 opacity-70' : 'border-slate-700'
    }`}>
      {/* Avatar placeholder */}
      <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-slate-300">
        {user.display_name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{user.display_name}</span>
          {user.username && (
            <span className="text-slate-500 text-xs">@{user.username}</span>
          )}
          {user.is_suspended && (
            <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">suspended</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {user.email && <span className="text-slate-400 text-xs">{user.email}</span>}
          <span className="text-slate-600 text-xs">{authMethods.join(', ')}</span>
          <span className="text-slate-600 text-xs">·</span>
          <span className="text-slate-600 text-xs">
            last seen {new Date(user.last_login_at).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Role selector */}
      <select
        value={user.role}
        onChange={e => onRoleChange(e.target.value as 'admin' | 'user')}
        className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-500"
      >
        <option value="user">user</option>
        <option value="admin">admin</option>
      </select>

      {/* Suspend toggle */}
      <button
        onClick={() => onSuspend(!user.is_suspended)}
        title={user.is_suspended ? 'Unsuspend account' : 'Suspend account'}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          user.is_suspended
            ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
            : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
        }`}
      >
        {user.is_suspended ? (
          <><Check className="w-3 h-3" /> Reinstate</>
        ) : (
          <><X className="w-3 h-3" /> Suspend</>
        )}
      </button>
    </div>
  )
}

function CreateUserForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    username: '',
    password: '',
    display_name: '',
    email: '',
    role: 'user' as 'admin' | 'user',
  })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => adminCreateUser(form),
    onSuccess: onCreated,
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Failed to create user')
    },
  })

  return (
    <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-5 mb-4">
      <h3 className="font-semibold mb-4">Create New User</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Username *</label>
          <input
            value={form.username}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
            placeholder="jdoe"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Display Name *</label>
          <input
            value={form.display_name}
            onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
            placeholder="John Doe"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Password *</label>
          <input
            type="password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
            placeholder="••••••••"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
            placeholder="john@example.com"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Role</label>
          <select
            value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value as 'admin' | 'user' }))}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2 mt-4">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !form.username || !form.password || !form.display_name}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-medium rounded-lg text-sm transition-colors"
        >
          {mutation.isPending ? 'Creating...' : 'Create User'}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Config Editor section
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Worker Monitor section
// ---------------------------------------------------------------------------

function WorkerMonitor() {
  const navigate = useNavigate()
  const [poolSizeInput, setPoolSizeInput] = useState<string>('')
  const [resizeMsg, setResizeMsg] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: status, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['admin', 'worker', 'status'],
    queryFn: adminGetWorkerStatus,
    refetchInterval: 3000,
  })

  const { data: dbHealth, dataUpdatedAt: dbUpdatedAt, refetch: refetchDb, isFetching: dbFetching } = useQuery({
    queryKey: ['admin', 'db', 'health'],
    queryFn: adminGetDbHealth,
    refetchInterval: 15000,
  })

  useEffect(() => {
    if (status && poolSizeInput === '') {
      setPoolSizeInput(String(status.pool_size))
    }
  }, [status])

  const resizeMutation = useMutation({
    mutationFn: (size: number) => adminSetWorkerPoolSize(size),
    onSuccess: (_data, size) => {
      setResizeMsg(`Pool resized to ${size}`)
      setTimeout(() => setResizeMsg(null), 3000)
      qc.invalidateQueries({ queryKey: ['admin', 'worker', 'status'] })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setResizeMsg(typeof detail === 'string' ? detail : 'Resize failed')
      setTimeout(() => setResizeMsg(null), 4000)
    },
  })

  const handleResize = () => {
    const n = parseInt(poolSizeInput, 10)
    if (!isNaN(n) && n >= 1 && n <= 20) resizeMutation.mutate(n)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    )
  }

  const queueDepth = status?.queue_depth ?? 0
  const activeWorkers = status?.active_workers ?? 0
  const poolSize = status?.pool_size ?? 0
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Worker Monitor</h2>
          <p className="text-slate-400 text-sm mt-1">Auto-refreshes every 3s · last update {lastUpdated}</p>
        </div>
      </div>

      {/* DB health card */}
      {dbHealth && (
        <div className={`rounded-xl border p-4 mb-6 ${dbHealth.ok ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/30'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${dbHealth.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className="text-sm font-semibold">Database</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${dbHealth.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                {dbHealth.ok ? 'Healthy' : 'Unhealthy'}
              </span>
              <span className="text-xs text-slate-500">{dbHealth.latency_ms} ms</span>
            </div>
            <button
              onClick={() => refetchDb()}
              disabled={dbFetching}
              className="text-slate-500 hover:text-slate-300 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${dbFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {dbHealth.error && (
            <p className="text-xs text-red-300 font-mono bg-red-500/10 rounded px-2 py-1 mb-3">{dbHealth.error}</p>
          )}
          {dbHealth.ok && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-slate-400">
              <span>Users: <span className="text-slate-200 font-medium">{dbHealth.total_users}</span></span>
              <span>Analyses total: <span className="text-slate-200 font-medium">{dbHealth.total_analyses}</span></span>
              {dbHealth.analyses_by_status && Object.entries(dbHealth.analyses_by_status).map(([s, n]) => (
                <span key={s}>{s.charAt(0).toUpperCase() + s.slice(1)}: <span className="text-slate-200 font-medium">{n}</span></span>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-600 mt-2">
            Last checked {dbUpdatedAt ? new Date(dbUpdatedAt).toLocaleTimeString() : '—'} · auto-refreshes every 15s
          </p>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Pool size</p>
          <p className="text-2xl font-bold text-white">{poolSize}</p>
          <p className="text-slate-500 text-xs mt-1">configured workers</p>
        </div>
        <div className={`bg-slate-800 border rounded-xl p-4 ${activeWorkers > 0 ? 'border-amber-500/40' : 'border-slate-700'}`}>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Active jobs</p>
          <p className={`text-2xl font-bold ${activeWorkers > 0 ? 'text-amber-400' : 'text-white'}`}>{activeWorkers}</p>
          <p className="text-slate-500 text-xs mt-1">currently running</p>
        </div>
        <div className={`bg-slate-800 border rounded-xl p-4 ${queueDepth > 0 ? 'border-blue-500/40' : 'border-slate-700'}`}>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Queue depth</p>
          <p className={`text-2xl font-bold ${queueDepth > 0 ? 'text-blue-400' : 'text-white'}`}>{queueDepth}</p>
          <p className="text-slate-500 text-xs mt-1">waiting to run</p>
        </div>
      </div>

      {/* Pool size control */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-6">
        <h3 className="text-sm font-semibold mb-3">Resize Pool</h3>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={20}
            value={poolSizeInput}
            onChange={e => setPoolSizeInput(e.target.value)}
            className="w-24 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={handleResize}
            disabled={resizeMutation.isPending}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-medium rounded-lg text-sm transition-colors"
          >
            {resizeMutation.isPending ? 'Applying…' : 'Apply'}
          </button>
          {resizeMsg && (
            <span className={`text-sm ${resizeMsg.includes('failed') || resizeMsg.includes('Failed') ? 'text-red-400' : 'text-emerald-400'}`}>
              {resizeMsg}
            </span>
          )}
        </div>
        <p className="text-slate-500 text-xs mt-2">Changes take effect immediately (1–20 workers). Set in .env as <code className="text-amber-400">ANALYSIS_QUEUE_SIZE</code> to persist across restarts.</p>
      </div>

      {/* Running tasks */}
      <div>
        <h3 className="text-sm font-semibold mb-3">
          Running Tasks
          {(status?.tasks?.length ?? 0) === 0 && (
            <span className="ml-2 text-slate-500 font-normal">— idle</span>
          )}
        </h3>
        {(status?.tasks?.length ?? 0) > 0 ? (
          <div className="space-y-2">
            {status!.tasks.map(task => {
              const pct = Math.min(100, (task.elapsed_seconds / task.timeout_seconds) * 100)
              const nearTimeout = task.elapsed_seconds > task.timeout_seconds * 0.75
              const started = new Date(task.started_at).toLocaleTimeString()
              return (
                <div
                  key={task.job_id}
                  className={`bg-slate-800 border rounded-xl p-4 ${nearTimeout ? 'border-red-500/40' : 'border-slate-700'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs text-slate-400">{task.job_id}</span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => navigate(`/report/${task.job_id}`)}
                        className="text-xs text-amber-400/70 hover:text-amber-400 transition-colors flex items-center gap-1"
                      >
                        <ChevronRight className="w-3 h-3" />View
                      </button>
                      <span className={`text-xs font-medium ${nearTimeout ? 'text-red-400' : 'text-amber-400'}`}>
                        {task.elapsed_seconds}s / {task.timeout_seconds}s
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 mb-2">Started {started}</div>
                  {/* Progress bar */}
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${nearTimeout ? 'bg-red-500' : 'bg-amber-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {nearTimeout && (
                    <p className="text-red-400 text-xs mt-1.5 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Approaching timeout — will be killed at {task.timeout_seconds}s
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 text-center text-slate-500 text-sm">
            No jobs currently running
          </div>
        )}
      </div>
    </div>
  )
}


function ConfigEditor() {
  const [content, setContent] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { isLoading, data: configData } = useQuery({
    queryKey: ['admin', 'config'],
    queryFn: adminGetConfig,
  })

  useEffect(() => {
    if (configData !== undefined && content === null) {
      setContent(configData)
    }
  }, [configData])

  const saveMutation = useMutation({
    mutationFn: () => adminSaveConfig(content ?? ''),
    onSuccess: () => {
      setSaved(true)
      setSaveError(null)
      setTimeout(() => setSaved(false), 3000)
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setSaveError(typeof detail === 'string' ? detail : 'Save failed')
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">Server Config</h2>
          <p className="text-slate-400 text-sm mt-1">Editing <code className="text-amber-400">.env</code> — sensitive values shown as <code className="text-slate-500">***</code> and preserved on save. Restart the backend for changes to take effect.</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
              <Check className="w-4 h-4" /> Saved
            </span>
          )}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || content === null}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-medium rounded-xl text-sm transition-colors"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-amber-300 text-sm">
          Changes are written directly to disk. The backend must be restarted to pick up changes.
          To update a sensitive value, replace <code className="text-slate-400">***</code> with the new value before saving.
        </p>
      </div>

      {saveError && (
        <p className="mb-3 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {saveError}
        </p>
      )}

      <textarea
        value={content ?? ''}
        onChange={e => setContent(e.target.value)}
        spellCheck={false}
        className="flex-1 w-full font-mono text-sm bg-slate-950 border border-slate-700 rounded-xl p-4 text-slate-300 focus:outline-none focus:border-amber-500 resize-none leading-relaxed"
        placeholder="Loading..."
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Prompts manager
// ---------------------------------------------------------------------------

function PromptEditor({ name, onClose }: { name: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { isLoading, data } = useQuery({
    queryKey: ['admin', 'prompt', name],
    queryFn: () => adminGetPrompt(name),
  })

  useEffect(() => {
    if (data !== undefined && content === null) setContent(data)
  }, [data])

  const saveMutation = useMutation({
    mutationFn: () => adminSavePrompt(name, content ?? ''),
    onSuccess: () => {
      setSaved(true)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'prompts'] })
      setTimeout(() => setSaved(false), 3000)
    },
    onError: (err: any) => {
      setError(err?.response?.data?.detail ?? 'Save failed')
    },
  })

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-semibold">Editing: <span className="text-amber-400">{name}</span></h2>
          </div>
          <p className="text-slate-400 text-sm mt-1 ml-7">Changes take effect on the next analysis run.</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="flex items-center gap-1.5 text-emerald-400 text-sm"><Check className="w-4 h-4" /> Saved</span>}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || content === null || isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-medium rounded-xl text-sm transition-colors"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="mb-3 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}
      {isLoading ? (
        <div className="flex items-center justify-center h-48"><RefreshCw className="w-6 h-6 animate-spin text-slate-500" /></div>
      ) : (
        <textarea
          value={content ?? ''}
          onChange={e => setContent(e.target.value)}
          spellCheck={false}
          className="flex-1 w-full font-mono text-sm bg-slate-950 border border-slate-700 rounded-xl p-4 text-slate-300 focus:outline-none focus:border-amber-500 resize-none leading-relaxed"
        />
      )}
    </div>
  )
}

function PromptsManager() {
  const queryClient = useQueryClient()
  const [editingName, setEditingName] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const [defaultsError, setDefaultsError] = useState<string | null>(null)

  const { data: prompts = [], isLoading } = useQuery<PromptMeta[]>({
    queryKey: ['admin', 'prompts'],
    queryFn: adminListPrompts,
  })

  const { data: defaults } = useQuery<PromptsDefaults>({
    queryKey: ['admin', 'prompts-defaults'],
    queryFn: adminGetPromptDefaults,
  })

  const [localDefaults, setLocalDefaults] = useState<PromptsDefaults | null>(null)
  useEffect(() => {
    if (defaults && !localDefaults) setLocalDefaults(defaults)
  }, [defaults])

  const setDefaultsMutation = useMutation({
    mutationFn: () => adminSetPromptDefaults(localDefaults!),
    onSuccess: () => {
      setDefaultsSaved(true)
      setDefaultsError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'prompts'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'prompts-defaults'] })
      setTimeout(() => setDefaultsSaved(false), 3000)
    },
    onError: (err: any) => setDefaultsError(err?.response?.data?.detail ?? 'Save failed'),
  })

  const createMutation = useMutation({
    mutationFn: () => adminCreatePrompt(newName, newContent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'prompts'] })
      setCreating(false)
      setNewName('')
      setNewContent('')
      setCreateError(null)
    },
    onError: (err: any) => setCreateError(err?.response?.data?.detail ?? 'Create failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (name: string) => adminDeletePrompt(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'prompts'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'prompts-defaults'] })
      setDeleteError(null)
    },
    onError: (err: any) => setDeleteError(err?.response?.data?.detail ?? 'Delete failed'),
  })

  if (editingName) {
    return <PromptEditor name={editingName} onClose={() => setEditingName(null)} />
  }

  const promptNames = prompts.map(p => p.name)

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">System Prompts</h2>
          <p className="text-slate-400 text-sm mt-1">Manage named prompt versions. Set the default per model below.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-medium rounded-xl text-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> New Prompt
        </button>
      </div>

      {/* Defaults */}
      {localDefaults && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-slate-300">Default per model</h3>
          <div className="flex flex-wrap gap-4">
            {(['claude', 'gemini'] as const).map(model => (
              <label key={model} className="flex items-center gap-2 text-sm">
                <span className="text-slate-400 w-16">{model}</span>
                <select
                  value={localDefaults[model]}
                  onChange={e => setLocalDefaults({ ...localDefaults, [model]: e.target.value })}
                  className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-slate-200 text-sm focus:outline-none focus:border-amber-500"
                >
                  {promptNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            ))}
            <button
              onClick={() => setDefaultsMutation.mutate()}
              disabled={setDefaultsMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              {defaultsSaved ? 'Saved!' : 'Save defaults'}
            </button>
          </div>
          {defaultsError && <p className="text-red-400 text-xs">{defaultsError}</p>}
        </div>
      )}

      {deleteError && <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{deleteError}</p>}

      {/* Prompt list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-24"><RefreshCw className="w-5 h-5 animate-spin text-slate-500" /></div>
      ) : (
        <div className="space-y-2">
          {prompts.map(p => (
            <div key={p.name} className="flex items-center gap-3 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3">
              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="font-mono text-sm text-amber-400 flex-1">{p.name}</span>
              {p.default_for.length > 0 && (
                <div className="flex gap-1">
                  {p.default_for.map(m => (
                    <span key={m} className="flex items-center gap-1 text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full px-2 py-0.5">
                      <Star className="w-2.5 h-2.5" />{m}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-slate-500 text-xs max-w-xs truncate hidden md:block">{p.content.slice(0, 80)}</p>
              <button
                onClick={() => setEditingName(p.name)}
                className="text-xs px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors shrink-0"
              >Edit</button>
              <button
                onClick={() => deleteMutation.mutate(p.name)}
                disabled={deleteMutation.isPending}
                className="text-xs px-2 py-1 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors shrink-0"
              ><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Create new prompt */}
      {creating && (
        <div className="bg-slate-800/50 border border-amber-500/30 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-amber-300">New prompt version</h3>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            placeholder="name (lowercase, dashes ok)"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-amber-500"
          />
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder="Prompt content…"
            rows={10}
            spellCheck={false}
            className="w-full font-mono text-sm bg-slate-950 border border-slate-700 rounded-xl p-3 text-slate-300 focus:outline-none focus:border-amber-500 resize-none"
          />
          {createError && <p className="text-red-400 text-xs">{createError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !newName || !newContent}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-medium rounded-xl text-sm transition-colors"
            >
              <Save className="w-4 h-4" />{createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => { setCreating(false); setCreateError(null) }} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reports section
// ---------------------------------------------------------------------------

const PAGE_SIZE = 10

function useElapsed(since: string, active: boolean) {
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - new Date(since).getTime()) / 1000)
  )
  useEffect(() => {
    if (!active) return
    setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000))
    const id = setInterval(() =>
      setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000)), 1000
    )
    return () => clearInterval(id)
  }, [active, since])
  return elapsed
}

function ReportRow({ r }: { r: AdminReport }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const isSolo = r.analysis_mode === 'solo'
  const model = r.model_name ?? r.llm_provider
  const isFailed = r.status === 'failed'
  const isProcessing = r.status === 'processing'
  const elapsed = useElapsed(r.enqueued_at ?? r.created_at, isProcessing)

  const isOngoing = r.status === 'enqueued' || r.status === 'processing'

  const rerunMutation = useMutation({
    mutationFn: () => regenerateAnalysis(r.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reports'] }),
  })

  const failMutation = useMutation({
    mutationFn: () => adminFailReport(r.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reports'] }),
  })

  return (
    <div className="space-y-0">
      <div className={`card ${isFailed ? 'border-red-500/20' : ''} p-0 overflow-hidden`}>
        <button
          onClick={() => isFailed ? setExpanded(v => !v) : isOngoing ? undefined : navigate(`/report/${r.id}`)}
          className={`w-full text-left transition-colors group px-4 py-3 ${isOngoing ? 'cursor-default' : 'hover:bg-slate-700'}`}
        >
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                  isSolo ? 'bg-violet-500/15 text-violet-400' : 'bg-orange-500/15 text-orange-400'
                }`}>
                  {isSolo ? 'Session' : 'Reference'}
                </span>
                {r.status === 'enqueued' && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-slate-600/40 text-slate-400 flex-shrink-0">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />In queue
                  </span>
                )}
                {isProcessing && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400 flex-shrink-0">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />Processing · {elapsed}s
                  </span>
                )}
                {isFailed && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400 flex-shrink-0">
                    Failed
                  </span>
                )}
                <span className="text-amber-400 font-semibold text-sm truncate">{r.car_name}</span>
                <span className="text-slate-500 text-xs">@</span>
                <span className="text-slate-300 text-sm truncate">{r.track_name}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap text-xs text-slate-500 mt-1">
                <span className="text-sky-400/80 font-medium">{r.username ?? r.display_name}</span>
                <span className="text-slate-600">·</span>
                <span className="font-mono text-slate-600">{r.id.slice(0, 8)}</span>
                <span className="text-slate-600">·</span>
                <span>{new Date(r.created_at).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                {model && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="font-mono text-amber-400/70 bg-amber-400/10 px-1.5 py-0.5 rounded">{model}</span>
                  </>
                )}
              </div>
            </div>
            {isFailed && (
              <span className="text-xs text-slate-500 flex-shrink-0">{expanded ? '▲' : '▼'}</span>
            )}
            {isOngoing && (
              <button
                onClick={(e) => { e.stopPropagation(); failMutation.mutate() }}
                disabled={failMutation.isPending}
                className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
              >
                {failMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Fail
              </button>
            )}
            {!isFailed && !isOngoing && (
              <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-amber-500 flex-shrink-0 transition-colors" />
            )}
          </div>
        </button>
        {isFailed && expanded && (
          <div className="border-t border-red-500/20 bg-red-950/20 px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-red-400 font-semibold">Error log</p>
              <button
                onClick={(e) => { e.stopPropagation(); rerunMutation.mutate() }}
                disabled={rerunMutation.isPending}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${rerunMutation.isPending ? 'animate-spin' : ''}`} />
                {rerunMutation.isPending ? 'Re-running…' : 'Re-run'}
              </button>
            </div>
            {r.error_message
              ? <pre className="text-xs text-red-300/80 font-mono whitespace-pre-wrap break-all leading-relaxed max-h-64 overflow-y-auto">{r.error_message}</pre>
              : <p className="text-xs text-slate-500 italic">No error details recorded.</p>
            }
          </div>
        )}
      </div>
    </div>
  )
}

const STATUS_TABS = ['completed', 'enqueued', 'processing', 'failed'] as const
type ReportTab = typeof STATUS_TABS[number]

const TAB_LABELS: Record<ReportTab, string> = {
  completed: 'Completed',
  enqueued: 'Enqueued',
  processing: 'Processing',
  failed: 'Failed',
}

function ReportsView() {
  const [tab, setTab] = useState<ReportTab>('completed')
  const [page, setPage] = useState(0)
  const [userFilter, setUserFilter] = useState('')

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: adminListReports,
    refetchInterval: 10000,
  })

  const filtered = userFilter.trim()
    ? reports.filter((r: AdminReport) =>
        (r.username ?? r.display_name).toLowerCase().includes(userFilter.trim().toLowerCase())
      )
    : reports
  const allReports = filtered.filter((r: AdminReport) => r.status === tab)
  const totalPages = Math.ceil(allReports.length / PAGE_SIZE)
  const paged = allReports.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const countByStatus = (s: ReportTab) => filtered.filter((r: AdminReport) => r.status === s).length

  // Reset page when switching tabs or filter changes
  const handleTab = (t: ReportTab) => { setTab(t); setPage(0) }
  const handleUserFilter = (v: string) => { setUserFilter(v); setPage(0) }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-4">
        <div>
          <h2 className="text-xl font-semibold">All Reports</h2>
          <p className="text-slate-400 text-sm mt-1">{filtered.length}{filtered.length !== reports.length ? ` of ${reports.length}` : ''} total (newest first)</p>
        </div>
        <input
          type="text"
          value={userFilter}
          onChange={e => handleUserFilter(e.target.value)}
          placeholder="Filter by username…"
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-amber-500 w-52"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-800">
        {STATUS_TABS.map((t) => {
          const count = countByStatus(t)
          const isActive = tab === t
          const isRed = t === 'failed'
          return (
            <button
              key={t}
              onClick={() => handleTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
                isActive
                  ? isRed ? 'border-red-500 text-red-400' : 'border-amber-500 text-amber-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {TAB_LABELS[t]}
              {count > 0 && (
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-xs ${
                  isRed ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                }`}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {allReports.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          No {TAB_LABELS[tab].toLowerCase()} reports.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {paged.map((r: AdminReport) => <ReportRow key={r.id} r={r} />)}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-slate-500">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
