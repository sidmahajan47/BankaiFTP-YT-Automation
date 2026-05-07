// Centralised API helpers — all components import from here
const BASE = ''  // same origin

export async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

// ── Types ──────────────────────────────────────────────────────────────────────
export type ClientStatus = {
  name: string
  drive_folder_id?: string
  health?: 'ok' | 'attention'
  running?: boolean
  issues?: string[]
  activity?: { message?: string; timestamp?: string }
  summary?: { total?: number; new?: number; uploaded?: number; failed?: number }
  uploads?: { count?: number; latest?: { youtube_id?: string; drive_id?: string; file_name?: string; uploaded_at?: string } | null }
  log?: { errors?: number; warnings?: number; last_error?: { message?: string } | null }
}

export type StatusPayload = {
  generated_at?: string
  health?: 'ok' | 'attention'
  multi?: boolean
  clients?: ClientStatus[]
}

export type UploadRecord = {
  drive_id: string
  youtube_id?: string
  file_name?: string
  uploaded_at?: string
  client?: string
}

export type LogEntry = {
  timestamp?: string
  level?: string
  message?: string
  raw?: string
}

export type Settings = {
  drive_credentials: { path: string; exists: boolean }
  drive_token: { path: string; exists: boolean }
  gemini_api_key_set: boolean
  gemini_key_count?: number
  telegram_token_set: boolean
  poll_interval_seconds: number
  gemini_model: string
}

// ── API calls ──────────────────────────────────────────────────────────────────
export const getStatus = () => apiFetch<StatusPayload>('/api/status')
export const getClients = () => apiFetch<{ clients: ClientStatus[] }>('/api/clients')
export const getSettings = () => apiFetch<Settings>('/api/settings')
export const saveSettings = (data: Partial<Settings & Record<string, unknown>>) =>
  apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(data) })

export const getLogs = (client: string, limit = 200) =>
  apiFetch<{ client: string; entries: LogEntry[] }>(`/api/logs/${client}?limit=${limit}`)

export const getUploads = (client: string) =>
  apiFetch<{ client: string; records: UploadRecord[] }>(`/api/uploads/${client}`)

export const runClient = (name: string) =>
  apiFetch(`/api/run/${name}`, { method: 'POST' })

export const runAll = () => apiFetch('/api/run/all', { method: 'POST' })

export const deleteClient = (name: string) =>
  apiFetch(`/api/clients/${name}`, { method: 'DELETE' })

export const authorizeClient = (name: string) =>
  apiFetch(`/api/clients/${name}/authorize`, { method: 'POST' })

export const getKnowledge = (name: string) =>
  apiFetch<{ ok: boolean; content: string }>(`/api/clients/${name}/knowledge`)

export const putKnowledge = (name: string, content: string) =>
  apiFetch(`/api/clients/${name}/knowledge`, { method: 'PUT', body: JSON.stringify({ content }) })

export function addClient(formData: FormData) {
  return fetch('/api/clients/add', { method: 'POST', body: formData }).then(async r => {
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? 'Failed to add client')
    return j
  })
}


// ── New Types ───────────────────────────────────────────────────────────────────

export type QueueItem = {
  file_id: string
  filename: string
  client: string
  status: 'pending_approval' | 'approved' | 'skipped'
  title: string
  description: string
  tags: string[]
  queued_at?: string
  generated_at?: string
}

export type TokenInfo = {
  status: 'valid' | 'expired' | 'missing' | 'unreadable'
  expires_at: string | null
  days_remaining: number | null
  health: 'good' | 'warning' | 'critical' | 'expired' | 'unknown'
}

export type ClientTokenHealth = {
  drive_token: TokenInfo
  youtube_token: TokenInfo
}

export type TokensHealth = Record<string, ClientTokenHealth>

export type FailedUpload = {
  file_id: string
  filename: string
  client: string
  failed_at: string
  reason: string
  retry_count: number
  max_retries: number
  next_retry_at: string
  status: 'pending_retry' | 'retrying' | 'permanently_failed'
}

export type ScheduleConfig = {
  enabled: boolean
  upload_times: string[]
  timezone: string
  max_per_day: number
  days_active: string[]
}

export type ScheduleEvent = {
  client: string
  date: string
  time: string
  datetime: string
}

export type ClientProfile = {
  name: string
  drive_folder_id: string
  health: 'ok' | 'attention'
  issues: string[]
  running: boolean
  activity: { message: string; timestamp: string }
  summary: { total: number; new: number; uploaded: number; failed: number } | null
  uploads: { count: number; latest: UploadRecord | null }
  tokens: { drive: { path: string; exists: boolean; size: number; modified: string }; youtube: { path: string; exists: boolean; size: number; modified: string } }
  credentials: { drive: { path: string; exists: boolean }; youtube: { path: string; exists: boolean } }
  log: { errors: number; warnings: number; last_error: { message: string } | null }
  token_health: ClientTokenHealth
  schedule: ScheduleConfig
  knowledge_chars: number
  youtube_credentials_file: string
}

// ── Queue API ───────────────────────────────────────────────────────────────────
export const getQueue = () =>
  apiFetch<{ items: QueueItem[] }>('/api/queue')

export const previewVideo = (client: string, fileId: string) =>
  apiFetch<{ ok: boolean; title: string; description: string; tags: string[] }>(
    `/api/queue/${client}/${fileId}/preview`, { method: 'POST' }
  )

export const approveVideo = (client: string, fileId: string, metadata: { title: string; description: string; tags: string[] }) =>
  apiFetch<{ ok: boolean; message: string; pid?: number }>(
    `/api/queue/${client}/${fileId}/approve`, { method: 'POST', body: JSON.stringify(metadata) }
  )

export const rejectVideo = (client: string, fileId: string, reason: string) =>
  apiFetch<{ ok: boolean; title: string; description: string; tags: string[] }>(
    `/api/queue/${client}/${fileId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }
  )

export const skipVideo = (client: string, fileId: string) =>
  apiFetch<{ ok: boolean; message: string }>(
    `/api/queue/${client}/${fileId}/skip`, { method: 'POST' }
  )

// ── Token Health API ────────────────────────────────────────────────────────────
export const getTokenHealth = () =>
  apiFetch<TokensHealth>('/api/tokens/health')

export const refreshToken = (client: string) =>
  apiFetch<{ ok: boolean; message: string }>(`/api/tokens/${client}/refresh`, { method: 'POST' })

export const reauthorizeToken = (client: string) =>
  apiFetch<{ ok: boolean; message: string; pid?: number }>(`/api/tokens/${client}/reauthorize`, { method: 'POST' })

// ── Failed Uploads API ──────────────────────────────────────────────────────────
export const getFailedUploads = () =>
  apiFetch<{ items: FailedUpload[] }>('/api/failed')

export const retryFailed = (client: string, fileId: string) =>
  apiFetch<{ ok: boolean; message: string; pid?: number }>(
    `/api/failed/${client}/${fileId}/retry`, { method: 'POST' }
  )

export const dismissFailed = (client: string, fileId: string) =>
  apiFetch<{ ok: boolean; message: string }>(
    `/api/failed/${client}/${fileId}/dismiss`, { method: 'POST' }
  )

export const retryAllFailed = () =>
  apiFetch<{ ok: boolean; retried: number }>('/api/failed/retry-all', { method: 'POST' })

// ── Schedule API ────────────────────────────────────────────────────────────────
export const getSchedule = () =>
  apiFetch<Record<string, ScheduleConfig>>('/api/schedule')

export const putSchedule = (client: string, schedule: ScheduleConfig) =>
  apiFetch<{ ok: boolean; message: string }>(
    `/api/schedule/${client}`, { method: 'PUT', body: JSON.stringify(schedule) }
  )

export const getUpcomingSchedule = (days = 7) =>
  apiFetch<{ events: ScheduleEvent[] }>(`/api/schedule/upcoming?days=${days}`)

// ── Client Profile API ──────────────────────────────────────────────────────────
export const getClientProfile = (name: string) =>
  apiFetch<{ ok: boolean; profile: ClientProfile }>(`/api/clients/${name}/profile`)

export const getClientVideos = (name: string) =>
  apiFetch<{ ok: boolean; client: string; videos: UploadRecord[] }>(`/api/clients/${name}/videos`)

// ── Test / Utility API ──────────────────────────────────────────────────────────
export const testDriveConnection = () =>
  apiFetch<{ ok: boolean; message?: string; error?: string }>('/api/test/drive', { method: 'POST' })

export const sendTelegramTest = () =>
  apiFetch<{ ok: boolean; message?: string; error?: string }>('/api/test/telegram', { method: 'POST' })
