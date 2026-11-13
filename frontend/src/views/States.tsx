import { AlertCircle, Database, GitFork, LoaderCircle, Table2 } from 'lucide-react'
import type { AppError } from '../models/sql'

export function Loading() {
  return <div className="inline-state" role="status"><LoaderCircle className="spin" size={19} /> Carregando…</div>
}

export function Failure({ error, retry }: { error: AppError; retry?: () => void }) {
  return <div className="inline-state failure" role="alert"><AlertCircle size={20} />
    <strong>{error.kind === 'authorization' ? 'Sem acesso' : 'Falha na leitura'}</strong>
    <span>{error.message}</span>{retry && <button className="button" onClick={retry}>Tentar novamente</button>}
  </div>
}

export function Empty({ title, note, type = 'table' }: { title: string; note?: string; type?: 'table' | 'database' | 'relation' }) {
  const Icon = type === 'relation' ? GitFork : type === 'database' ? Database : Table2
  return <div className="inline-state"><span className="quiet-icon"><Icon size={19} /></span>
    <strong>{title}</strong>{note && <span>{note}</span>}</div>
}
