import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity, AlertTriangle, ArrowLeft, BookOpen, CheckCircle,
  Clock, ExternalLink, Loader2, RefreshCw, Shield, Upload,
  Video, XCircle, Save,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  getClientProfile, getClientVideos, putKnowledge, getKnowledge,
  refreshToken, reauthorizeToken,
  type ClientProfile as TClientProfile, type UploadRecord,
} from '../lib/api'
import { useToast } from '../App'

type Tab = 'overview' | 'videos' | 'tokens' | 'knowledge'

// ── Avatar helper ─────────────────────────────────────────────────────────────
const AVATAR_PALETTE = [
  { bg: '#FF2D55', glow: 'rgba(255,45,85,0.3)' },
  { bg: '#5E5CE6', glow: 'rgba(94,92,230,0.3)' },
  { bg: '#30D158', glow: 'rgba(48,209,88,0.3)' },
  { bg: '#FF9F0A', glow: 'rgba(255,159,10,0.3)' },
  { bg: '#0A84FF', glow: 'rgba(10,132,255,0.3)' },
  { bg: '#BF5AF2', glow: 'rgba(191,90,242,0.3)' },
]
function getAvatar(name: string) {
  const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[idx]
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, iconColor }: {
  icon: React.ComponentType<{ className?: string }>
  label: string; value: number | string; iconColor: string
}) {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="mb-3 grid size-9 place-items-center rounded-xl" style={{ background: `${iconColor}18` }}>
        <span style={{ color: iconColor }}>
          <Icon className="size-5" />
        </span>
      </div>
      <div className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{value}</div>
      <div className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  )
}

// ── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({ profile }: { profile: TClientProfile | null }) {
  if (!profile) return <EmptyState text="No profile data" />
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Upload}        label="Total Uploads"  value={profile.uploads?.count ?? 0}       iconColor="var(--info)" />
        <StatCard icon={XCircle}       label="Log Errors"     value={profile.log?.errors ?? 0}           iconColor="var(--error)" />
        <StatCard icon={AlertTriangle} label="Warnings"       value={profile.log?.warnings ?? 0}         iconColor="var(--warning)" />
        <StatCard icon={BookOpen}      label="KB Characters"  value={`${profile.knowledge_chars ?? 0}`}  iconColor="#BF5AF2" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Activity card */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Latest Activity</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{profile.activity?.message ?? '—'}</p>
          {profile.activity?.timestamp && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <Clock className="size-3" />{profile.activity.timestamp}
            </p>
          )}
          {profile.uploads?.latest && (
            <div className="rounded-xl p-3 space-y-1" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Last Upload</p>
              <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {profile.uploads.latest.file_name ?? '—'}
              </p>
              {profile.uploads.latest.youtube_id && (
                <a
                  href={`https://youtube.com/watch?v=${profile.uploads.latest.youtube_id}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-xs font-medium"
                  style={{ color: 'var(--accent-red)' }}
                >
                  <ExternalLink className="size-3" /> Watch on YouTube
                </a>
              )}
            </div>
          )}
        </div>

        {/* Issues card */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Issues</h3>
          {!profile.issues?.length ? (
            <div className="flex items-center gap-2">
              <CheckCircle className="size-4" style={{ color: 'var(--success)' }} />
              <span className="text-sm" style={{ color: 'var(--success)' }}>No active issues</span>
            </div>
          ) : (
            <ul className="space-y-2">
              {profile.issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--warning)' }}>
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {issue}
                </li>
              ))}
            </ul>
          )}

          {/* Last error */}
          {profile.log?.last_error && (
            <div className="rounded-xl px-3 py-2.5 mt-2" style={{ background: 'rgba(255,69,58,0.06)', border: '1px solid rgba(255,69,58,0.2)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--error)' }}>Last Error</p>
              <p className="text-xs break-words" style={{ color: 'var(--text-secondary)' }}>{profile.log.last_error.message}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Videos Tab ────────────────────────────────────────────────────────────────
function VideosTab({ videos }: { videos: UploadRecord[] }) {
  if (!videos.length) return <EmptyState text="No uploads tracked yet" />
  return (
    <>
      {/* Mobile: cards */}
      <div className="space-y-2 md:hidden">
        {[...videos].reverse().map((v) => (
          <div key={v.drive_id} className="rounded-xl p-3.5 space-y-1.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{v.file_name ?? v.drive_id}</p>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                {v.uploaded_at ? new Date(v.uploaded_at).toLocaleString() : '—'}
              </span>
              {v.youtube_id && (
                <a href={`https://youtube.com/watch?v=${v.youtube_id}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--accent-red)' }}>
                  <ExternalLink className="size-3" />{v.youtube_id}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-2xl md:block" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
                {['Filename', 'YouTube ID', 'Uploaded At'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...videos].reverse().map(v => (
                <motion.tr
                  key={v.drive_id}
                  whileHover={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
                  className="transition-all"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <td className="max-w-xs truncate px-5 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>{v.file_name ?? v.drive_id}</td>
                  <td className="px-5 py-3">
                    {v.youtube_id ? (
                      <a href={`https://youtube.com/watch?v=${v.youtube_id}`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 font-mono text-xs" style={{ color: 'var(--accent-red)' }}>
                        {v.youtube_id} <ExternalLink className="size-3" />
                      </a>
                    ) : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                  </td>
                  <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {v.uploaded_at ? new Date(v.uploaded_at).toLocaleString() : '—'}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Tokens Tab ────────────────────────────────────────────────────────────────
const healthStyle = (h?: string): { color: string; bg: string; border: string } => ({
  good:     { color: 'var(--success)', bg: 'rgba(48,209,88,0.1)',  border: 'rgba(48,209,88,0.3)' },
  warning:  { color: 'var(--warning)', bg: 'rgba(255,214,10,0.1)', border: 'rgba(255,214,10,0.3)' },
  critical: { color: 'var(--warning)', bg: 'rgba(255,214,10,0.1)', border: 'rgba(255,214,10,0.3)' },
  expired:  { color: 'var(--error)',   bg: 'rgba(255,69,58,0.1)',  border: 'rgba(255,69,58,0.3)' },
}[h ?? ''] ?? { color: 'var(--text-tertiary)', bg: 'var(--bg-elevated)', border: 'var(--border-default)' })

function TokenCard({ label, info }: { label: string; info?: { status?: string; health?: string; expires_at?: string | null; days_remaining?: number | null } }) {
  const h    = healthStyle(info?.health)
  const days = info?.days_remaining ?? 0
  const pct  = Math.min(100, Math.max(0, (days / 60) * 100))
  return (
    <div className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</p>
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase"
          style={{ background: h.bg, border: `1px solid ${h.border}`, color: h.color }}>
          {info?.health ?? 'unknown'}
        </span>
      </div>
      <div className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <p>Status: <span style={{ color: 'var(--text-primary)' }}>{info?.status ?? '—'}</span></p>
        <p>Expires: <span style={{ color: 'var(--text-primary)' }}>{info?.expires_at ?? 'unknown'}</span></p>
        <p>Days left: <span className="font-bold" style={{ color: days < 7 ? 'var(--error)' : 'var(--text-primary)' }}>{info?.days_remaining ?? '—'}</span></p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-elevated)' }}>
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full" style={{ background: h.color }} />
      </div>
    </div>
  )
}

function TokensTab({ client, profile }: { client: string; profile: TClientProfile | null }) {
  const { show }    = useToast()
  const [busy, setBusy] = useState<'refresh' | 'reauth' | null>(null)
  const th = profile?.token_health

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <TokenCard label="Drive Token"   info={th?.drive_token} />
        <TokenCard label="YouTube Token" info={th?.youtube_token} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <motion.button whileTap={{ scale: 0.96 }} disabled={!!busy}
          onClick={() => { setBusy('refresh'); refreshToken(client).then(d => show(d.message, 'success')).catch(e => show(e.message, 'error')).finally(() => setBusy(null)) }}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
          {busy === 'refresh' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Silent Refresh
        </motion.button>
        <motion.button whileTap={{ scale: 0.96 }} disabled={!!busy}
          onClick={() => { setBusy('reauth'); reauthorizeToken(client).then(d => show(d.message, 'info')).catch(e => show(e.message, 'error')).finally(() => setBusy(null)) }}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--accent-red-dim)', border: '1px solid rgba(255,45,85,0.3)', color: 'var(--accent-red)' }}>
          {busy === 'reauth' ? <Loader2 className="size-4 animate-spin" /> : <Shield className="size-4" />}
          Re-authorize
        </motion.button>
      </div>
    </div>
  )
}

// ── Knowledge Tab ─────────────────────────────────────────────────────────────
function KnowledgeTab({ knowledge, dirty, onChange, onSave }: {
  knowledge: string; dirty: boolean; onChange: (v: string) => void; onSave: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Knowledge Base</h3>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>Context fed to Gemini when generating metadata for this client</p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          disabled={!dirty}
          onClick={onSave}
          className="flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-40"
          style={{ background: 'var(--success)', boxShadow: dirty ? '0 0 16px rgba(48,209,88,0.25)' : 'none' }}
        >
          <Save className="size-4" /> {dirty ? 'Save' : 'Saved'}
        </motion.button>
      </div>
      <textarea
        value={knowledge}
        onChange={e => onChange(e.target.value)}
        rows={16}
        placeholder="Describe the client's property, target audience, location, amenities, contact details, brand voice…"
        className="w-full resize-none rounded-2xl px-5 py-4 text-sm outline-none transition-all"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          lineHeight: 1.7,
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = 'var(--accent-red)'
          e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-red-dim)'
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = 'var(--border-default)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      />
      <p className="text-right text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {knowledge.length.toLocaleString()} characters
      </p>
    </div>
  )
}

// ── Utility ───────────────────────────────────────────────────────────────────
function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-2xl" style={{ border: '1px dashed var(--border-default)', color: 'var(--text-tertiary)' }}>
      {text}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ClientProfile({ client, onBack, onViewLogs }: {
  client: string; onBack: () => void; onViewLogs: (client: string) => void
}) {
  const { show }                         = useToast()
  const [tab, setTab]                    = useState<Tab>('overview')
  const [profile, setProfile]            = useState<TClientProfile | null>(null)
  const [videos, setVideos]              = useState<UploadRecord[]>([])
  const [knowledge, setKb]               = useState('')
  const [kbDirty, setKbDirty]           = useState(false)
  const [loading, setLoading]            = useState(true)
  const avatar                           = getAvatar(client)

  const loadProfile = useCallback(() => {
    if (!client) return
    setLoading(true)
    getClientProfile(client)
      .then(d => setProfile(d.profile ?? null))
      .catch(() => show('Failed to load profile', 'error'))
      .finally(() => setLoading(false))
  }, [client, show])

  useEffect(() => { loadProfile() }, [loadProfile])

  useEffect(() => {
    if (tab === 'videos' && videos.length === 0)
      getClientVideos(client).then(d => setVideos(d.videos ?? [])).catch(() => {})
    if (tab === 'knowledge' && !knowledge)
      getKnowledge(client).then(d => setKb(d.content ?? '')).catch(() => {})
  }, [tab, client]) // eslint-disable-line

  const saveKb = () =>
    putKnowledge(client, knowledge)
      .then(() => { show('Knowledge base saved ✓', 'success'); setKbDirty(false) })
      .catch(e => show(e.message, 'error'))

  const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview',  label: 'Overview',  icon: Activity },
    { id: 'videos',    label: 'Videos',    icon: Video },
    { id: 'tokens',    label: 'Tokens',    icon: Shield },
    { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  ]

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="size-8 animate-spin" style={{ color: 'var(--text-tertiary)' }} />
    </div>
  )

  const isHealthy = profile?.health === 'ok'

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onBack}
          className="mb-4 flex items-center gap-1.5 text-sm font-medium transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
        >
          <ArrowLeft className="size-4" /> Back to Clients
        </motion.button>

        <div className="flex flex-wrap items-start gap-4">
          {/* Avatar */}
          <div
            className="grid size-14 shrink-0 place-items-center rounded-2xl text-2xl font-extrabold text-white"
            style={{ background: avatar.bg, boxShadow: `0 0 24px ${avatar.glow}` }}
          >
            {client.charAt(0).toUpperCase()}
          </div>

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-extrabold capitalize" style={{ color: 'var(--text-primary)' }}>
                {client}
              </h1>
              <span
                className="rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wide"
                style={{
                  background: isHealthy ? 'rgba(48,209,88,0.12)' : 'rgba(255,214,10,0.1)',
                  color: isHealthy ? 'var(--success)' : 'var(--warning)',
                  border: `1px solid ${isHealthy ? 'rgba(48,209,88,0.3)' : 'rgba(255,214,10,0.3)'}`,
                }}
              >
                {isHealthy ? '✓ Healthy' : '⚠ Attention'}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {profile?.drive_folder_id ?? '—'}
            </p>
          </div>

          <div className="flex gap-2">
            <motion.button whileTap={{ scale: 0.96 }} onClick={loadProfile}
              className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
              <RefreshCw className="size-4" />
            </motion.button>
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => onViewLogs(client)}
              className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
              <Activity className="size-4" />
              <span className="hidden sm:inline">Logs</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="relative flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors"
            style={{ color: tab === id ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
          >
            <Icon className="size-4" />
            {label}
            {tab === id && (
              <motion.div layoutId="profile-tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full"
                style={{ background: 'var(--accent-red)' }} />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'overview'  && <OverviewTab profile={profile} />}
          {tab === 'videos'    && <VideosTab videos={videos} />}
          {tab === 'tokens'    && <TokensTab client={client} profile={profile} />}
          {tab === 'knowledge' && (
            <KnowledgeTab
              knowledge={knowledge}
              dirty={kbDirty}
              onChange={v => { setKb(v); setKbDirty(true) }}
              onSave={saveKb}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
