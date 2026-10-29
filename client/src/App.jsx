import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api.js'
import { Dashboard } from './pages/Dashboard.jsx'
import { Library } from './pages/Library.jsx'
import { Login } from './pages/Login.jsx'
import { Sab } from './pages/Sab.jsx'
import { Settings } from './pages/Settings.jsx'
import { Setup } from './pages/Setup.jsx'
import { SessionContext, useSession } from './session.js'
import { Shell } from './Shell.jsx'
import { Bone } from './ui.jsx'

export function App() {
  const [session, setSession] = useState({ ready: false, needsSetup: false, user: null, error: null })

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const status = await api('/api/setup/status')
        let user = null
        try {
          const me = await api('/api/auth/me')
          user = me.username
        } catch {
          user = null
        }
        if (alive) setSession({ ready: true, needsSetup: status.needsSetup, user, error: null })
      } catch (err) {
        if (alive) setSession({ ready: true, needsSetup: false, user: null, error: err.message })
      }
    }
    load()
    function onLost() {
      setSession((current) => ({ ...current, ready: true, user: null }))
    }
    window.addEventListener('auth:lost', onLost)
    return () => {
      alive = false
      window.removeEventListener('auth:lost', onLost)
    }
  }, [])

  return (
    <SessionContext.Provider value={{ session, setSession }}>
      <BrowserRouter>
        <Routes>
          <Route element={<Gate />}>
            <Route path="/setup" element={<Setup />} />
            <Route path="/login" element={<Login />} />
            <Route element={<Shell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sab" element={<Sab />} />
              <Route path="/sonarr" element={<Library service="sonarr" />} />
              <Route path="/sonarr/:id" element={<Library service="sonarr" />} />
              <Route path="/radarr" element={<Library service="radarr" />} />
              <Route path="/radarr/:id" element={<Library service="radarr" />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionContext.Provider>
  )
}

function BootSkeleton() {
  return (
    <div className="app-shell" aria-busy="true">
      <span className="sr-only">Loading</span>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><Bone width="72px" height={14} /></div>
        <div className="nav skeleton-nav">
          {Array.from({ length: 5 }, (_, index) => <Bone key={index} width="120px" height={16} />)}
        </div>
      </aside>
      <main className="main">
        <div className="page narrow">
          <Bone width="180px" height={26} />
          <Bone width="240px" height={14} className="gap" />
          <div className="stat-strip" style={{ marginTop: 28 }}>
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index}>
                <Bone width="48px" height={10} />
                <Bone width="72px" height={18} className="gap" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

function Gate() {
  const { session } = useSession()
  const location = useLocation()
  if (!session.ready) return <BootSkeleton />
  if (session.error && !session.user && location.pathname !== '/login') {
    return (
      <div className="boot">
        <div className="banner" role="alert">{session.error}</div>
      </div>
    )
  }
  const path = location.pathname
  if (session.needsSetup) {
    if (path !== '/setup') return <Navigate to="/setup" replace />
    return <Outlet />
  }
  if (!session.user) {
    if (path !== '/login') return <Navigate to="/login" replace />
    return <Outlet />
  }
  if (path === '/login' || path === '/setup') return <Navigate to="/" replace />
  return <Outlet />
}
