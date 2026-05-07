import { AnimatePresence, motion } from 'framer-motion'
import { ExternalLink, FileText, Play, Plus, Trash2, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import AddClientDrawer from '../components/AddClientDrawer'
import { deleteClient, getClients, getTokenHealth, runClient } from '../lib/api'
import type { ClientStatus, TokensHealth } from '../lib/api'
import { useToast } from '../App'
import { ClientCardSkeleton } from '../components/Skeleton'

// ── Avatar ────────────────────────────────────────────────────────────────────
const AVATAR_PALETTE = [
  { bg: '#FF2D55', glow: 'rgba(255,45,85,0.3)' },
  { bg: '#5E5CE6', glow: 'rgba(94,92,230,0.3)' },
  { bg: '#30D158', glow: 'rgba(48,209,88,0.3)' },
  { bg: '#FF9F0A', glow: 'rgba(255,159,10,0.3)' },
  { bg: '#0A84FF', glow: 'rgba(10,132,255,0.3)' },
  { bg: '#BF5AF2', glow: 'rgba(191,90,242,0.3)' },
]
function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_PALETTE.length
  const { bg, glow } = AVATAR_PALETTE[idx]
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full text-xs font-extrabold text-white"
      style={{ width: size, height: size, background: bg, boxShadow: `0 0 12px ${glow}` }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

// ── Delete Confirm Modal ──────────────────────────────────────────────────────
function DeleteModal({ name, onConfirm, onCancel }: {
  name: string; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-default)' }}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl" style={{ background: 'rgba(255,69,58,0.12)', border: '1px solid rgba(255,69,58,0.3)' }}>
            <Trash2 className="size-5" style={{ color: 'var(--error)' }} />
          </div>
          <div>
            <div className="font-bold" style={{ color: 'var(--text-primary)' }}>Delete Client</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>This action cannot be undone</div>
          </div>
        </div>
        <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
          This will remove <span className="font-bold" style={{ color: 'var(--text-primary)' }}>"{name}"</span> from automation. Drive files are kept.
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex h-10 flex-1 items-center justify-center rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
            Cancel
          </button>
          <button onClick={onConfirm} className="flex h-10 flex-1 items-center justify-center rounded-xl text-sm font-bold text-white"
            style={{ background: 'var(--error)' }}>
            Delete Client
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Mobile Client Card ────────────────────────────────────────────────────────
function MobileClientCard({ c, tokenHealth, running, onRun, onLogs, onProfile, onDelete }: {
  c: ClientStatus; tokenHealth: TokensHealth; running: boolean
  onRun: () => void; onLogs: () => void; onProfile: () => void; onDelete: () => void
}) {
  const healthy = c.health !== 'attention'
  const th = tokenHealth[c.name]?.youtube_token?.health
  const tokenOk = th === 'good'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 space-y-3"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${!healthy ? 'rgba(255,69,58,0.3)' : 'var(--border-subtle)'}`,
      }}
    >
      <div className="flex items-center gap-3">
        <Avatar name={c.name} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{
                background: c.running ? 'rgba(48,209,88,0.15)' : !healthy ? 'rgba(255,69,58,0.12)' : 'var(--bg-elevated)',
                color: c.running ? 'var(--success)' : !healthy ? 'var(--error)' : 'var(--text-tertiary)',
                border: `1px solid ${c.running ? 'rgba(48,209,88,0.3)' : !healthy ? 'rgba(255,69,58,0.3)' : 'var(--border-default)'}`,
              }}
            >
              {c.running ? '● Active' : !healthy ? '⚠ Error' : '○ Idle'}
            </span>
          </div>
          <div className="font-mono text-[10px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {c.drive_folder_id}
          </div>
        </div>
        <button onClick={onDelete} className="size-8 flex items-center justify-center rounded-lg transition"
          style={{ color: 'var(--text-tertiary)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--error)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ color: 'var(--text-tertiary)' }}>Uploads</div>
          <div className="font-mono text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{c.uploads?.count ?? 0}</div>
        </div>
        <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ color: 'var(--text-tertiary)' }}>Errors</div>
          <div className="font-mono text-lg font-bold" style={{ color: (c.log?.errors ?? 0) > 0 ? 'var(--error)' : 'var(--text-primary)' }}>{c.log?.errors ?? 0}</div>
        </div>
        <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ color: 'var(--text-tertiary)' }}>Token</div>
          <div className="font-mono text-sm font-bold" style={{ color: tokenOk ? 'var(--success)' : 'var(--warning)' }}>
            {tokenOk ? '✓' : '⚠'}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <motion.button whileTap={{ scale: 0.96 }} onClick={onRun} disabled={running}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-bold text-white disabled:opacity-70"
          style={{ background: 'var(--accent-red)' }}>
          {running ? <div className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Play className="size-3.5" strokeWidth={2.5} />}
          {running ? 'Running…' : '▶ Run'}
        </motion.button>
        <motion.button whileTap={{ scale: 0.96 }} onClick={onLogs}
          className="flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
          <FileText className="size-4" />
        </motion.button>
        <motion.button whileTap={{ scale: 0.96 }} onClick={onProfile}
          className="flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
          <User className="size-4" />
        </motion.button>
      </div>
    </motion.div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Clients({ onViewLogs, onViewProfile }: {
  onViewLogs:   (client: string) => void
  onViewProfile:(client: string) => void
}) {
  const { show } = useToast()
  const [clients, setClients]         = useState<ClientStatus[]>([])
  const [tokenHealth, setTokenHealth] = useState<TokensHealth>({})
  const [loading, setLoading]         = useState(true)
  const [showDrawer, setShowDrawer]   = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [running, setRunning]         = useState<string | null>(null)

  const refresh = async () => {
    try {
      const [{ clients: cls }, th] = await Promise.all([getClients(), getTokenHealth()])
      setClients(cls); setTokenHealth(th)
    } finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const handleRun = async (name: string) => {
    setRunning(name)
    try { await runClient(name); await refresh(); show(`Run triggered for ${name}`, 'success') }
    catch (e: unknown) { show(e instanceof Error ? e.message : 'Run failed', 'error') }
    finally { setRunning(null) }
  }

  const handleDelete = async (name: string) => {
    try { await deleteClient(name); await refresh(); show(`${name} removed`, 'info') }
    catch (e: unknown) { show(e instanceof Error ? e.message : 'Delete failed', 'error') }
    finally { setPendingDelete(null) }
  }

  const tokenBadge = (client: string) => {
    const h = tokenHealth[client]?.youtube_token?.health
    const map: Record<string, { color: string; label: string }> = {
      good:     { color: 'var(--success)', label: '✓ OK' },
      warning:  { color: 'var(--warning)', label: '⚠ Warn' },
      critical: { color: 'var(--warning)', label: '⚠ Critical' },
      expired:  { color: 'var(--error)',   label: '✗ Expired' },
    }
    if (!h) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>
    const cfg = map[h]
    return <span className="text-[11px] font-bold" style={{ color: cfg?.color ?? 'var(--text-tertiary)' }}>{cfg?.label ?? h}</span>
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text-primary)' }}>Clients</h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>{clients.length} configured</p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setShowDrawer(true)}
          className="flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white"
          style={{ background: 'var(--accent-red)' }}
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Add Client</span>
          <span className="sm:hidden">Add</span>
        </motion.button>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {loading ? (
          <><ClientCardSkeleton /><ClientCardSkeleton /></>
        ) : clients.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-2xl text-sm"
            style={{ border: '1px dashed var(--border-default)', color: 'var(--text-tertiary)' }}>
            <Plus className="size-8 opacity-30" />
            No clients yet — tap Add to get started
          </div>
        ) : clients.map(c => (
          <MobileClientCard
            key={c.name} c={c} tokenHealth={tokenHealth}
            running={running === c.name}
            onRun={() => handleRun(c.name)}
            onLogs={() => onViewLogs(c.name)}
            onProfile={() => onViewProfile(c.name)}
            onDelete={() => setPendingDelete(c.name)}
          />
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-2xl md:block" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
                {['Name', 'Status', 'YT Token', 'Uploads', 'Last Upload', 'Folder ID', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="skeleton h-4 w-24 rounded-lg" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : clients.length === 0 ? (
                <tr><td colSpan={7} className="py-20 text-center">
                  <div className="flex flex-col items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
                    <Plus className="size-10 opacity-30" />
                    <span>No clients yet.</span>
                    <button onClick={() => setShowDrawer(true)}
                      className="rounded-xl px-4 py-2 text-sm font-bold text-white"
                      style={{ background: 'var(--accent-red)' }}>
                      Add Client
                    </button>
                  </div>
                </td></tr>
              ) : clients.map(c => {
                const healthy = c.health !== 'attention'
                const lastUpload = c.uploads?.latest?.uploaded_at?.slice(0, 16) ?? '—'
                return (
                  <motion.tr
                    key={c.name}
                    className="group relative transition-all"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    whileHover={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
                  >
                    {/* Name */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.name} size={32} />
                        <div>
                          <div className="font-bold" style={{ color: 'var(--text-primary)' }}>{c.name}</div>
                        </div>
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <span className="flex items-center gap-1.5 text-xs font-bold">
                        <span className={`size-1.5 rounded-full ${c.running ? 'animate-pulse' : ''}`}
                          style={{ background: c.running ? 'var(--success)' : !healthy ? 'var(--error)' : 'var(--text-tertiary)' }} />
                        <span style={{ color: c.running ? 'var(--success)' : !healthy ? 'var(--error)' : 'var(--text-secondary)' }}>
                          {c.running ? 'Active' : !healthy ? 'Error' : 'Idle'}
                        </span>
                      </span>
                    </td>
                    {/* Token */}
                    <td className="px-4 py-3.5">{tokenBadge(c.name)}</td>
                    {/* Uploads */}
                    <td className="px-4 py-3.5 font-mono" style={{ color: 'var(--text-primary)' }}>
                      {c.uploads?.count ?? 0}
                    </td>
                    {/* Last Upload */}
                    <td className="whitespace-nowrap px-4 py-3.5 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {lastUpload}
                    </td>
                    {/* Folder ID */}
                    <td className="px-4 py-3.5">
                      <span className="max-w-[120px] truncate block font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {c.drive_folder_id}
                      </span>
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => onViewProfile(c.name)} title="Profile"
                          className="flex size-8 items-center justify-center rounded-lg transition-all"
                          style={{ border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#BF5AF2')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}>
                          <User className="size-3" />
                        </button>
                        <button onClick={() => handleRun(c.name)} disabled={running === c.name} title="Run"
                          className="flex size-8 items-center justify-center rounded-lg transition-all disabled:opacity-40"
                          style={{ border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-red)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}>
                          <Play className="size-3" />
                        </button>
                        <button onClick={() => onViewLogs(c.name)}
                          className="rounded-lg px-2 py-1.5 text-[11px] font-bold transition-all"
                          style={{ border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}>
                          Logs
                        </button>
                        {c.uploads?.latest?.youtube_id && (
                          <a href={`https://youtube.com/watch?v=${c.uploads.latest.youtube_id}`} target="_blank" rel="noreferrer"
                            className="flex size-8 items-center justify-center rounded-lg transition-all"
                            style={{ border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--error)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}>
                            <ExternalLink className="size-3" />
                          </a>
                        )}
                        <button onClick={() => setPendingDelete(c.name)} title="Delete"
                          className="flex size-8 items-center justify-center rounded-lg transition-all"
                          style={{ border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--error)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Client Drawer */}
      <AnimatePresence>
        {showDrawer && <AddClientDrawer onClose={() => setShowDrawer(false)} onAdded={refresh} />}
      </AnimatePresence>

      {/* Delete Confirm Modal */}
      <AnimatePresence>
        {pendingDelete && (
          <DeleteModal
            name={pendingDelete}
            onConfirm={() => handleDelete(pendingDelete)}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
