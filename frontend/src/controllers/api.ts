import { invoke, isTauri } from '@tauri-apps/api/core'
import type {
  AppError, Connection, ConnectionInput, DatabaseDiagram, EditInput, QueryOutput, PageRequest, RecordsPage, Relationship,
  Schema, Scope, Structure, Table, TableScope,
} from '../models/sql'

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw { kind: 'desktop', message: 'Abra o Nexo SQL pelo aplicativo instalado no Windows.' }
  }
  return invoke<T>(command, args)
}

export const sql = {
  connect: (input: ConnectionInput) => call<Connection>('connect', { input }),
  disconnect: () => call<void>('disconnect'),
  schemas: (scope: Scope) => call<Schema[]>('schemas', { scope }),
  tables: (scope: Scope, schema: Schema) => call<Table[]>('tables', { scope, schema }),
  structure: (scope: TableScope) => call<Structure>('structure', { scope }),
  records: (scope: TableScope, page: PageRequest) =>
    call<RecordsPage>('records', { input: { ...scope, ...page } }),
  queryRead: (scope: Scope, source: string) => call<QueryOutput>('query_read', { scope, source }),
  updateCell: (input: EditInput) => call<{ changed: boolean }>('update_cell', { input }),
  databaseDiagram: (scope: Scope) => call<DatabaseDiagram>('database_diagram', { scope }),
  relationships: (scope: TableScope) => call<Relationship[]>('relationships', { scope }),
}

export function appError(error: unknown): AppError {
  if (typeof error === 'object' && error && 'kind' in error && 'message' in error
      && typeof error.kind === 'string' && typeof error.message === 'string') {
    return { kind: error.kind, message: error.message }
  }
  return { kind: 'application', message: 'O aplicativo não conseguiu concluir a leitura.' }
}
