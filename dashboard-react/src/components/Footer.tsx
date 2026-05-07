import { motion } from 'framer-motion'
import { Mail, Phone, Link, Zap, ExternalLink, Activity } from 'lucide-react'

export default function Footer({ apiLive = false }: { apiLive?: boolean }) {
  return (
    <footer
      className="relative mt-auto overflow-hidden"
      style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'linear-gradient(180deg, transparent, rgba(255,45,85,0.03))',
      }}
    >
      {/* Ambient glow line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-red-500/30 to-transparent" />

      <div className="px-6 py-6 space-y-5">

        {/* Backend Status */}
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className={`size-2 rounded-full transition-all ${apiLive ? 'dot-pulse' : ''}`}
            style={{ background: apiLive ? 'var(--success)' : 'var(--text-tertiary)' }}
          />
          <span style={{ color: 'var(--text-secondary)' }}>
            {apiLive ? 'Backend live' : 'Demo mode'}
          </span>
        </div>

        {/* Brand row */}
        <div className="flex items-center gap-2.5">
          <div
            className="grid size-7 shrink-0 place-items-center rounded-lg"
            style={{
              background: 'linear-gradient(135deg, var(--accent-red), #c0392b)',
              boxShadow: '0 0 12px var(--accent-red-glow)',
            }}
          >
            <Zap className="size-3.5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div
              className="text-[11px] font-extrabold tracking-[0.08em]"
              style={{ color: 'var(--text-primary)' }}
            >
              BANKAIFTP
            </div>
            <div className="text-[9px] font-medium tracking-[0.04em]" style={{ color: 'var(--text-tertiary)' }}>
              powered by <span style={{ color: 'var(--accent-red)' }}>EverScale</span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border-subtle)' }} />

        {/* Developer info */}
        <div className="space-y-1">
          <div className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--text-tertiary)' }}>
            Designed &amp; Developed by
          </div>
          <div className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>
            Sid Mahajan
          </div>
        </div>

        {/* Contact links */}
        <div className="space-y-2">
          <motion.a
            href="tel:7620860302"
            whileHover={{ x: 2 }}
            className="flex items-center gap-2 text-[11px] group transition-colors"
            style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            <Phone className="size-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
            <span className="group-hover:text-white transition-colors">+91 7620860302</span>
          </motion.a>

          <motion.a
            href="mailto:everscalebusiness@gmail.com"
            whileHover={{ x: 2 }}
            className="flex items-center gap-2 text-[11px] group transition-colors"
            style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            <Mail className="size-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
            <span className="group-hover:text-white transition-colors truncate">everscalebusiness@gmail.com</span>
          </motion.a>

          <motion.a
            href="mailto:sidmahajan47@gmail.com"
            whileHover={{ x: 2 }}
            className="flex items-center gap-2 text-[11px] group transition-colors"
            style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            <Mail className="size-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
            <span className="group-hover:text-white transition-colors truncate">sidmahajan47@gmail.com</span>
          </motion.a>

          <motion.a
            href="https://www.linkedin.com/in/siddheshmahajan47?utm_source=share_via&utm_content=profile&utm_medium=member_android"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ x: 2 }}
            className="flex items-center gap-2 text-[11px] group transition-colors"
            style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            <Link className="size-3 shrink-0" style={{ color: '#0A66C2' }} />
            <span className="group-hover:text-white transition-colors">siddheshmahajan47</span>
            <ExternalLink className="size-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
          </motion.a>
        </div>

        {/* Version badge */}
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold tracking-widest uppercase"
          style={{
            background: 'var(--accent-red-dim)',
            color: 'var(--accent-red)',
            border: '1px solid var(--accent-red-glow)',
          }}
        >
          <span className="size-1.5 rounded-full bg-current animate-pulse" />
          EverScale v2.1
        </div>
      </div>
    </footer>
  )
}
