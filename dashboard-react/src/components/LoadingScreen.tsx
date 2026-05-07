import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

// ── Particle system ─────────────────────────────────────────────────────────
interface Particle {
  x: number; y: number
  vx: number; vy: number
  size: number; opacity: number
}

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const particles: Particle[] = Array.from({ length: 55 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      size: Math.random() * 1.8 + 0.4,
      opacity: Math.random() * 0.35 + 0.08,
    }))

    let animId: number
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      particles.forEach(p => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,45,85,${p.opacity})`
        ctx.fill()
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0)             p.x = canvas.width
        if (p.x > canvas.width)  p.x = 0
        if (p.y < 0)             p.y = canvas.height
        if (p.y > canvas.height) p.y = 0
      })
      animId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0" />
}

// ── Loading messages ────────────────────────────────────────────────────────
const MESSAGES = [
  'Connecting to Drive…',
  'Loading clients…',
  'Calibrating AI engine…',
  'Ready ✓',
]

const CHARS = 'BANKAIFTP'.split('')

// ── Main Component ──────────────────────────────────────────────────────────
// NOTE: exit animation is driven by parent's AnimatePresence.
// onDone is called after 2.6s; parent removes this component, triggering exit={}.
export default function LoadingScreen({ onDone }: { onDone: () => void }) {
  const [msgIdx, setMsgIdx]     = useState(0)
  const [progress, setProgress] = useState(0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []

    // Progress steps
    const steps: [number, number][] = [
      [350,  28],
      [850,  55],
      [1400, 80],
      [2000, 100],
    ]
    steps.forEach(([delay, pct]) =>
      timers.push(setTimeout(() => setProgress(pct), delay))
    )

    // Message cycling
    ;[350, 850, 1400, 2050].forEach((delay, i) =>
      timers.push(setTimeout(() => setMsgIdx(i), delay))
    )

    // Tell parent to remove us after 2.6s — parent's AnimatePresence plays exit
    timers.push(setTimeout(() => onDoneRef.current(), 2600))

    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <motion.div
      key="loading-screen"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden select-none"
      style={{ background: '#080808' }}
      initial={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Particle field */}
      <ParticleField />

      {/* Radial glow behind logo */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 50% 35% at 50% 50%, rgba(255,45,85,0.12), transparent)',
        }}
      />

      {/* ── Center content ── */}
      <div className="relative z-10 flex flex-col items-center gap-8">

        {/* Lightning bolt logo box */}
        <motion.div
          initial={{ opacity: 0, scale: 0.5, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.34, 1.56, 0.64, 1] }}
          className="relative"
        >
          {/* Pulsing glow ring */}
          <motion.div
            className="absolute -inset-3 rounded-3xl"
            animate={{
              boxShadow: [
                '0 0 20px rgba(255,45,85,0.25)',
                '0 0 50px rgba(255,45,85,0.50)',
                '0 0 20px rgba(255,45,85,0.25)',
              ],
            }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div
            className="relative grid size-20 place-items-center rounded-2xl"
            style={{
              background: 'linear-gradient(135deg, #FF2D55 0%, #c0392b 100%)',
              boxShadow: '0 0 40px rgba(255,45,85,0.45)',
            }}
          >
            <svg width="36" height="44" viewBox="0 0 18 24" fill="none">
              <motion.path
                d="M11 2L3 14h7l-1 8 9-12h-7z"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.9, ease: 'easeInOut' }}
              />
            </svg>
          </div>
        </motion.div>

        {/* BANKAIFTP — character-by-character reveal */}
        <div className="flex items-center" style={{ gap: '2px' }}>
          {CHARS.map((char, i) => (
            <motion.span
              key={i}
              className="font-black"
              style={{
                fontFamily: 'Inter, sans-serif',
                color: '#F5F5F7',
                fontSize: 'clamp(2.2rem, 6vw, 3.5rem)',
                letterSpacing: '0.1em',
                lineHeight: 1,
              }}
              initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{
                delay: 0.55 + i * 0.06,
                duration: 0.45,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {char}
            </motion.span>
          ))}
        </div>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3, duration: 0.5 }}
          style={{
            fontFamily: 'Inter, sans-serif',
            color: 'rgba(255,255,255,0.28)',
            fontSize: '0.7rem',
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          Drive&nbsp;→&nbsp;YouTube Automation
        </motion.p>
      </div>

      {/* ── Bottom — progress bar + messages ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.5 }}
        className="absolute bottom-12 left-0 right-0 z-10 flex flex-col gap-3 px-12 md:px-28"
      >
        {/* Cycling message */}
        <AnimatePresence mode="wait">
          <motion.p
            key={msgIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="text-center"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.7rem',
              letterSpacing: '0.1em',
              color: 'rgba(255,45,85,0.7)',
            }}
          >
            {MESSAGES[msgIdx]}
          </motion.p>
        </AnimatePresence>

        {/* Progress bar */}
        <div
          className="h-[1.5px] w-full overflow-hidden rounded-full"
          style={{ background: 'rgba(255,255,255,0.07)' }}
        >
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, #FF2D55, #FF6B81, #FF2D55)', backgroundSize: '200% 100%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </motion.div>
    </motion.div>
  )
}
