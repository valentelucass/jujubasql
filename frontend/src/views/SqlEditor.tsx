import { useRef, useState, type FormEvent } from 'react'
import { Play } from 'lucide-react'
import { appError, sql } from '../controllers/api'
import type { Remote, QueryOutput, Scope } from '../models/sql'
import { Empty, Failure, Loading } from './States'
import { SqlCode } from './SqlCode'

export function SqlEditor({ scope }: { scope: Scope }) {
  const [source, setSource] = useState('SELECT TOP (25) name FROM sys.tables ORDER BY name')
  const [result, setResult] = useState<Remote<QueryOutput>>({ status: 'idle' })
  const running = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  async function run(event: FormEvent) {
    event.preventDefault()
    if (running.current || !source.trim()) return
    running.current = true
    setResult({ status: 'loading' })
    try { setResult({ status: 'ready', data: await sql.queryRead(scope, source) }) }
    catch (error) { setResult({ status: 'error', error: appError(error) }) }
    finally { running.current = false }
  }
  const output = result.status === 'ready' ? result.data : null
  return <div className="sql-workspace">
    <form ref={form} onSubmit={run}>
      <div className="sql-editor-toolbar">
        <label id="sql-code-label">Consulta SQL</label>
        <span>SELECT · até 200 linhas</span>
        <button className="button primary" disabled={!source.trim() || result.status === 'loading'}><Play size={15} /> Executar</button>
      </div>
      <SqlCode source={source} onChange={setSource} form={form} />
    </form>
    <section className="sql-results" aria-label="Resultados da consulta">
      {result.status === 'idle' && <Empty title="Resultados da consulta" note="Execute o SQL para ver os registros aqui." />}
      {result.status === 'loading' && <Loading />}
      {result.status === 'error' && <Failure error={result.error} />}
      {output && <>
        <div className="grid-scroll sql-result"><table className="data-grid">
          <thead><tr>{output.columns.map((name, index) => <th key={index} scope="col"><span>{name || 'Coluna ' + (index + 1)}</span></th>)}</tr></thead>
          <tbody>{output.rows.map((row, index) => <tr key={index}>{row.map((value, col) =>
            <td key={col} title={value ?? undefined}>{value === null ? <em className="null-value">NULL</em> : value}</td>)}</tr>)}</tbody>
        </table>{!output.rows.length && <Empty title="A consulta não retornou registros" />}</div>
        <div className="pagination">{output.truncated ? 'Mostrando as primeiras 200 linhas.' : output.rows.length + ' registros'}</div>
      </>}
    </section>
  </div>
}
