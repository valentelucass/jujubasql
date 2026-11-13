import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Server, X } from 'lucide-react'
import { appError, sql } from '../controllers/api'
import { readConnectionPreference, rememberConnection } from '../controllers/connectionPreference'
import { useRemote } from '../controllers/useRemote'
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
  const [port, setPort] = useState(String(saved.port ?? 1433))
  const [instance, setInstance] = useState(saved.instance ?? '')
  const [username, setUsername] = useState(saved.username ?? '')
  const [rememberedProfile, setRememberedProfile] = useState('')
  const [manualProfile, setManualProfile] = useState('')
  const [credentialRevision, setCredentialRevision] = useState(0)
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host.trim().toLowerCase())
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const profile = useMemo(() => ({
    transport,
    host: transport === 'network' ? host.trim() : undefined,
    port: transport === 'network' ? Number(port) : undefined,
    instance: transport === 'local' ? instance.trim() : undefined,
    authentication,
    username: authentication === 'sql' ? username.trim() : undefined,
  }), [transport, host, port, instance, authentication, username])
  const profileKey = JSON.stringify([transport, profile.host?.toLowerCase(), profile.port,
    profile.instance?.toLowerCase(), authentication, profile.username])
  const remember = rememberedProfile === profileKey
  const lookup = useMemo(() => () => sql.hasSavedPassword(profile), [profile, credentialRevision])
  const passwordStatus = useRemote(authentication === 'sql' && profile.username
    && (transport === 'local' || (profile.host && profile.port && profile.port <= 65535)) ? lookup : null)
  const hasSavedPassword = passwordStatus.status === 'ready' && passwordStatus.data
  const useSavedPassword = hasSavedPassword && manualProfile !== profileKey

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
    const request = sql.connect({ ...profile, password: String(data.get('password') ?? '') || undefined },
      useSavedPassword, authentication === 'sql' && !useSavedPassword && (remember || hasSavedPassword))
    data.delete('password')
    try {
      const connection = await request
      rememberConnection(profile)
      onConnected(connection)
    } catch (failure) {
      const issue = appError(failure)
      setError(issue)
      if (useSavedPassword && ['authentication', 'credentials'].includes(issue.kind)) setManualProfile(profileKey)
    } finally {
      setLoading(false)
    }
  }

  async function forgetPassword() {
    setLoading(true)
    setError(null)
    try {
      await sql.forgetPassword(profile)
      setManualProfile(profileKey)
      setRememberedProfile('')
      setCredentialRevision((value) => value + 1)
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
            <label>Porta<input name="port" type="number" value={port} onChange={(event) => setPort(event.target.value)} min={1} max={65535} required /></label>
          </div>
          {loopback && <button type="button" className="detail-link" onClick={() => { setTransport('local'); setError(null) }}>
            Conectar ao SQL Server neste computador
          </button>}
        </> : <label>Instância local<input name="instance" value={instance} onChange={(event) => setInstance(event.target.value)} maxLength={16} placeholder="Em branco para a instância padrão"
          spellCheck={false} autoComplete="off" /></label>}
        <label>Autenticação<select name="authentication" value={authentication}
          onChange={(event) => { setAuthentication(event.target.value as Authentication); setShowPassword(false) }}>
          <option value="windows">Conta atual do Windows</option>
          <option value="sql">Usuário do SQL Server</option>
        </select></label>
        {authentication === 'sql' && <>
          <label>Usuário<input name="username" value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={128} autoComplete="off" /></label>
          {useSavedPassword ? <p className="saved-password"><LockKeyhole size={15} /> Senha salva neste PC</p>
          : <div className="password-group"><label htmlFor="connection-password">Senha</label><div className="password-field">
            <input key={profileKey} id="connection-password" name="password" type={showPassword && manualProfile === profileKey ? 'text' : 'password'}
              required maxLength={128} autoComplete="off" onChange={() => setManualProfile(profileKey)} />
            <button className="icon-button" type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              onClick={() => { setManualProfile(profileKey); setShowPassword(!showPassword || manualProfile !== profileKey) }}>
              {showPassword && manualProfile === profileKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div></div>}
          {hasSavedPassword ? <div className="saved-password-actions">
            {useSavedPassword && <button type="button" className="detail-link" onClick={() => { setManualProfile(profileKey); setShowPassword(false) }}>Digitar outra senha</button>}
            <button type="button" className="detail-link" onClick={() => void forgetPassword()}>Esquecer senha salva</button>
          </div> : <label className="remember-password">
            <input type="checkbox" checked={remember} onChange={(event) => setRememberedProfile(event.target.checked ? profileKey : '')} />
            Lembrar senha neste PC
          </label>}
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
