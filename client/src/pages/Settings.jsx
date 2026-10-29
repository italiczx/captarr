import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api.js'
import { Banner, Bone, PageHead } from '../ui.jsx'

const services = [
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

export function Settings() {
  const location = useLocation()
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      setSettings(await api('/api/settings'))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!location.hash || !settings) return
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [location.hash, settings])

  return (
    <div className="page narrow">
      <PageHead title="Settings" lede={settings ? `Signed in as ${settings.username}` : (error ? null : <Bone width="148px" />)} />
      <Banner>{error}</Banner>
      {!settings && !error ? <SettingsSkeleton /> : null}
      {settings ? (
        <>
          <PasswordForm />
          {services.map((service) => (
            <ServiceForm
              key={`${service.id}-${settings.connections[service.id].baseUrl}-${settings.connections[service.id].hasApiKey}`}
              service={service}
              saved={settings.connections[service.id]}
              onSaved={load}
            />
          ))}
        </>
      ) : null}
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: 4 }, (_, index) => (
        <section key={index} className="panel settings-block" aria-hidden="true">
          <Bone width="120px" height={16} />
          <Bone height={38} className="gap" />
          <Bone height={38} className="gap" />
        </section>
      ))}
    </div>
  )
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api('/api/settings/password', { method: 'POST', json: { currentPassword, newPassword } })
      setCurrentPassword('')
      setNewPassword('')
      setNotice('Password updated.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel settings-block">
      <h2>Password</h2>
      <form onSubmit={submit}>
        <Banner>{error}</Banner>
        {notice ? <p className="notice">{notice}</p> : null}
        <label className="field" htmlFor="current-password">Current password</label>
        <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        <label className="field" htmlFor="new-password">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
        </div>
      </form>
    </section>
  )
}

function ServiceForm({ service, saved, onSaved }) {
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl || '')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)

  async function test() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api('/api/settings/test', {
        method: 'POST',
        json: { service: service.id, baseUrl, apiKey },
      })
      setNotice(`Connected · ${result.version}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(`/api/settings/connections/${service.id}`, { method: 'PUT', json: { baseUrl, apiKey } })
      setNotice('Saved.')
      setApiKey('')
      window.dispatchEvent(new Event('status:refresh'))
      await onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await api(`/api/settings/connections/${service.id}`, { method: 'DELETE' })
      setArmed(false)
      window.dispatchEvent(new Event('status:refresh'))
      await onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel settings-block" id={service.id}>
      <h2>{service.label}</h2>
      <form onSubmit={save}>
        <Banner>{error}</Banner>
        {notice ? <p className="notice">{notice}</p> : null}
        <label className="field" htmlFor={`${service.id}-host`}>Host</label>
        <input
          id={`${service.id}-host`}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={service.placeholder}
          value={baseUrl}
          onChange={(event) => {
            setBaseUrl(event.target.value)
            setNotice('')
          }}
        />
        <p className="hint">{service.hint}</p>
        <label className="field" htmlFor={`${service.id}-key`}>API key</label>
        <input
          id={`${service.id}-key`}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={saved.hasApiKey ? 'Saved — leave blank to keep it' : ''}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <div className="form-actions">
          <button type="button" onClick={test} disabled={busy}>Test</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          {saved.hasApiKey && !armed ? (
            <button type="button" className="danger" onClick={() => setArmed(true)}>Remove</button>
          ) : null}
          {armed ? (
            <>
              <span className="hint">Remove this connection?</span>
              <button type="button" className="danger fill" onClick={remove} disabled={busy}>Yes, remove</button>
              <button type="button" onClick={() => setArmed(false)}>Cancel</button>
            </>
          ) : null}
        </div>
      </form>
    </section>
  )
}
