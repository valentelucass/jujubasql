import { useState, type MouseEvent } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Database as DatabaseIcon, ExternalLink, ShieldCheck } from 'lucide-react'
import type { Database } from '../models/sql'

const links = [
  { label: 'Referências', url: 'https://github.com/valentelucass/jujubasql#referências' },
  { label: 'Feito por Lucas Andrade', url: 'https://github.com/valentelucass' },
]

export function StatusBar({ endpoint, database }: { endpoint?: string; database?: Database | null }) {
  const [error, setError] = useState(false)

  async function openLink(event: MouseEvent<HTMLAnchorElement>, url: string) {
    if (!isTauri()) return
    event.preventDefault()
    setError(false)
    try { await openUrl(url) }
    catch { setError(true) }
  }

  return <footer className="statusbar">
    <span className="status-permissions"><ShieldCheck size={13} /> Permissões do SQL Server</span>
    {database && <span className="status-context"><DatabaseIcon size={12} /> <span>{database}</span></span>}
    <span className="status-end status-context">{endpoint ?? 'Sessão local'}</span>
    <nav className="status-links" aria-label="Créditos do JujubaSQL">
      {links.map(({ label, url }) => <a key={url} href={url} target="_blank" rel="noopener noreferrer"
        onClick={(event) => void openLink(event, url)}>
        {label}<ExternalLink size={11} aria-hidden="true" />
      </a>)}
    </nav>
    {error && <span className="status-error" role="alert">Não foi possível abrir o link.</span>}
  </footer>
}
