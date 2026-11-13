import { useCallback, useEffect, useRef, useState } from 'react'
import { ChartNoAxesCombined, Clock3, Database, HardDrive, RefreshCw } from 'lucide-react'
import { init, use, type ComposeOption } from 'echarts/core'
import { BarChart, LineChart, type BarSeriesOption, type LineSeriesOption } from 'echarts/charts'
import { GridComponent, TooltipComponent, type GridComponentOption, type TooltipComponentOption } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { sql } from '../controllers/api'
import { useRemote } from '../controllers/useRemote'
import type { DashboardOverview, DashboardPerformance, TableStorage } from '../models/dashboard'
import type { Scope } from '../models/sql'
import { Empty, Failure, Loading } from './States'

use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('pt-BR')
const fileKinds: Record<string, string> = { ROWS: 'Dados', LOG: 'Log de transações', FILESTREAM: 'FILESTREAM' }
const tabs = [
  { id: 'overview', title: 'Visão geral', icon: Database },
  { id: 'storage', title: 'Armazenamento', icon: HardDrive },
  { id: 'performance', title: 'Desempenho', icon: Clock3 },
] as const
type Tab = (typeof tabs)[number]['id']
type ChartOption = ComposeOption<BarSeriesOption | LineSeriesOption | GridComponentOption | TooltipComponentOption>

function Chart({ label, option }: { label: string; option: ChartOption }) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const chart = init(element, 'dark')
    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', renderMode: 'richText', confine: true },
      ...option,
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(element)
    return () => { observer.disconnect(); chart.dispose() }
  }, [option])
  return <div ref={container} className="dashboard-chart" role="img" aria-label={label} />
}

function mib(value: number) {
  return value >= 1024 ? number.format(value / 1024) + ' GiB' : number.format(value) + ' MiB'
}

function duration(value: number) {
  if (value >= 60000) return number.format(value / 60000) + ' min'
  if (value >= 1000) return number.format(value / 1000) + ' s'
  return number.format(value) + ' ms'
}

function FileList({ files }: Pick<DashboardOverview, 'files'>) {
  return <div className="dashboard-table"><table>
    <caption>Arquivos do banco</caption>
    <thead><tr><th scope="col">Arquivo lógico</th><th scope="col">Tipo</th>
      <th scope="col">Alocado</th><th scope="col">Ocupado em dados</th></tr></thead>
    <tbody>{files.map((file) => <tr key={file.name}><th scope="row">{file.name}</th>
      <td>{fileKinds[file.kind] ?? file.kind}</td><td>{mib(file.sizeMib)}</td>
      <td>{file.usedMib === null ? '—' : mib(file.usedMib)}</td></tr>)}</tbody>
  </table></div>
}

function Overview({ data }: { data: DashboardOverview }) {
  const fileSize = (kind: string) => data.files.filter((file) => file.kind === kind)
    .reduce((total, file) => total + file.sizeMib, 0)
  const cards = [
    ['Tabelas visíveis', integer.format(data.tables)],
    ['Views visíveis', integer.format(data.views)],
    ['Esquemas com tabelas', integer.format(data.schemas)],
    ['Chaves estrangeiras visíveis', integer.format(data.foreignKeys)],
    ['Arquivos de dados', mib(fileSize('ROWS'))],
    ['Arquivos de log', mib(fileSize('LOG'))],
  ]
  return <><dl className="dashboard-metrics">
    {cards.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>
    {data.files.length > 0 && <FileList files={data.files} />}
  </>
}

function Storage({ files, tables }: { files: DashboardOverview['files']; tables: TableStorage[] }) {
  const top = tables.slice(0, 8).reverse()
  return <>
    {files.length > 0 && <FileList files={files} />}
    {tables.length > 0 ? <>
      <section className="dashboard-panel">
        <h2>Maiores tabelas por espaço reservado</h2>
        <p>Inclui os índices. O espaço usado faz parte do reservado.</p>
        <Chart label="Comparação de espaço usado e reservado nas oito maiores tabelas, em MiB" option={{
          color: ['#749e80', '#d5a0ad'],
          grid: { left: 156, right: 26, top: 15, bottom: 38 },
          xAxis: { type: 'value', name: 'MiB', nameLocation: 'middle', nameGap: 23 },
          yAxis: { type: 'category', data: top.map(({ schema, name }) => schema + '.' + name),
            axisLabel: { width: 145, overflow: 'truncate' } },
          series: [
            { type: 'bar', name: 'Reservado (MiB)', data: top.map((table) => table.reservedMib) },
            { type: 'bar', name: 'Usado (MiB)', data: top.map((table) => table.usedMib) },
          ],
        }} />
      </section>
      <div className="dashboard-table"><table>
        <caption>Até 30 tabelas por espaço reservado</caption>
        <thead><tr><th scope="col">Tabela</th><th scope="col">Linhas estimadas</th>
          <th scope="col">Reservado</th><th scope="col">Usado</th></tr></thead>
        <tbody>{tables.map((table) => <tr key={JSON.stringify([table.schema, table.name])}>
          <th scope="row">{table.schema}.{table.name}</th><td>{integer.format(table.rows)}</td>
          <td>{mib(table.reservedMib)}</td><td>{mib(table.usedMib)}</td>
        </tr>)}</tbody>
      </table></div>
    </> : <Empty title="Nenhuma tabela com estatísticas disponíveis" />}
  </>
}

function Performance({ data, hours }: { data: DashboardPerformance; hours: number }) {
  const [metric, setMetric] = useState<'averageMs' | 'executions'>('averageMs')
  if (!data.timeline.length) {
    if (data.state === 'OFF') return <Empty title="Query Store desativado" note="O SQL Server precisa coletar histórico para preencher este painel." />
    if (data.state === 'ERROR') return <Empty title="Query Store indisponível" note="O SQL Server informou erro no armazenamento do histórico." />
    return <Empty title="Sem execuções registradas neste período" note="Escolha outro período para consultar o histórico disponível." />
  }
  const label = metric === 'averageMs' ? 'Duração média (ms)' : 'Execuções concluídas'
  const timeline = data.timeline
  const time = (value: string) => hours === 24
    ? value.slice(8, 10) + '/' + value.slice(5, 7) + ' ' + value.slice(11, 16)
    : value.slice(8, 10) + '/' + value.slice(5, 7)
  return <>
    <section className="dashboard-panel">
      <div className="dashboard-panel-heading"><div>
        <h2>Histórico de consultas</h2>
        <p>Query Store · agrupado por {hours === 24 ? 'hora' : 'dia'} em UTC · execuções concluídas</p>
      </div>
        <label>Métrica <select value={metric} onChange={(event) => setMetric(event.target.value === 'executions' ? 'executions' : 'averageMs')}>
          <option value="averageMs">Duração média</option><option value="executions">Execuções</option>
        </select></label>
      </div>
      <Chart label={label + ' ao longo do tempo, em UTC'} option={{
        grid: { left: 62, right: 24, top: 25, bottom: 38 },
        xAxis: { type: 'time', splitNumber: 4, axisLabel: {
          hideOverlap: true, formatter: (value: number) => time(new Date(value).toISOString()),
        } },
        yAxis: { type: 'value', name: metric === 'averageMs' ? 'ms' : 'Execuções',
          minInterval: metric === 'executions' ? 1 : undefined },
        tooltip: { trigger: 'item', renderMode: 'richText', confine: true, valueFormatter: (value) =>
          Array.isArray(value) ? number.format(Number(value[1])) : number.format(Number(value)) },
        series: [{ type: 'line', name: label, itemStyle: { color: '#d5a0ad' },
          data: timeline.map((item) => [Date.parse(item.label), item[metric]]) }],
        useUTC: true,
      }} />
    </section>
    <div className="dashboard-table"><table>
      <caption>Até 15 consultas por tempo acumulado</caption>
      <thead><tr><th scope="col">Consulta</th><th scope="col">Execuções</th>
        <th scope="col">Duração média</th><th scope="col">Tempo acumulado</th></tr></thead>
      <tbody>{data.queries.map((query) => <tr key={query.label}><th scope="row">
        {query.sqlPreview ? <details className="dashboard-query">
          <summary>#{query.label} · {query.sqlPreview.trim().split(/\s+/, 1)[0]}</summary>
          <code>{query.sqlPreview}</code>
        </details> : '#' + query.label}</th>
        <td>{integer.format(query.executions)}</td><td>{duration(query.averageMs)}</td><td>{duration(query.totalMs)}</td>
      </tr>)}</tbody>
    </table></div>
    <details className="dashboard-panel dashboard-series"><summary>Ver dados do gráfico em tabela (UTC)</summary>
      <div className="dashboard-table"><table>
        <thead><tr><th scope="col">Período</th><th scope="col">Execuções</th><th scope="col">Duração média</th></tr></thead>
        <tbody>{timeline.map((item) => <tr key={item.label}><th scope="row">{time(item.label)}</th>
          <td>{integer.format(item.executions)}</td><td>{duration(item.averageMs)}</td></tr>)}</tbody>
      </table></div>
    </details>
  </>
}

export default function DatabaseDashboard({ database, session }: Scope) {
  const [tab, setTab] = useState<Tab>('overview')
  const [hours, setHours] = useState(24)
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision((value) => value + 1)
  const overview = useCallback(() => sql.dashboardOverview({ database, session }), [database, session, revision])
  const storage = useCallback(() => sql.dashboardStorage({ database, session }), [database, session, revision])
  const performance = useCallback(() => sql.dashboardPerformance({ database, session }, hours), [database, session, hours, revision])
  const summary = useRemote(tab === 'performance' ? null : overview)
  const sizes = useRemote(tab === 'storage' ? storage : null)
  const history = useRemote(tab === 'performance' ? performance : null)
  return <>
    <div className="object-heading"><div className="breadcrumbs"><Database size={14} />{database}</div>
      <h1><ChartNoAxesCombined size={24} />Dashboards</h1></div>
    <nav className="dashboard-nav" aria-label="Painéis do banco">
      {tabs.map(({ id, title, icon: Icon }) => <button key={id} className="button" aria-pressed={tab === id}
        onClick={() => setTab(id)}><Icon size={15} />{title}</button>)}
    </nav>
    <div className="dashboard-body">
      <div className="dashboard-actions">
        {tab === 'performance' && <label>Período <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
          <option value={24}>Últimas 24 horas</option><option value={168}>Últimos 7 dias</option>
          <option value={720}>Últimos 30 dias</option>
        </select></label>}
        <button className="button" onClick={refresh}><RefreshCw size={14} /> Atualizar painel</button>
      </div>
      {tab !== 'performance' && summary.status === 'error' && <Failure error={summary.error} retry={refresh} />}
      {tab === 'overview' && (summary.status === 'ready' ? <Overview data={summary.data} />
        : summary.status !== 'error' && <Loading />)}
      {tab === 'storage' && (sizes.status === 'ready'
        ? <Storage files={summary.status === 'ready' ? summary.data.files : []} tables={sizes.data} />
        : <>
          {summary.status === 'ready' && summary.data.files.length > 0 && <FileList files={summary.data.files} />}
          {sizes.status === 'error' ? <Failure error={sizes.error} retry={refresh} /> : <Loading />}
        </>)}
      {tab === 'performance' && (history.status === 'ready' ? <Performance data={history.data} hours={hours} />
        : history.status === 'error' ? <Failure error={history.error} retry={refresh} /> : <Loading />)}
    </div>
  </>
}
