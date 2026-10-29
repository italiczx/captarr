import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { formatBytes, formatRuntime } from '../format.js'
import { Banner, Bone, Modal, NotConnected, PageHead, Poster, SkeletonRows } from '../ui.jsx'

const copy = {
  sonarr: {
    name: 'Sonarr',
    hash: 'sonarr',
    noun: 'series',
    nouns: 'series',
    collection: 'series',
    placeholder: 'Search series',
    hint: 'Searches TheTVDB through Sonarr.',
    filter: 'Filter series',
  },
  radarr: {
    name: 'Radarr',
    hash: 'radarr',
    noun: 'movie',
    nouns: 'movies',
    collection: 'movies',
    placeholder: 'Search movies',
    hint: 'Searches TMDB through Radarr.',
    filter: 'Filter movies',
  },
}

export function Library({ service }) {
  const params = useParams()
  if (params.id) return <Detail service={service} id={params.id} />
  return <Browse service={service} />
}

const PAGE_SIZE = 48

function Browse({ service }) {
  const meta = copy[service]
  const navigate = useNavigate()
  const { status } = useOutletContext() || {}
  const configured = status?.services?.[service]?.configured
  const [tab, setTab] = useState('library')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('title')
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem('captarr-library-view') || 'posters'
    } catch {
      return 'posters'
    }
  })

  const queryRef = useRef(query)
  useEffect(() => {
    const next = filter.trim()
    const handle = setTimeout(() => {
      if (queryRef.current === next) return
      queryRef.current = next
      setQuery(next)
      setPage(1)
    }, 200)
    return () => clearTimeout(handle)
  }, [filter])

  useEffect(() => {
    if (configured === false || tab !== 'library') return undefined
    let alive = true
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
      q: query,
    })
    api(`/api/${service}/${meta.collection}?${params}`)
      .then((data) => {
        if (!alive) return
        setItems(data.items || [])
        setTotal(data.total || 0)
        if (typeof data.page === 'number' && data.page !== page) setPage(data.page)
        setError(null)
      })
      .catch((err) => {
        if (alive) setError(err)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [service, meta.collection, configured, tab, page, sort, query])

  if (configured === false || error?.code === 'not_configured') {
    return <NotConnected name={meta.name} hash={meta.hash} />
  }

  return (
    <div className="page">
      <PageHead
        title={meta.name}
        lede={loading && items.length === 0 ? <Bone width="88px" /> : `${total} ${total === 1 ? meta.noun : meta.nouns}`}
      />
      <div className="tabs" role="tablist">
        <button type="button" className="tab" role="tab" aria-selected={tab === 'library'} onClick={() => setTab('library')}>Library</button>
        <button type="button" className="tab" role="tab" aria-selected={tab === 'add'} onClick={() => setTab('add')}>Add</button>
      </div>
      <Banner>{error?.message && error.code !== 'not_configured' ? error.message : ''}</Banner>
      {tab === 'library' ? (
        <>
          <div className="toolbar">
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={meta.filter} aria-label={meta.filter} />
            <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }} aria-label="Sort">
              <option value="title">Title</option>
              <option value="added">Recently added</option>
              <option value="year">Year</option>
            </select>
            <div className="segmented">
              <button type="button" className={view === 'posters' ? 'on' : ''} onClick={() => chooseView('posters', setView)}>Posters</button>
              <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => chooseView('list', setView)}>List</button>
            </div>
          </div>
          {!loading && total === 0 && !query ? (
            <div className="empty">
              <p>No {meta.nouns} in {meta.name} yet.</p>
              <button type="button" className="primary" onClick={() => setTab('add')}>Add {meta.noun}</button>
            </div>
          ) : null}
          {!loading && total === 0 && query ? <p className="hint">No matches.</p> : null}
          {view === 'posters' ? (
            loading && items.length === 0 ? <PosterSkeleton /> : (
            <div className="poster-grid">
              {items.map((item) => (
                <Link key={item.id} to={`/${service}/${item.id}`} className="poster-card">
                  <div className="poster-frame"><Poster item={item} service={service} /></div>
                  <h3>{item.title}</h3>
                  <p>{metaLine(service, item)}</p>
                </Link>
              ))}
            </div>
            )
          ) : (
            <div className="table-wrap" aria-busy={loading && items.length === 0 ? 'true' : undefined}>
              {loading && items.length === 0 ? <span className="sr-only">Loading</span> : null}
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Year</th>
                    <th>Status</th>
                    <th>{service === 'sonarr' ? 'Episodes' : 'File'}</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && items.length === 0 ? <SkeletonRows columns={5} rows={8} /> : null}
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="click"
                      tabIndex={0}
                      onClick={() => navigate(`/${service}/${item.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') navigate(`/${service}/${item.id}`)
                      }}
                    >
                      <td>
                        <div className="title-cell">
                          <span className="row-thumb"><Poster item={item} service={service} /></span>
                          <span>{item.title}</span>
                        </div>
                      </td>
                      <td className="mono">{item.year || ''}</td>
                      <td>{item.status}</td>
                      <td className={service === 'radarr' && !item.hasFile ? 'bad' : ''}>{service === 'sonarr' ? `${item.episodeFileCount}/${item.episodeCount}` : (item.hasFile ? 'Downloaded' : 'Missing')}</td>
                      <td className="mono">{formatBytes(item.sizeOnDisk)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      ) : (
        <AddSearch service={service} meta={meta} />
      )}
    </div>
  )
}

function Pager({ page, pageSize, total, onPage }) {
  if (total <= pageSize) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  const pages = Math.ceil(total / pageSize)
  return (
    <div className="pager">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>{start}–{end} of {total}</span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  )
}

function chooseView(next, setView) {
  setView(next)
  try {
    localStorage.setItem('captarr-library-view', next)
  } catch {
    /* Ignore private browsing restrictions. */
  }
}

function metaLine(service, item) {
  if (service === 'sonarr') return `${item.year || '—'} · ${item.episodeFileCount}/${item.episodeCount}`
  return `${item.year || '—'} · ${item.hasFile ? 'Downloaded' : 'Missing'}`
}

function AddSearch({ service, meta }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const [added, setAdded] = useState('')

  useEffect(() => {
    const query = term.trim()
    if (query.length < 2) {
      setResults([])
      setSearching(false)
      return undefined
    }
    let alive = true
    const timer = setTimeout(() => {
      setSearching(true)
      api(`/api/${service}/lookup?term=${encodeURIComponent(query)}`)
        .then((data) => {
          if (!alive) return
          setResults(data.results || [])
          setError('')
        })
        .catch((err) => {
          if (alive) setError(err.message)
        })
        .finally(() => {
          if (alive) setSearching(false)
        })
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [term, service])

  return (
    <div>
      <input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={meta.placeholder}
        aria-label={meta.placeholder}
        autoFocus
      />
      <p className="hint">{meta.hint}</p>
      <Banner>{error}</Banner>
      {added ? <p className="notice">{added}</p> : null}
      {searching ? <p className="hint">Searching…</p> : null}
      {!searching && term.trim().length >= 2 && !results.length && !error ? <p className="hint">No matches.</p> : null}
      <div className="results">
        {results.map((result) => (
          <div key={result.externalId} className="search-hit">
            <div className="hit-poster"><Poster item={result} service={service} /></div>
            <div>
              <strong>{result.title}{result.year ? <span className="dim"> {result.year}</span> : null}</strong>
              <p className="clamp">{result.overview}</p>
            </div>
            {result.alreadyAdded ? (
              <span className="hint">In library</span>
            ) : (
              <button type="button" className="primary" onClick={() => setPending(result)}>Add</button>
            )}
          </div>
        ))}
      </div>
      {pending ? (
        <AddDialog
          service={service}
          meta={meta}
          result={pending}
          onClose={() => setPending(null)}
          onAdded={(title) => {
            setPending(null)
            setAdded(`Added ${title}.`)
            setResults((current) => current.map((item) => (
              item.externalId === pending.externalId ? { ...item, alreadyAdded: true } : item
            )))
          }}
        />
      ) : null}
    </div>
  )
}

function AddDialog({ service, meta, result, onClose, onAdded }) {
  const [options, setOptions] = useState(null)
  const [error, setError] = useState('')
  const [profileId, setProfileId] = useState('')
  const [root, setRoot] = useState('')
  const [monitored, setMonitored] = useState(true)
  const [search, setSearch] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api(`/api/${service}/options`)
      .then((data) => {
        if (!alive) return
        setOptions(data)
        setProfileId(String(data.qualityProfiles[0]?.id ?? ''))
        const folder = data.rootFolders.find((item) => item.accessible) || data.rootFolders[0]
        setRoot(folder?.path || '')
      })
      .catch((err) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [service])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/${service}/${meta.collection}`, {
        method: 'POST',
        json: {
          externalId: result.externalId,
          qualityProfileId: Number(profileId),
          rootFolderPath: root,
          monitored,
          search: monitored && search,
        },
      })
      onAdded(result.title)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const ready = options && profileId && root

  return (
    <Modal title={`Add ${result.title}`} onClose={onClose}>
      <p className="hint">{result.year}{result.overview ? ` · ${result.overview}` : ''}</p>
      <Banner>{error}</Banner>
      {!options && !error ? (
        <div aria-busy="true">
          <span className="sr-only">Loading</span>
          <Bone width="34%" height={14} className="gap" />
          <Bone height={38} className="gap" />
          <Bone width="28%" height={14} className="gap" />
          <Bone height={38} className="gap" />
        </div>
      ) : null}
      {options && !options.rootFolders.length ? <p className="hint">Add a root folder in {meta.name} first.</p> : null}
      {options && !options.qualityProfiles.length ? <p className="hint">Add a quality profile in {meta.name} first.</p> : null}
      {options ? (
        <form onSubmit={submit}>
          <label className="field" htmlFor="profile">Quality profile</label>
          <select id="profile" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            {options.qualityProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
          <label className="field" htmlFor="root">Root folder</label>
          <select id="root" value={root} onChange={(event) => setRoot(event.target.value)}>
            {options.rootFolders.map((folder) => (
              <option key={folder.path} value={folder.path}>
                {folder.path}{folder.freeSpace != null ? ` · ${formatBytes(folder.freeSpace)} free` : ''}{folder.accessible ? '' : ' · unavailable'}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={monitored} onChange={(event) => setMonitored(event.target.checked)} />
            Monitored
          </label>
          <label className="check">
            <input type="checkbox" checked={search} disabled={!monitored} onChange={(event) => setSearch(event.target.checked)} />
            {service === 'sonarr' ? 'Search for missing episodes' : 'Search for this movie'}
          </label>
          <div className="form-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Adding…' : 'Add'}</button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}

function Detail({ service, id }) {
  const meta = copy[service]
  const navigate = useNavigate()
  const { status } = useOutletContext() || {}
  const configured = status?.services?.[service]?.configured
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [searchingSeason, setSearchingSeason] = useState(null)
  const [notice, setNotice] = useState('')
  const [manual, setManual] = useState(false)
  const [episodeId, setEpisodeId] = useState('')
  const [releases, setReleases] = useState([])
  const [releaseMeta, setReleaseMeta] = useState({ total: 0, truncated: false })
  const [searching, setSearching] = useState(false)
  const [grabbing, setGrabbing] = useState('')

  useEffect(() => {
    if (configured === false) return undefined
    let alive = true
    api(`/api/${service}/${meta.collection}/${id}`)
      .then((next) => {
        if (!alive) return
        setData(next)
        setError(null)
      })
      .catch((err) => {
        if (alive) setError(err)
      })
    return () => {
      alive = false
    }
  }, [service, meta.collection, id, configured])

  useEffect(() => {
    if (!manual || configured === false) return undefined
    let alive = true
    setSearching(true)
    const params = new URLSearchParams()
    if (service === 'sonarr' && episodeId) params.set('episodeId', episodeId)
    api(`/api/${service}/${meta.collection}/${id}/releases?${params}`)
      .then((next) => {
        if (!alive) return
        setReleases(next.releases || [])
        setReleaseMeta({ total: next.total || 0, truncated: Boolean(next.truncated) })
        setError(null)
      })
      .catch((err) => {
        if (!alive) return
        setReleases([])
        setError(err)
      })
      .finally(() => {
        if (alive) setSearching(false)
      })
    return () => {
      alive = false
    }
  }, [manual, episodeId, service, meta.collection, id, configured])

  async function automaticSearch() {
    setAutoBusy(true)
    setNotice('')
    try {
      await api(`/api/${service}/${meta.collection}/${id}/search`, { method: 'POST' })
      setError(null)
      setNotice(service === 'sonarr'
        ? 'Automatic search started. Sonarr will look for missing episodes.'
        : 'Automatic search started. Radarr will look for this movie.')
    } catch (err) {
      setError(err)
    } finally {
      setAutoBusy(false)
    }
  }

  async function seasonSearch(seasonNumber) {
    setSearchingSeason(seasonNumber)
    setNotice('')
    try {
      await api(`/api/${service}/${meta.collection}/${id}/search`, { method: 'POST', json: { seasonNumber } })
      setError(null)
      setNotice(seasonNumber === 0
        ? 'Automatic search started for specials.'
        : `Automatic search started for season ${seasonNumber}.`)
    } catch (err) {
      setError(err)
    } finally {
      setSearchingSeason(null)
    }
  }

  async function deleteEpisode(episode) {
    await api(`/api/${service}/${meta.collection}/${id}/episodes/${episode.id}`, { method: 'DELETE' })
    setData((current) => {
      if (!current?.item) return current
      return {
        ...current,
        item: {
          ...current.item,
          episodeFileCount: Math.max(0, (current.item.episodeFileCount || 0) - 1),
        },
        episodes: (current.episodes || []).map((item) => (
          item.id === episode.id ? { ...item, hasFile: false, episodeFileId: null } : item
        )),
      }
    })
    setError(null)
    const code = `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`
    setNotice(`Deleted ${code}.`)
  }

  function openManual(nextEpisodeId = '') {
    setNotice('')
    setEpisodeId(String(nextEpisodeId || ''))
    setManual(true)
  }

  function openManualDefault() {
    const episodes = data?.episodes || []
    const missing = episodes.find((episode) => !episode.hasFile)
    openManual(missing ? missing.id : '')
  }

  async function grab(release) {
    setGrabbing(release.guid)
    setNotice('')
    try {
      await api(`/api/${service}/${meta.collection}/${id}/releases`, {
        method: 'POST',
        json: { guid: release.guid, indexerId: release.indexerId },
      })
      setError(null)
      setNotice(`Grabbed ${release.title}.`)
    } catch (err) {
      setError(err)
    } finally {
      setGrabbing('')
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api(`/api/${service}/${meta.collection}/${id}?deleteFiles=${deleteFiles ? 'true' : 'false'}`, { method: 'DELETE' })
      navigate(`/${service}`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  if (configured === false || error?.code === 'not_configured') {
    return <NotConnected name={meta.name} hash={meta.hash} />
  }

  const item = data?.item
  return (
    <div className="page">
      <Link to={`/${service}`} className="back">Back to library</Link>
      <Banner>{error?.message}</Banner>
      {notice ? <p className="notice">{notice}</p> : null}
      {!item && !error ? <DetailSkeleton /> : null}
      {item ? (
        <>
          <div className="detail-top">
            <div className="detail-poster"><Poster item={item} service={service} /></div>
            <div>
              <PageHead title={item.title} lede={[item.year, item.status, item.monitored ? 'Monitored' : 'Unmonitored', item.qualityProfileName].filter(Boolean).join(' · ')} />
              {item.overview ? <p className="overview">{item.overview}</p> : null}
              <dl className="facts">
                {service === 'sonarr' ? <Fact label="Network" value={item.network} /> : <Fact label="Studio" value={item.studio} />}
                {item.genres?.length ? <Fact label="Genres" value={item.genres.slice(0, 4).join(', ')} /> : null}
                {service === 'sonarr' ? (
                  <Fact label="Episodes" value={`${item.episodeFileCount} of ${item.episodeCount}`} />
                ) : (
                  <Fact label="Runtime" value={formatRuntime(item.runtime)} />
                )}
                <Fact label="Size" value={formatBytes(item.sizeOnDisk)} />
                <Fact label="Path" value={item.path} path />
              </dl>
              <div className="page-actions">
                <button type="button" onClick={automaticSearch} disabled={autoBusy}>
                  {autoBusy ? 'Starting…' : 'Automatic search'}
                </button>
                <button type="button" onClick={openManualDefault}>Manual search</button>
                <button type="button" className="danger" onClick={() => setConfirming(true)}>Remove from library</button>
              </div>
            </div>
          </div>
          {manual ? (
            <ManualSearch
              service={service}
              episodes={data.episodes || []}
              episodeId={episodeId}
              onEpisode={setEpisodeId}
              releases={releases}
              total={releaseMeta.total}
              truncated={releaseMeta.truncated}
              searching={searching}
              grabbing={grabbing}
              onGrab={grab}
            />
          ) : null}
          {service === 'sonarr' ? (
            <Seasons
              episodes={data.episodes || []}
              searchingSeason={searchingSeason}
              onSearch={(episode) => openManual(episode.id)}
              onSeasonSearch={seasonSearch}
              onDelete={deleteEpisode}
            />
          ) : <MovieFile file={item.file} />}
        </>
      ) : null}
      {confirming && item ? (
        <Modal title={`Remove ${item.title}`} onClose={() => setConfirming(false)}>
          <p>This removes the {meta.noun} from {meta.name}. Files stay on disk unless you delete them too.</p>
          <label className="check">
            <input type="checkbox" checked={deleteFiles} onChange={(event) => setDeleteFiles(event.target.checked)} />
            Delete video files from disk
          </label>
          {deleteFiles ? <p className="warn">This permanently deletes the files in the {meta.noun} folder.</p> : null}
          <div className="form-actions">
            <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="danger fill" disabled={busy} onClick={remove}>
              {busy ? 'Removing…' : deleteFiles ? 'Remove and delete files' : 'Remove'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function PosterSkeleton() {
  return (
    <div className="poster-grid" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="poster-card" aria-hidden="true">
          <div className="poster-frame"><Bone className="fill" /></div>
          <Bone width="78%" height={14} />
          <Bone width="42%" height={10} />
        </div>
      ))}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="detail-top" aria-busy="true">
      <span className="sr-only">Loading</span>
      <div className="detail-poster"><Bone className="fill" /></div>
      <div>
        <Bone width="240px" height={26} />
        <Bone width="180px" height={14} className="gap" />
        <Bone width="100%" height={14} className="gap" />
        <Bone width="92%" height={14} className="gap" />
        <Bone width="70%" height={14} className="gap" />
      </div>
    </div>
  )
}

function episodeLabel(episode) {
  const season = String(episode.seasonNumber).padStart(2, '0')
  const number = String(episode.episodeNumber).padStart(2, '0')
  return `S${season}E${number} · ${episode.title}${episode.hasFile ? '' : ' · missing'}`
}

function ManualSearch({ service, episodes, episodeId, onEpisode, releases, total, truncated, searching, grabbing, onGrab }) {
  return (
    <section className="manual-search">
      <h2>Manual search</h2>
      {service === 'sonarr' ? (
        <>
          <label className="field" htmlFor="episode">Episode</label>
          <select id="episode" value={episodeId} onChange={(event) => onEpisode(event.target.value)}>
            <option value="">Entire series</option>
            {episodes.map((episode) => (
              <option key={episode.id} value={episode.id}>{episodeLabel(episode)}</option>
            ))}
          </select>
        </>
      ) : (
        <p className="hint">Releases from your indexers.</p>
      )}
      {searching ? (
        <div aria-busy="true">
          <span className="sr-only">Loading</span>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="release" aria-hidden="true">
              <div>
                <Bone width="72%" height={14} />
                <Bone width="42%" height={12} className="gap" />
              </div>
              <Bone width="52px" height={28} />
            </div>
          ))}
        </div>
      ) : null}
      {!searching && releases.length === 0 ? <p className="hint">No releases found.</p> : null}
      {truncated ? <p className="hint">Showing 50 of {total}.</p> : null}
      {releases.map((release) => (
        <div key={`${release.indexerId}-${release.guid}`} className="release">
          <div>
            <strong>{release.title}</strong>
            <p>
              {[
                release.indexer,
                release.quality,
                formatBytes(release.size),
                release.age,
                release.protocol === 'torrent' && release.seeders != null ? `${release.seeders} seeders` : '',
              ].filter(Boolean).join(' · ')}
            </p>
            {release.rejections?.length ? <p className="bad">{release.rejections.join(' ')}</p> : null}
          </div>
          <button type="button" className="small" disabled={!release.approved || grabbing === release.guid} onClick={() => onGrab(release)}>
            {grabbing === release.guid ? 'Grabbing…' : 'Grab'}
          </button>
        </div>
      ))}
    </section>
  )
}

function Fact({ label, value, path }) {
  if (!value) return null
  return (
    <div>
      <dt>{label}</dt>
      <dd className={path ? 'path' : ''}>{value}</dd>
    </div>
  )
}

function Seasons({ episodes, onSearch, onSeasonSearch, onDelete, searchingSeason }) {
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!episodes.length) return <p className="hint">No episodes returned.</p>
  const groups = new Map()
  for (const episode of episodes) {
    if (!groups.has(episode.seasonNumber)) groups.set(episode.seasonNumber, [])
    groups.get(episode.seasonNumber).push(episode)
  }
  const seasons = [...groups.keys()].sort((a, b) => {
    if (a === 0) return 1
    if (b === 0) return -1
    return a - b
  })

  async function confirmDelete() {
    if (!pending) return
    setBusy(true)
    setError('')
    try {
      await onDelete(pending)
      setPending(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {seasons.map((season) => (
        <section key={season}>
          <div className="season-head">
            <h2>{season === 0 ? 'Specials' : `Season ${season}`}</h2>
            <button
              type="button"
              className="small"
              disabled={searchingSeason === season}
              onClick={() => onSeasonSearch(season)}
            >
              {searchingSeason === season ? 'Starting…' : (season === 0 ? 'Search specials' : 'Search season')}
            </button>
          </div>
          <ul className="episodes">
            {groups.get(season).map((episode) => (
              <li key={episode.id} className={episode.hasFile ? '' : 'missing'}>
                <span className="ep-no">{episode.episodeNumber}</span>
                <span>{episode.title}</span>
                <span className="ep-side">
                  <span className={episode.hasFile ? '' : 'bad'}>{episode.hasFile ? 'Downloaded' : 'Missing'}</span>
                  <button type="button" className="small" onClick={() => onSearch(episode)}>Search</button>
                  {episode.hasFile && episode.episodeFileId ? (
                    <button type="button" className="small danger" onClick={() => { setError(''); setPending(episode) }}>Delete</button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {pending ? (
        <Modal title={`Delete S${String(pending.seasonNumber).padStart(2, '0')}E${String(pending.episodeNumber).padStart(2, '0')}`} onClose={() => { if (!busy) setPending(null) }}>
          <p>This deletes the video file for {pending.title}. The episode stays in the series.</p>
          <Banner>{error}</Banner>
          <div className="form-actions">
            <button type="button" onClick={() => setPending(null)}>Cancel</button>
            <button type="button" className="danger fill" disabled={busy} onClick={confirmDelete}>
              {busy ? 'Deleting…' : 'Delete file'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function MovieFile({ file }) {
  return (
    <section>
      <h2>File</h2>
      {file ? (
        <dl className="facts">
          <Fact label="Quality" value={[file.quality, file.resolution].filter(Boolean).join(' · ')} />
          <Fact label="Video" value={file.videoCodec} />
          <Fact label="Audio" value={file.audioCodec} />
          <Fact label="Size" value={formatBytes(file.size)} />
          <Fact label="Path" value={file.relativePath} path />
        </dl>
      ) : (
        <p className="hint">No file yet.</p>
      )}
    </section>
  )
}
