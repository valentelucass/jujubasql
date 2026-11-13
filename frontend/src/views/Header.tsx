import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Database, Plug, Power, Search } from 'lucide-react'
import jujuba from '../assets/jujuba.png'
import type { Connection, Database as DatabaseName } from '../models/sql'

export function Header({ connection, database, onConnect, onDisconnect, onDatabase, tools, disconnecting }: {
  tools?: ReactNode
  disconnecting?: boolean
  connection?: Connection
  database?: DatabaseName | null
  onConnect?: () => void
  onDisconnect?: () => void
  onDatabase?: (db: DatabaseName) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdown = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      if (event.target instanceof Node && !dropdown.current?.contains(event.target)) setOpen(false)
    }
    if (!open) return
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [open])

  const matches = connection?.databases.filter((db) => db.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? []
  function select(db: string) {
    onDatabase?.(db)
    setOpen(false)
    picker.current?.focus()
  }

  return <header className="topbar">
    <div className="wordmark"><span className="brand-mark" aria-hidden="true"><img src={jujuba} alt="" /></span><strong>Jujuba<span>SQL</span></strong></div>
    <div className="header-divider" />
    {connection ? <button className="button header-connect" onClick={onDisconnect} disabled={disconnecting} title="Desconectar">
      <Power size={15} /><span>Desconectar</span></button> :
      <button className="button primary header-connect" onClick={onConnect}><Plug size={15} /><span>Conectar</span></button>}
    <div className="database-picker" ref={dropdown}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { setOpen(false); picker.current?.focus() } }}>
      <button ref={picker} className="button database-button" aria-expanded={open} disabled={!connection}
        onClick={() => { setSearch(''); setOpen(!open) }}><Database size={15} />
        <span>{database ?? 'Selecionar banco'}</span><ChevronDown size={14} /></button>
      {open && connection && <div className="db-popover">
        <label className="search-field"><Search size={16} /><input autoFocus aria-label="Buscar banco" placeholder="Buscar banco…"
          value={search} onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !matches[0]) return
            event.preventDefault()
            select(matches[0])
          }} /></label>
        <div className="db-options">{matches.map((db) => <button key={db} onClick={() => select(db)}>
          <Database size={15} /><span>{db}</span>{db === database && <Check size={14} />}</button>)}
          {!matches.length && <p>Nenhum banco encontrado.</p>}
        </div>
      </div>}
    </div>
    {tools}
    <div className="header-spacer" />
    <span className={`connection-status${connection ? ' online' : ''}`}><i />{connection ? 'Conectado' : 'Desconectado'}</span>
  </header>
}
