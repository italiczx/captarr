import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api.js'
import { formatPercent, formatWhen, statusTone } from '../format.js'
import { Banner, Bone, Modal, NotConnected, PageHead, SkeletonRows } from '../ui.jsx'

export function Sab() {
  const { status } = useOutletContext() || {}
  const configured = status?.services?.sabnzbd?.configured
  const [tab, setTab] = useState('queue')
  const [queue, setQueue] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleteFiles, setDeleteFiles] = useState(true)

  useEffect(() => {
    if (configured === false) return undefined
    let alive = true
    async function load() {
      try {
        const data = await api('/api/sab/queue')
        if (!alive) return
        setQueue(data)
        setError(null)
      } catch (err) {
        if (alive) setError(err)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    const timer = setInterval(() => {
      if (!document.hidden && tab === 'queue') load()
    }, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [configured, tab])

  useEffect(() => {
    if (tab !== 'history' || configured === false) return undefined
    let alive = true
    api('/api/sab/history?start=0&limit=40')
      .then((data) => {
        if (alive) setHistory(data)
      })
      .catch((err) => {
        if (alive) setError(err)
      })
    return () => {
      alive = false
    }
  }, [tab, configured])

  async function run(path, options) {
    setBusy(true)
    setError(null)
    try {
      setQueue(await api(path, options))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const id = pendingDelete.id
    setPendingDelete(null)
    await run(`/api/sab/queue/${encodeURIComponent(id)}?deleteFiles=${deleteFiles ? 'true' : 'false'}`, { method: 'DELETE' })
  }

  async function loadMore() {
    if (!history) return
    const data = await api(`/api/sab/history?start=${history.slots.length}&limit=40`)
    setHistory((current) => ({
      ...current,
      slots: [
        ...current.slots,
        ...data.slots.filter((slot) => !current.slots.some((existing) => existing.id === slot.id)),
      ],
    }))
  }

  if (configured === false || error?.code === 'not_configured') {
    return <NotConnected name="SABnzbd" hash="sabnzbd" />
  }

  const lede = queue
    ? `${queue.paused ? 'Paused' : queue.status} · ${queue.sizeleft || '0'} left`
    : (loading ? <Bone width="168px" /> : null)

  return (
    <div className="page">
      <PageHead
        title="SABnzbd"
        lede={lede}
        actions={queue ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => run(queue.paused ? '/api/sab/resume' : '/api/sab/pause', { method: 'POST' })}
          >
            {queue.paused ? 'Resume' : 'Pause'}
          </button>
        ) : null}
      />
      <Banner>{error?.message}</Banner>
      <div className="tabs" role="tablist">
        <button type="button" className="tab" role="tab" aria-selected={tab === 'queue'} onClick={() => setTab('queue')}>Queue</button>
        <button type="button" className="tab" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>History</button>
      </div>

      {tab === 'queue' ? (
        <div className="table-wrap" aria-busy={loading && !queue ? 'true' : undefined}>
          {loading && !queue ? <span className="sr-only">Loading</span> : null}
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Progress</th>
                <th>Size</th>
                <th>Left</th>
                <th>Time</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue?.slots?.length ? queue.slots.map((slot) => {
                const paused = /pause/i.test(slot.status)
                return (
                  <tr key={slot.id}>
                    <td className="name">
                      <strong title={slot.filename}>{slot.filename}</strong>
                      {slot.category ? <span className="sub">{slot.category}</span> : null}
                    </td>
                    <td>
                      <div className="progress">
                        <div className="meter" aria-hidden="true"><span style={{ width: `${slot.percentage}%` }} /></div>
                        <span className="mono">{formatPercent(slot.percentage)}%</span>
                      </div>
                    </td>
                    <td className="mono">{slot.size}</td>
                    <td className="mono">{slot.sizeleft}</td>
                    <td className="mono">{slot.timeleft}</td>
                    <td className={statusTone(slot.status)}>{slot.status}</td>
                    <td className="actions">
                      <button
                        type="button"
                        className="small"
                        disabled={busy}
                        onClick={() => run(`/api/sab/queue/${encodeURIComponent(slot.id)}/${paused ? 'resume' : 'pause'}`, { method: 'POST' })}
                      >
                        {paused ? 'Resume' : 'Pause'}
                      </button>
                      <button type="button" className="small" disabled={busy} onClick={() => setPendingDelete(slot)}>Remove</button>
                    </td>
                  </tr>
                )
              }) : (
                loading ? <SkeletonRows columns={7} /> : <tr><td colSpan={7} className="empty-cell">Queue is empty.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {history ? (
            <p className="volume">
              {[
                history.day ? `Today ${history.day}` : null,
                history.week ? `This week ${history.week}` : null,
                history.month ? `This month ${history.month}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          <div className="table-wrap" aria-busy={!history ? 'true' : undefined}>
            {!history ? <span className="sr-only">Loading</span> : null}
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Size</th>
                  <th>When</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history?.slots?.length ? history.slots.map((slot) => (
                  <tr key={slot.id}>
                    <td className="name">
                      <strong title={slot.name}>{slot.name}</strong>
                      {slot.failMessage ? <span className="sub bad">{slot.failMessage}</span> : null}
                    </td>
                    <td>{slot.category}</td>
                    <td className="mono">{slot.size}</td>
                    <td>{slot.completed ? formatWhen(slot.completed) : ''}</td>
                    <td className={statusTone(slot.status)}>{slot.status}</td>
                  </tr>
                )) : (
                  history ? <tr><td colSpan={5} className="empty-cell">No history yet.</td></tr> : <SkeletonRows columns={5} />
                )}
              </tbody>
            </table>
          </div>
          {history?.slots?.length >= 40 ? (
            <div className="form-actions">
              <button type="button" onClick={loadMore}>Load more</button>
            </div>
          ) : null}
        </>
      )}

      {pendingDelete ? (
        <Modal title="Remove download" onClose={() => setPendingDelete(null)}>
          <p>Remove “{pendingDelete.filename}” from the queue?</p>
          <label className="check">
            <input type="checkbox" checked={deleteFiles} onChange={(event) => setDeleteFiles(event.target.checked)} />
            Delete incomplete files
          </label>
          <div className="form-actions">
            <button type="button" onClick={() => setPendingDelete(null)}>Cancel</button>
            <button type="button" className="danger fill" onClick={confirmDelete}>
              {deleteFiles ? 'Remove and delete files' : 'Remove'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
