import { motion } from 'framer-motion'
import { ArrowDown, ClipboardCopy, Search } from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { getClients, getLogs } from '../lib/api'
import type { ClientStatus, LogEntry } from '../lib/api'
import { LogRowSkeleton } from '../components/Skeleton'

// ── Level config ──────────────────────────────────────────────────────────────
const LEVEL_CONFIG: Record<string, { color: string; bg: string; border: string; pill: string }> = {
  ERROR:   {
    color:  'var(--error)',
    bg:     'rgba(255,69,58,0.04)',
    border: 'rgba(255,69,58,0.2)',
    pill:   'rgba(255,69,58,0.15)',
  },
  WARNING: {
    color:  'var(--warning)',
    bg:     'rgba(255,214,10,0.04)',
    border: 'rgba(255,214,10,0.2)',
    pill:   'rgba(255,214,10,0.15)',
  },
  INFO: {
    color:  'var(--text-secondary)',
    bg:     'transparent',
    border: 'transparent',
    pill:   'var(--bg-elevated)',
  },
  DEBUG: {
    color:  'var(--text-tertiary)',
    bg:     'transparent',
    border: 'transparent',
    pill:   'var(--bg-elevated)',
  },
  SUCCESS: {
    color:  'var(--success)',
    bg:     'rgba(48,209,88,0.04)',
    border: 'rgba(48,209,88,0.15)',
    pill:   'rgba(48,209,88,0.15)',
  },
}

function getLevel(entry: LogEntry): string {
  const raw = (entry.message ?? entry.raw ?? '').toLowerCase()
  if (entry.level) {
    const l = entry.level.toUpperCase()
    if (raw.includes('upload') && (raw.includes('success') || raw.includes('complete') || raw.includes('complete.')))
      return 'SUCCESS'
    return l
  }
  if (raw.includes('error'))   return 'ERROR'
  if (raw.includes('warning')) return 'WARNING'
  return 'INFO'
}

// ── Log row ───────────────────────────────────────────────────────────────────
function LogRow({ entry, search, mobile }: { entry: LogEntry; search: string; mobile?: boolean }) {
  const lvl = getLevel(entry)
  const cfg = LEVEL_CONFIG[lvl] ?? LEVEL_CONFIG.INFO
  const msg = entry.message ?? entry.raw ?? ''
  const ts  = entry.timestamp?.slice(0, 19) ?? ''

  const highlighted = (text: string) => {
    if (!search) return <>{text}</>
    const parts = text.split(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return (
      <>
        {parts.map((p, i) =>
          i % 2 === 1
            ? <mark key={i} className="rounded px-0.5" style={{ background: 'rgba(255,214,10,0.25)', color: 'var(--warning)' }}>{p}</mark>
            : p
        )}
      </>
    )
  }

  if (mobile) {
    return (
      <div
        className="space-y-0.5 rounded-xl px-3 py-2.5"
        style={{
          background: cfg.bg,
          borderLeft: cfg.border !== 'transparent' ? `2px solid ${cfg.border}` : undefined,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{ts}</span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
            style={{ background: cfg.pill, color: cfg.color }}
          >
            {lvl}
          </span>
        </div>
        <p className="break-words text-xs leading-relaxed" style={{ color: cfg.color }}>{highlighted(msg)}</p>
      </div>
    )
  }

  return (
    <div
      className="grid gap-3 rounded-xl px-3 py-2"
      style={{
        gridTemplateColumns: '130px 72px 1fr',
        background: cfg.bg,
        borderLeft: cfg.border !== 'transparent' ? `2px solid ${cfg.border}` : undefined,
      }}
    >
      <span className="font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{ts}</span>
      <span
        className="rounded-full px-2 py-0.5 text-[10px] font-bold self-start text-center"
        style={{ background: cfg.pill, color: cfg.color }}
      >
        {lvl}
      </span>
      <span className="break-words text-xs leading-relaxed" style={{ color: cfg.color }}>{highlighted(msg)}</span>
    </div>
  )
}

// ── Level filter buttons ──────────────────────────────────────────────────────
const LEVELS = ['ALL', 'ERROR', 'WARNING', 'INFO'] as const
type LevelFilter = typeof LEVELS[number]

// ── Main Logs Page ────────────────────────────────────────────────────────────
export default function Logs({ initialClient }: { initialClient?: string }) {
  const [clients, setClients]             = useState<ClientStatus[]>([])
  const [activeClient, setActiveClient]   = useState<string>(initialClient ?? '')
  const [logs, setLogs]                   = useState<LogEntry[]>([])
  const [loading, setLoading]             = useState(false)
  const [copied, setCopied]               = useState(false)
  const [search, setSearch]               = useState('')
  const [levelFilter, setLevelFilter]     = useState<LevelFilter>('ALL')
  const [autoScroll, setAutoScroll]       = useState(true)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const isMobile   = typeof window !== 'undefined' && window.innerWidth < 768

  useEffect(() => {
    getClients().then(({ clients: cls }) => {
      setClients(cls)
      if (!activeClient && cls.length > 0) setActiveClient(cls[0].name)
    })
  }, [])

  const fetchLogs = useCallback(() => {
    if (!activeClient) return
    getLogs(activeClient, 400)
      .then(({ entries }) => setLogs(entries))
      .finally(() => setLoading(false))
  }, [activeClient])

  useEffect(() => {
    if (!activeClient) return
    setLoading(true)
    setLogs([])
    fetchLogs()
    const t = setInterval(fetchLogs, 5000)
    return () => clearInterval(t)
  }, [activeClient, fetchLogs])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, autoScroll])

  const visible = logs.filter(e => {
    const lvl = getLevel(e)
    if (levelFilter !== 'ALL' && lvl !== levelFilter) return false
    if (search) {
      const msg = (e.message ?? e.raw ?? '').toLowerCase()
      if (!msg.includes(search.toLowerCase())) return false
    }
    return true
  }).slice(-200) // performance: last 200 entries

  const copyLogs = () => {
    const text = visible.map(e => `[${e.timestamp}] ${e.level} ${e.message ?? e.raw}`).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  const clientDot = (c: ClientStatus) => {
    const hasErrors = (c.log?.errors ?? 0) > 0
    if (hasErrors) return 'var(--error)'
    if (c.health === 'ok') return 'var(--success)'
    return 'var(--text-tertiary)'
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4 md:flex-row">
      {/* ── Mobile: horizontal client chips ──────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
        {clients.map(c => (
          <button
            key={c.name}
            onClick={() => setActiveClient(c.name)}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
            style={{
              background: activeClient === c.name ? 'var(--accent-red-dim)' : 'var(--bg-elevated)',
              border: `1px solid ${activeClient === c.name ? 'var(--accent-red)' : 'var(--border-default)'}`,
              color: activeClient === c.name ? 'var(--accent-red)' : 'var(--text-secondary)',
            }}
          >
            <span className="size-1.5 rounded-full" style={{ background: clientDot(c) }} />
            {c.name}
          </button>
        ))}
      </div>

      {/* ── Desktop: client sidebar ───────────────────────────────────────── */}
      <aside
        className="hidden shrink-0 flex-col gap-1 rounded-2xl p-3 md:flex"
        style={{
          width: 168,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
          Clients
        </div>
        {clients.map(c => (
          <button
            key={c.name}
            onClick={() => setActiveClient(c.name)}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all"
            style={{
              background: activeClient === c.name ? 'var(--accent-red-dim)' : 'transparent',
              color: activeClient === c.name ? 'var(--text-primary)' : 'var(--text-tertiary)',
              boxShadow: activeClient === c.name ? 'inset 3px 0 0 var(--accent-red)' : 'none',
            }}
            onMouseEnter={e => { if (activeClient !== c.name) e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={e => { if (activeClient !== c.name) e.currentTarget.style.background = 'transparent' }}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: clientDot(c) }}
            />
            {c.name}
          </button>
        ))}
        {clients.length === 0 && (
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No clients</span>
        )}
      </aside>

      {/* ── Log pane ─────────────────────────────────────────────────────── */}
      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      >
        {/* Toolbar */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>
              {activeClient || '—'}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {visible.length} entries · auto 5s
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search logs…"
                className="h-8 rounded-xl pl-8 pr-3 text-xs outline-none transition-all"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                  minWidth: 140,
                  fontSize: 16,
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-red)')}
                onBlur={e  => (e.currentTarget.style.borderColor = 'var(--border-default)')}
              />
            </div>

            {/* Level filter pills */}
            <div className="flex gap-1">
              {LEVELS.map(l => (
                <button
                  key={l}
                  onClick={() => setLevelFilter(l)}
                  className="rounded-lg px-2 py-1 text-[11px] font-bold transition-all"
                  style={{
                    background: levelFilter === l ? 'var(--bg-elevated)' : 'transparent',
                    color: levelFilter === l
                      ? (l === 'ERROR' ? 'var(--error)' : l === 'WARNING' ? 'var(--warning)' : 'var(--text-primary)')
                      : 'var(--text-tertiary)',
                    border: levelFilter === l ? '1px solid var(--border-default)' : '1px solid transparent',
                  }}
                >
                  {l}
                </button>
              ))}
            </div>

            {/* Copy */}
            <button
              onClick={copyLogs}
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-bold transition-all"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                color: copied ? 'var(--success)' : 'var(--text-secondary)',
              }}
            >
              <ClipboardCopy className="size-3.5" />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Log entries */}
        <div ref={scrollRef} className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {loading && logs.length === 0 ? (
            <div className="space-y-0.5">
              {Array.from({ length: 10 }).map((_, i) => <LogRowSkeleton key={i} />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No logs match current filters
            </div>
          ) : (
            visible.map((e, i) => (
              <LogRow key={i} entry={e} search={search} mobile={isMobile} />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Auto-scroll FAB */}
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => {
            setAutoScroll(p => !p)
            if (!autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
          }}
          className="absolute bottom-24 right-4 flex size-9 items-center justify-center rounded-full shadow-lg transition-all md:bottom-8 md:right-8"
          style={{
            background: autoScroll ? 'var(--accent-red)' : 'var(--bg-elevated)',
            border: `1px solid ${autoScroll ? 'var(--accent-red)' : 'var(--border-default)'}`,
            color: autoScroll ? '#fff' : 'var(--text-secondary)',
          }}
          title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
        >
          <ArrowDown className="size-4" />
        </motion.button>
      </div>
    </div>
  )
}
