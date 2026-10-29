import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { formatSpeed, formatWhen } from '../format.js'
import { Banner, Bone, PageHead, Poster } from '../ui.jsx'

export function Dashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const next = await api('/api/dashboard')
        if (!alive) return
        setData(next)
        setError('')
      } catch (err) {
        if (alive) setError(err.message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    const timer = setInterval(() => {
      if (!document.hidden) load()
    }, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const connected = data && [data.sab, data.sonarr, data.radarr].some((item) => item.configured)

  return (
    <div className="page narrow">
      <PageHead title="Dashboard" lede="Downloads and recent imports." />
      <Banner>{error}</Banner>
      {loading && !data ? <DashboardSkeleton /> : null}
      {!loading && data && !connected ? (
        <div className="empty">
          <p>Nothing is connected yet.</p>
          <Link className="button primary" to="/settings">Open settings</Link>
        </div>
      ) : null}
      {data && connected ? (
        <>
          <section className="block">
            <div className="block-head">
              <h2><Link to="/sab">SABnzbd</Link></h2>
              {data.sab.ok ? <span className={data.sab.paused ? 'warn' : ''}>{data.sab.status}</span> : null}
            </div>
            <ServiceMessage info={data.sab} hash="sabnzbd" name="SABnzbd" />
            {data.sab.ok ? <SabStats sab={data.sab} /> : null}
          </section>

          <section className="block">
            <div className="block-head">
              <h2>Recently downloaded</h2>
            </div>
            {data.recent?.length ? (
              <div className="feed">
                {data.recent.map((item) => (
                  <RecentRow key={`${item.source}-${item.id}-${item.date}-${item.subtitle}`} item={item} />
                ))}
              </div>
            ) : (
              <p className="hint">No recent imports.</p>
            )}
          </section>

          <div className="split">
            <LibraryPanel
              title="Sonarr"
              to="/sonarr"
              hash="sonarr"
              info={data.sonarr}
              rows={[
                ['Series', data.sonarr.seriesCount],
                ['Episode files', data.sonarr.episodeFiles],
                ['Missing', data.sonarr.missing, data.sonarr.missing > 0],
                ['Queue', data.sonarr.queueCount],
              ]}
            />
            <LibraryPanel
              title="Radarr"
              to="/radarr"
              hash="radarr"
              info={data.radarr}
              rows={[
                ['Movies', data.radarr.movieCount],
                ['Downloaded', data.radarr.downloaded],
                ['Missing', data.radarr.missing, data.radarr.missing > 0],
                ['Queue', data.radarr.queueCount],
              ]}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading</span>
      <section className="block">
        <div className="block-head"><Bone width="92px" height={16} /></div>
        <div className="stat-strip">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index}>
              <Bone width="52px" height={10} />
              <Bone width="76px" height={18} className="gap" />
            </div>
          ))}
        </div>
      </section>
      <section className="block">
        <div className="block-head"><Bone width="160px" height={16} /></div>
        <div className="feed">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="feed-row" aria-hidden="true">
              <Bone width={36} height={54} />
              <div>
                <Bone width="46%" height={14} />
                <Bone width="28%" height={10} className="gap" />
              </div>
              <Bone width="52px" height={12} />
            </div>
          ))}
        </div>
      </section>
      <div className="split">
        {Array.from({ length: 2 }, (_, panel) => (
          <section key={panel} className="panel">
            <Bone width="80px" height={16} />
            <div className="stats">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index}>
                  <Bone width="64px" height={10} />
                  <Bone width="36px" height={18} className="gap" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function SabStats({ sab }) {
  const volumes = [
    sab.day ? ['Today', sab.day] : null,
    sab.week ? ['This week', sab.week] : null,
    sab.month ? ['This month', sab.month] : null,
  ].filter(Boolean)
  return (
    <>
      <div className="stat-strip">
        <Stat label="Speed" value={formatSpeed(sab.speed, sab.paused)} />
        <Stat label="Queue" value={String(sab.queueCount ?? 0)} />
        <Stat label="Remaining" value={sab.sizeleft || '—'} />
        <Stat label="Time left" value={!sab.queueCount ? '—' : (sab.timeleft || '—')} />
        <Stat label="Disk free" value={sab.diskFree || '—'} />
      </div>
      {volumes.length ? (
        <p className="volume">
          {volumes.map(([label, value]) => `${label} ${value}`).join(' · ')}
        </p>
      ) : null}
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  )
}

function ServiceMessage({ info, hash, name }) {
  if (!info.configured) {
    return <p className="hint">{name} isn't connected. <Link to={`/settings#${hash}`}>Connect</Link></p>
  }
  if (!info.ok) return <p className="warn">{info.error}</p>
  return null
}

function RecentRow({ item }) {
  const href = item.id ? `/${item.source}/${item.id}` : null
  const body = (
    <>
      <div className="thumb"><Poster item={item} service={item.source} /></div>
      <div>
        <strong>{item.title}</strong>
        <div className="sub">{item.subtitle}</div>
      </div>
      <div className="when">
        <div>{formatWhen(item.date)}</div>
        <div className="sub">{item.quality}</div>
      </div>
    </>
  )
  if (!href) return <div className="feed-row">{body}</div>
  return <Link className="feed-row" to={href}>{body}</Link>
}

function LibraryPanel({ title, to, hash, info, rows }) {
  return (
    <section className="panel">
      <div className="block-head">
        <h2><Link to={to}>{title}</Link></h2>
      </div>
      <ServiceMessage info={info} hash={hash} name={title} />
      {info.ok ? (
        <dl className="stats">
          {rows.map(([label, value, alert]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={alert ? 'bad' : ''}>{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
