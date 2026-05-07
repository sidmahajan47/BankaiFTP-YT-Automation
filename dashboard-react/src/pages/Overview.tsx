import { Activity, AlertTriangle, CheckCircle, FileText, Play, RefreshCw, Users, Video, Zap } from 'lucide-react'
import { motion, AnimatePresence, useMotionValue, useMotionTemplate } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import type { ClientStatus, StatusPayload, TokensHealth } from '../lib/api'
import { getStatus, getTokenHealth, runClient } from '../lib/api'
import { useToast } from '../App'
import { KPICardSkeleton, ClientCardSkeleton } from '../components/Skeleton'

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, mono = true }: { value: number; mono?: boolean }) {
  const [display, setDisplay] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    const from = prev.current
    const to   = value
    prev.current = to
    if (from === to) { setDisplay(to); return }
    const duration = 800
    const start    = performance.now()
    const animate  = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out-cubic
      setDisplay(Math.round(from + (to - from) * eased))
      if (t < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }, [value])
  return <span className={mono ? 'font-mono' : ''}>{display}</span>
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
const ACCENT_COLORS: Record<string, { top: string; icon: string; glow: string }> = {
  blue:   { top: 'var(--info)',    icon: '#0A84FF', glow: 'rgba(10,132,255,0.15)' },
  green:  { top: 'var(--success)', icon: '#30D158', glow: 'rgba(48,209,88,0.15)' },
  red:    { top: 'var(--error)',   icon: '#FF453A', glow: 'rgba(255,69,58,0.15)' },
  yellow: { top: 'var(--warning)', icon: '#FFD60A', glow: 'rgba(255,214,10,0.15)' },
}

function KPICard({ icon: Icon, label, value, sub, accent, alert }: {
  icon: React.ComponentType<{ className?: string }>
  label: string; value: number; sub: string
  accent: keyof typeof ACCENT_COLORS
  alert?: boolean
}) {
  const c = ACCENT_COLORS[accent]
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, boxShadow: `0 12px 32px rgba(0,0,0,0.5)` }}
      onMouseMove={(e) => {
        const { left, top } = e.currentTarget.getBoundingClientRect()
        mouseX.set(e.clientX - left)
        mouseY.set(e.clientY - top)
      }}
      className="relative overflow-hidden rounded-2xl p-5 transition-all group"
      style={{
        background: alert ? 'rgba(255,69,58,0.06)' : 'var(--bg-surface)',
        border: `1px solid ${alert ? 'rgba(255,69,58,0.3)' : 'var(--border-subtle)'}`,
      }}
    >
      {/* Spotlight Hover Effect */}
      <motion.div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition duration-500 group-hover:opacity-100 z-0"
        style={{
          background: useMotionTemplate`
            radial-gradient(
              250px circle at ${mouseX}px ${mouseY}px,
              ${c.glow},
              transparent 80%
            )
          `,
        }}
      />
      {/* Top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl z-10" style={{ background: c.top }} />

      <div className="flex items-start justify-between gap-3 relative z-10">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="rounded-lg p-1.5" style={{ background: c.glow }}>
              <Icon className="size-4" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
              {label}
            </span>
          </div>
          <div className="kpi-number">
            <AnimatedNumber value={value} />
          </div>
          <div className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{sub}</div>
        </div>
      </div>
    </motion.div>
  )
}

// ── Token Alert Banner ────────────────────────────────────────────────────────
function TokenBanner({ health }: { health: TokensHealth }) {
  const alerts: string[] = []
  for (const [client, h] of Object.entries(health)) {
    if ((h.youtube_token?.days_remaining ?? 99) < 7)
      alerts.push(`${client} YouTube token expires in ${h.youtube_token.days_remaining}d`)
    if ((h.drive_token?.days_remaining ?? 99) < 7)
      alerts.push(`${client} Drive token expires in ${h.drive_token.days_remaining}d`)
  }
  if (!alerts.length) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 rounded-xl px-4 py-3"
      style={{ background: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.25)' }}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warning)' }} />
      <div className="text-sm" style={{ color: 'var(--warning)' }}>
        <span className="font-bold">Token Alert — </span>
        {alerts.join(' · ')}
        <span className="ml-2 opacity-70">→ Go to Settings to refresh</span>
      </div>
    </motion.div>
  )
}

// ── Client Avatar ─────────────────────────────────────────────────────────────
const AVATAR_PALETTE = [
  { bg: '#FF2D55', glow: 'rgba(255,45,85,0.3)' },
  { bg: '#5E5CE6', glow: 'rgba(94,92,230,0.3)' },
  { bg: '#30D158', glow: 'rgba(48,209,88,0.3)' },
  { bg: '#FF9F0A', glow: 'rgba(255,159,10,0.3)' },
  { bg: '#0A84FF', glow: 'rgba(10,132,255,0.3)' },
  { bg: '#BF5AF2', glow: 'rgba(191,90,242,0.3)' },
]

function Avatar({ name }: { name: string }) {
  const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_PALETTE.length
  const { bg, glow } = AVATAR_PALETTE[idx]
  return (
    <div
      className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-extrabold text-white"
      style={{ background: bg, boxShadow: `0 0 14px ${glow}` }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

// ── Client Card ───────────────────────────────────────────────────────────────
function ClientCard({ client, onViewLogs, onRun }: {
  client: ClientStatus
  onViewLogs: () => void
  onRun: () => void
}) {
  const [running, setRunning]     = useState(client.running ?? false)
  const [done, setDone]           = useState(false)
  const healthy = client.health !== 'attention'
  const uploadCount = client.uploads?.count ?? 0
  const errorCount  = client.log?.errors ?? 0
  const total       = client.summary?.total ?? 0
  const uploaded    = client.summary?.uploaded ?? 0
  const pct         = total > 0 ? Math.min(100, (uploaded / total) * 100) : 0

  const lastUploadTime = client.uploads?.latest?.uploaded_at
  const lastRelative = lastUploadTime
    ? (() => {
        const diff = Date.now() - new Date(lastUploadTime).getTime()
        const hrs  = Math.floor(diff / 3600000)
        const days = Math.floor(hrs / 24)
        if (days > 0)  return `${days}d ago`
        if (hrs > 0)   return `${hrs}h ago`
        return 'Just now'
      })()
    : '—'

  const handleRun = async () => {
    setRunning(true); setDone(false)
    try { await Promise.resolve(onRun()); setDone(true); setTimeout(() => setDone(false), 2500) }
    finally { setRunning(false) }
  }

  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      onMouseMove={(e) => {
        const { left, top } = e.currentTarget.getBoundingClientRect()
        mouseX.set(e.clientX - left)
        mouseY.set(e.clientY - top)
      }}
      className={`relative flex flex-col gap-4 rounded-2xl p-5 transition-all group ${running ? 'running-glow' : ''}`}
      style={{
        background: 'linear-gradient(145deg, var(--bg-surface), var(--bg-elevated))',
        border: `1px solid ${running ? 'rgba(48,209,88,0.4)' : !healthy ? 'rgba(255,69,58,0.3)' : 'var(--border-subtle)'}`,
      }}
    >
      {/* Spotlight Hover Effect */}
      <motion.div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition duration-500 group-hover:opacity-100 z-0"
        style={{
          background: useMotionTemplate`
            radial-gradient(
              300px circle at ${mouseX}px ${mouseY}px,
              rgba(255,255,255,0.06),
              transparent 80%
            )
          `,
        }}
      />

      {/* Running pulse */}
      {running && (
        <span className="absolute right-4 top-4 flex size-2.5 z-10">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: 'var(--success)' }} />
          <span className="relative inline-flex size-2.5 rounded-full" style={{ background: 'var(--success)' }} />
        </span>
      )}

      {/* Header row */}
      <div className="flex items-center gap-3 relative z-10">
        <Avatar name={client.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold tracking-wide" style={{ color: 'var(--text-primary)' }}>
              {client.name}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{
                background: running ? 'rgba(48,209,88,0.15)' : !healthy ? 'rgba(255,69,58,0.12)' : 'var(--bg-elevated)',
                color: running ? 'var(--success)' : !healthy ? 'var(--error)' : 'var(--text-tertiary)',
                border: `1px solid ${running ? 'rgba(48,209,88,0.3)' : !healthy ? 'rgba(255,69,58,0.3)' : 'var(--border-default)'}`,
              }}
            >
              {running ? '● Active' : !healthy ? '⚠ Error' : '○ Idle'}
            </span>
          </div>
          <div className="truncate font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {client.drive_folder_id}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-xs relative z-10">
        {[
          { label: 'Uploads', val: uploadCount, color: 'var(--text-primary)' },
          { label: 'Errors',  val: errorCount,  color: errorCount > 0 ? 'var(--error)' : 'var(--text-primary)' },
          { label: 'Last Upload', val: lastRelative, color: 'var(--text-secondary)', isStr: true },
        ].map(({ label, val, color, isStr }) => (
          <div
            key={label}
            className="rounded-xl p-2.5"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
            <div className="font-mono text-lg font-bold" style={{ color }}>
              {isStr ? val : <AnimatedNumber value={val as number} />}
            </div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="relative z-10">
        <div className="mb-1.5 flex justify-between text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          <span>Activity</span>
          <span>{uploaded}/{total}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-elevated)' }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, var(--accent-red), #c0392b)' }}
          />
        </div>
      </div>

      {/* Latest activity */}
      {client.activity?.message && (
        <div
          className="rounded-xl px-3 py-2 text-xs truncate relative z-10"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
        >
          {client.activity.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1 relative z-10">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleRun}
          disabled={running}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-70 md:h-9"
          style={{
            background: done
              ? 'var(--success)'
              : 'var(--accent-red)',
          }}
        >
          {running ? (
            <div className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : done ? (
            <CheckCircle className="size-3.5" />
          ) : (
            <Play className="size-3.5" strokeWidth={2.5} />
          )}
          {running ? 'Running…' : done ? 'Done ✓' : '▶ Run'}
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onViewLogs}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all md:h-9"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
        >
          <FileText className="size-3.5" />
          Logs
        </motion.button>
      </div>
    </motion.article>
  )
}

// ── Activity Timeline ─────────────────────────────────────────────────────────
function ActivityTimeline({ clients }: { clients: ClientStatus[] }) {
  type Event = { time: string; message: string; client: string; ok: boolean }
  const events: Event[] = []

  clients.forEach(c => {
    if (c.activity?.message && c.activity.timestamp) {
      const time = c.activity.timestamp.split(' ')[1]?.slice(0, 5) ?? ''
      events.push({ time, message: c.activity.message, client: c.name, ok: !c.activity.message.includes('fail') })
    }
  })
  events.sort((a, b) => b.time.localeCompare(a.time))

  if (!events.length) return null

  return (
    <div>
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
        Today's Activity
      </h2>
      <div
        className="rounded-2xl p-4 space-y-3"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      >
        {events.map((e, i) => (
          <div key={i} className="flex items-start gap-3">
            <span
              className="mt-0.5 shrink-0 font-mono text-xs"
              style={{ color: 'var(--text-tertiary)', minWidth: 40 }}
            >
              {e.time}
            </span>
            <div
              className="mt-1.5 size-2 shrink-0 rounded-full"
              style={{ background: e.ok ? 'var(--success)' : 'var(--error)' }}
            />
            <div className="min-w-0 flex-1">
              <span className="text-xs font-semibold mr-1.5" style={{ color: 'var(--accent-red)' }}>
                {e.client}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {e.message}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Overview Page ─────────────────────────────────────────────────────────────
interface OverviewProps {
  onViewLogs: (client: string) => void
  onRunAll?: () => void
  runningAll?: boolean
}

export default function Overview({ onViewLogs, onRunAll, runningAll = false }: OverviewProps) {
  const { show }     = useToast()
  const [status, setStatus]           = useState<StatusPayload | null>(null)
  const [tokenHealth, setTokenHealth] = useState<TokensHealth>({})
  const [loading, setLoading]         = useState(true)
  const [refreshing, setRefreshing]   = useState(false)

  const refresh = async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const [s, th] = await Promise.all([getStatus(), getTokenHealth()])
      setStatus(s); setTokenHealth(th)
    } catch { /* ignore */ }
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(() => refresh(), 10000)
    return () => clearInterval(t)
  }, [])

  const clients     = status?.clients ?? []
  const totUploads  = clients.reduce((s, c) => s + (c.uploads?.count ?? 0), 0)
  const totErrors   = clients.reduce((s, c) => s + (c.log?.errors ?? 0), 0)
  const activeCount = clients.filter(c => c.running).length

  return (
    <div className="space-y-6">
      {/* Premium Hero / Command Center */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[2rem] p-6 md:p-8 border border-white/5"
        style={{
          background: 'linear-gradient(145deg, rgba(20,20,20,0.8), rgba(10,10,10,0.95))',
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.05), 0 20px 40px -10px rgba(0,0,0,0.5)',
        }}
      >
        {/* Animated background glows */}
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[var(--accent-red)]/10 blur-[80px]" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-[#0A84FF]/10 blur-[80px]" />

        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-red-glow)] bg-[var(--accent-red-dim)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-widest text-[var(--accent-red)]">
              <span className="size-1.5 animate-pulse rounded-full bg-current" />
              Live Dashboard
            </div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tighter" style={{ color: 'var(--text-primary)' }}>
              Command <span className="gradient-text">Center</span>
            </h1>
            <p className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
              {status?.generated_at ? `Last sync: ${status.generated_at}` : 'Establishing connection to mainframe…'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => refresh(true)}
              className="flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-secondary)',
              }}
            >
              <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Data</span>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02, boxShadow: '0 0 20px var(--accent-red-glow)' }}
              whileTap={{ scale: 0.96 }}
              onClick={onRunAll}
              disabled={runningAll}
              className="flex h-11 items-center gap-2 rounded-xl px-6 text-sm font-bold text-white disabled:opacity-60 relative overflow-hidden"
              style={{ background: 'var(--accent-red)' }}
            >
              {/* Button inner glow */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
              <div className="relative flex items-center gap-2">
                {runningAll
                  ? <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  : <Zap className="size-4" fill="currentColor" />
                }
                {runningAll ? 'Executing Sequence…' : 'Run All Automations'}
              </div>
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Token alert */}
      <AnimatePresence>
        {Object.keys(tokenHealth).length > 0 && <TokenBanner health={tokenHealth} />}
      </AnimatePresence>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {loading ? (
          <>
            <KPICardSkeleton /><KPICardSkeleton /><KPICardSkeleton /><KPICardSkeleton />
          </>
        ) : (
          <>
            <KPICard icon={Users}         label="Clients"  value={clients.length} sub={clients.map(c => c.name).join(', ') || '—'} accent="blue" />
            <KPICard icon={Activity}      label="Active"   value={activeCount}    sub="currently running"  accent="green" />
            <KPICard icon={Video}         label="Uploads"  value={totUploads}     sub="across all clients" accent="blue" />
            <KPICard icon={AlertTriangle} label="Errors"   value={totErrors}      sub={totErrors ? 'check logs' : 'all clear'} accent="red" alert={totErrors > 0} />
          </>
        )}
      </div>

      {/* Client cards */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
            Clients
          </h2>
          {!loading && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <CheckCircle className="size-3" style={{ color: 'var(--success)' }} />
              {clients.filter(c => c.health === 'ok').length} healthy
            </span>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ClientCardSkeleton /><ClientCardSkeleton />
          </div>
        ) : clients.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {clients.map(c => (
              <ClientCard
                key={c.name}
                client={c}
                onViewLogs={() => onViewLogs(c.name)}
                onRun={() => runClient(c.name).then(() => refresh()).catch(e => show(e.message, 'error'))}
              />
            ))}
          </div>
        ) : (
          <div
            className="flex h-40 flex-col items-center justify-center gap-2 rounded-2xl text-sm"
            style={{ border: '1px dashed var(--border-default)', color: 'var(--text-tertiary)' }}
          >
            <Users className="size-8 opacity-40" />
            No clients configured yet
          </div>
        )}
      </div>

      {/* Activity timeline */}
      {!loading && <ActivityTimeline clients={clients} />}
    </div>
  )
}
