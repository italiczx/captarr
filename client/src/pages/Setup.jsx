import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useSession } from '../session.js'
import { Banner, Brand } from '../ui.jsx'

const steps = [
  { id: 'account', label: 'Account' },
  {
    id: 'sabnzbd',
    label: 'SABnzbd',
    placeholder: 'http://192.168.1.10:8080/sabnzbd',
    hint: 'Include http:// and a URL base if SABnzbd uses one.',
  },
  {
    id: 'sonarr',
    label: 'Sonarr',
    placeholder: 'http://192.168.1.10:8989',
    hint: 'Include http:// and a URL base if Sonarr uses one.',
  },
  {
    id: 'radarr',
    label: 'Radarr',
    placeholder: 'http://192.168.1.10:7878',
    hint: 'Include http:// and a URL base if Radarr uses one.',
  },
]

const emptyConnections = {
  sabnzbd: { baseUrl: '', apiKey: '' },
  sonarr: { baseUrl: '', apiKey: '' },
  radarr: { baseUrl: '', apiKey: '' },
}

export function Setup() {
  const { setSession } = useSession()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [account, setAccount] = useState({ username: '', password: '', confirm: '' })
  const [connections, setConnections] = useState(emptyConnections)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [canForce, setCanForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const current = steps[step]

  function resetFeedback() {
    setError('')
    setNotice('')
    setCanForce(false)
  }

  function updateConnection(field, value) {
    resetFeedback()
    setConnections((currentConnections) => ({
      ...currentConnections,
      [current.id]: { ...currentConnections[current.id], [field]: value },
    }))
  }

  async function finish() {
    setBusy(true)
    setError('')
    try {
      const body = {
        username: account.username.trim(),
        password: account.password,
        connections: {
          sabnzbd: connectionPayload(connections.sabnzbd),
          sonarr: connectionPayload(connections.sonarr),
          radarr: connectionPayload(connections.radarr),
        },
      }
      const me = await api('/api/setup', { method: 'POST', json: body })
      setSession({ ready: true, needsSetup: false, user: me.username, error: null })
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function continueStep(force) {
    if (current.id === 'account') {
      if (!/^[A-Za-z0-9._-]{2,32}$/.test(account.username.trim())) {
        setError('Username must be 2–32 characters: letters, numbers, dot, dash, or underscore.')
        return
      }
      if (account.password.length < 8) {
        setError('Password must be at least 8 characters.')
        return
      }
      if (account.password !== account.confirm) {
        setError('Passwords do not match.')
        return
      }
      setStep(1)
      resetFeedback()
      return
    }

    const draft = connections[current.id]
    const hasUrl = draft.baseUrl.trim()
    const hasKey = draft.apiKey.trim()
    if (!hasUrl && !hasKey) {
      if (step === steps.length - 1) await finish()
      else {
        setStep((value) => value + 1)
        resetFeedback()
      }
      return
    }
    if (!hasUrl || !hasKey) {
      setError(`${current.label} needs both a host and an API key, or clear both to skip.`)
      return
    }
    if (!force) {
      setBusy(true)
      try {
        const result = await api('/api/setup/test', {
          method: 'POST',
          json: { service: current.id, baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim() },
        })
        setNotice(`Connected · ${result.version}`)
        setError('')
        setCanForce(false)
      } catch (err) {
        setError(err.message)
        setCanForce(true)
        setBusy(false)
        return
      } finally {
        setBusy(false)
      }
    }
    if (step === steps.length - 1) await finish()
    else {
      setStep((value) => value + 1)
      resetFeedback()
    }
  }

  function skip() {
    setConnections((currentConnections) => ({
      ...currentConnections,
      [current.id]: { baseUrl: '', apiKey: '' },
    }))
    resetFeedback()
    if (step === steps.length - 1) {
      const next = {
        ...connections,
        [current.id]: { baseUrl: '', apiKey: '' },
      }
      setConnections(next)
      finishFrom(next)
      return
    }
    setStep((value) => value + 1)
  }

  async function finishFrom(nextConnections) {
    setBusy(true)
    try {
      const me = await api('/api/setup', {
        method: 'POST',
        json: {
          username: account.username.trim(),
          password: account.password,
          connections: {
            sabnzbd: connectionPayload(nextConnections.sabnzbd),
            sonarr: connectionPayload(nextConnections.sonarr),
            radarr: connectionPayload(nextConnections.radarr),
          },
        },
      })
      setSession({ ready: true, needsSetup: false, user: me.username, error: null })
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const last = step === steps.length - 1
  const primary = last ? 'Finish' : 'Continue'

  return (
    <div className="gate">
      <aside className="gate-aside">
        <Brand />
        <p className="aside-copy">SABnzbd, Sonarr, and Radarr in one place.</p>
        <ol className="steps">
          {steps.map((item, index) => (
            <li key={item.id} className={index === step ? 'step on' : index < step ? 'step done' : 'step'}>
              <span className="n">{index + 1}</span>
              {item.label}
            </li>
          ))}
        </ol>
      </aside>
      <main className="gate-main">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            continueStep(false)
          }}
        >
          <h1>{current.id === 'account' ? 'Create a login' : `Connect ${current.label}`}</h1>
          <p className="lede">
            {current.id === 'account'
              ? 'One account for this dashboard. You can change the password later.'
              : 'Use the address this server can reach. You can skip this and add it later.'}
          </p>
          <Banner>{error}</Banner>
          {current.id === 'account' ? (
            <>
              <label className="field" htmlFor="username">Username</label>
              <input
                id="username"
                autoFocus
                autoComplete="username"
                value={account.username}
                onChange={(event) => {
                  resetFeedback()
                  setAccount({ ...account, username: event.target.value })
                }}
              />
              <label className="field" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={account.password}
                onChange={(event) => {
                  resetFeedback()
                  setAccount({ ...account, password: event.target.value })
                }}
              />
              <label className="field" htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={account.confirm}
                onChange={(event) => {
                  resetFeedback()
                  setAccount({ ...account, confirm: event.target.value })
                }}
              />
            </>
          ) : (
            <>
              <label className="field" htmlFor="host">Host</label>
              <input
                id="host"
                autoFocus
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={current.placeholder}
                value={connections[current.id].baseUrl}
                onChange={(event) => updateConnection('baseUrl', event.target.value)}
              />
              <p className="hint">{current.hint}</p>
              <label className="field" htmlFor="apiKey">API key</label>
              <input
                id="apiKey"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={connections[current.id].apiKey}
                onChange={(event) => updateConnection('apiKey', event.target.value)}
              />
              {notice ? <p className="notice">{notice}</p> : null}
            </>
          )}
          <div className="form-actions">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setStep((value) => value - 1)
                  resetFeedback()
                }}
                disabled={busy}
              >
                Back
              </button>
            ) : null}
            {current.id !== 'account' ? (
              <button type="button" onClick={skip} disabled={busy}>Skip</button>
            ) : null}
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Working…' : primary}
            </button>
            {canForce ? (
              <button type="button" onClick={() => continueStep(true)} disabled={busy}>
                {last ? 'Finish anyway' : 'Continue anyway'}
              </button>
            ) : null}
          </div>
        </form>
      </main>
    </div>
  )
}

function connectionPayload(connection) {
  if (!connection.baseUrl.trim() && !connection.apiKey.trim()) return null
  return { baseUrl: connection.baseUrl.trim(), apiKey: connection.apiKey.trim() }
}
