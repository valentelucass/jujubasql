import { useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, Database, Folder, PanelLeft, Server, Table2, Columns3 } from 'lucide-react'
import type { TreeItem } from '../controllers/useExplorer'

const icons = { server: Server, database: Database, folder: Folder, table: Table2, column: Columns3 }

export function Explorer({ items, connected }: { items: TreeItem[]; connected: boolean }) {
  const [focused, setFocused] = useState('')
  const tree = useRef<HTMLDivElement>(null)
  const active = items.some((item) => item.id === focused) ? focused : items[0]?.id

  function focus(index: number) {
    const item = items[index]
    if (!item) return
    setFocused(item.id)
    tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[index]?.focus()
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>, item: TreeItem, index: number) {
    switch (event.key) {
      case 'ArrowUp': focus(index - 1); break
      case 'ArrowDown': focus(index + 1); break
      case 'Home': focus(0); break
      case 'End': focus(items.length - 1); break
      case 'ArrowRight':
        if (item.expanded === false) item.toggle?.()
        else if (items[index + 1]?.parent === item.id) focus(index + 1)
        break
      case 'ArrowLeft':
        if (item.expanded) item.toggle?.()
        else focus(items.findIndex((candidate) => candidate.id === item.parent))
        break
      case ' ':
      case 'Enter': (item.choose ?? item.toggle)?.(); break
      default: return
    }
    event.preventDefault()
  }

  return <aside className="sidebar" id="object-explorer">
    <div className="panel-title"><PanelLeft size={15} /><h2>Explorador de objetos</h2></div>
    {connected ? <div role="tree" aria-label="Explorador de objetos" className="tree" ref={tree}>
      {items.map((item, index) => {
        const Icon = item.type === 'status' ? null : icons[item.type]
        const Chevron = item.expanded ? ChevronDown : ChevronRight
        return <div key={item.id} role="treeitem" aria-level={item.level}
          aria-expanded={item.expanded} aria-selected={item.selected} tabIndex={active === item.id ? 0 : -1}
          className={`tree-row tree-${item.type}${item.selected ? ' selected' : ''}`}
          style={{ paddingInlineStart: 10 + (item.level - 1) * 13 }}
          onFocus={() => setFocused(item.id)} onKeyDown={(event) => navigate(event, item, index)}
          onClick={() => { focus(index); (item.choose ?? item.toggle)?.() }}
          title={item.note ? `${item.label} · ${item.note}` : item.label}>
          <span className="tree-toggle" aria-hidden="true" onClick={item.toggle ? (event) => {
            event.stopPropagation(); focus(index); item.toggle?.()
          } : undefined}>{item.toggle && <Chevron size={14} />}</span>
          {Icon && <Icon size={15} />}
          <span className="tree-label">{item.label}</span>
          {item.note && <small>{item.note}</small>}
        </div>
      })}
    </div> : <div className="sidebar-empty"><span className="quiet-icon"><Server size={17} /></span>
      <span>Nenhuma conexão aberta</span></div>}
  </aside>
}
