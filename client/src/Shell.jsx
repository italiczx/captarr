import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from './api.js'
import { useSession } from './session.js'

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/sab', label: 'SABnzbd', service: 'sabnzbd' },
  { to: '/sonarr', label: 'Sonarr', service: 'sonarr' },
  { to: '/radarr', label: 'Radarr', service: 'radarr' },
  { to: '/settings', label: 'Settings' },
]

export function Shell() {
  const { session, setSession } = useSession()
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const data = await api('/api/status')
        if (alive) setStatus(data)
      } catch {
        /* The page itself will show a connection error. */
      }
    }
    load()
    const timer = setInterval(() => {
      if (!document.hidden) load()
    }, 15000)
    window.addEventListener('status:refresh', load)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('status:refresh', load)
    }
  }, [])

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    setSession({ ready: true, needsSetup: false, user: null, error: null })
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" end>
          <span className="brand-mark" aria-hidden="true" />
          Captarr
        </NavLink>
        <nav className="nav">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <Dot service={link.service} status={status} />
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">{session.user}</div>
          <button type="button" className="linkish" onClick={logout}>Log out</button>
          {status?.version ? <div className="version">v{status.version}</div> : null}
        </div>
      </aside>
      <main className="main">
        <Outlet context={{ status }} />
      </main>
    </div>
  )
}

function Dot({ service, status }) {
  if (!service) return <span className="dot spacer" aria-hidden="true" />
  const info = status?.services?.[service]
  const tone = !info?.configured ? '' : info.ok ? 'ok' : 'bad'
  const label = !info ? '' : !info.configured ? 'Not connected' : info.ok ? 'Connected' : info.error
  return <span className={`dot ${tone}`} title={label} aria-hidden="true" />
}
