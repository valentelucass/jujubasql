import { useCallback, useState } from 'react'
import type { PageRequest, Relationship, Tab, TableScope } from '../models/sql'
import { sql } from './api'
import { useRemote } from './useRemote'

export function useTable(scope: TableScope, refreshKey: number) {
  const [tab, setTab] = useState<Tab>('dados')
  const [page, setPage] = useState<PageRequest>({ page: 0, pageSize: 50 })
  const [picked, pick] = useState<{ relation: Relationship; refreshKey: number } | null>(null)
  const [revision, setRevision] = useState(0)
  const { session, database, tableId } = scope
  const relationship = picked?.refreshKey === refreshKey ? picked.relation : null
  const setRelationship = (relation: Relationship | null) => pick(relation ? { relation, refreshKey } : null)

  const readStructure = useCallback(() => sql.structure({ session, database, tableId }),
    // Revision reloads all active requests after a manual refresh.
    [session, database, tableId, revision, refreshKey])
  const readPage = useCallback(() => sql.records({ session, database, tableId }, page),
    [session, database, tableId, page, revision, refreshKey])
  const readRelationships = useCallback(() => sql.relationships({ session, database, tableId }),
    [session, database, tableId, revision, refreshKey])
  const structure = useRemote(readStructure)
  const records = useRemote(tab === 'dados' ? readPage : null)
  const relationships = useRemote(tab !== 'dados' ? readRelationships : null)

  function changeTab(next: Tab) {
    setRelationship(null)
    setTab(next)
  }
  function refresh() {
    setRelationship(null)
    setRevision((value) => value + 1)
  }

  return { tab, changeTab, page, setPage, relationship, setRelationship,
    structure, records, relationships, refresh }
}
