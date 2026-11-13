import { useRef, useState } from 'react'
import { appError, sql } from './api'
import type { Column, Connection, Database, Remote, Schema, Table } from '../models/sql'

const id = (...parts: (string | number)[]) => JSON.stringify(parts)
export const serverId = 'server'
export const folderId = 'databases'
export const databaseId = (db: Database) => id('database', db)
export const schemaId = (db: Database, schema: Schema) => id('schema', db, schema)
export const tablesId = (db: Database, schema: Schema) => id('tables', db, schema)
export const tableId = (db: Database, table: Table) => id('table', db, table.id)
const columnId = (db: Database, table: Table, column: Column) => id('column', db, table.id, column.id)

type TreeItemType = 'server' | 'folder' | 'database' | 'table' | 'column' | 'status'
export interface TreeItem {
  id: string
  label: string
  level: number
  parent?: string
  type: TreeItemType
  expanded?: boolean
  selected?: boolean
  note?: string
  toggle?: () => void
  choose?: () => void
}

export function useExplorer(
  connection: Connection,
  database: Database | null,
  table: Table | null,
  onDatabase: (db: Database) => void,
  onTable: (db: Database, table: Table) => void,
) {
  const [expanded, setExpanded] = useState(new Set([serverId, folderId]))
  const [schemas, setSchemas] = useState<Record<string, Remote<Schema[]>>>({})
  const [tables, setTables] = useState<Record<string, Remote<Table[]>>>({})
  const [columns, setColumns] = useState<Record<string, Remote<Column[]>>>({})
  const requested = useRef(new Set<string>())

  function fetchBranch<T>(
    key: string,
    load: () => Promise<T>,
    update: React.Dispatch<React.SetStateAction<Record<string, Remote<T>>>>,
  ) {
    if (requested.current.has(key)) return
    requested.current.add(key)
    update((cache) => ({ ...cache, [key]: { status: 'loading' } }))
    load().then(
      (data) => update((cache) => ({ ...cache, [key]: { status: 'ready', data } })),
      (error: unknown) => {
        requested.current.delete(key)
        update((cache) => ({ ...cache, [key]: { status: 'error', error: appError(error) } }))
      },
    )
  }

  function show(...keys: string[]) {
    setExpanded((previous) => new Set([...previous, ...keys]))
  }

  function toggle(key: string, load?: () => void) {
    const opening = !expanded.has(key)
    if (opening) load?.()
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const loadSchemas = (db: Database) => fetchBranch(databaseId(db),
    () => sql.schemas({ session: connection.session, database: db }), setSchemas)
  const loadTables = (db: Database, schema: Schema) => fetchBranch(tablesId(db, schema),
    () => sql.tables({ session: connection.session, database: db }, schema), setTables)
  const loadColumns = (db: Database, entry: Table) => fetchBranch(tableId(db, entry),
    async () => (await sql.structure({ session: connection.session, database: db, tableId: entry.id })).columns, setColumns)

  function chooseDatabase(db: Database) {
    show(serverId, folderId, databaseId(db))
    loadSchemas(db)
    onDatabase(db)
  }

  function chooseRelatedTable(db: Database, entry: Table) {
    show(serverId, folderId, databaseId(db), schemaId(db, entry.schema), tablesId(db, entry.schema))
    loadSchemas(db)
    loadTables(db, entry.schema)
    onTable(db, entry)
  }

  const items: TreeItem[] = [
    { id: serverId, label: connection.endpoint, level: 1, type: 'server', expanded: expanded.has(serverId), toggle: () => toggle(serverId) },
  ]

  function content<T>(
    state: Remote<T[]> | undefined, parent: TreeItem, empty: string,
    render: (entry: T) => void, retry: () => void,
  ) {
    if (!parent.expanded) return
    if (state?.status === 'ready' && state.data.length > 0) {
      state.data.forEach(render)
      return
    }
    const error = state?.status === 'error' ? state.error : null
    items.push({
      id: id(parent.id, 'status'), type: 'status', parent: parent.id, level: parent.level + 1,
      label: error ? error.message : state?.status === 'ready' ? empty : 'Carregando…',
      note: error ? 'Tentar novamente' : undefined, choose: error ? retry : undefined,
    })
  }

  if (expanded.has(serverId)) {
    items.push({ id: folderId, label: 'Bancos de dados', parent: serverId, level: 2, type: 'folder',
      expanded: expanded.has(folderId), toggle: () => toggle(folderId) })
  }
  if (expanded.has(serverId) && expanded.has(folderId)) {
    if (!connection.databases.length) {
      items.push({ id: 'empty', label: 'Nenhum banco acessível', level: 3, parent: folderId, type: 'status' })
    }
    for (const db of connection.databases) {
      const dbNode: TreeItem = { id: databaseId(db), label: db, parent: folderId, level: 3, type: 'database',
        selected: db === database && !table, expanded: expanded.has(databaseId(db)),
        toggle: () => toggle(databaseId(db), () => loadSchemas(db)), choose: () => chooseDatabase(db) }
      items.push(dbNode)
      content(schemas[dbNode.id], dbNode, 'Nenhum esquema com tabelas visíveis', (schema) => {
        const schemaNode: TreeItem = { id: schemaId(db, schema), label: schema, parent: dbNode.id, level: 4,
          type: 'folder', expanded: expanded.has(schemaId(db, schema)), toggle: () => toggle(schemaId(db, schema)) }
        items.push(schemaNode)
        if (!schemaNode.expanded) return
        const folder: TreeItem = { id: tablesId(db, schema), label: 'Tabelas', parent: schemaNode.id, level: 5, type: 'folder',
          expanded: expanded.has(tablesId(db, schema)), toggle: () => toggle(tablesId(db, schema), () => loadTables(db, schema)) }
        items.push(folder)
        content(tables[folder.id], folder, 'Nenhuma tabela visível', (entry) => {
          const node: TreeItem = { id: tableId(db, entry), label: entry.name, parent: folder.id, level: 6, type: 'table',
            selected: db === database && table?.id === entry.id, expanded: expanded.has(tableId(db, entry)),
            toggle: () => toggle(tableId(db, entry), () => loadColumns(db, entry)), choose: () => onTable(db, entry) }
          items.push(node)
          content(columns[node.id], node, 'Nenhuma coluna visível', (column) => {
            items.push({ id: columnId(db, entry, column), label: column.name, note: column.dataType,
              parent: node.id, level: 7, type: 'column' })
          }, () => loadColumns(db, entry))
        }, () => loadTables(db, schema))
      }, () => loadSchemas(db))
    }
  }

  return { items, chooseDatabase, chooseRelatedTable }
}
