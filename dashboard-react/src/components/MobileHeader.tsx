import { Play, RefreshCw, Zap } from 'lucide-react'
import { motion } from 'framer-motion'

interface MobileHeaderProps {
  onRunAll: () => void
  onRefresh: () => void
  runningAll: boolean
  refreshing: boolean
}

export default function MobileHeader({ onRunAll, onRefresh, runningAll, refreshing }: MobileHeaderProps) {
  return (
    <div
      className="sticky top-0 z-40 md:hidden flex items-center justify-between px-4"
      style={{
        height: 56,
        background: 'rgba(8,8,8,0.92)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div
          className="grid size-8 place-items-center rounded-xl"
          style={{
            background: 'linear-gradient(135deg, var(--accent-red), #c0392b)',
            boxShadow: '0 0 16px var(--accent-red-glow)',
          }}
        >
          <Zap className="size-4 text-white" strokeWidth={2.5} />
        </div>
        <span className="text-sm font-extrabold tracking-[0.08em]" style={{ color: 'var(--text-primary)' }}>
          BANKAIFTP
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={onRefresh}
          className="flex size-9 items-center justify-center rounded-xl"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
          }}
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={onRunAll}
          disabled={runningAll}
          className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-white disabled:opacity-60"
          style={{ background: 'var(--accent-red)' }}
        >
          {runningAll ? (
            <div className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Play className="size-3.5" strokeWidth={2.5} />
          )}
          {runningAll ? 'Running…' : 'Run All'}
        </motion.button>
      </div>
    </div>
  )
}
