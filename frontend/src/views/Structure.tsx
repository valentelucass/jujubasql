import { KeyRound } from 'lucide-react'
import type { Relationship, Remote, Structure as TableStructure } from '../models/sql'
import { Empty, Failure, Loading } from './States'

export function Structure({ result, relationships, retry }: {
  result: Remote<TableStructure>; relationships: Remote<Relationship[]>; retry: () => void
}) {
  if (result.status === 'error') return <Failure error={result.error} retry={retry} />
  if (result.status !== 'ready') return <Loading />
  const { columns, indexes } = result.data
  return <div className="structure-scroll">
    <section>
      <h3>Colunas <span>{columns.length}</span></h3>
      {columns.length ? <div className="metadata-grid"><table>
        <thead><tr><th>Nome</th><th>Tipo</th><th>Aceita NULL</th><th>Atributos</th></tr></thead>
        <tbody>{columns.map((column) => <tr key={column.id}>
          <th scope="row">{column.primaryKey && <KeyRound size={13} className="key-icon" />}{column.name}</th>
          <td><code>{column.dataType}</code></td><td>{column.nullable ? 'Sim' : 'Não'}</td>
          <td>{[column.primaryKey && 'Chave primária', column.identity && 'Identidade', column.computed && 'Calculada'].filter(Boolean).join(' · ') || '—'}</td>
        </tr>)}</tbody>
      </table></div> : <Empty title="Nenhuma coluna visível" />}
    </section>
    <section>
      <h3>Índices <span>{indexes.length}</span></h3>
      {indexes.length ? <div className="metadata-grid"><table>
        <thead><tr><th>Nome</th><th>Tipo</th><th>Colunas</th><th>Atributos</th></tr></thead>
        <tbody>{indexes.map((index) => <tr key={index.name}>
          <th scope="row">{index.name}</th><td><code>{index.kind}</code></td>
          <td>{index.columns.map((column) => `${column.name}${column.included ? ' (incluída)' : column.descending ? ' DESC' : ''}`).join(', ') || '—'}</td>
          <td title={index.filter ?? undefined}>{[index.primary && 'Chave primária', index.unique && 'Único',
            index.filtered && 'Filtrado', index.disabled && 'Desabilitado'].filter(Boolean).join(' · ') || '—'}</td>
        </tr>)}</tbody>
      </table></div> : <p>Nenhum índice visível.</p>}
    </section>
    <section>
      <h3>Chaves estrangeiras</h3>
      {relationships.status === 'error' && <Failure error={relationships.error} retry={retry} />}
      {relationships.status === 'loading' && <Loading />}
      {relationships.status === 'ready' && (relationships.data.length ? <div className="metadata-grid"><table>
        <thead><tr><th>Restrição</th><th>Origem</th><th>Destino</th></tr></thead>
        <tbody>{relationships.data.map((relation) => <tr key={relation.id}>
          <th scope="row">{relation.name}</th>
          <td>{relation.source.schema}.{relation.source.name} ({relation.columns.map((pair) => pair.source).join(', ')})</td>
          <td>{relation.target.schema}.{relation.target.name} ({relation.columns.map((pair) => pair.target).join(', ')})</td>
        </tr>)}</tbody>
      </table></div> : <p>Nenhuma chave estrangeira visível.</p>)}
    </section>
  </div>
}
