import { motion } from 'framer-motion'
import { Check, Eye, EyeOff, Loader2, Save, Send, Shield, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getClients, getSettings, getTokenHealth, putSchedule, saveSettings, sendTelegramTest, testDriveConnection } from '../lib/api'
import type { ClientStatus, ScheduleConfig, Settings, TokensHealth } from '../lib/api'
import { useToast } from '../App'

// ── Shared Input ──────────────────────────────────────────────────────────────
// ── Masked / password input ───────────────────────────────────────────────────
function MaskedInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative flex-1">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl py-2.5 pl-3 pr-10 text-sm outline-none transition-all"
        style={{
          height: 44,
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          color: 'var(--text-primary)',
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
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
        style={{ color: 'var(--text-tertiary)' }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

// ── Status Dot ────────────────────────────────────────────────────────────────
function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-flex size-2 shrink-0 rounded-full"
      style={{
        background: ok ? 'var(--success)' : 'var(--error)',
        boxShadow: ok ? '0 0 8px rgba(48,209,88,0.5)' : '0 0 8px rgba(255,69,58,0.4)',
      }}
    />
  )
}

// ── Section Card ──────────────────────────────────────────────────────────────
function Section({ title, accent, children }: {
  title: string; accent: string; children: React.ReactNode
}) {
  return (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <h2 className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

// ── Field ─────────────────────────────────────────────────────────────────────
function Field({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {sub && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{sub}</p>}
      {children}
    </div>
  )
}

// ── Credential Row ────────────────────────────────────────────────────────────
function CredRow({ label, path, ok, okLabel, failLabel }: {
  label: string; path?: string; ok: boolean; okLabel: string; failLabel: string
}) {
  return (
    <div
      className="flex items-center justify-between rounded-xl px-4 py-3"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="min-w-0">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</div>
        <div className="mt-0.5 truncate font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{path ?? '—'}</div>
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-1.5 text-xs">
        <StatusDot ok={ok} />
        <span style={{ color: ok ? 'var(--success)' : 'var(--error)' }}>{ok ? okLabel : failLabel}</span>
      </div>
    </div>
  )
}

// ── Token Health Bar ──────────────────────────────────────────────────────────
const healthColor = (h?: string) => ({
  good: 'var(--success)', warning: 'var(--warning)', critical: 'var(--warning)', expired: 'var(--error)',
}[h ?? ''] ?? 'var(--text-tertiary)')

// ── Schedule Editor ───────────────────────────────────────────────────────────
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function ScheduleEditor({ client, schedule, onSave }: {
  client: string; schedule: ScheduleConfig; onSave: (s: ScheduleConfig) => void
}) {
  const [s, setS]   = useState<ScheduleConfig>({ ...schedule })
  const [dirty, setDirty] = useState(false)

  const update = (patch: Partial<ScheduleConfig>) => { setS(prev => ({ ...prev, ...patch })); setDirty(true) }
  const toggleDay  = (day: string) => {
    const days = s.days_active.includes(day) ? s.days_active.filter(d => d !== day) : [...s.days_active, day]
    update({ days_active: days })
  }
  const addTime    = () => update({ upload_times: [...s.upload_times, '10:00'] })
  const removeTime = (i: number) => update({ upload_times: s.upload_times.filter((_, idx) => idx !== i) })
  const setTime    = (i: number, v: string) => update({ upload_times: s.upload_times.map((t, idx) => idx === i ? v : t) })

  return (
    <div className="space-y-4">
      {/* Client toggle row */}
      <div className="flex items-center justify-between">
        <span className="font-bold capitalize" style={{ color: 'var(--text-primary)' }}>{client}</span>
        <button
          onClick={() => update({ enabled: !s.enabled })}
          className="relative flex h-6 w-11 items-center rounded-full transition-all"
          style={{ background: s.enabled ? 'var(--accent-red)' : 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
        >
          <span
            className="absolute size-4 rounded-full bg-white transition-transform shadow-sm"
            style={{ left: s.enabled ? 'calc(100% - 20px)' : 4 }}
          />
        </button>
      </div>

      {s.enabled && (
        <>
          {/* Days */}
          <div className="flex flex-wrap gap-1">
            {DAYS.map(d => (
              <button key={d} onClick={() => toggleDay(d)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase transition-all"
                style={{
                  background: s.days_active.includes(d) ? 'var(--accent-red-dim)' : 'var(--bg-elevated)',
                  border: `1px solid ${s.days_active.includes(d) ? 'var(--accent-red)' : 'var(--border-default)'}`,
                  color: s.days_active.includes(d) ? 'var(--accent-red)' : 'var(--text-tertiary)',
                }}>
                {d}
              </button>
            ))}
          </div>

          {/* Time slots */}
          <div className="space-y-2">
            {s.upload_times.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="time" value={t} onChange={e => setTime(i, e.target.value)}
                  className="h-10 rounded-xl px-3 text-sm outline-none transition-all"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                    fontSize: 16,
                  }} />
                <button onClick={() => removeTime(i)} className="size-8 flex items-center justify-center rounded-lg transition"
                  style={{ color: 'var(--text-tertiary)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--error)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <button onClick={addTime} className="text-xs font-semibold transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>
              + Add time slot
            </button>
          </div>

          {/* Max per day */}
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Max per day</span>
            <input type="number" min={1} max={10} value={s.max_per_day}
              onChange={e => update({ max_per_day: parseInt(e.target.value) || 2 })}
              className="h-10 w-20 rounded-xl px-3 text-sm outline-none"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                fontSize: 16,
              }} />
          </div>
        </>
      )}

      <motion.button
        whileTap={{ scale: 0.96 }}
        disabled={!dirty}
        onClick={() => { onSave(s); setDirty(false) }}
        className="flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-40"
        style={{ background: 'var(--accent-red)' }}
      >
        <Save className="size-4" /> Save Schedule
      </motion.button>
    </div>
  )
}

// ── Main Settings ─────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { show }                              = useToast()
  const [settings, setSettings]               = useState<Settings | null>(null)
  const [clients, setClients]                 = useState<ClientStatus[]>([])
  const [tokenHealth, setTokenHealth]         = useState<TokensHealth>({})
  const [geminiKey, setGeminiKey]             = useState('')
  const [telegramToken, setTelegramToken]     = useState('')
  const [pollInterval, setPollInterval]       = useState('3600')
  const [geminiModel, setGeminiModel]         = useState('gemini-2.5-flash')
  const [saving, setSaving]                   = useState(false)
  const [saved, setSaved]                     = useState(false)
  const [testingDrive, setTestingDrive]       = useState(false)
  const [testingTg, setTestingTg]             = useState(false)
  const [schedules, setSchedules]             = useState<Record<string, ScheduleConfig>>({})

  useEffect(() => {
    Promise.all([getSettings(), getClients(), getTokenHealth()]).then(([s, { clients: cls }, th]) => {
      setSettings(s); setClients(cls); setTokenHealth(th)
      setPollInterval(String(s.poll_interval_seconds))
      setGeminiModel(s.gemini_model)
      const sched: Record<string, ScheduleConfig> = {}
      cls.forEach(c => {
        sched[c.name] = { enabled: false, upload_times: [], timezone: 'Asia/Kolkata', max_per_day: 2, days_active: ['mon','tue','wed','thu','fri','sat','sun'] }
      })
      setSchedules(sched)
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { POLL_INTERVAL_SECONDS: pollInterval, GEMINI_MODEL: geminiModel }
      if (geminiKey) payload.GEMINI_API_KEY_1 = geminiKey
      if (telegramToken) payload.TELEGRAM_BOT_TOKEN = telegramToken
      await saveSettings(payload)
      setSaved(true); setTimeout(() => setSaved(false), 3000)
      setSettings(await getSettings())
      show('Settings saved ✓', 'success')
    } catch (e: unknown) { show(e instanceof Error ? e.message : 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  const INTERVALS = [
    { label: '5 min',  value: '300' },   { label: '15 min', value: '900' },
    { label: '30 min', value: '1800' },  { label: '1 hr',   value: '3600' },
    { label: '6 hr',   value: '21600' }, { label: '12 hr',  value: '43200' },
  ]

  const scanDesc = INTERVALS.find(iv => iv.value === pollInterval)
  const scansPerDay = scanDesc ? Math.round(86400 / parseInt(pollInterval)) : null

  return (
    <div className="max-w-2xl space-y-5 pb-24 md:pb-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text-primary)' }}>Settings</h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>System configuration — sensitive values are masked</p>
      </div>

      {/* Google Drive */}
      <Section title="Google Drive (Shared)" accent="var(--info)">
        <CredRow
          label="Drive Credentials (sid.json)"
          path={settings?.drive_credentials?.path}
          ok={settings?.drive_credentials?.exists ?? false}
          okLabel="Connected" failLabel="Missing"
        />
        <CredRow
          label="Drive Token"
          path={settings?.drive_token?.path}
          ok={settings?.drive_token?.exists ?? false}
          okLabel="Authorized" failLabel="Not authorized"
        />
        <motion.button
          whileTap={{ scale: 0.96 }}
          disabled={testingDrive}
          onClick={() => {
            setTestingDrive(true)
            testDriveConnection()
              .then(d => show(d.message ?? 'Connected to Drive ✓', 'success'))
              .catch(e => show(e.message, 'error'))
              .finally(() => setTestingDrive(false))
          }}
          className="flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
        >
          {testingDrive ? <Loader2 className="size-4 animate-spin" /> : <Shield className="size-4" />}
          Test Connection →
        </motion.button>
      </Section>

      {/* Token Health */}
      <Section title="Token Health" accent="#BF5AF2">
        <div className="space-y-3">
          {clients.map(c => {
            const th = tokenHealth[c.name]
            if (!th) return null
            const ytDays = th.youtube_token?.days_remaining ?? 0
            const pct    = Math.min(100, Math.max(0, (ytDays / 60) * 100))
            return (
              <div key={c.name} className="rounded-xl px-4 py-3 space-y-2"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <div className="font-bold capitalize" style={{ color: 'var(--text-primary)' }}>{c.name}</div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {[{ label: 'Drive', info: th.drive_token }, { label: 'YouTube', info: th.youtube_token }].map(({ label, info }) => (
                    <div key={label}>
                      <span style={{ color: 'var(--text-tertiary)' }}>{label}: </span>
                      <span className="font-bold" style={{ color: healthColor(info?.health) }}>{info?.health ?? '—'}</span>
                      {info?.days_remaining != null && (
                        <span className="ml-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>({info.days_remaining}d)</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-base)' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{ background: pct > 50 ? 'var(--success)' : pct > 20 ? 'var(--warning)' : 'var(--error)' }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* API Keys */}
      <Section title="API Keys" accent="#FF9F0A">
        <Field label="Gemini API Key" sub="Leave blank to keep existing key(s)">
          <div className="flex items-center gap-2">
            <MaskedInput value={geminiKey} onChange={setGeminiKey} placeholder="Enter new Gemini key…" />
            <StatusDot ok={settings?.gemini_api_key_set ?? false} />
          </div>
          {(settings?.gemini_key_count ?? 0) > 0 && (
            <p className="text-xs" style={{ color: 'var(--success)' }}>
              ✓ {settings?.gemini_key_count} key{(settings?.gemini_key_count ?? 0) > 1 ? 's' : ''} configured (auto-rotated)
            </p>
          )}
        </Field>

        <Field label="Telegram Bot Token" sub="Leave blank to keep existing token">
          <div className="flex items-center gap-2">
            <MaskedInput value={telegramToken} onChange={setTelegramToken} placeholder="Enter new token…" />
            <StatusDot ok={settings?.telegram_token_set ?? false} />
          </div>
        </Field>

        <motion.button
          whileTap={{ scale: 0.96 }}
          disabled={testingTg}
          onClick={() => {
            setTestingTg(true)
            sendTelegramTest()
              .then(d => show(d.message ?? 'Test message sent!', 'success'))
              .catch(e => show(e.message, 'error'))
              .finally(() => setTestingTg(false))
          }}
          className="flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
        >
          {testingTg ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send Test Message
        </motion.button>
      </Section>

      {/* Automation */}
      <Section title="Automation" accent="#FF9F0A">
        <Field label="Scan Interval">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {INTERVALS.map(iv => (
              <button
                key={iv.value}
                onClick={() => setPollInterval(iv.value)}
                className="rounded-xl py-2 text-xs font-bold transition-all"
                style={{
                  background: pollInterval === iv.value ? 'var(--accent-red-dim)' : 'var(--bg-elevated)',
                  border: `1px solid ${pollInterval === iv.value ? 'var(--accent-red)' : 'var(--border-default)'}`,
                  color: pollInterval === iv.value ? 'var(--accent-red)' : 'var(--text-tertiary)',
                }}
              >
                {iv.label}
              </button>
            ))}
          </div>
          {scansPerDay && (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              ~{scansPerDay} scans/day · {scanDesc?.label} interval
            </p>
          )}
        </Field>

        <Field label="Gemini Model">
          <select
            value={geminiModel}
            onChange={e => setGeminiModel(e.target.value)}
            className="h-11 w-full rounded-xl px-3 text-sm outline-none"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
              fontSize: 16,
            }}
          >
            {['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
      </Section>

      {/* Schedule */}
      {clients.length > 0 && (
        <Section title="Upload Schedule (per client)" accent="#0A84FF">
          <div className="space-y-5 divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
            {clients.map(c => (
              <div key={c.name} className="pt-4 first:pt-0">
                <ScheduleEditor
                  client={c.name}
                  schedule={schedules[c.name] ?? { enabled: false, upload_times: [], timezone: 'Asia/Kolkata', max_per_day: 2, days_active: ['mon','tue','wed','thu','fri','sat','sun'] }}
                  onSave={s => putSchedule(c.name, s).then(() => show(`Schedule saved for ${c.name}`, 'success')).catch(e => show(e.message, 'error'))}
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Save button — sticky on mobile */}
      <div className="fixed bottom-16 left-0 right-0 z-30 p-4 md:static md:bottom-auto md:p-0">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleSave}
          disabled={saving}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60 md:h-10 md:w-auto md:px-8"
          style={{
            background: saved ? 'var(--success)' : 'var(--accent-red)',
            boxShadow: saved ? '0 0 20px rgba(48,209,88,0.3)' : undefined,
          }}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved ? (
            <><Check className="size-4" /> Saved!</>
          ) : (
            <><Save className="size-4" /> Save Settings</>
          )}
        </motion.button>
      </div>
    </div>
  )
}
