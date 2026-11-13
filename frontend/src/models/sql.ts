export type Transport = 'network' | 'local'

export type Authentication = 'windows' | 'sql'

export interface ConnectionInput {
  transport: Transport
  host?: string
  port?: number
  instance?: string
  authentication: Authentication
  username?: string
  password?: string
}

export interface Connection {
  session: number
  endpoint: string
  transport: Transport
  databases: string[]
}

export type Database = string
export type Schema = string

export interface Scope {
  session: number
  database: Database
}

export interface TableScope extends Scope {
  tableId: number
}

export interface Table {
  id: number
  schema: Schema
  name: string
}

export interface Column {
  id: number
  name: string
  dataType: string
  nullable: boolean
  identity: boolean
  computed: boolean
  primaryKey: boolean
  sortable: boolean
  filterable: boolean
  editable: boolean
  editableKey: boolean
}

export interface Index {
  name: string
  kind: string
  unique: boolean
  primary: boolean
  disabled: boolean
  filtered: boolean
  filter: string | null
  columns: { name: string; descending: boolean; included: boolean }[]
}

export interface Structure {
  table: Table
  columns: Column[]
  indexes: Index[]
}

export interface Sort {
  columnId: number
  descending: boolean
}

export interface Filter {
  columnId: number
  text: string
}

export interface PageRequest {
  page: number
  pageSize: number
  sort?: Sort
  filter?: Filter
}

export interface RecordsPage {
  rows: (string | null)[][]
  columns: Column[]
  page: number
  pageSize: number
  hasNext: boolean
  stableOrder: boolean
}

export interface QueryOutput {
  columns: string[]
  rows: (string | null)[][]
  truncated: boolean
}

export interface EditInput extends TableScope {
  columnId: number
  key: string[]
  oldValue: string | null
  value: string | null
}

export interface DatabaseDiagram {
  tables: Table[]
  relationships: Relationship[]
}

export interface Relationship {
  id: number
  name: string
  source: Table
  target: Table
  columns: { source: string; target: string; ordinal: number }[]
  targetPerSource: string | null
  sourcePerTarget: string | null
  unknownReason: string | null
}

export interface AppError {
  kind: string
  message: string
}

export type Remote<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; error: AppError }
  | { status: 'ready'; data: T }

export type Tab = 'dados' | 'estrutura' | 'diagrama'
