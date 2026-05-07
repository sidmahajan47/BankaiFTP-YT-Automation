import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, ClipboardList, FileText,
  Settings, Upload, Users, X, Zap
} from 'lucide-react'
import { createContext, useContext, useEffect, useState } from 'react'
import Overview from './pages/Overview'
import Clients from './pages/Clients'
import Uploads from './pages/Uploads'
import Logs from './pages/Logs'
import SettingsPage from './pages/Settings'
import Queue from './pages/Queue'
import ClientProfile from './pages/ClientProfile'
import { getQueue, getStatus, runAll } from './lib/api'
import BottomNav from './components/BottomNav'
import MobileHeader from './components/MobileHeader'
import { ToastProvider, useToast } from './components/Toast'
import Footer from './components/Footer'
import LoadingScreen from './components/LoadingScreen'
import Cursor from './components/Cursor'

// ── Inject Google Fonts once ─────────────────────────────────────────────────
if (!document.getElementById('gfonts')) {
  const link = document.createElement('link')
  link.id   = 'gfonts'
  link.rel  = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100;0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;0,14..32,800;0,14..32,900&family=JetBrains+Mono:wght@400;500;600;700&display=swap'
  document.head.appendChild(link)
}

// ── Page type ─────────────────────────────────────────────────────────────────
export type Page = 'overview' | 'clients' | 'uploads' | 'logs' | 'settings' | 'queue' | 'client-profile'

// ── Legacy Toast Context for page components ──────────────────────────────────
export type ToastKind = 'success' | 'error' | 'info' | 'warning'
export type Toast = { id: number; kind: ToastKind; message: string }
type ToastCtx = { show: (message: string, kind?: ToastKind) => void }
export const ToastContext = createContext<ToastCtx>({ show: () => {} })
export const useToastCtx = () => useContext(ToastContext)

// ── More Bottom Sheet (mobile) ────────────────────────────────────────────────
function MoreSheet({
  open, onClose, apiLive, onNavigate
}: {
  open: boolean
  onClose: () => void
  apiLive: boolean
  onNavigate: (page: Page) => void
}) {
  const items = [
    { icon: FileText, label: 'Logs',     page: 'logs' as Page },
    { icon: Settings, label: 'Settings', page: 'settings' as Page },
  ]

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] md:hidden"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="fixed bottom-0 left-0 right-0 z-[61] rounded-t-[28px] md:hidden overflow-hidden"
            style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="sheet-handle mt-3" />
            <div className="px-4 pb-4 pt-2">
              {/* Nav items */}
              {items.map(({ icon: Icon, label, page }) => (
                <motion.button
                  key={page}
                  onClick={() => { onNavigate(page); onClose() }}
                  whileTap={{ scale: 0.97 }}
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-semibold transition-colors"
                  style={{ color: 'var(--text-1)', minHeight: 52 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div
                    className="grid size-8 place-items-center rounded-xl"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
                  >
                    <Icon className="size-4" style={{ color: 'var(--text-2)' }} />
                  </div>
                  {label}
                </motion.button>
              ))}

              <div className="mt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }} />
              <motion.button
                onClick={onClose}
                whileTap={{ scale: 0.97 }}
                className="mt-2 flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-semibold"
                style={{ color: 'var(--text-3)', minHeight: 52 }}
              >
                <div
                  className="grid size-8 place-items-center rounded-xl"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
                >
                  <X className="size-4" />
                </div>
                Cancel
              </motion.button>
            </div>
            {/* Embedded Mobile Footer */}
            <Footer apiLive={apiLive} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Sidebar Nav ───────────────────────────────────────────────────────────────
const NAV_ITEMS: Array<{
  id: Page
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  badge?: boolean
}> = [
  { id: 'overview',  label: 'Overview',  icon: Activity },
  { id: 'queue',     label: 'Queue',     icon: ClipboardList, badge: true },
  { id: 'clients',   label: 'Clients',   icon: Users },
  { id: 'uploads',   label: 'Uploads',   icon: Upload },
  { id: 'logs',      label: 'Logs',      icon: FileText },
  { id: 'settings',  label: 'Settings',  icon: Settings },
]

function Sidebar({
  page, apiLive, queueCount, onNavigate
}: {
  page: Page
  apiLive: boolean
  queueCount: number
  onNavigate: (p: Page) => void
}) {
  const activeId: Page = page

  return (
    <motion.aside
      initial={{ x: -40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: 0.05 }}
      className="sticky top-0 hidden h-screen flex-col md:flex overflow-hidden"
      style={{
        width: 220,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      {/* Subtle top glow strip */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(255,45,85,0.4), transparent)' }}
      />

      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5">
        <motion.div
          whileHover={{ scale: 1.08, rotate: -3 }}
          transition={{ type: 'spring', stiffness: 400, damping: 15 }}
          className="grid size-9 shrink-0 place-items-center rounded-xl relative"
          style={{
            background: 'linear-gradient(135deg, #FF2D55, #c0392b)',
            boxShadow: '0 0 20px rgba(255,45,85,0.35)',
          }}
        >
          <motion.div
            className="absolute inset-0 rounded-xl"
            animate={{ boxShadow: ['0 0 12px rgba(255,45,85,0.3)', '0 0 28px rgba(255,45,85,0.55)', '0 0 12px rgba(255,45,85,0.3)'] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          <Zap className="size-4 text-white relative z-10" strokeWidth={2.5} />
        </motion.div>
        <div>
          <div className="text-[13px] font-extrabold tracking-[0.07em]" style={{ color: 'var(--text-1)' }}>
            BANKAIFTP
          </div>
          <div className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
            Drive → YouTube
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="mt-1 flex flex-col gap-0.5 px-3">
        {NAV_ITEMS.map(({ id, label, icon: Icon, badge }, idx) => {
          const active = activeId === id
          const count  = badge ? queueCount : 0
          return (
            <motion.button
              key={id}
              onClick={() => onNavigate(id)}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12 + idx * 0.05, type: 'spring', stiffness: 280, damping: 26 }}
              whileHover={{ x: active ? 0 : 2 }}
              whileTap={{ scale: 0.97 }}
              className="group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition-all duration-150 overflow-hidden"
              style={{
                background: active ? 'var(--accent-dim)' : 'transparent',
                color: active ? 'var(--text-1)' : 'var(--text-3)',
                boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none',
              }}
              onMouseEnter={e => {
                if (!active) e.currentTarget.style.background = 'var(--bg-elevated)'
              }}
              onMouseLeave={e => {
                if (!active) e.currentTarget.style.background = 'transparent'
              }}
            >
              {/* Active glow */}
              {active && (
                <motion.div
                  layoutId="nav-active-glow"
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: 'radial-gradient(ellipse at 0% 50%, rgba(255,45,85,0.15), transparent 70%)',
                  }}
                />
              )}
              <motion.span
                animate={{ color: active ? '#FF2D55' : 'var(--text-3)' }}
                transition={{ duration: 0.15 }}
              >
                <Icon
                  className="size-4 transition-colors"
                  strokeWidth={active ? 2.2 : 1.8}
                />
              </motion.span>
              {label}
              <AnimatePresence>
                {count > 0 && (
                  <motion.span
                    key="badge"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white"
                    style={{
                      background: '#FF2D55',
                      boxShadow: '0 0 10px rgba(255,45,85,0.4)',
                    }}
                  >
                    {count > 99 ? '99+' : count}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          )
        })}
      </nav>

      {/* Footer */}
      <Footer apiLive={apiLive} />
    </motion.aside>
  )
}

// ── Page transition variants ──────────────────────────────────────────────────
const pageVariants = {
  initial: { opacity: 0, y: 10, scale: 0.99 },
  animate: { opacity: 1, y: 0,  scale: 1 },
  exit:    { opacity: 0, y: -6, scale: 0.99 },
}

// ── Inner App (needs Toast context) ──────────────────────────────────────────
function AppInner() {
  const { show } = useToast()

  // One-per-session loading screen (v2 key clears old stale flag)
  // Wipe stale old key once so the versioned check wins
  useEffect(() => { sessionStorage.removeItem('bftp_loaded') }, [])
  const [appReady, setAppReady] = useState<boolean>(() =>
    sessionStorage.getItem('bftp_v2_loaded') === '1'
  )
  const handleLoadDone = () => {
    sessionStorage.setItem('bftp_v2_loaded', '1')
    setAppReady(true)
  }

  const [page, setPage]                   = useState<Page>('overview')
  const [logsClient, setLogsClient]       = useState<string | undefined>()
  const [profileClient, setProfileClient] = useState<string | undefined>()
  const [apiLive, setApiLive]             = useState(false)
  const [queueCount, setQueueCount]       = useState(0)
  const [moreOpen, setMoreOpen]           = useState(false)
  const [runningAll, setRunningAll]       = useState(false)
  const [refreshing, setRefreshing]       = useState(false)

  // ── API health ping ────────────────────────────────────────────────────────
  useEffect(() => {
    const ping = () => getStatus().then(() => setApiLive(true)).catch(() => setApiLive(false))
    ping()
    const t = setInterval(ping, 15000)
    return () => clearInterval(t)
  }, [])

  // ── Queue badge polling ────────────────────────────────────────────────────
  useEffect(() => {
    const poll = () =>
      getQueue()
        .then(d => setQueueCount((d.items ?? []).filter(i => i.status === 'pending_approval').length))
        .catch(() => {})
    poll()
    const t = setInterval(poll, 12000)
    return () => clearInterval(t)
  }, [])

  // ── Navigation ─────────────────────────────────────────────────────────────
  const goToLogs    = (client: string) => { setLogsClient(client); setPage('logs') }
  const goToProfile = (client: string) => { setProfileClient(client); setPage('client-profile') }
  const goTo        = (p: Page)        => setPage(p)

  const handleRunAll = async () => {
    setRunningAll(true)
    try { await runAll(); show('All clients triggered', 'success') }
    catch (e: unknown) { show(e instanceof Error ? e.message : 'Run failed', 'error') }
    finally { setRunningAll(false) }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await new Promise(r => setTimeout(r, 400))
    setRefreshing(false)
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {/* Custom cursor — desktop only */}
      <Cursor />

      {/* Loading screen — once per session */}
      <AnimatePresence mode="wait">
        {!appReady && (
          <LoadingScreen key="loading" onDone={handleLoadDone} />
        )}
      </AnimatePresence>

      <div
        className="relative min-h-screen overflow-hidden"
        style={{ background: 'var(--bg-base)', color: 'var(--text-1)' }}
      >
        {/* ── Animated Premium Background ────────────────────────────────── */}
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          {/* Breathing deep red glow */}
          <motion.div
            className="absolute -top-1/4 -right-1/4 h-3/4 w-3/4 rounded-full bg-breathe"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(255,45,85,0.07) 0%, transparent 70%)',
            }}
            animate={{ opacity: [0.06, 0.12, 0.06] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute -bottom-1/4 -left-1/4 h-3/4 w-3/4 rounded-full"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.05) 0%, transparent 70%)',
            }}
            animate={{
              x: ['0%', '4%', '0%'],
              y: ['0%', '-4%', '0%'],
              opacity: [0.04, 0.08, 0.04],
            }}
            transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <div className="relative z-10 flex min-h-screen">
          {/* Desktop Sidebar */}
          <Sidebar
            page={page}
            apiLive={apiLive}
            queueCount={queueCount}
            onNavigate={goTo}
          />

          {/* Main content */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Mobile header */}
            <MobileHeader
              onRunAll={handleRunAll}
              onRefresh={handleRefresh}
              runningAll={runningAll}
              refreshing={refreshing}
            />

            {/* Top accent line (desktop) */}
            <div className="sticky top-0 z-10 hidden h-px bg-gradient-to-r from-transparent via-red-500/25 to-transparent md:block" />

            {/* Page content */}
            <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
              <div className="p-4 md:p-8">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={page}
                    variants={pageVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {page === 'overview'       && <Overview onViewLogs={goToLogs} onRunAll={handleRunAll} runningAll={runningAll} />}
                    {page === 'queue'          && <Queue onNavigate={goTo} />}
                    {page === 'clients'        && <Clients onViewLogs={goToLogs} onViewProfile={goToProfile} />}
                    {page === 'client-profile' && <ClientProfile client={profileClient ?? ''} onBack={() => setPage('clients')} onViewLogs={goToLogs} />}
                    {page === 'uploads'        && <Uploads />}
                    {page === 'logs'           && <Logs initialClient={logsClient} />}
                    {page === 'settings'       && <SettingsPage />}
                  </motion.div>
                </AnimatePresence>
              </div>
            </main>
          </div>
        </div>

        {/* Mobile bottom nav */}
        <BottomNav
          page={page}
          queueCount={queueCount}
          onNavigate={goTo}
          onMoreOpen={() => setMoreOpen(true)}
        />

        {/* More sheet */}
        <MoreSheet
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          apiLive={apiLive}
          onNavigate={goTo}
        />
      </div>
    </ToastContext.Provider>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  )
}

// Legacy export for page components that import useToast from App
export { useToast } from './components/Toast'
