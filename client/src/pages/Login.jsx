import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useSession } from '../session.js'
import { Banner, Brand } from '../ui.jsx'

export function Login() {
  const { setSession } = useSession()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const me = await api('/api/auth/login', { method: 'POST', json: { username, password } })
      setSession({ ready: true, needsSetup: false, user: me.username, error: null })
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <aside className="gate-aside">
        <Brand />
        <p className="aside-copy">SABnzbd, Sonarr, and Radarr in one place.</p>
      </aside>
      <main className="gate-main">
        <form onSubmit={submit}>
          <h1>Sign in</h1>
          <Banner>{error}</Banner>
          <label className="field" htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <label className="field" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="form-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
