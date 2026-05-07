import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'
export type ToastItem = { id: number; kind: ToastKind; message: string }
type ToastCtxType = { show: (message: string, kind?: ToastKind) => void }

export const ToastContext = createContext<ToastCtxType>({ show: () => {} })
export const useToast = () => useContext(ToastContext)

const CONFIG: Record<ToastKind, {
  icon: React.ComponentType<{ className?: string }>
  color: string
  bg: string
  border: string
}> = {
  success: {
    icon: CheckCircle,
    color: 'var(--success)',
    bg: 'rgba(48,209,88,0.08)',
    border: 'rgba(48,209,88,0.25)',
  },
  error: {
    icon: AlertTriangle,
    color: 'var(--error)',
    bg: 'rgba(255,69,58,0.08)',
    border: 'rgba(255,69,58,0.25)',
  },
  warning: {
    icon: AlertTriangle,
    color: 'var(--warning)',
    bg: 'rgba(255,214,10,0.08)',
    border: 'rgba(255,214,10,0.25)',
  },
  info: {
    icon: Info,
    color: 'var(--info)',
    bg: 'rgba(10,132,255,0.08)',
    border: 'rgba(10,132,255,0.25)',
  },
}

function ToastItem_({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const cfg = CONFIG[toast.kind]
  const Icon = cfg.icon

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 60, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.9 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-start gap-3 rounded-xl px-4 py-3 shadow-2xl"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        minWidth: 280,
        maxWidth: 380,
      }}
    >
      <span className="mt-0.5 shrink-0" style={{ color: cfg.color }}>
        <Icon className="size-4" />
      </span>
      <p className="flex-1 text-sm font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
        {toast.message}
      </p>
      <button
        onClick={onDismiss}
        className="mt-0.5 opacity-50 transition-opacity hover:opacity-100"
        style={{ color: 'var(--text-secondary)' }}
      >
        <X className="size-3.5" />
      </button>
    </motion.div>
  )
}

export function Toaster({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[9999] flex flex-col gap-2 max-md:right-3 max-md:top-auto max-md:bottom-20">
      <AnimatePresence initial={false}>
        {toasts.slice(-3).map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem_
              toast={t}
              onDismiss={() => dismiss(t.id)}
            />
          </div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const dismiss = useCallback((id: number) =>
    setToasts(prev => prev.filter(t => t.id !== id)), [])

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++idRef.current
    setToasts(prev => [...prev.slice(-4), { id, kind, message }])
    setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <Toaster toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}
