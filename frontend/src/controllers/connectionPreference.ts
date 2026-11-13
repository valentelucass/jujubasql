import type { ConnectionInput } from '../models/sql'

type ConnectionPreference = Omit<ConnectionInput, 'password'>
const key = 'nexo.connection.last'

export function readConnectionPreference(): ConnectionPreference {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (saved?.transport === 'local' || saved?.transport === 'network') {
      return {
        transport: saved.transport,
        authentication: saved.authentication === 'windows' ? 'windows' : 'sql',
        host: typeof saved.host === 'string' ? saved.host : undefined,
        port: Number.isInteger(saved.port) && saved.port > 0 && saved.port <= 65535 ? saved.port : undefined,
        instance: typeof saved.instance === 'string' ? saved.instance : undefined,
        username: typeof saved.username === 'string' ? saved.username : undefined,
      }
    }
  } catch { /* Use the default form when storage is unavailable. */ }
  return { transport: 'network', authentication: 'sql' }
}

export function rememberConnection({ transport, authentication, host, port, instance, username }: ConnectionPreference) {
  try {
    localStorage.setItem(key, JSON.stringify({ transport, authentication, host, port, instance, username }))
  } catch { /* A successful connection is usable without saved preferences. */ }
}
