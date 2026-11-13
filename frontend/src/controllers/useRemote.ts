import { useEffect, useState } from 'react'
import type { Remote } from '../models/sql'
import { appError } from './api'

export function useRemote<T>(load: (() => Promise<T>) | null): Remote<T> {
  const [result, setResult] = useState<{ load: typeof load; state: Remote<T> }>({
    load: null, state: { status: 'idle' },
  })

  useEffect(() => {
    if (!load) return
    let active = true
    load().then(
      (data) => { if (active) setResult({ load, state: { status: 'ready', data } }) },
      (error: unknown) => { if (active) setResult({ load, state: { status: 'error', error: appError(error) } }) },
    )
    return () => { active = false }
  }, [load])

  if (!load) return { status: 'idle' }
  return result.load === load ? result.state : { status: 'loading' }
}
