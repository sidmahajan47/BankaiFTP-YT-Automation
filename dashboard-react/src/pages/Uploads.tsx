import { motion, AnimatePresence } from 'framer-motion'
import { Check, Download, ExternalLink, Loader2, RefreshCw, Search, Video, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { dismissFailed, getClients, getFailedUploads, getUploads, retryAllFailed, retryFailed } from '../lib/api'
import type { ClientStatus, FailedUpload, UploadRecord } from '../lib/api'
import { useToast } from '../App'
import { UploadCardSkeleton } from '../components/Skeleton'

type Tab = 'all' | 'live' | 'queued' | 'failed'

type EnrichedRecord = UploadRecord & { client: string }

// ── Upload Row Detail Panel (desktop) ────────────────────────────────────────
function DetailPanel({ record, onClose }: { record: EnrichedRecord | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {record && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} />
          <motion.aside
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm shadow-2xl"
            style={{ background: 'var(--bg-overlay)', borderLeft: '1px solid var(--border-default)' }}
          >
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <Video className="size-4" style={{ color: 'var(--accent-red)' }} />
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Video Detail</span>
              </div>
              <button onClick={onClose} className="size-8 flex items-center justify-center rounded-lg transition"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>
                <X className="size-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-5 space-y-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>File</div>
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{record.file_name || record.drive_id}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Client</div>
                <span className="rounded-full px-2 py-0.5 text-xs font-bold"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                  {record.client}
                </span>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Uploaded</div>
                <div className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {record.uploaded_at ? new Date(record.uploaded_at).toLocaleString() : '—'}
                </div>
              </div>
              {record.youtube_id && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>YouTube</div>
                  <a href={`https://youtu.be/${record.youtube_id}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 rounded-xl p-3 text-sm font-medium transition-all"
                    style={{ background: 'rgba(255,45,85,0.08)', border: '1px solid rgba(255,45,85,0.2)', color: 'var(--accent-red)' }}>
                    <ExternalLink className="size-4" />
                    youtu.be/{record.youtube_id}
                  </a>
                </div>
              )}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Drive ID</div>
                <div className="font-mono text-xs break-all" style={{ color: 'var(--text-tertiary)' }}>{record.drive_id}</div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Mobile Upload Card ────────────────────────────────────────────────────────
function MobileUploadCard({ record, onClick }: { record: EnrichedRecord; onClick: () => void }) {
  const isLive = !!record.youtube_id
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="rounded-xl p-4 space-y-2.5 cursor-pointer"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: 'rgba(255,45,85,0.1)' }}>
            <Video className="size-4" style={{ color: 'var(--accent-red)' }} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {record.file_name || record.drive_id}
            </div>
            <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-tertiary)',
              }}>
              {record.client}
            </span>
          </div>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={{
            background: isLive ? 'rgba(48,209,88,0.12)' : 'rgba(255,214,10,0.10)',
            color: isLive ? 'var(--success)' : 'var(--warning)',
            border: `1px solid ${isLive ? 'rgba(48,209,88,0.3)' : 'rgba(255,214,10,0.3)'}`,
          }}>
          {isLive ? '✓ Live' : 'Queued'}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {record.uploaded_at?.slice(0, 16) ?? '—'}
        </span>
        {record.youtube_id && (
          <a href={`https://youtu.be/${record.youtube_id}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--accent-red)' }}>
            <ExternalLink className="size-3" />
            {record.youtube_id}
          </a>
        )}
      </div>
    </motion.div>
  )
}

// ── Failed Upload Card ────────────────────────────────────────────────────────
function FailedCard({ f, onRetry, onDismiss, busy }: {
  f: FailedUpload; onRetry: () => void; onDismiss: () => void; busy: boolean
}) {
  const permanent = f.status === 'permanently_failed'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 space-y-3"
      style={{
        background: permanent ? 'rgba(255,69,58,0.05)' : 'rgba(255,214,10,0.04)',
        border: `1px solid ${permanent ? 'rgba(255,69,58,0.25)' : 'rgba(255,214,10,0.2)'}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{f.filename}</span>
            <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-tertiary)' }}>
              {f.client}
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{f.reason}</p>
          <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            <span>Retries: {f.retry_count}/{f.max_retries}</span>
            {f.next_retry_at && <span>Next: {new Date(f.next_retry_at).toLocaleString()}</span>}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        {!permanent && (
          <button disabled={busy} onClick={onRetry}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-bold disabled:opacity-50"
            style={{ background: 'rgba(255,214,10,0.12)', border: '1px solid rgba(255,214,10,0.3)', color: 'var(--warning)' }}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            Retry
          </button>
        )}
        <button onClick={onDismiss}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-bold"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
          Dismiss
        </button>
      </div>
    </motion.div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Uploads() {
  const { show }                              = useToast()
  const [tab, setTab]                         = useState<Tab>('all')
  const [records, setRecords]                 = useState<EnrichedRecord[]>([])
  const [failed, setFailed]                   = useState<FailedUpload[]>([])
  const [clients, setClients]                 = useState<ClientStatus[]>([])
  const [filterClient, setFilterClient]       = useState('all')
  const [search, setSearch]                   = useState('')
  const [loading, setLoading]                 = useState(true)
  const [busyId, setBusyId]                   = useState<string | null>(null)
  const [selected, setSelected]               = useState<EnrichedRecord | null>(null)

  const loadAll = async () => {
    setLoading(true)
    const { clients: cls } = await getClients()
    setClients(cls)
    const all: EnrichedRecord[] = []
    await Promise.all(cls.map(async c => {
      const { records: recs } = await getUploads(c.name)
      recs.forEach(r => all.push({ ...r, client: c.name }))
    }))
    all.sort((a, b) => (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? ''))
    setRecords(all)
    const { items } = await getFailedUploads()
    setFailed(items ?? [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  const liveCount   = records.filter(r => !!r.youtube_id).length
  const queuedCount = records.filter(r => !r.youtube_id).length

  const filtered = useMemo(() => records.filter(r => {
    if (filterClient !== 'all' && r.client !== filterClient) return false
    if (search && !r.file_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (tab === 'live'   && !r.youtube_id)  return false
    if (tab === 'queued' &&  r.youtube_id)  return false
    return true
  }), [records, filterClient, search, tab])

  const exportCSV = () => {
    const rows = [['File', 'Client', 'YouTube ID', 'Uploaded At']]
    filtered.forEach(r => rows.push([r.file_name ?? r.drive_id, r.client, r.youtube_id ?? '', r.uploaded_at ?? '']))
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'uploads.csv'; a.click()
  }

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'all',    label: 'All',    count: records.length },
    { id: 'live',   label: 'Live',   count: liveCount },
    { id: 'queued', label: 'Queued', count: queuedCount },
    { id: 'failed', label: 'Failed', count: failed.length },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text-primary)' }}>Uploads</h1>
          <div className="mt-1 flex items-center gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span>Total: {records.length}</span>
            <span style={{ color: 'var(--success)' }}>Live: {liveCount}</span>
            <span style={{ color: 'var(--warning)' }}>Queued: {queuedCount}</span>
            {failed.length > 0 && <span style={{ color: 'var(--error)' }}>Failed: {failed.length}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <motion.button whileTap={{ scale: 0.96 }} onClick={loadAll}
            className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
            <RefreshCw className="size-4" />
          </motion.button>
          <motion.button whileTap={{ scale: 0.96 }} onClick={exportCSV}
            className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
            <Download className="size-4" />
            <span className="hidden sm:inline">CSV</span>
          </motion.button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="relative flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors"
            style={{ color: tab === t.id ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
            {t.label}
            {(t.count ?? 0) > 0 && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                style={{
                  background: tab === t.id ? 'var(--accent-red-dim)' : 'var(--bg-elevated)',
                  color: tab === t.id ? 'var(--accent-red)' : 'var(--text-tertiary)',
                }}>
                {t.count}
              </span>
            )}
            {tab === t.id && (
              <motion.div layoutId="tab-line"
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full"
                style={{ background: 'var(--accent-red)' }} />
            )}
          </button>
        ))}
      </div>

      {tab !== 'failed' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                className="h-9 rounded-xl pl-9 pr-3 text-sm outline-none"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                  minWidth: 180,
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-red)')}
                onBlur={e  => (e.currentTarget.style.borderColor = 'var(--border-default)')}
              />
            </div>
            {/* Client chips */}
            <div className="flex items-center gap-1 overflow-x-auto">
              {['all', ...clients.map(c => c.name)].map(cl => (
                <button key={cl} onClick={() => setFilterClient(cl)}
                  className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-all"
                  style={{
                    background: filterClient === cl ? 'var(--accent-red-dim)' : 'var(--bg-elevated)',
                    border: `1px solid ${filterClient === cl ? 'var(--accent-red)' : 'var(--border-default)'}`,
                    color: filterClient === cl ? 'var(--accent-red)' : 'var(--text-secondary)',
                  }}>
                  {cl === 'all' ? 'All Clients' : cl}
                </button>
              ))}
            </div>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-tertiary)' }}>{filtered.length} records</span>
          </div>

          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            {loading ? (
              <><UploadCardSkeleton /><UploadCardSkeleton /><UploadCardSkeleton /></>
            ) : filtered.length === 0 ? (
              <div className="flex h-40 items-center justify-center rounded-2xl text-sm"
                style={{ border: '1px dashed var(--border-default)', color: 'var(--text-tertiary)' }}>
                No uploads found
              </div>
            ) : filtered.map((r, i) => (
              <MobileUploadCard key={r.drive_id + i} record={r} onClick={() => setSelected(r)} />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl md:block" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
                    {['#', 'Video Title', 'Client', 'Upload Time', 'YouTube', 'Status'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded-lg" style={{ width: j === 1 ? 200 : 80 }} /></td>
                        ))}
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={6} className="py-16 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>No uploads found</td></tr>
                  ) : filtered.map((r, i) => (
                    <motion.tr key={r.drive_id + i}
                      whileHover={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
                      onClick={() => setSelected(r)}
                      className="cursor-pointer transition-all"
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>{i + 1}</td>
                      <td className="px-4 py-3 max-w-[280px] truncate font-medium" style={{ color: 'var(--text-primary)' }}>{r.file_name || r.drive_id}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                          {r.client}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {r.uploaded_at?.slice(0, 16) ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {r.youtube_id
                          ? <a href={`https://youtu.be/${r.youtube_id}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                              className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--accent-red)' }}>
                              <ExternalLink className="size-3" />{r.youtube_id}
                            </a>
                          : <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1 text-xs font-bold"
                          style={{ color: r.youtube_id ? 'var(--success)' : 'var(--warning)' }}>
                          {r.youtube_id ? <><Check className="size-3" /> Live</> : 'Queued'}
                        </span>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Failed tab */}
      {tab === 'failed' && (
        <div className="space-y-4">
          {failed.length > 0 && (
            <div className="flex justify-end">
              <button onClick={() => retryAllFailed().then(d => { show(`Retrying ${d.retried}`, 'info'); loadAll() }).catch(e => show(e.message, 'error'))}
                className="flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-bold"
                style={{ background: 'rgba(255,214,10,0.12)', border: '1px solid rgba(255,214,10,0.3)', color: 'var(--warning)' }}>
                <RefreshCw className="size-4" /> Retry All
              </button>
            </div>
          )}
          {failed.length === 0
            ? <div className="flex h-40 items-center justify-center rounded-2xl text-sm"
                style={{ border: '1px dashed var(--border-default)', color: 'var(--text-tertiary)' }}>
                No failed uploads 🎉
              </div>
            : failed.map(f => (
              <FailedCard
                key={f.file_id} f={f}
                busy={busyId === f.file_id}
                onRetry={() => {
                  setBusyId(f.file_id)
                  retryFailed(f.client, f.file_id)
                    .then(() => { show('Retry started', 'success'); loadAll() })
                    .catch(e => show(e.message, 'error'))
                    .finally(() => setBusyId(null))
                }}
                onDismiss={() => dismissFailed(f.client, f.file_id).then(() => { show('Dismissed', 'info'); loadAll() }).catch(e => show(e.message, 'error'))}
              />
            ))
          }
        </div>
      )}

      {/* Side panel */}
      <DetailPanel record={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
