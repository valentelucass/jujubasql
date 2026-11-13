export interface DatabaseFile {
  name: string
  kind: string
  sizeMib: number
  usedMib: number | null
}

export interface DashboardOverview {
  tables: number
  views: number
  schemas: number
  foreignKeys: number
  files: DatabaseFile[]
}

export interface TableStorage {
  schema: string
  name: string
  rows: number
  reservedMib: number
  usedMib: number
}

export interface QueryActivity {
  label: string
  executions: number
  averageMs: number
  totalMs: number
  sqlPreview: string | null
}

export interface DashboardPerformance {
  state: string
  timeline: QueryActivity[]
  queries: QueryActivity[]
}
