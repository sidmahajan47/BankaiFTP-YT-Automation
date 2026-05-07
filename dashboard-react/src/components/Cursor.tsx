import { useEffect, useState } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

// Only show on desktop (hover: hover, pointer: fine)
const isTouch = typeof window !== 'undefined'
  && (window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)

export default function Cursor() {
  const [visible,  setVisible]  = useState(false)
  const [hovering, setHovering] = useState(false)
  const [clicking, setClicking] = useState(false)

  const dotX = useMotionValue(-100)
  const dotY = useMotionValue(-100)

  // Ring follows with spring lag
  const ringX = useSpring(dotX, { stiffness: 280, damping: 26, mass: 0.5 })
  const ringY = useSpring(dotY, { stiffness: 280, damping: 26, mass: 0.5 })

  useEffect(() => {
    if (isTouch) return

    // Add class to html for CSS cursor: none
    document.documentElement.classList.add('custom-cursor')

    const onMove = (e: MouseEvent) => {
      dotX.set(e.clientX)
      dotY.set(e.clientY)
      setVisible(true)
    }

    const onOver = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      const interactive = t.closest(
        'button, a, input, textarea, select, label, [role="button"], [role="link"], [tabindex]'
      )
      setHovering(!!interactive)
    }

    const onDown  = () => setClicking(true)
    const onUp    = () => setClicking(false)
    const onLeave = () => setVisible(false)
    const onEnter = () => setVisible(true)

    window.addEventListener('mousemove',   onMove)
    window.addEventListener('mouseover',   onOver)
    window.addEventListener('mousedown',   onDown)
    window.addEventListener('mouseup',     onUp)
    document.addEventListener('mouseleave', onLeave)
    document.addEventListener('mouseenter', onEnter)

    return () => {
      document.documentElement.classList.remove('custom-cursor')
      window.removeEventListener('mousemove',   onMove)
      window.removeEventListener('mouseover',   onOver)
      window.removeEventListener('mousedown',   onDown)
      window.removeEventListener('mouseup',     onUp)
      document.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('mouseenter', onEnter)
    }
  }, [dotX, dotY])

  // Don't render on touch devices
  if (isTouch) return null

  const dotSize  = clicking ? 4  : hovering ? 8  : 6
  const ringSize = clicking ? 20 : hovering ? 44 : 32

  return (
    <>
      {/* Dot — instant tracking */}
      <motion.div
        className="pointer-events-none fixed z-[9999] top-0 left-0"
        style={{ x: dotX, y: dotY }}
        aria-hidden
      >
        <motion.div
          className="rounded-full"
          style={{ background: '#FF2D55', translateX: '-50%', translateY: '-50%' }}
          animate={{
            width:   dotSize,
            height:  dotSize,
            opacity: visible ? 1 : 0,
          }}
          transition={{ duration: 0.1 }}
        />
      </motion.div>

      {/* Ring — spring lag */}
      <motion.div
        className="pointer-events-none fixed z-[9998] top-0 left-0"
        style={{ x: ringX, y: ringY }}
        aria-hidden
      >
        <motion.div
          className="rounded-full"
          style={{ translateX: '-50%', translateY: '-50%', border: '1.5px solid' }}
          animate={{
            width:       ringSize,
            height:      ringSize,
            opacity:     visible ? 1 : 0,
            borderColor: hovering
              ? 'rgba(255,45,85,0.9)'
              : clicking
              ? 'rgba(255,45,85,0.5)'
              : 'rgba(255,45,85,0.4)',
            scale:       clicking ? 0.85 : 1,
          }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        />
      </motion.div>
    </>
  )
}
