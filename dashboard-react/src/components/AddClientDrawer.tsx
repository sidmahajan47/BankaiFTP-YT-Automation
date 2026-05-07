import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ChevronRight, FileText, FolderOpen, Loader2, Upload, X } from 'lucide-react'
import { useState, useRef, useCallback } from 'react'
import { addClient, authorizeClient } from '../lib/api'

type Step = 'details' | 'files' | 'authorize' | 'done'

const STEPS: Step[] = ['details', 'files', 'authorize', 'done']
const STEP_LABELS = ['Details', 'Upload Files', 'Authorize', 'Done']

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current)
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={`flex size-6 items-center justify-center rounded-full text-xs font-bold transition ${
            i < idx ? 'bg-emerald-500 text-white' :
            i === idx ? 'bg-red-500 text-white' :
            'bg-zinc-800 text-zinc-600'
          }`}>
            {i < idx ? <CheckCircle2 className="size-4" /> : i + 1}
          </div>
          <span className={`text-xs ${i === idx ? 'text-white font-bold' : 'text-zinc-600'}`}>{STEP_LABELS[i]}</span>
          {i < STEPS.length - 1 && <ChevronRight className="size-3 text-zinc-700" />}
        </div>
      ))}
    </div>
  )
}

function DropZone({ label, accept, file, onFile, icon: Icon }: {
  label: string; accept: string; file: File | null
  onFile: (f: File) => void
  icon: React.ComponentType<{ className?: string }>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }, [onFile])

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 transition ${
        drag ? 'border-red-500 bg-red-500/10' :
        file ? 'border-emerald-500/50 bg-emerald-950/10' :
        'border-white/10 bg-zinc-900/50 hover:border-white/20'
      }`}>
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      {file ? (
        <>
          <CheckCircle2 className="size-8 text-emerald-400" />
          <span className="text-sm font-semibold text-emerald-300">{file.name}</span>
          <span className="text-xs text-zinc-600">Click to replace</span>
        </>
      ) : (
        <>
          <Icon className="size-8 text-zinc-600" />
          <span className="text-sm font-semibold text-zinc-400">{label}</span>
          <span className="text-xs text-zinc-600">Drag & drop or click to browse</span>
        </>
      )}
    </div>
  )
}

type Props = { onClose: () => void; onAdded: () => void }

export default function AddClientDrawer({ onClose, onAdded }: Props) {
  const [step, setStep] = useState<Step>('details')
  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('')
  const [ytFile, setYtFile] = useState<File | null>(null)
  const [kbFile, setKbFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState('')
  const [addedClient, setAddedClient] = useState('')
  const [authStatus, setAuthStatus] = useState<'idle' | 'pending' | 'done'>('idle')

  const slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '')

  const validateDetails = () => {
    const e: Record<string, string> = {}
    if (!slug) e.name = 'Client name is required'
    if (!folderId.trim()) e.folderId = 'Folder ID is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateFiles = () => {
    const e: Record<string, string> = {}
    if (!ytFile) e.ytFile = 'YouTube credentials file is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleDetailsNext = () => {
    if (validateDetails()) setStep('files')
  }

  const handleSubmit = async () => {
    if (!validateFiles()) return
    setLoading(true); setApiError('')
    try {
      const fd = new FormData()
      fd.append('name', slug)
      fd.append('drive_folder_id', folderId.trim())
      fd.append('youtube_credentials', ytFile!)
      if (kbFile) fd.append('knowledge_base', kbFile)
      else fd.append('knowledge_base', new Blob([''], { type: 'text/plain' }), `${slug}.txt`)
      await addClient(fd)
      setAddedClient(slug)
      onAdded()
      setStep('authorize')
    } catch (e: unknown) {
      setApiError(e instanceof Error ? e.message : 'Failed to add client')
    } finally {
      setLoading(false)
    }
  }

  const handleAuthorize = async () => {
    setAuthStatus('pending')
    try {
      await authorizeClient(addedClient)
      setAuthStatus('done')
      setTimeout(() => setStep('done'), 1200)
    } catch {
      setAuthStatus('idle')
      setApiError('Authorization failed. Try manually: python3 drive_to_youtube_uploader.py --client ' + addedClient + ' authorize-youtube')
    }
  }

  return (
    <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-white/10 bg-zinc-950/98 shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <div className="text-base font-extrabold text-white">Add New Client</div>
          <div className="mt-1"><StepIndicator current={step} /></div>
        </div>
        <button onClick={onClose} className="rounded-lg border border-white/10 p-2 text-zinc-400 hover:text-white">
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">

          {/* Step 1: Details */}
          {step === 'details' && (
            <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-zinc-500">Client Name</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. eknath, nashikpg"
                  className={`h-10 w-full rounded-lg border bg-zinc-900/80 px-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-500/50 ${errors.name ? 'border-red-500' : 'border-white/10'}`} />
                {slug && <p className="mt-1 text-xs text-zinc-600">Slug: <span className="font-mono text-zinc-400">{slug}</span></p>}
                {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-zinc-500">
                  <FolderOpen className="mr-1 inline size-3" />Google Drive Folder ID
                </label>
                <input value={folderId} onChange={e => setFolderId(e.target.value)}
                  placeholder="Paste the folder ID from Drive URL"
                  className={`h-10 w-full rounded-lg border bg-zinc-900/80 px-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-500/50 ${errors.folderId ? 'border-red-500' : 'border-white/10'}`} />
                <p className="mt-1 text-xs text-zinc-600">From: drive.google.com/drive/folders/<span className="text-zinc-400">FOLDER_ID</span></p>
                {errors.folderId && <p className="mt-1 text-xs text-red-400">{errors.folderId}</p>}
              </div>
            </motion.div>
          )}

          {/* Step 2: Files */}
          {step === 'files' && (
            <motion.div key="files" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-zinc-500">
                  <Upload className="mr-1 inline size-3" />YouTube OAuth Credentials
                </label>
                <DropZone label="Upload YouTube credentials JSON" accept=".json,application/json"
                  file={ytFile} onFile={setYtFile} icon={Upload} />
                {errors.ytFile && <p className="mt-1 text-xs text-red-400">{errors.ytFile}</p>}
                <p className="mt-1 text-xs text-zinc-600">Download from Google Cloud Console → Credentials → OAuth 2.0 Client IDs</p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-zinc-500">
                  <FileText className="mr-1 inline size-3" />Knowledge Base (Optional)
                </label>
                <DropZone label="Upload knowledge base .txt file" accept=".txt,text/plain"
                  file={kbFile} onFile={setKbFile} icon={FileText} />
                <p className="mt-1 text-xs text-zinc-600">Plain text with channel niche, tone, keywords, location — used by Gemini for SEO</p>
              </div>
              {apiError && <div className="rounded-lg border border-red-500/40 bg-red-950/20 p-3 text-xs text-red-300">{apiError}</div>}
            </motion.div>
          )}

          {/* Step 3: Authorize */}
          {step === 'authorize' && (
            <motion.div key="authorize" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5">
                <CheckCircle2 className="mb-2 size-8 text-emerald-400" />
                <div className="font-bold text-white">Client <span className="font-mono text-emerald-300">"{addedClient}"</span> added!</div>
                <div className="mt-1 text-sm text-zinc-400">Now authorize YouTube access so the system can upload videos to their channel.</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-5 text-sm text-zinc-400">
                <div className="mb-2 font-bold text-zinc-200">How it works:</div>
                <ol className="list-inside list-decimal space-y-1 text-xs">
                  <li>Click "Authorize YouTube" below</li>
                  <li>A browser window will open</li>
                  <li>Log in with the client's YouTube account</li>
                  <li>Allow the requested permissions</li>
                  <li>Token saved automatically ✓</li>
                </ol>
              </div>
              {apiError && <div className="rounded-lg border border-red-500/40 bg-red-950/20 p-3 text-xs text-red-300">{apiError}</div>}
            </motion.div>
          )}

          {/* Step 4: Done */}
          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="grid size-20 place-items-center rounded-full bg-emerald-500/20 ring-4 ring-emerald-500/30">
                <CheckCircle2 className="size-10 text-emerald-400" />
              </div>
              <div>
                <div className="text-xl font-extrabold text-white">All done!</div>
                <div className="mt-1 text-sm text-zinc-400">
                  Client <span className="font-mono font-bold text-white">"{addedClient}"</span> is ready.
                  Drop a video in their Drive folder and it will upload automatically.
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer actions */}
      <div className="border-t border-white/10 px-6 py-4 pb-[calc(1rem+64px)] md:pb-4 flex gap-3">
        {step === 'details' && (
          <>
            <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/10 text-sm text-zinc-400 hover:text-white">Cancel</button>
            <button onClick={handleDetailsNext} className="flex-1 h-10 rounded-lg bg-red-600 font-bold text-white hover:bg-red-500">Next →</button>
          </>
        )}
        {step === 'files' && (
          <>
            <button onClick={() => setStep('details')} className="flex-1 h-10 rounded-lg border border-white/10 text-sm text-zinc-400 hover:text-white">← Back</button>
            <button onClick={handleSubmit} disabled={loading}
              className="flex-1 h-10 rounded-lg bg-red-600 font-bold text-white hover:bg-red-500 disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="size-4 animate-spin" />Saving…</> : 'Add Client'}
            </button>
          </>
        )}
        {step === 'authorize' && (
          <>
            <button onClick={() => { setStep('done') }} className="h-10 rounded-lg border border-white/10 px-4 text-sm text-zinc-400 hover:text-white">Skip for now</button>
            <button onClick={handleAuthorize} disabled={authStatus === 'pending'}
              className="flex-1 h-10 rounded-lg bg-emerald-600 font-bold text-white hover:bg-emerald-500 disabled:opacity-60 flex items-center justify-center gap-2">
              {authStatus === 'pending' ? <><Loader2 className="size-4 animate-spin" />Opening browser…</> :
               authStatus === 'done' ? <><CheckCircle2 className="size-4" />Authorized!</> :
               'Authorize YouTube →'}
            </button>
          </>
        )}
        {step === 'done' && (
          <button onClick={onClose} className="flex-1 h-10 rounded-lg bg-red-600 font-bold text-white hover:bg-red-500">
            Close
          </button>
        )}
      </div>
    </motion.div>
  )
}
