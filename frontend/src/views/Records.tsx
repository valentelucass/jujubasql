import { useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Filter as FilterIcon, KeyRound, Pencil, X } from 'lucide-react'
import type { Column, PageRequest, RecordsPage, Remote, TableScope } from '../models/sql'
import { CellEditor, type CellDraft } from './CellEditor'
import { Empty, Failure, Loading } from './States'

export function Records({ result, columns, request, onChange, retry, scope }: {
  result: Remote<RecordsPage>
  columns: Column[]
  request: PageRequest
  onChange: (request: PageRequest) => void
  retry: () => void
  scope: TableScope
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CellDraft | null>(null)
  const [saved, setSaved] = useState(false)
  const [filterColumn, setFilterColumn] = useState(request.filter ? String(request.filter.columnId) : '')
  const [filterText, setFilterText] = useState(request.filter?.text ?? '')
  const data = result.status === 'ready' ? result.data : null
  const filterable = columns.filter((column) => column.filterable)
  const activeFilterColumn = filterable.some((column) => String(column.id) === filterColumn)
    ? filterColumn : String(filterable[0]?.id ?? '')

  const keys = data?.columns.flatMap((column, index) => column.primaryKey ? [{ column, index }] : []) ?? []
  const canEdit = keys.length > 0 && keys.every(({ column }) => column.editableKey) && data?.columns.some((column) => column.editable)
  const complete = (value: string | null) => value === null || (value.length < 2048 && !value.includes('\0'))

  function applyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeFilterColumn || !filterText) return
    onChange({ ...request, page: 0, filter: { columnId: Number(activeFilterColumn), text: filterText } })
  }

  function sortBy(column: Column) {
    const descending = request.sort?.columnId === column.id && !request.sort.descending
    onChange({ ...request, page: 0, sort: { columnId: column.id, descending } })
  }

  return <div className="records-layout">
    <form className="record-toolbar" onSubmit={applyFilter}>
      <FilterIcon size={16} />
      <select aria-label="Coluna do filtro" value={activeFilterColumn} onChange={(event) => setFilterColumn(event.target.value)}
        disabled={!filterable.length}>{filterable.length ? filterable.map((column) =>
          <option key={column.id} value={column.id}>{column.name}</option>) : <option value="">Coluna</option>}</select>
      <input aria-label="Valor do filtro" placeholder="Contém…" value={filterText} maxLength={200}
        disabled={!filterable.length} onChange={(event) => setFilterText(event.target.value)} />
      <button className="button" disabled={!filterable.length || !filterText}>Filtrar</button>
      {request.filter && <button type="button" className="icon-button" aria-label="Remover filtro" title="Remover filtro"
        onClick={() => { setFilterText(''); onChange({ ...request, page: 0, filter: undefined }) }}><X size={16} /></button>}
      {request.filter && <span className="filter-summary" title={request.filter.text}>
        {columns.find((column) => column.id === request.filter?.columnId)?.name} contém “{request.filter.text}”
      </span>}
      {canEdit && <button type="button" className="button" aria-pressed={editing} onClick={() => setEditing(!editing)}>
        <Pencil size={14} /> {editing ? 'Encerrar edição' : 'Editar células'}
      </button>}
      {saved && <span role="status">Alteração gravada</span>}
    </form>
    {draft && <CellEditor draft={draft} scope={scope} close={() => setDraft(null)} updated={() => {
      setDraft(null); setSaved(true); retry()
    }} />}
    {result.status === 'error' && <Failure error={result.error} retry={retry} />}
    {result.status === 'loading' && <Loading />}
    {data && !data.rows.length && <Empty title={request.filter ? 'Nenhum registro corresponde ao filtro' :
      request.page ? 'A página está vazia' : 'Tabela vazia'} />}
    {data && data.rows.length > 0 && <div className="grid-scroll" tabIndex={0} aria-label="Registros">
      <table className="data-grid">
        <thead><tr><th className="row-number" scope="col">#</th>{data.columns.map((column) => {
          const sorted = request.sort?.columnId === column.id
          const SortIcon = sorted ? request.sort?.descending ? ArrowDown : ArrowUp : ArrowUpDown
          return <th key={column.id} scope="col" aria-sort={sorted ? request.sort?.descending ? 'descending' : 'ascending' : undefined}>
            {column.sortable ? <button onClick={() => sortBy(column)} title={`Ordenar por ${column.name}`}>
              {column.primaryKey && <KeyRound size={13} className="key-icon" />}{column.name}<SortIcon size={13} />
            </button> : <span>{column.name}</span>}
          </th>
        })}</tr></thead>
        <tbody>{data.rows.map((row, index) => <tr key={index}>
          <td className="row-number">{data.page * data.pageSize + index + 1}</td>
          {row.map((value, columnIndex) => {
            const column = data.columns[columnIndex]
            const content = value === null ? <em className="null-value">NULL</em> : value
            const editable = editing && canEdit && column.editable && complete(value)
              && keys.every((key) => row[key.index] !== null && complete(row[key.index]))
            return <td key={columnIndex} title={value ?? undefined}>{editable
              ? <button className="cell-edit" aria-label={'Editar ' + column.name + ', linha ' + (data.page * data.pageSize + index + 1)}
                  onClick={() => { setSaved(false); setDraft({ column, oldValue: value,
                    key: keys.map((key) => ({ name: key.column.name, value: row[key.index]! })) }) }}>{content}<Pencil size={12} /></button>
              : content}</td>
          })}
        </tr>)}</tbody>
      </table>
    </div>}
    <div className="pagination">
      <span>{data ? `${data.rows.length} ${data.rows.length === 1 ? 'registro' : 'registros'} nesta página` : ''}</span>
      {data && !data.stableOrder && <span className="page-note" title="A tabela não tem uma chave única visível para estabilizar a ordem.">Ordem sem chave única</span>}
      <div className="pagination-controls">
        <select aria-label="Registros por página" value={request.pageSize}
          onChange={(event) => onChange({ ...request, page: 0, pageSize: Number(event.target.value) })}>
          {[25, 50, 100].map((size) => <option key={size} value={size}>{size} por página</option>)}
        </select>
        <button className="icon-button" aria-label="Página anterior" disabled={request.page === 0 || result.status === 'loading'}
          onClick={() => onChange({ ...request, page: request.page - 1 })}><ChevronLeft size={16} /></button>
        <span>Página {request.page + 1}</span>
        <button className="icon-button" aria-label="Próxima página" disabled={!data?.hasNext}
          onClick={() => onChange({ ...request, page: request.page + 1 })}><ChevronRight size={16} /></button>
      </div>
    </div>
  </div>
}
