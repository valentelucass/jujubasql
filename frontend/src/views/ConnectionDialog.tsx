import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Server, X } from 'lucide-react'
import { appError, sql } from '../controllers/api'
import { readConnectionPreference, rememberConnection } from '../controllers/connectionPreference'
import type { AppError, Authentication, Connection, Transport } from '../models/sql'

export function ConnectionDialog({ onClose, onConnected }: {
  onClose: () => void
  onConnected: (connection: Connection) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [saved] = useState(readConnectionPreference)
  const [transport, setTransport] = useState<Transport>(saved.transport)
  const [authentication, setAuthentication] = useState<Authentication>(saved.authentication)
  const [host, setHost] = useState(saved.host ?? '')
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host.trim().toLowerCase())
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    const form = event.currentTarget
    const data = new FormData(form)
    const secret = form.elements.namedItem('password')
    if (secret instanceof HTMLInputElement) secret.value = ''
    const profile = {
      transport,
      host: transport === 'network' ? host.trim() : undefined,
      port: transport === 'network' ? Number(data.get('port')) : undefined,
      instance: transport === 'local' ? String(data.get('instance') ?? '').trim() : undefined,
      authentication,
      username: authentication === 'sql' ? String(data.get('username') ?? '').trim() : undefined,
    }
    const request = sql.connect({ ...profile, password: String(data.get('password') ?? '') || undefined })
    data.delete('password')
    try {
      const connection = await request
      rememberConnection(profile)
      onConnected(connection)
    } catch (failure) {
      setError(appError(failure))
    } finally {
      setLoading(false)
    }
  }

  return <dialog ref={dialog} className="connection-dialog" aria-labelledby="connection-title"
    onCancel={(event) => { event.preventDefault(); if (!loading) onClose() }}>
    <form onSubmit={connect}>
      <div className="dialog-top"><span className="quiet-icon accent-icon"><Server size={21} /></span>
        <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose} disabled={loading}><X size={18} /></button>
      </div>
      <h2 id="connection-title">Conectar ao SQL Server</h2>
      <p>Escolha onde está o SQL Server e informe o login com acesso aos bancos.</p>
      <fieldset disabled={loading}>
        <label>Tipo de conexão<select value={transport} onChange={(event) => {
          setTransport(event.target.value as Transport)
          setError(null)
        }}>
          <option value="network">Pela rede</option>
          <option value="local">Neste computador</option>
        </select></label>
        {transport === 'network' ? <>
          <div className="form-row">
            <label>Servidor DNS<input name="host" required autoFocus maxLength={253} placeholder="servidor.empresa.local"
              spellCheck={false} autoComplete="off" value={host} onChange={(event) => setHost(event.target.value)} /></label>
            <label>Porta<input name="port" type="number" defaultValue={saved.port ?? 1433} min={1} max={65535} required /></label>
          </div>
          {loopback && <button type="button" className="detail-link" onClick={() => { setTransport('local'); setError(null) }}>
            Conectar ao SQL Server neste computador
          </button>}
        </> : <label>Instância local<input name="instance" defaultValue={saved.instance ?? ''} maxLength={16} placeholder="Em branco para a instância padrão"
          spellCheck={false} autoComplete="off" /></label>}
        <label>Autenticação<select name="authentication" value={authentication}
          onChange={(event) => { setAuthentication(event.target.value as Authentication); setShowPassword(false) }}>
          <option value="windows">Conta atual do Windows</option>
          <option value="sql">Usuário do SQL Server</option>
        </select></label>
        {authentication === 'sql' && <>
          <label>Usuário<input name="username" defaultValue={saved.username ?? ''} required maxLength={128} autoComplete="off" /></label>
          <div className="password-group"><label htmlFor="connection-password">Senha</label><div className="password-field">
            <input id="connection-password" name="password" type={showPassword ? 'text' : 'password'} required maxLength={128} autoComplete="off" />
            <button className="icon-button" type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div></div>
        </>}
      </fieldset>
      <div className="tls-note"><LockKeyhole size={15} /> {transport === 'local'
        ? 'Conexão direta na mesma máquina. O login do SQL Server continua obrigatório.'
        : 'Criptografia e validação do certificado do servidor.'}</div>
      {error && <div className="form-error" role="alert">{error.message}</div>}
      <div className="dialog-actions"><button type="button" className="button" disabled={loading} onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={16} /> Conectando…</> : <>Conectar <ArrowRight size={16} /></>}</button>
      </div>
    </form>
  </dialog>
}
