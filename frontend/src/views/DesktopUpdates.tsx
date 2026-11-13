import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { Download, RefreshCw } from 'lucide-react'

const Updates = createContext<{ open: () => void; available: boolean } | null>(null)
type Status = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'error'

export function DesktopUpdates({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [version, setVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const resource = useRef<Update | null>(null)
  const checkInProgress = useRef(false)
  const manualCheck = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const busy = status === 'downloading' || status === 'installing'

  async function search(manual: boolean) {
    manualCheck.current ||= manual
    if (checkInProgress.current || busy) return
    checkInProgress.current = true
    setStatus('checking')
    try {
      const found = await check({ timeout: 12000 })
      const previous = resource.current
      resource.current = found
      if (previous) void previous.close().catch(() => {})
      setVersion(found?.version ?? null)
      setStatus(found ? 'available' : 'current')
    } catch {
      setError('Não foi possível consultar o GitHub. Tente novamente em instantes.')
      setStatus(manualCheck.current ? 'error' : 'idle')
    } finally {
      checkInProgress.current = false
      manualCheck.current = false
    }
  }

  useEffect(() => {
    if (!isTauri()) return
    const timer = window.setTimeout(() => { void search(false) }, 1000)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (visible && !dialog.current?.open) dialog.current?.showModal()
    if (!visible && dialog.current?.open) dialog.current.close()
  }, [visible])

  async function install() {
    const update = resource.current
    if (!update || busy) return
    setStatus('downloading')
    setProgress(null)
    let total = 0
    let downloaded = 0
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0
        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          if (total > 0) setProgress(Math.min(100, Math.round(downloaded / total * 100)))
        }
        if (event.event === 'Finished') setStatus('installing')
      }, { timeout: 180000 })
    } catch {
      setError('Não foi possível baixar, validar ou instalar a atualização. Confira a conexão e tente novamente.')
      setStatus('error')
    }
  }

  if (!isTauri()) return children
  return <Updates.Provider value={{ available: version !== null, open: () => {
    setVisible(true)
    if (!resource.current) void search(true)
  } }}>
    {children}
    <dialog ref={dialog} className="connection-dialog update-dialog" aria-labelledby="update-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) setVisible(false) }}>
      <h2 id="update-title">Atualizações do JujubaSQL</h2>
      <div role="status">
        {status === 'checking' && <p>Verificando se há uma nova versão…</p>}
        {status === 'current' && <p>Você já está na versão mais recente.</p>}
        {status === 'available' && <p>A versão <strong>{version}</strong> está disponível. Salve seu trabalho antes de atualizar. O aplicativo será fechado para a instalação.</p>}
        {status === 'downloading' && <><p>Baixando atualização{progress === null ? '…' : ' · ' + progress + '%'}</p>
          <progress aria-label="Progresso da atualização" max={100} value={progress ?? undefined} /></>}
        {status === 'installing' && <p>Validando e iniciando o instalador…</p>}
      </div>
      {status === 'error' && <p role="alert">{error}</p>}
      <div className="update-actions">
        <button className="button" disabled={busy} onClick={() => setVisible(false)}>{version ? 'Mais tarde' : 'Fechar'}</button>
        {(status === 'available' || (status === 'error' && version)) &&
          <button className="button primary" onClick={() => void install()}><Download size={15} />Atualizar agora</button>}
        {(status === 'current' || (status === 'error' && !version)) &&
          <button className="button" onClick={() => void search(true)}><RefreshCw size={14} />Verificar novamente</button>}
      </div>
    </dialog>
  </Updates.Provider>
}

export function UpdateButton() {
  const updates = useContext(Updates)
  if (!updates) return null
  return <button type="button" className={`update-button${updates.available ? ' available' : ''}`} onClick={updates.open}>
    <Download size={12} />{updates.available ? 'Atualização disponível' : 'Atualizações'}
  </button>
}
