import { assertPassword, assertUsername, createAuth, hashPassword, verifyPassword } from './auth.js'
import { HttpError } from './errors.js'
import {
  movieCounts,
  pickRecent,
  presentArrHistory,
  presentEpisode,
  presentLookup,
  presentMovie,
  presentRelease,
  presentSabHistory,
  presentSabQueue,
  presentSeries,
  queueTotal,
  seriesCounts,
} from './present.js'
import { CONNECTION_IDS, SERVICE_IDS, SERVICE_LABELS, isConfigured, publicConnection } from './store.js'
import { arrRequest, fetchMedia, normalizeApiKey, normalizeBaseUrl, plexItemUrl, probe, sabRequest, safeMediaPath } from './upstream.js'

function wrap(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      if (res.headersSent) return next(err)
      const status = Number(err.status) || 500
      if (status >= 500 && !(err.code === 'upstream')) console.error(err)
      res.status(status).json({
        error: status >= 500 && err.code !== 'upstream' ? 'Something went wrong.' : err.message,
        code: err.code,
      })
    })
  }
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'local'
}

function createLimiter() {
  const attempts = new Map()
  return {
    check(ip) {
      const row = attempts.get(ip)
      if (row && row.until > Date.now()) {
        throw new HttpError(429, 'Too many attempts. Wait a minute.')
      }
    },
    fail(ip) {
      const row = attempts.get(ip) || { fails: 0, until: 0 }
      row.fails += 1
      if (row.fails >= 5) {
        row.until = Date.now() + 60_000
        row.fails = 0
      }
      attempts.set(ip, row)
    },
    ok(ip) {
      attempts.delete(ip)
    },
  }
}

function requireId(value) {
  if (!/^\d+$/.test(String(value || ''))) throw new HttpError(400, 'Invalid id.')
  return String(value)
}

function requireNzo(value) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(value || ''))) throw new HttpError(400, 'Invalid queue id.')
  return String(value)
}

function plexLink(store, item) {
  const baseUrl = store.read().connections.plex?.baseUrl
  if (!baseUrl) return null
  return plexItemUrl(baseUrl, item) || null
}

function requireService(value) {
  if (!CONNECTION_IDS.includes(value)) throw new HttpError(400, 'Unknown service.')
  return value
}

const LIBRARY_TTL_MS = 20_000
const libraryCache = new Map()
const releaseCache = new Map()

function libraryCacheKey(service, connection) {
  return `${service}\n${connection.baseUrl}\n${connection.apiKey}`
}

function dropLibraryCache(service) {
  for (const key of libraryCache.keys()) {
    if (key.startsWith(`${service}\n`)) libraryCache.delete(key)
  }
}

async function cachedLibrary(connection, service, listPath, present) {
  const key = libraryCacheKey(service, connection)
  const hit = libraryCache.get(key)
  if (hit && Date.now() - hit.at < LIBRARY_TTL_MS) return hit.items
  const raw = await arrRequest(connection, listPath, { timeout: 60_000, maxBytes: 80 * 1024 * 1024 })
  const items = (Array.isArray(raw) ? raw : []).map((entry) => present(entry))
  libraryCache.set(key, { at: Date.now(), items })
  return items
}

function sortTitle(title) {
  return String(title || '').toLocaleLowerCase().replace(/^(the|a|an)\s+/, '')
}

function sortLibrary(items, sort) {
  const copy = items.slice()
  copy.sort((a, b) => {
    if (sort === 'year') {
      const year = (b.year || 0) - (a.year || 0)
      if (year) return year
    } else if (sort === 'added') {
      const added = new Date(b.added || 0) - new Date(a.added || 0)
      if (added) return added
    }
    return sortTitle(a.title).localeCompare(sortTitle(b.title)) || String(a.title).localeCompare(String(b.title))
  })
  return copy
}

function clampInt(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function listItem(item) {
  return {
    id: item.id,
    title: item.title,
    year: item.year,
    status: item.status,
    monitored: item.monitored,
    posterPath: item.posterPath,
    remotePoster: item.remotePoster,
    episodeFileCount: item.episodeFileCount,
    episodeCount: item.episodeCount,
    hasFile: item.hasFile,
    sizeOnDisk: item.sizeOnDisk,
    added: item.added,
  }
}

function pageLibrary(items, query) {
  const pageSize = clampInt(query.pageSize, 48, 1, 100)
  const sort = query.sort === 'year' || query.sort === 'added' ? query.sort : 'title'
  const q = String(query.q || '').trim().slice(0, 120).toLowerCase()
  const filtered = q
    ? items.filter((item) => String(item.title || '').toLowerCase().includes(q))
    : items
  const sorted = sortLibrary(filtered, sort)
  const total = sorted.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(clampInt(query.page, 1, 1, 100000), pages)
  const start = (page - 1) * pageSize
  return {
    items: sorted.slice(start, start + pageSize).map(listItem),
    total,
    page,
    pageSize,
  }
}

function releaseKey(service, indexerId, guid) {
  return `${service}:${indexerId ?? ''}:${guid}`
}

function rememberReleases(service, releases) {
  const now = Date.now()
  for (const release of releases) {
    if (!release?.guid) continue
    releaseCache.set(releaseKey(service, release.indexerId, release.guid), { at: now, release })
  }
  if (releaseCache.size <= 400) return
  const oldest = [...releaseCache.entries()].sort((a, b) => a[1].at - b[1].at)
  for (const [key] of oldest.slice(0, releaseCache.size - 300)) releaseCache.delete(key)
}

function takeRelease(service, indexerId, guid) {
  const key = releaseKey(service, indexerId, guid)
  const hit = releaseCache.get(key)
  if (!hit || Date.now() - hit.at > 10 * 60 * 1000) {
    releaseCache.delete(key)
    return null
  }
  return hit.release
}

function connectionOf(store, service) {
  const connection = store.read().connections[service]
  if (!isConfigured(connection)) {
    throw new HttpError(400, `${SERVICE_LABELS[service]} isn't connected.`, 'not_configured')
  }
  return connection
}

async function resolveApiKey(store, service, baseUrl, provided, allowStoredKey) {
  let apiKey = String(provided || '').trim()
  if (!apiKey && allowStoredKey) {
    const saved = store.read().connections[service]
    if (saved?.apiKey) apiKey = saved.apiKey
  }
  return normalizeApiKey(apiKey)
}

async function testConnection(store, body, allowStoredKey) {
  const service = requireService(body?.service)
  if (service === 'plex') throw new HttpError(400, 'Plex only needs an address. There is nothing to test.')
  let baseUrl
  try {
    baseUrl = normalizeBaseUrl(body?.baseUrl)
  } catch (err) {
    throw new HttpError(err.status || 400, `${SERVICE_LABELS[service]}: ${err.message}`)
  }
  const apiKey = await resolveApiKey(store, service, baseUrl, body?.apiKey, allowStoredKey)
  const version = await probe(service, { baseUrl, apiKey })
  return { ok: true, service, version }
}

function readSetupConnection(input, service) {
  const label = SERVICE_LABELS[service]
  if (input == null) return { baseUrl: '', apiKey: '' }
  const rawUrl = String(input.baseUrl || '').trim()
  const rawKey = String(input.apiKey || '').trim()
  if (service === 'plex') {
    if (!rawUrl) return { baseUrl: '', apiKey: '' }
    return { baseUrl: parseBaseUrl(rawUrl, label), apiKey: '' }
  }
  if (!rawUrl && !rawKey) return { baseUrl: '', apiKey: '' }
  if (!rawUrl || !rawKey) throw new HttpError(400, `${label} needs both a host and an API key.`)
  return { baseUrl: parseBaseUrl(rawUrl, label), apiKey: normalizeApiKey(rawKey) }
}

function parseBaseUrl(rawUrl, label) {
  try {
    return normalizeBaseUrl(rawUrl)
  } catch (err) {
    throw new HttpError(err.status || 400, `${label}: ${err.message}`)
  }
}

function saveConnection(store, service, body) {
  const label = SERVICE_LABELS[service]
  const rawUrl = String(body?.baseUrl || '').trim()
  const rawKey = String(body?.apiKey || '').trim()
  if (service === 'plex') {
    const next = rawUrl ? { baseUrl: parseBaseUrl(rawUrl, label), apiKey: '' } : { baseUrl: '', apiKey: '' }
    store.update((data) => { data.connections.plex = next })
    return publicConnection(next)
  }
  if (!rawUrl && !rawKey) {
    const cleared = { baseUrl: '', apiKey: '' }
    store.update((data) => { data.connections[service] = cleared })
    return publicConnection(cleared)
  }
  if (!rawUrl) throw new HttpError(400, `${label} needs a host.`)
  let baseUrl
  try {
    baseUrl = normalizeBaseUrl(rawUrl)
  } catch (err) {
    throw new HttpError(err.status || 400, `${label}: ${err.message}`)
  }
  const saved = store.read().connections[service]
  const apiKey = rawKey ? normalizeApiKey(rawKey) : saved?.apiKey
  if (!apiKey) throw new HttpError(400, `${label} needs an API key.`)
  const next = { baseUrl, apiKey }
  store.update((data) => { data.connections[service] = next })
  return publicConnection(next)
}

async function profileName(connection, profileId) {
  try {
    const profiles = await arrRequest(connection, '/api/v3/qualityprofile')
    return (Array.isArray(profiles) ? profiles : []).find((profile) => profile.id === profileId)?.name || ''
  } catch {
    return ''
  }
}

async function existingExternalIds(connection, service) {
  const ids = new Set()
  try {
    const listPath = service === 'sonarr' ? '/api/v3/series' : '/api/v3/movie'
    const present = service === 'sonarr' ? presentSeries : presentMovie
    const items = await cachedLibrary(connection, service, listPath, present)
    const field = service === 'sonarr' ? 'tvdbId' : 'tmdbId'
    for (const item of items) ids.add(item[field])
  } catch {
    return ids
  }
  return ids
}

function notFound(err, noun, label) {
  if (err?.upstreamStatus === 404) {
    throw new HttpError(404, `That ${noun} is no longer in ${label}.`)
  }
  throw err
}

export function mountRoutes(app, { store, version }) {
  const auth = createAuth(store)
  const limiter = createLimiter()

  app.get('/api/health', (req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/setup/status', (req, res) => {
    res.json({ needsSetup: !store.read().user, version })
  })

  app.post('/api/setup/test', wrap(async (req, res) => {
    if (store.read().user) throw new HttpError(403, 'Setup is already finished.')
    res.json(await testConnection(store, req.body, false))
  }))

  app.post('/api/setup', wrap(async (req, res) => {
    if (store.read().user) throw new HttpError(409, 'Setup is already finished.')
    assertUsername(req.body?.username)
    assertPassword(req.body?.password)
    const connections = {
      sabnzbd: readSetupConnection(req.body?.connections?.sabnzbd, 'sabnzbd'),
      sonarr: readSetupConnection(req.body?.connections?.sonarr, 'sonarr'),
      radarr: readSetupConnection(req.body?.connections?.radarr, 'radarr'),
      plex: readSetupConnection(req.body?.connections?.plex, 'plex'),
    }
    const passwordHash = await hashPassword(req.body.password)
    const user = { username: req.body.username, passwordHash, tokenVersion: 1 }
    store.update((data) => {
      if (data.user) throw new HttpError(409, 'Setup is already finished.')
      data.user = user
      data.connections = connections
    })
    auth.establish(res, user)
    res.json({ username: user.username, version })
  }))

  app.get('/api/auth/me', wrap(async (req, res) => {
    const session = auth.sessionUser(req)
    res.json({ username: session?.username || null, version })
  }))

  app.post('/api/auth/login', wrap(async (req, res) => {
    const ip = clientIp(req)
    limiter.check(ip)
    try {
      const user = await auth.authenticate(req.body?.username, req.body?.password)
      limiter.ok(ip)
      auth.establish(res, user)
      res.json({ username: user.username, version })
    } catch (err) {
      if (err.status === 401) limiter.fail(ip)
      throw err
    }
  }))

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) return next()
    if (req.path === '/api/health' || req.path === '/api/setup/status' || req.path === '/api/auth/login' || req.path === '/api/auth/me') return next()
    if ((req.path === '/api/setup' || req.path === '/api/setup/test') && !store.read().user) return next()
    const session = auth.sessionUser(req)
    if (!session) {
      res.status(401).json({ error: 'Sign in required.' })
      return
    }
    req.user = session
    next()
  })

  app.post('/api/auth/logout', wrap(async (req, res) => {
    auth.clear(res)
    res.json({ ok: true })
  }))

  app.get('/api/settings', wrap(async (req, res) => {
    const data = store.read()
    res.json({
      username: data.user.username,
      version,
      connections: {
        sabnzbd: publicConnection(data.connections.sabnzbd),
        sonarr: publicConnection(data.connections.sonarr),
        radarr: publicConnection(data.connections.radarr),
        plex: publicConnection(data.connections.plex),
      },
    })
  }))

  app.post('/api/settings/test', wrap(async (req, res) => {
    res.json(await testConnection(store, req.body, true))
  }))

  app.put('/api/settings/connections/:service', wrap(async (req, res) => {
    const service = requireService(req.params.service)
    res.json(saveConnection(store, service, req.body))
  }))

  app.delete('/api/settings/connections/:service', wrap(async (req, res) => {
    const service = requireService(req.params.service)
    store.update((data) => { data.connections[service] = { baseUrl: '', apiKey: '' } })
    res.json(publicConnection({}))
  }))

  app.post('/api/settings/password', wrap(async (req, res) => {
    assertPassword(req.body?.newPassword)
    const current = store.read().user
    const matches = await verifyPassword(req.body?.currentPassword, current.passwordHash)
    if (!matches) throw new HttpError(400, 'Current password is wrong.')
    const passwordHash = await hashPassword(req.body.newPassword)
    let updated
    store.update((data) => {
      data.user.passwordHash = passwordHash
      data.user.tokenVersion += 1
      updated = data.user
    })
    auth.establish(res, updated)
    res.json({ ok: true })
  }))

  app.get('/api/status', wrap(async (req, res) => {
    const connections = store.read().connections
    const services = {}
    await Promise.all(SERVICE_IDS.map(async (service) => {
      if (!isConfigured(connections[service])) {
        services[service] = { configured: false, ok: false, error: null, version: null }
        return
      }
      try {
        const reported = await probe(service, connections[service])
        services[service] = { configured: true, ok: true, error: null, version: reported }
      } catch (err) {
        services[service] = { configured: true, ok: false, error: err.message, version: null }
      }
    }))
    res.json({ version, services })
  }))

  app.get('/api/dashboard', wrap(async (req, res) => {
    const connections = store.read().connections
    const [sab, sonarr, radarr] = await Promise.all([
      loadSab(connections.sabnzbd),
      loadSonarr(connections.sonarr),
      loadRadarr(connections.radarr),
    ])
    const recent = pickRecent([...(sonarr.recent || []), ...(radarr.recent || [])])
    res.json({
      sab: stripRecent(sab),
      sonarr: stripRecent(sonarr),
      radarr: stripRecent(radarr),
      recent,
    })
  }))

  app.get('/api/sab/queue', wrap(async (req, res) => {
    res.json(await currentQueue(connectionOf(store, 'sabnzbd')))
  }))

  app.get('/api/sab/history', wrap(async (req, res) => {
    const start = Number(req.query.start ?? 0)
    const limit = Number(req.query.limit ?? 40)
    if (!Number.isInteger(start) || start < 0) throw new HttpError(400, 'Invalid history offset.')
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, 'Invalid history limit.')
    const body = await sabRequest(connectionOf(store, 'sabnzbd'), { mode: 'history', start, limit })
    res.json(presentSabHistory(body))
  }))

  app.post('/api/sab/pause', wrap(async (req, res) => {
    const connection = connectionOf(store, 'sabnzbd')
    await sabRequest(connection, { mode: 'pause' })
    res.json(await currentQueue(connection))
  }))

  app.post('/api/sab/resume', wrap(async (req, res) => {
    const connection = connectionOf(store, 'sabnzbd')
    await sabRequest(connection, { mode: 'resume' })
    res.json(await currentQueue(connection))
  }))

  app.post('/api/sab/queue/:id/pause', wrap(async (req, res) => {
    const connection = connectionOf(store, 'sabnzbd')
    await sabRequest(connection, { mode: 'queue', name: 'pause', value: requireNzo(req.params.id) })
    res.json(await currentQueue(connection))
  }))

  app.post('/api/sab/queue/:id/resume', wrap(async (req, res) => {
    const connection = connectionOf(store, 'sabnzbd')
    await sabRequest(connection, { mode: 'queue', name: 'resume', value: requireNzo(req.params.id) })
    res.json(await currentQueue(connection))
  }))

  app.delete('/api/sab/queue/:id', wrap(async (req, res) => {
    const connection = connectionOf(store, 'sabnzbd')
    const params = { mode: 'queue', name: 'delete', value: requireNzo(req.params.id) }
    if (req.query.deleteFiles === 'true') params.del_files = 1
    await sabRequest(connection, params)
    res.json(await currentQueue(connection))
  }))

  registerLibrary(app, store, 'sonarr')
  registerLibrary(app, store, 'radarr')

  app.get('/api/images/:service', wrap(async (req, res) => {
    const service = req.params.service
    if (service !== 'sonarr' && service !== 'radarr') throw new HttpError(404, 'Not found.')
    const mediaPath = safeMediaPath(req.query.path)
    const file = await fetchMedia(connectionOf(store, service), mediaPath)
    res.setHeader('Content-Type', file.type)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.send(file.body)
  }))
}

function registerLibrary(app, store, service) {
  const label = SERVICE_LABELS[service]
  const noun = service === 'sonarr' ? 'series' : 'movie'
  const collection = service === 'sonarr' ? 'series' : 'movies'
  const listPath = service === 'sonarr' ? '/api/v3/series' : '/api/v3/movie'
  const present = service === 'sonarr' ? presentSeries : presentMovie

  app.get(`/api/${service}/${collection}`, wrap(async (req, res) => {
    const items = await cachedLibrary(connectionOf(store, service), service, listPath, present)
    res.json(pageLibrary(items, req.query))
  }))

  app.post(`/api/${service}/${collection}/:id/search`, wrap(async (req, res) => {
    const id = Number(requireId(req.params.id))
    let body
    if (service === 'sonarr' && req.body?.seasonNumber != null && req.body.seasonNumber !== '') {
      const seasonNumber = Number(req.body.seasonNumber)
      if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 200) {
        throw new HttpError(400, 'Invalid season.')
      }
      body = { name: 'SeasonSearch', seriesId: id, seasonNumber }
    } else if (service === 'sonarr') {
      body = { name: 'SeriesSearch', seriesId: id }
    } else {
      body = { name: 'MoviesSearch', movieIds: [id] }
    }
    await arrRequest(connectionOf(store, service), '/api/v3/command', { method: 'POST', body })
    res.json({ ok: true })
  }))

  if (service === 'sonarr') {
    app.delete(`/api/sonarr/series/:id/episodes/:episodeId`, wrap(async (req, res) => {
      const seriesId = requireId(req.params.id)
      const episodeId = requireId(req.params.episodeId)
      const connection = connectionOf(store, service)
      let episode
      try {
        episode = await arrRequest(connection, `/api/v3/episode/${episodeId}`)
      } catch (err) {
        notFound(err, 'episode', label)
      }
      if (String(episode?.seriesId) !== seriesId) throw new HttpError(404, 'That episode is not in this series.')
      const fileId = Number(episode?.episodeFileId)
      if (!episode?.hasFile || !Number.isInteger(fileId) || fileId <= 0) {
        throw new HttpError(400, 'That episode has no file to delete.')
      }
      try {
        await arrRequest(connection, `/api/v3/episodefile/${fileId}`, { method: 'DELETE' })
      } catch (err) {
        if (err?.upstreamStatus === 404) throw new HttpError(404, 'That episode file is already gone.')
        throw err
      }
      dropLibraryCache(service)
      res.json({ ok: true })
    }))
  }

  app.get(`/api/${service}/${collection}/:id/releases`, wrap(async (req, res) => {
    const id = Number(requireId(req.params.id))
    const query = service === 'sonarr' ? { seriesId: id } : { movieId: id }
    if (service === 'sonarr' && req.query.episodeId) query.episodeId = Number(requireId(req.query.episodeId))
    const raw = await arrRequest(connectionOf(store, service), '/api/v3/release', { query, timeout: 60_000 })
    const releases = (Array.isArray(raw) ? raw : []).filter((release) => release?.guid)
    rememberReleases(service, releases)
    const presented = releases
      .map(presentRelease)
      .sort((a, b) => Number(b.approved) - Number(a.approved))
    res.json({
      releases: presented.slice(0, 50),
      total: presented.length,
      truncated: presented.length > 50,
    })
  }))

  app.post(`/api/${service}/${collection}/:id/releases`, wrap(async (req, res) => {
    requireId(req.params.id)
    const guid = String(req.body?.guid || '').slice(0, 400)
    if (!guid) throw new HttpError(400, 'Choose a release.')
    const release = takeRelease(service, req.body?.indexerId ?? null, guid)
    if (!release) throw new HttpError(400, 'That search expired. Search again.')
    await arrRequest(connectionOf(store, service), '/api/v3/release', { method: 'POST', body: release })
    res.json({ ok: true })
  }))

  app.get(`/api/${service}/${collection}/:id`, wrap(async (req, res) => {
    const id = requireId(req.params.id)
    const connection = connectionOf(store, service)
    let raw
    try {
      raw = await arrRequest(connection, `${listPath}/${id}`)
    } catch (err) {
      notFound(err, noun, label)
    }
    const item = { ...present(raw), qualityProfileName: await profileName(connection, raw.qualityProfileId) }
    let episodes = null
    if (service === 'sonarr') {
      const episodeBody = await arrRequest(connection, '/api/v3/episode', { query: { seriesId: id } })
      episodes = (Array.isArray(episodeBody) ? episodeBody : [])
        .map(presentEpisode)
        .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)
    }
    res.json({ item, episodes, plexUrl: plexLink(store, item) })
  }))

  app.get(`/api/${service}/lookup`, wrap(async (req, res) => {
    const term = String(req.query.term || '').trim()
    if (term.length < 2) throw new HttpError(400, 'Enter at least 2 characters.')
    if (term.length > 120) throw new HttpError(400, 'Search is too long.')
    const connection = connectionOf(store, service)
    const lookupPath = service === 'sonarr' ? '/api/v3/series/lookup' : '/api/v3/movie/lookup'
    const raw = await arrRequest(connection, lookupPath, { query: { term } })
    const existing = await existingExternalIds(connection, service)
    const results = (Array.isArray(raw) ? raw : [])
      .slice(0, 20)
      .map((item) => presentLookup(service, item, existing))
      .filter((item) => item.externalId)
    res.json({ results })
  }))

  app.get(`/api/${service}/options`, wrap(async (req, res) => {
    const connection = connectionOf(store, service)
    const [profiles, folders] = await Promise.all([
      arrRequest(connection, '/api/v3/qualityprofile'),
      arrRequest(connection, '/api/v3/rootfolder'),
    ])
    res.json({
      qualityProfiles: (Array.isArray(profiles) ? profiles : []).map((profile) => ({
        id: profile.id,
        name: profile.name,
      })),
      rootFolders: (Array.isArray(folders) ? folders : []).map((folder) => ({
        path: folder.path,
        freeSpace: folder.freeSpace ?? null,
        accessible: folder.accessible !== false,
      })),
    })
  }))

  app.post(`/api/${service}/${collection}`, wrap(async (req, res) => {
    const connection = connectionOf(store, service)
    const qualityProfileId = Number(req.body?.qualityProfileId)
    const rootFolderPath = String(req.body?.rootFolderPath || '')
    const monitored = Boolean(req.body?.monitored)
    const search = Boolean(req.body?.search)
    if (!Number.isInteger(qualityProfileId)) throw new HttpError(400, 'Choose a quality profile.')
    if (!rootFolderPath) throw new HttpError(400, 'Choose a root folder.')

    const [profiles, folders] = await Promise.all([
      arrRequest(connection, '/api/v3/qualityprofile'),
      arrRequest(connection, '/api/v3/rootfolder'),
    ])
    if (!(Array.isArray(profiles) ? profiles : []).some((profile) => profile.id === qualityProfileId)) {
      throw new HttpError(400, 'That quality profile is no longer available.')
    }
    if (!(Array.isArray(folders) ? folders : []).some((folder) => folder.path === rootFolderPath)) {
      throw new HttpError(400, 'That root folder is no longer available.')
    }

    const externalId = Number(req.body?.externalId)
    if (!Number.isInteger(externalId)) throw new HttpError(400, `Choose a ${noun} from the search results.`)
    const lookupPath = service === 'sonarr' ? '/api/v3/series/lookup' : '/api/v3/movie/lookup'
    const term = service === 'sonarr' ? `tvdb:${externalId}` : `tmdb:${externalId}`
    const found = await arrRequest(connection, lookupPath, { query: { term } })
    const match = (Array.isArray(found) ? found : []).find((item) => {
      return service === 'sonarr' ? item.tvdbId === externalId : item.tmdbId === externalId
    })
    if (!match) throw new HttpError(404, `${label} did not return that ${noun}.`)

    const payload = { ...match }
    delete payload.id
    Object.assign(payload, {
      qualityProfileId,
      rootFolderPath,
      monitored,
      addOptions: {
        ...(match.addOptions || {}),
        ...(service === 'sonarr'
          ? { searchForMissingEpisodes: monitored && search, monitor: monitored ? 'all' : 'none' }
          : { searchForMovie: monitored && search }),
      },
    })
    if (service === 'sonarr') {
      payload.seasonFolder = true
      if (!payload.seriesType) payload.seriesType = 'standard'
      if (Array.isArray(payload.seasons)) {
        payload.seasons = payload.seasons.map((season) => ({ ...season, monitored }))
      }
    } else if (!payload.minimumAvailability) {
      payload.minimumAvailability = 'released'
    }

    let created
    try {
      created = await arrRequest(connection, listPath, { method: 'POST', body: payload })
    } catch (err) {
      if (service === 'sonarr' && /language profile/i.test(err.message || '')) {
        const languages = await arrRequest(connection, '/api/v3/languageprofile')
        const languageProfileId = Array.isArray(languages) ? languages[0]?.id : null
        if (!languageProfileId) throw err
        created = await arrRequest(connection, listPath, {
          method: 'POST',
          body: { ...payload, languageProfileId },
        })
      } else {
        throw err
      }
    }
    dropLibraryCache(service)
    res.status(201).json({ item: present(created) })
  }))

  app.delete(`/api/${service}/${collection}/:id`, wrap(async (req, res) => {
    const id = requireId(req.params.id)
    const deleteFiles = req.query.deleteFiles === 'true'
    const query = service === 'sonarr'
      ? { deleteFiles, addImportListExclusion: false }
      : { deleteFiles, addImportExclusion: false }
    try {
      await arrRequest(connectionOf(store, service), `${listPath}/${id}`, { method: 'DELETE', query })
    } catch (err) {
      notFound(err, noun, label)
    }
    dropLibraryCache(service)
    res.json({ ok: true })
  }))
}

function stripRecent(block) {
  const { recent, ...rest } = block
  return rest
}

async function currentQueue(connection) {
  return presentSabQueue(await sabRequest(connection, { mode: 'queue' }))
}

async function loadSab(connection) {
  if (!isConfigured(connection)) return { configured: false, ok: false, error: null }
  try {
    const [queueBody, historyBody] = await Promise.all([
      sabRequest(connection, { mode: 'queue' }),
      sabRequest(connection, { mode: 'history', start: 0, limit: 1 }),
    ])
    const queue = presentSabQueue(queueBody)
    const history = presentSabHistory(historyBody)
    return {
      configured: true,
      ok: true,
      error: null,
      paused: queue.paused,
      status: queue.status,
      speed: queue.speed,
      timeleft: queue.timeleft,
      size: queue.size,
      sizeleft: queue.sizeleft,
      queueCount: queue.count,
      diskFree: queue.diskFree,
      diskTotal: queue.diskTotal,
      day: history.day,
      week: history.week,
      month: history.month,
    }
  } catch (err) {
    return { configured: true, ok: false, error: err.message }
  }
}

async function loadSonarr(connection) {
  if (!isConfigured(connection)) return { configured: false, ok: false, error: null, recent: [] }
  try {
    const [series, historyBody, queueBody, missingBody] = await Promise.all([
      cachedLibrary(connection, 'sonarr', '/api/v3/series', presentSeries),
      arrRequest(connection, '/api/v3/history', {
        query: { page: 1, pageSize: 40, sortKey: 'date', sortDirection: 'descending', includeSeries: true, includeEpisode: true },
      }).catch(() => null),
      arrRequest(connection, '/api/v3/queue', { query: { page: 1, pageSize: 1 } }).catch(() => null),
      arrRequest(connection, '/api/v3/wanted/missing', { query: { page: 1, pageSize: 1 } }).catch(() => null),
    ])
    const counts = seriesCounts(series)
    return {
      configured: true,
      ok: true,
      error: null,
      ...counts,
      missing: missingBody ? queueTotal(missingBody) : counts.missing,
      queueCount: queueBody ? queueTotal(queueBody) : 0,
      recent: historyBody ? presentArrHistory('sonarr', historyBody) : [],
    }
  } catch (err) {
    return { configured: true, ok: false, error: err.message, recent: [] }
  }
}

async function loadRadarr(connection) {
  if (!isConfigured(connection)) return { configured: false, ok: false, error: null, recent: [] }
  try {
    const [movies, historyBody, queueBody, missingBody] = await Promise.all([
      cachedLibrary(connection, 'radarr', '/api/v3/movie', presentMovie),
      arrRequest(connection, '/api/v3/history', {
        query: { page: 1, pageSize: 40, sortKey: 'date', sortDirection: 'descending', includeMovie: true },
      }).catch(() => null),
      arrRequest(connection, '/api/v3/queue', { query: { page: 1, pageSize: 1 } }).catch(() => null),
      arrRequest(connection, '/api/v3/wanted/missing', { query: { page: 1, pageSize: 1 } }).catch(() => null),
    ])
    const counts = movieCounts(movies)
    return {
      configured: true,
      ok: true,
      error: null,
      ...counts,
      missing: missingBody ? queueTotal(missingBody) : counts.missing,
      queueCount: queueBody ? queueTotal(queueBody) : 0,
      recent: historyBody ? presentArrHistory('radarr', historyBody) : [],
    }
  } catch (err) {
    return { configured: true, ok: false, error: err.message, recent: [] }
  }
}
