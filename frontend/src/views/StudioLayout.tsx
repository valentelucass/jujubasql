import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Explorer } from './Explorer'
import type { TreeItem } from '../controllers/useExplorer'

const minimum = 160
const maximum = 640
const defaultWidth = 274
const preference = 'nexo.explorer.width'

function clamp(width: number) {
  return Math.max(minimum, Math.min(maximum, width))
}

function readWidth() {
  try {
    const saved = Number(localStorage.getItem(preference))
    return saved > 0 && Number.isFinite(saved) ? clamp(saved) : defaultWidth
  } catch {
    return defaultWidth
  }
}

function saveWidth(width: number) {
  try { localStorage.setItem(preference, String(width)) } catch { /* preference is optional */ }
}

export function StudioLayout({ items, connected, children }: {
  items: TreeItem[]
  connected: boolean
  children: ReactNode
}) {
  const [width, setWidth] = useState(readWidth)
  const [dragging, setDragging] = useState(false)

  function pointerWidth(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    return clamp(Math.round(event.clientX - (bounds?.left ?? 0)))
  }

  function updateWidth(next: number) {
    setWidth(next)
    saveWidth(next)
  }

  function keyboardResize(event: KeyboardEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    const current = Math.round(event.currentTarget.getBoundingClientRect().left - (bounds?.left ?? 0))
    const step = event.shiftKey ? 50 : 16
    const next = { ArrowLeft: current - step, ArrowRight: current + step, Home: minimum, End: maximum }[event.key]
    if (next === undefined) return
    event.preventDefault()
    updateWidth(clamp(next))
  }

  return <div className={dragging ? 'studio resizing' : 'studio'} style={{ '--explorer-width': width + 'px' } as CSSProperties}>
    <Explorer items={items} connected={connected} />
    <div role="separator" tabIndex={0} aria-label="Largura do Explorador de objetos" aria-controls="object-explorer"
      aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width}
      title="Arraste para ajustar. Clique duas vezes para restaurar."
      className="explorer-divider" onKeyDown={keyboardResize} onDoubleClick={() => updateWidth(defaultWidth)}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(pointerWidth(event))
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        updateWidth(pointerWidth(event))
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => setDragging(false)} />
    {children}
  </div>
}