import { Activity, ClipboardList, MoreHorizontal, Upload, Users } from 'lucide-react'
import { motion } from 'framer-motion'
import type { Page } from '../App'

interface BottomNavProps {
  page: Page
  queueCount: number
  onNavigate: (page: Page) => void
  onMoreOpen: () => void
}

const TABS: Array<{
  id: Page
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  badge?: (queueCount: number) => number
}> = [
  { id: 'overview',  label: 'Home',    icon: Activity },
  { id: 'clients',   label: 'Clients', icon: Users },
  { id: 'uploads',   label: 'Uploads', icon: Upload },
  { id: 'queue',     label: 'Queue',   icon: ClipboardList, badge: (q) => q },
]

export default function BottomNav({ page, queueCount, onNavigate, onMoreOpen }: BottomNavProps) {
  const activeId = (page === 'client-profile' || page === 'logs') ? 'clients' : page

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
      style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-stretch bottom-nav-safe">
        {TABS.map(({ id, label, icon: Icon, badge }) => {
          const isActive = activeId === id
          const count = badge ? badge(queueCount) : 0
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className="relative flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-all"
              style={{ minHeight: 64 }}
            >
              {/* Active indicator dot */}
              {isActive && (
                <motion.div
                  layoutId="bottom-nav-dot"
                  className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full"
                  style={{ background: 'var(--accent-red)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}

              <div className="relative">
                <span style={{ color: isActive ? 'var(--accent-red)' : 'var(--text-tertiary)' }}>
                  <Icon
                    className="size-5 transition-colors"
                    strokeWidth={isActive ? 2.2 : 1.8}
                  />
                </span>
                {count > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                    style={{ background: 'var(--accent-red)' }}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </div>

              <span
                className="text-[10px] font-semibold transition-colors"
                style={{ color: isActive ? 'var(--accent-red)' : 'var(--text-tertiary)' }}
              >
                {label}
              </span>
            </button>
          )
        })}

        {/* More button */}
        <button
          onClick={onMoreOpen}
          className="relative flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-all"
          style={{ minHeight: 64 }}
        >
          <span style={{ color: 'var(--text-tertiary)' }}>
            <MoreHorizontal className="size-5" strokeWidth={1.8} />
          </span>
          <span className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
            More
          </span>
        </button>
      </div>
    </div>
  )
}
