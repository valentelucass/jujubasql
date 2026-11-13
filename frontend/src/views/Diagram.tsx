import {
  Background, BaseEdge, EdgeLabelRenderer, Handle, Panel, Position, ReactFlow, useReactFlow, useStore,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react'
import { GitFork, Maximize, Minus, Plus, Table2 } from 'lucide-react'
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { Relationship, Remote, Table } from '../models/sql'
import { Failure, Loading } from './States'

const portSpacing = 28
const stemLength = 56
type Port = { id: string; type: 'source' | 'target'; side: Position.Left | Position.Right; offset: number }
type RelationNode = Node<{ table: Table; columns: string[]; current: boolean; ports: Port[] }, 'relationTable'>
type RelationEdge = Edge<{
  relation: Relationship; offset: number; compact: boolean
}, 'foreignKey'>

const Selection = createContext<Pick<GraphProps, 'selected' | 'onSelect'> & {
  activeTable: number | null; hoveredEdge: string | null; arrowId: string
  hoverEdge: (id: string | null) => void
}>({ selected: null, activeTable: null, hoveredEdge: null, arrowId: '', onSelect: () => {}, hoverEdge: () => {} })

function TableNode({ data }: NodeProps<RelationNode>) {
  const { selected, activeTable } = useContext(Selection)
  const active = data.table.id === activeTable
  const highlighted = data.table.id === selected?.source.id || data.table.id === selected?.target.id
  const portHeight = Math.max(0, ...data.ports.map(({ offset }) => Math.abs(offset) * 2 + portSpacing))
  return <div className={`diagram-node${data.current ? ' current' : ''}${highlighted ? ' highlighted' : ''}${active ? ' active' : ''}`}
    style={{ minHeight: portHeight }}>
    {data.ports.map(({ id, type, side, offset }) =>
      <Handle key={id} type={type} position={side} id={id} style={{ top: `calc(50% + ${offset}px)` }} />)}
    <div><Table2 size={15} /><span title={`${data.table.schema}.${data.table.name}`}><small>{data.table.schema}</small>
      <strong>{data.table.name}</strong></span></div>
    <ul>{data.columns.map((column) => <li key={column} title={column}>{column}</li>)}</ul>
  </div>
}

type Point = { x: number; y: number }
type Curve = [Point, Point, Point, Point]

function pointOnCurve([start, first, second, end]: Curve, t: number): Point {
  const u = 1 - t
  const a = u ** 3
  const b = 3 * u ** 2 * t
  const c = 3 * u * t ** 2
  const d = t ** 3
  return {
    x: a * start.x + b * first.x + c * second.x + d * end.x,
    y: a * start.y + b * first.y + c * second.y + d * end.y,
  }
}

function closestLabelPosition(curve: Curve, pointer: Point, previous: number): number {
  let best = previous
  let distance = Infinity
  let low = .14
  let high = .86
  for (let pass = 0; pass < 3; pass++) {
    const step = (high - low) / 24
    for (let index = 0; index <= 24; index++) {
      const t = low + step * index
      const { x, y } = pointOnCurve(curve, t)
      const candidate = (x - pointer.x) ** 2 + (y - pointer.y) ** 2
      if (candidate < distance) {
        best = t
        distance = candidate
      }
    }
    low = Math.max(.14, best - step)
    high = Math.min(.86, best + step)
  }
  return best
}

function ForeignKeyEdge({ id, source, target, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data }: EdgeProps<RelationEdge>) {
  const { selected, activeTable, hoveredEdge, arrowId, onSelect, hoverEdge } = useContext(Selection)
  const { getZoom } = useReactFlow()
  const [labelPosition, setLabelPosition] = useState(.5)
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; zoom: number; moved: boolean } | null>(null)
  if (!data) return null
  const relation = data.relation
  const selectedEdge = selected?.id === relation.id
  const highlighted = selectedEdge || activeTable === relation.source.id || activeTable === relation.target.id
  const dimmed = activeTable !== null && !highlighted
  const showLabel = !data.compact || (hoveredEdge === null ? selectedEdge : hoveredEdge === id)
  const self = source === target
  const sourceDirection = sourcePosition === Position.Left ? -1 : 1
  const targetDirection = targetPosition === Position.Left ? -1 : 1
  const start = { x: sourceX + sourceDirection * stemLength, y: sourceY }
  const end = { x: targetX + targetDirection * stemLength, y: targetY }
  const span = self ? 128 + data.offset : Math.max(28, Math.abs(end.x - start.x) * .45)
  const first = { x: start.x + sourceDirection * span, y: start.y + (self ? 0 : data.offset) }
  const second = { x: end.x + targetDirection * span, y: end.y + (self ? 0 : data.offset) }
  const curve: Curve = [start, first, second, end]
  const path = `M ${sourceX},${sourceY} L ${start.x},${start.y} C ${first.x},${first.y} ${second.x},${second.y} ${end.x},${end.y} L ${targetX},${targetY}`
  const label = pointOnCurve(curve, labelPosition)

  function endpointBadge(value: string | null, x: number, y: number, side: string) {
    const label = value ?? '?'
    const width = label.length * 8 + 12
    return <g className={`edge-cardinality${highlighted ? ' highlighted' : ''}${dimmed ? ' dimmed' : ''}`}
      aria-label={`${side}: ${value ?? 'indeterminada'}`}>
      <title>{side} · {value ?? 'Cardinalidade indeterminada'}</title>
      <rect x={x - width / 2} y={y - 10} width={width} height={20} rx={6} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central">{label}</text>
    </g>
  }

  function moveLabel(event: PointerEvent<HTMLButtonElement>) {
    const origin = drag.current
    if (!origin || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const x = event.clientX - origin.x
    const y = event.clientY - origin.y
    if (!origin.moved && Math.hypot(x, y) < 4) return
    origin.moved = true
    setLabelPosition(closestLabelPosition(curve, { x: origin.startX + x / origin.zoom, y: origin.startY + y / origin.zoom }, labelPosition))
  }

  return <>
    <BaseEdge id={id} path={path} markerEnd={`url(#${arrowId}-${highlighted ? 'pink' : 'green'})`}
      style={{ stroke: highlighted ? 'var(--berry)' : '#679970', strokeWidth: highlighted ? 2.3 : 1.5, opacity: dimmed ? .4 : 1 }} />
    {endpointBadge(relation.sourcePerTarget, sourceX + sourceDirection * 31, sourceY - 11, 'Origens por destino')}
    {endpointBadge(relation.targetPerSource, targetX + targetDirection * 31, targetY - 11, 'Destinos por origem')}
    <EdgeLabelRenderer>
      <button type="button" className={`edge-label nodrag nopan${highlighted ? ' highlighted' : ''}${showLabel ? '' : ' compact'}`}
        style={{ transform: `translate(-50%, -50%) translate(${label.x}px,${label.y}px)` }}
        aria-label={`Selecionar restrição ${relation.name}`} aria-pressed={selectedEdge}
        title={relation.name + ' · Arraste ao longo da linha'}
        onPointerEnter={() => { if (data.compact) hoverEdge(id) }}
        onPointerLeave={() => { if (data.compact) hoverEdge(null) }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          drag.current = { x: event.clientX, y: event.clientY, startX: label.x, startY: label.y, zoom: getZoom(), moved: false }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={moveLabel} onPointerCancel={() => { drag.current = null }}
        onClick={(event) => {
          const moved = drag.current?.moved
          drag.current = null
          if (!moved || event.detail === 0) onSelect(relation)
        }}>
        {relation.columns.map((pair) => <span key={pair.ordinal}>{pair.source} → {pair.target}</span>)}
      </button>
    </EdgeLabelRenderer>
  </>
}

const nodeTypes = { relationTable: TableNode }
const edgeTypes = { foreignKey: ForeignKeyEdge }

function makeLayout(table: Table | undefined, relations: Relationship[], allTables: Table[]) {
  const tables = new Map<number, { table: Table; columns: Set<string> }>()
  const outgoing = new Set<number>()
  for (const entry of allTables) tables.set(entry.id, { table: entry, columns: new Set() })
  if (table) tables.set(table.id, { table, columns: new Set() })
  const groups = new Map<string, Relationship[]>()
  for (const relation of relations) {
    for (const entry of [relation.source, relation.target]) {
      if (!tables.has(entry.id)) tables.set(entry.id, { table: entry, columns: new Set() })
    }
    for (const column of relation.columns) {
      tables.get(relation.source.id)?.columns.add(column.source)
      tables.get(relation.target.id)?.columns.add(column.target)
    }
    if (relation.source.id === table?.id) outgoing.add(relation.target.id)
    const key = [relation.source.id, relation.target.id].sort((a, b) => a - b).join(':')
    const group = groups.get(key) ?? []
    group.push(relation)
    groups.set(key, group)
  }
  const ordered = Array.from(tables.values())
  const rowSize = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(ordered.length))))
  const nodeLayouts = ordered.map(({ table: entry, columns }, index) => {
    const side = outgoing.has(entry.id) ? 'right' : 'left'
    const x = table ? (entry.id === table.id ? 0 : side === 'right' ? 650 : -650) : (index % rowSize) * 450
    return { entry, columns: Array.from(columns), index, side, position: { x, y: 0 }, ports: [] as Port[] }
  })
  type NodeLayout = (typeof nodeLayouts)[number]
  const nodesById = new Map(nodeLayouts.map((node) => [node.entry.id, node]))
  const connections = new Map<string, Array<{ port: Port; neighbor: number }>>()

  function addPort(node: NodeLayout, neighbor: NodeLayout, id: string, type: Port['type'], side: Port['side']) {
    const port = { id, type, side, offset: 0 }
    node.ports.push(port)
    const key = `${node.entry.id}:${side}`
    const entries = connections.get(key) ?? []
    entries.push({ port, neighbor: neighbor.index })
    connections.set(key, entries)
    return id
  }

  const edgeLayouts = Array.from(groups.values()).flatMap((group) => {
    const spacing = 58 + Math.max(...group.map((item) => item.columns.length)) * 20
    return group.map((relation, index) => {
      const source = nodesById.get(relation.source.id)!
      const target = nodesById.get(relation.target.id)!
      const self = source === target
      const rightward = target.position.x >= source.position.x
      const sameColumn = target.position.x === source.position.x
      return {
        relation,
        sourceHandle: addPort(source, target, `source-${relation.id}`, 'source', rightward ? Position.Right : Position.Left),
        targetHandle: addPort(target, source, `target-${relation.id}`, 'target', sameColumn || !rightward ? Position.Right : Position.Left),
        offset: self ? index * spacing * .5 : (index - (group.length - 1) / 2) * spacing,
      }
    })
  })
  for (const entries of connections.values()) {
    entries.sort((a, b) => a.neighbor - b.neighbor)
    entries.forEach(({ port }, index) => { port.offset = (index - (entries.length - 1) / 2) * portSpacing })
  }
  const rows = new Map<number | string, number>()
  for (const node of nodeLayouts) {
    const height = Math.max(62 + Math.min(8, node.columns.length) * 21,
      ...node.ports.map(({ offset }) => 2 * Math.abs(offset) + portSpacing))
    if (table) {
      node.position.y = node.position.x ? rows.get(node.side) ?? 0 : 40
      if (node.position.x) rows.set(node.side, node.position.y + height + 38)
    } else {
      const row = Math.floor(node.index / rowSize)
      node.position.y = rows.get(row) ?? 0
      rows.set(row + 1, Math.max(rows.get(row + 1) ?? 0, node.position.y + Math.max(245, height + 90)))
    }
  }
  return { nodeLayouts, edgeLayouts }
}

interface GraphProps {
  table?: Table
  tables?: Table[]
  relations: Relationship[]
  selected: Relationship | null
  onSelect: (relation: Relationship | null) => void
  onTable: (table: Table) => void
}

function TableFinder({ tables }: { tables: Table[] }) {
  const { fitView } = useReactFlow()
  const [query, setQuery] = useState('')
  const match = query.trim() && tables.find((table) => `${table.schema}.${table.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <Panel position="top-right" className="diagram-find"><form onSubmit={(event) => {
    event.preventDefault()
    if (match) void fitView({ nodes: [{ id: String(match.id) }], padding: .4, maxZoom: 1.15, duration: 180 })
  }}>
    <input aria-label="Localizar tabela no diagrama" placeholder="Localizar tabela…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <button className="button" disabled={!match}>Ir</button>
  </form></Panel>
}

function DiagramControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore((state) => state.transform[2])
  const minZoom = useStore((state) => state.minZoom)
  const maxZoom = useStore((state) => state.maxZoom)
  return <Panel position="bottom-left" className="diagram-controls" role="group" aria-label="Controles do diagrama">
    <button className="icon-button" aria-label="Ampliar" title="Ampliar" disabled={zoom >= maxZoom}
      onClick={() => void zoomIn({ duration: 120 })}><Plus size={17} /></button>
    <button className="icon-button" aria-label="Reduzir" title="Reduzir" disabled={zoom <= minZoom}
      onClick={() => void zoomOut({ duration: 120 })}><Minus size={17} /></button>
    <button className="icon-button" aria-label="Ajustar à janela" title="Ajustar à janela"
      onClick={() => void fitView({ padding: .28, duration: 120 })}><Maximize size={15} /></button>
  </Panel>
}

const noTables: Table[] = []

export function Graph({ table, tables = noTables, relations, selected, onSelect, onTable }: GraphProps) {
  const layout = useMemo(() => makeLayout(table, relations, tables), [table, relations, tables])
  const [activeTable, setActiveTable] = useState<number | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)
  const arrowId = useId()
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hoverEdge = useMemo(() => (id: string | null) => {
    clearTimeout(hoverTimeout.current)
    if (id === null) hoverTimeout.current = setTimeout(() => setHoveredEdge(null), 120)
    else setHoveredEdge(id)
  }, [])
  useEffect(() => () => clearTimeout(hoverTimeout.current), [])
  const selection = useMemo(() => ({ selected, activeTable, hoveredEdge, arrowId, onSelect, hoverEdge }),
    [selected, activeTable, hoveredEdge, arrowId, onSelect, hoverEdge])
  const nodes = useMemo<RelationNode[]>(() => layout.nodeLayouts.map(({ entry, columns, position, ports }) => ({
    id: String(entry.id), position, type: 'relationTable',
    ariaLabel: `Tabela ${entry.schema}.${entry.name}`,
    data: { table: entry, columns, ports, current: entry.id === table?.id },
  })), [layout, table?.id])
  const edges = useMemo<RelationEdge[]>(() => layout.edgeLayouts.map(({ relation, offset, sourceHandle, targetHandle }) => ({
    id: String(relation.id), source: String(relation.source.id), target: String(relation.target.id), type: 'foreignKey',
    sourceHandle, targetHandle, ariaLabel: relation.name, selectable: false,
    data: { relation, offset, compact: layout.edgeLayouts.length > 2 },
  })), [layout])

  function selectTable(id: number | null) {
    setActiveTable(id)
    setHoveredEdge(null)
    onSelect(null)
  }

  return <Selection.Provider value={selection}><div className="diagram-pane">
    <div className="diagram-toolbar"><GitFork size={16} />
      {!table && <span>{nodes.length} {nodes.length === 1 ? 'tabela' : 'tabelas'}</span>}
      <span>{relations.length ? `${relations.length} ${relations.length === 1 ? 'chave estrangeira' : 'chaves estrangeiras'}` : 'Nenhuma relação visível'}</span>
      {relations.length > 0 && <div className="cardinality-legend" aria-label="Legenda da cardinalidade">
        <span><code>1</code> obrigatório</span><span><code>0..1</code> opcional</span>
        <span><code>0..N</code> zero ou muitos</span><span><code>?</code> indeterminada</span>
      </div>}
    </div>
    <div className="diagram-canvas">
      <svg className="diagram-markers" width="0" height="0" aria-hidden="true">
        <defs>
          <marker id={`${arrowId}-green`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9"
            markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#679970" /></marker>
          <marker id={`${arrowId}-pink`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11"
            markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="var(--berry)" /></marker>
        </defs>
      </svg>
      <ReactFlow colorMode="dark" defaultNodes={nodes} defaultEdges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        fitView fitViewOptions={{ padding: .28, maxZoom: nodes.length === 1 ? .8 : 1.15 }} minZoom={.12} maxZoom={2.2}
        nodesDraggable panOnDrag nodesConnectable={false} deleteKeyCode={null}
        onPaneClick={() => selectTable(null)}
        onNodeClick={(_, node) => selectTable(node.data.table.id)}
        onNodeDoubleClick={(_, node) => onTable(node.data.table)}
        onEdgeMouseEnter={(_, edge) => { if (edge.data?.compact) hoverEdge(edge.id) }}
        onEdgeMouseLeave={(_, edge) => { if (edge.data?.compact) hoverEdge(null) }}
        onEdgeClick={(_, edge) => { if (edge.data) onSelect(edge.data.relation) }}>
        <Background color="#345341" gap={20} size={1} />
        <DiagramControls />
        {!table && <TableFinder tables={tables} />}
      </ReactFlow>
    </div>
  </div></Selection.Provider>
}

export function Diagram({ result, retry, ...props }: Omit<GraphProps, 'relations'> & {
  result: Remote<Relationship[]>; retry: () => void
}) {
  if (result.status === 'error') return <Failure error={result.error} retry={retry} />
  if (result.status !== 'ready') return <Loading />
  return <Graph {...props} relations={result.data} />
}
