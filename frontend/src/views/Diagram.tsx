import {
  Background, BaseEdge, EdgeLabelRenderer, Handle, MarkerType, Panel, Position, ReactFlow, useReactFlow, useStore,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react'
import { GitFork, Maximize, Minus, Plus, Table2 } from 'lucide-react'
import { createContext, useContext, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { Relationship, Remote, Table } from '../models/sql'
import { Failure, Loading } from './States'

type RelationNode = Node<{ table: Table; columns: string[]; current: boolean }, 'relationTable'>
type RelationEdge = Edge<{
  relation: Relationship; offset: number
}, 'foreignKey'>

const Selection = createContext<Pick<GraphProps, 'selected' | 'onSelect'>>({ selected: null, onSelect: () => {} })

function TableNode({ data }: NodeProps<RelationNode>) {
  const { selected } = useContext(Selection)
  const highlighted = data.table.id === selected?.source.id || data.table.id === selected?.target.id
  return <div className={`diagram-node${data.current ? ' current' : ''}${highlighted ? ' highlighted' : ''}`}>
    <Handle type="target" position={Position.Left} id="target-left" />
    <Handle type="target" position={Position.Right} id="target-right" />
    <Handle type="source" position={Position.Left} id="source-left" />
    <Handle type="source" position={Position.Right} id="source-right" />
    <Handle type="source" position={Position.Bottom} id="loop-source" style={{ left: '38%' }} />
    <Handle type="target" position={Position.Bottom} id="loop-target" style={{ left: '62%' }} />
    <div><Table2 size={15} /><span title={`${data.table.schema}.${data.table.name}`}><small>{data.table.schema}</small>
      <strong>{data.table.name}</strong></span></div>
    <ul>{data.columns.map((column) => <li key={column} title={column}>{column}</li>)}</ul>
  </div>
}

function ForeignKeyEdge({ id, source, target, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, markerEnd, data }: EdgeProps<RelationEdge>) {
  const { selected, onSelect } = useContext(Selection)
  const { getZoom } = useReactFlow()
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; zoom: number; moved: boolean } | null>(null)
  if (!data) return null
  const highlighted = selected?.id === data.relation.id
  const self = source === target
  const sourceDirection = sourcePosition === Position.Left ? -1 : 1
  const targetDirection = targetPosition === Position.Left ? -1 : 1
  const span = Math.max(65, Math.abs(targetX - sourceX) * .45)
  const firstX = self ? sourceX - 54 : sourceX + sourceDirection * span
  const secondX = self ? targetX + 54 : targetX + targetDirection * span
  const firstY = sourceY + data.offset + (self ? 112 : 0)
  const secondY = targetY + data.offset + (self ? 112 : 0)
  const path = `M ${sourceX},${sourceY} C ${firstX},${firstY} ${secondX},${secondY} ${targetX},${targetY}`
  const labelX = (sourceX + 3 * firstX + 3 * secondX + targetX) / 8
  const labelY = (sourceY + 3 * firstY + 3 * secondY + targetY) / 8
  const color = highlighted ? '#8be1c7' : '#52877b'
  const relation = data.relation

  function endpointBadge(value: string | null, x: number, y: number, side: string) {
    const label = value ?? '?'
    const width = label.length * 8 + 12
    return <g className={`edge-cardinality${highlighted ? ' highlighted' : ''}`} aria-label={`${side}: ${value ?? 'indeterminada'}`}>
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
    setOffset({ x: origin.startX + x / origin.zoom, y: origin.startY + y / origin.zoom })
  }

  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: color, strokeWidth: highlighted ? 2.2 : 1.5 }} />
    {endpointBadge(relation.sourcePerTarget, sourceX + (self ? -23 : sourceDirection * 34), sourceY + (self ? 28 : -15 + data.offset * .14), 'Origens por destino')}
    {endpointBadge(relation.targetPerSource, targetX + (self ? 23 : targetDirection * 34), targetY + (self ? 28 : -15 + data.offset * .14), 'Destinos por origem')}
    <EdgeLabelRenderer>
      <button type="button" className={`edge-label nodrag nopan${highlighted ? ' highlighted' : ''}`}
        style={{ transform: `translate(-50%, -50%) translate(${labelX + offset.x}px,${labelY + offset.y}px)` }}
        aria-label={`Selecionar restrição ${relation.name}`} aria-pressed={highlighted}
        title={relation.name + ' · Arraste para mover'}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          drag.current = { x: event.clientX, y: event.clientY, startX: offset.x, startY: offset.y, zoom: getZoom(), moved: false }
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
  const y = { left: 0, right: 0 }
  const ordered = Array.from(tables.values())
  const rowSize = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(ordered.length))))
  const nodeLayouts = ordered.map(({ table: entry, columns }, index) => {
    if (!table) {
      return { entry, columns: Array.from(columns), position: { x: (index % rowSize) * 380, y: Math.floor(index / rowSize) * 270 } }
    }
    const side = outgoing.has(entry.id) ? 'right' : 'left'
    const x = entry.id === table.id ? 0 : side === 'right' ? 650 : -650
    const position = { x, y: x ? y[side] : 40 }
    if (x) y[side] += 92 + Math.min(8, columns.size) * 21
    return { entry, columns: Array.from(columns), position }
  })
  const nodePositions = new Map(nodeLayouts.map(({ entry, position }) => [entry.id, position]))
  const edgeLayouts = Array.from(groups.values()).flatMap((group) => group.map((relation, index) => {
    const self = relation.source.id === relation.target.id
    const spacing = 58 + Math.max(...group.map((item) => item.columns.length)) * 20
    return {
      relation,
      rightward: (nodePositions.get(relation.target.id)?.x ?? 0) >= (nodePositions.get(relation.source.id)?.x ?? 0),
      offset: self ? index * spacing : (index - (group.length - 1) / 2) * spacing * 1.35,
    }
  }))
  return { nodeLayouts, edgeLayouts }
}

interface GraphProps {
  table?: Table
  tables?: Table[]
  relations: Relationship[]
  selected: Relationship | null
  onSelect: (relation: Relationship) => void
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
  const selection = useMemo(() => ({ selected, onSelect }), [selected, onSelect])
  const nodes = useMemo<RelationNode[]>(() => layout.nodeLayouts.map(({ entry, columns, position }) => ({
    id: String(entry.id), position, type: 'relationTable',
    ariaLabel: `Tabela ${entry.schema}.${entry.name}`,
    data: { table: entry, columns, current: entry.id === table?.id },
  })), [layout, table?.id])
  const edges = useMemo<RelationEdge[]>(() => layout.edgeLayouts.map(({ relation, offset, rightward }) => {
    const source = String(relation.source.id)
    const target = String(relation.target.id)
    const self = source === target
    return {
      id: String(relation.id), source, target, type: 'foreignKey',
      sourceHandle: self ? 'loop-source' : rightward ? 'source-right' : 'source-left',
      targetHandle: self ? 'loop-target' : rightward ? 'target-left' : 'target-right',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#52877b' },
      ariaLabel: relation.name,
      data: { relation, offset },
    }
  }), [layout])

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
      <ReactFlow colorMode="dark" defaultNodes={nodes} defaultEdges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        fitView fitViewOptions={{ padding: .28, maxZoom: nodes.length === 1 ? .8 : 1.15 }} minZoom={.12} maxZoom={2.2}
        nodesDraggable panOnDrag nodesConnectable={false} deleteKeyCode={null}
        onNodeDoubleClick={(_, node) => onTable(node.data.table)}
        onEdgeClick={(_, edge) => { if (edge.data) onSelect(edge.data.relation) }}>
        <Background color="#353d3a" gap={20} size={1} />
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
