import { useEffect, useRef, useState, type FormEvent } from 'react'
import { appError, sql } from '../controllers/api'
import type { Column, TableScope } from '../models/sql'

export interface CellDraft {
  column: Column
  key: { name: string; value: string }[]
  oldValue: string | null
}

export function CellEditor({ draft, scope, close, updated }: {
  draft: CellDraft; scope: TableScope; close: () => void; updated: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState(draft.oldValue ?? '')
  const [nullValue, setNull] = useState(draft.oldValue === null)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshRequired, setRefreshRequired] = useState(false)
  const nextValue = nullValue ? null : value
  useEffect(() => { dialog.current?.showModal() }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || refreshRequired || nextValue === draft.oldValue) return
    setError(null)
    if (!preview) { setPreview(true); return }
    setBusy(true)
    try {
      await sql.updateCell({ ...scope, columnId: draft.column.id, key: draft.key.map((part) => part.value),
        oldValue: draft.oldValue, value: nextValue })
      updated()
    } catch (failure) {
      const issue = appError(failure)
      setError(issue.message)
      setRefreshRequired(['conflict', 'update_unknown'].includes(issue.kind))
    } finally { setBusy(false) }
  }

  return <dialog ref={dialog} className="connection-dialog cell-dialog" aria-labelledby="edit-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) close() }}>
    <form onSubmit={submit}>
      <h2 id="edit-title">{preview ? 'Confirmar alteração' : 'Editar ' + draft.column.name}</h2>
      <dl className="edit-review">
        <dt>Registro</dt><dd>{draft.key.map((part) => <div key={part.name}><code>{part.name}</code> = {part.value}</div>)}</dd>
        {preview && <><dt>Coluna</dt><dd>{draft.column.name}</dd></>}
        <dt>Valor atual</dt><dd><code>{draft.oldValue === null ? 'NULL' : JSON.stringify(draft.oldValue)}</code></dd>
        {preview && <><dt>Novo valor</dt><dd><code>{nextValue === null ? 'NULL' : JSON.stringify(nextValue)}</code></dd></>}
      </dl>
      {!preview && <fieldset>
        <label>Novo valor<textarea value={value} maxLength={2047} disabled={nullValue} onChange={(event) => setValue(event.target.value)} /></label>
        {draft.column.nullable && <label className="null-check"><input type="checkbox" checked={nullValue} onChange={(event) => setNull(event.target.checked)} /> Gravar NULL</label>}
      </fieldset>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button" type="button" disabled={busy} onClick={close}>Cancelar</button>
        {preview && !refreshRequired && <button className="button" type="button" disabled={busy} onClick={() => { setPreview(false); setError(null) }}>Voltar</button>}
        <button className="button primary" disabled={busy || refreshRequired || nextValue === draft.oldValue}>
          {busy ? 'Gravando…' : preview ? 'Gravar alteração' : 'Revisar alteração'}
        </button>
      </div>
    </form>
  </dialog>
}
