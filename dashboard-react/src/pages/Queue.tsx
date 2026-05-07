import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, Loader2, RefreshCw, SkipForward, Tag, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { approveVideo, getQueue, previewVideo, skipVideo, type QueueItem } from '../lib/api'
import type { Page } from '../App'
import { useToast } from '../App'
import { QueueCardSkeleton } from '../components/Skeleton'

// ── Tag Chip Component ────────────────────────────────────────────────────────
function TagChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
    >
      {label}
      {onRemove && (
        <button onClick={onRemove} className="opacity-50 hover:opacity-100 transition-opacity">
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

// ── Queue Card ────────────────────────────────────────────────────────────────
function QueueCard({ item, index, onApprove, onSkip, onRegenerate }: {
  item: QueueItem
  index: number
  onApprove: (meta: { title: string; description: string; tags: string[] }) => Promise<void>
  onSkip: () => Promise<void>
  onRegenerate: () => Promise<{ title: string; description: string; tags: string[] }>
}) {
  const [title, setTitle] = useState(item.title)
  const [desc, setDesc]   = useState(item.description)
  const [tags, setTags]   = useState<string[]>(item.tags)
  const [newTag, setNewTag] = useState('')
  const [busy, setBusy]   = useState<'approve' | 'skip' | 'regen' | null>(null)
  const [done, setDone]   = useState(false)

  useEffect(() => {
    setTitle(item.title); setDesc(item.description); setTags(item.tags)
  }, [item])

  const handleApprove = async () => {
    setBusy('approve')
    try { await onApprove({ title, description: desc, tags }); setDone(true) }
    finally { setBusy(null) }
  }

  const handleSkip = async () => {
    setBusy('skip')
    try { await onSkip() } finally { setBusy(null) }
  }

  const handleRegen = async () => {
    setBusy('regen')
    try {
      const d = await onRegenerate()
      setTitle(d.title); setDesc(d.description); setTags(d.tags)
    } finally { setBusy(null) }
  }

  const addTag = () => {
    const t = newTag.trim()
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setNewTag('')
  }

  if (done) return null

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 60, scale: 0.95 }}
      transition={{ delay: index * 0.05, duration: 0.2 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Card header */}
      <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div
          className="grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold"
          style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)' }}
        >
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {item.filename}
            </span>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{
                background: 'var(--accent-red-dim)',
                color: 'var(--accent-red)',
                border: '1px solid rgba(255,45,85,0.3)',
              }}
            >
              {item.client}
            </span>
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold"
          style={{ background: 'rgba(255,214,10,0.1)', color: 'var(--warning)', border: '1px solid rgba(255,214,10,0.3)' }}
        >
          Pending
        </span>
      </div>

      {/* Editor */}
      <div className="space-y-4 p-5">
        {/* Title */}
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
            AI Generated Title
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Video title…"
            className="w-full rounded-xl px-4 py-2.5 text-sm outline-none transition-all"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
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
          <div className="mt-1 text-right text-xs" style={{ color: title.length > 70 ? 'var(--error)' : 'var(--text-tertiary)' }}>
            {title.length}/100
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
            AI Description
          </label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={4}
            placeholder="Video description…"
            className="w-full resize-none rounded-xl px-4 py-2.5 text-sm outline-none transition-all"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
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
        </div>

        {/* Tags */}
        <div>
          <label className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
            <Tag className="size-3" /> Tags ({tags.length})
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.map((t, i) => (
              <TagChip key={t + i} label={t} onRemove={() => setTags(prev => prev.filter((_, j) => j !== i))} />
            ))}
            <div className="flex items-center gap-1">
              <input
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                placeholder="+ Add tag"
                className="h-7 rounded-full px-2.5 text-xs outline-none"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                  fontSize: 16,
                  width: 90,
                }}
              />
            </div>
          </div>
        </div>

        {/* Actions — Desktop: horizontal row */}
        <div className="hidden items-center gap-2 pt-1 md:flex">
          <motion.button
            whileTap={{ scale: 0.96 }}
            disabled={!!busy}
            onClick={handleApprove}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-bold text-white disabled:opacity-60"
            style={{ background: 'var(--success)', boxShadow: '0 0 20px rgba(48,209,88,0.25)' }}
          >
            {busy === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle className="size-4" />}
            ✅ Approve & Upload
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.96 }}
            disabled={!!busy}
            onClick={handleRegen}
            className="flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
          >
            {busy === 'regen' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Regen
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.96 }}
            disabled={!!busy}
            onClick={handleSkip}
            className="flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {busy === 'skip' ? <Loader2 className="size-4 animate-spin" /> : <SkipForward className="size-4" />}
            Skip
          </motion.button>
        </div>

        {/* Actions — Mobile: stacked */}
        <div className="space-y-2 md:hidden">
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={!!busy}
            onClick={handleApprove}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white disabled:opacity-60"
            style={{ background: 'var(--success)' }}
          >
            {busy === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle className="size-4" />}
            ✅ Approve & Upload
          </motion.button>
          <div className="flex gap-2">
            <motion.button
              whileTap={{ scale: 0.96 }}
              disabled={!!busy}
              onClick={handleRegen}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
            >
              {busy === 'regen' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Regen
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              disabled={!!busy}
              onClick={handleSkip}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-tertiary)' }}
            >
              {busy === 'skip' ? <Loader2 className="size-4 animate-spin" /> : <SkipForward className="size-4" />}
              Skip
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── Main Queue Page ───────────────────────────────────────────────────────────
export default function Queue({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { show }             = useToast()
  const [items, setItems]    = useState<QueueItem[]>([])
  const [loading, setLoading]= useState(true)
  const [approvingAll, setApprovingAll] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getQueue()
      .then(d => setItems((d.items ?? []).filter(i => i.status === 'pending_approval')))
      .catch(() => show('Failed to load queue', 'error'))
      .finally(() => setLoading(false))
  }, [show])

  useEffect(() => { load() }, [load])

  const pendingCount = items.length

  const handleApproveAll = async () => {
    setApprovingAll(true)
    let success = 0
    for (const item of items) {
      try {
        await approveVideo(item.client, item.file_id, {
          title: item.title, description: item.description, tags: item.tags,
        })
        success++
      } catch { /* continue */ }
    }
    show(`${success} video(s) queued for upload`, 'success')
    load()
    setApprovingAll(false)
  }

  return (
    <div className="space-y-5 pb-24 md:pb-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Queue
            </h1>
            {pendingCount > 0 && (
              <span
                className="flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold text-white"
                style={{ background: 'var(--accent-red)', boxShadow: '0 0 12px var(--accent-red-glow)' }}
              >
                {pendingCount}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Review AI metadata before videos go live
          </p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button whileTap={{ scale: 0.96 }} onClick={load}
            className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </motion.button>
          {pendingCount > 1 && (
            <motion.button whileTap={{ scale: 0.96 }} onClick={handleApproveAll} disabled={approvingAll}
              className="flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-60"
              style={{ background: 'var(--success)' }}>
              {approvingAll
                ? <Loader2 className="size-4 animate-spin" />
                : <CheckCircle className="size-4" />
              }
              Approve All
            </motion.button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center gap-4 rounded-2xl py-20"
          style={{ border: '1px dashed var(--border-default)' }}
        >
          <div className="grid size-16 place-items-center rounded-2xl" style={{ background: 'rgba(48,209,88,0.1)' }}>
            <CheckCircle className="size-8" style={{ color: 'var(--success)' }} />
          </div>
          <div className="text-center">
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Queue is empty</p>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-tertiary)' }}>
              New videos will appear here after the next Drive scan.
            </p>
          </div>
          <button onClick={() => onNavigate('clients')}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
            Go to Clients
          </button>
        </motion.div>
      )}

      {/* Skeleton */}
      {loading && (
        <div className="space-y-4">
          <QueueCardSkeleton /><QueueCardSkeleton />
        </div>
      )}

      {/* Cards */}
      <div className="space-y-4">
        <AnimatePresence>
          {items.map((item, idx) => (
            <QueueCard
              key={item.file_id}
              item={item}
              index={idx}
              onApprove={async (meta) => {
                await approveVideo(item.client, item.file_id, meta)
                show(`Upload started for "${meta.title}"`, 'success')
                load()
              }}
              onSkip={async () => {
                await skipVideo(item.client, item.file_id)
                show('Video skipped', 'info')
                load()
              }}
              onRegenerate={async () => {
                const d = await previewVideo(item.client, item.file_id)
                show('New metadata generated', 'success')
                return d
              }}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Mobile sticky approve-all bar */}
      {pendingCount > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-30 p-3 md:hidden" style={{ background: 'rgba(8,8,8,0.92)', backdropFilter: 'blur(12px)', borderTop: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {pendingCount} video{pendingCount !== 1 ? 's' : ''} pending
            </span>
            <button onClick={handleApproveAll} disabled={approvingAll}
              className="flex h-10 items-center gap-2 rounded-xl px-5 text-sm font-bold text-white disabled:opacity-60"
              style={{ background: 'var(--success)' }}>
              {approvingAll ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle className="size-4" />}
              Approve All
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
