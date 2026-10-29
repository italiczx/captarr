import http from 'node:http'
import { pathToFileURL } from 'node:url'

const KEY = 'test-key'

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString()
}

function series(partial) {
  return {
    monitored: true,
    overview: `${partial.title} is in the library.`,
    network: 'HBO',
    genres: ['Drama'],
    status: 'continuing',
    qualityProfileId: 1,
    year: partial.year,
    seasons: [{ seasonNumber: 1, monitored: true, statistics: { episodeFileCount: 4, episodeCount: 6 } }],
    statistics: { episodeFileCount: 4, episodeCount: 6, totalEpisodeCount: 6, sizeOnDisk: 12_000_000_000 },
    ...partial,
    images: [{ coverType: 'poster', url: `/MediaCover/${partial.id}/poster.svg` }],
    path: `/tv/${partial.title}`,
  }
}

function movie(partial) {
  const file = partial.hasFile ? {
    relativePath: `${partial.title}/feature.mkv`,
    size: 8_000_000_000,
    quality: { quality: { name: 'Bluray-1080p' } },
    mediaInfo: { resolution: '1920x1080', videoCodec: 'x265', audioCodec: 'AAC' },
  } : null
  return {
    monitored: true,
    overview: `${partial.title} is in the library.`,
    studio: 'A24',
    genres: ['Drama'],
    status: 'released',
    qualityProfileId: 1,
    runtime: 120,
    sizeOnDisk: partial.hasFile ? 8_000_000_000 : 0,
    minimumAvailability: 'released',
    ...partial,
    movieFile: file,
    images: [{ coverType: 'poster', url: `/MediaCover/${partial.id}/poster.svg` }],
    path: `/movies/${partial.title}`,
  }
}

function createState() {
  return {
    nextId: 100,
    paused: false,
    lastAdd: null,
    lastDelete: null,
    lastSabDelete: null,
    lastCommand: null,
    lastGrab: null,
    lastEpisodeDelete: null,
    deletedEpisodeFiles: [],
    slots: [
      {
        nzo_id: 'SABnzbd_nzo_show',
        filename: 'The.Bear.S02E08.2160p',
        cat: 'tv',
        percentage: '42',
        size: '8.2 GB',
        sizeleft: '4.8 GB',
        timeleft: '0:08:10',
        status: 'Downloading',
      },
      {
        nzo_id: 'SABnzbd_nzo_movie',
        filename: 'Heat.1995.1080p',
        cat: 'movies',
        percentage: '0',
        size: '13.9 GB',
        sizeleft: '13.9 GB',
        timeleft: '0:00:00',
        status: 'Queued',
      },
    ],
    history: [
      { nzo_id: 'hist-1', name: 'Slow Horses S03E06', category: 'tv', status: 'Completed', size: '2.4 GB', completed: Math.floor(Date.now() / 1000) - 3600, fail_message: '' },
      { nzo_id: 'hist-2', name: 'Past Lives 2023', category: 'movies', status: 'Completed', size: '11.1 GB', completed: Math.floor(Date.now() / 1000) - 86400, fail_message: '' },
      { nzo_id: 'hist-3', name: 'Broken.Download', category: 'tv', status: 'Failed', size: '1.1 GB', completed: Math.floor(Date.now() / 1000) - 7200, fail_message: 'Not enough repair blocks' },
    ],
    series: [
      series({ id: 1, title: 'The Bear', year: 2022, tvdbId: 125935, network: 'FX' }),
      series({ id: 2, title: 'Slow Horses', year: 2022, tvdbId: 403937, network: 'Apple TV+' }),
      series({ id: 3, title: 'Shogun', year: 2024, tvdbId: 392108, network: 'FX', status: 'ended' }),
      series({ id: 4, title: 'Andor', year: 2022, tvdbId: 356990, network: 'Disney+' }),
      ...Array.from({ length: 52 }, (_, index) => series({
        id: 5 + index,
        title: `Archive Show ${String(index + 1).padStart(2, '0')}`,
        year: 1990 + (index % 30),
        tvdbId: 810000 + index,
        added: new Date(Date.UTC(2020, 0, 1) + index * 86400000).toISOString(),
      })),
    ],
    movies: [
      movie({ id: 1, title: 'Past Lives', year: 2023, tmdbId: 666277, hasFile: true }),
      movie({ id: 2, title: 'The Holdovers', year: 2023, tmdbId: 840430, hasFile: true }),
      movie({ id: 3, title: 'Anatomy of a Fall', year: 2023, tmdbId: 915935, hasFile: false }),
      movie({ id: 4, title: 'Dune: Part Two', year: 2024, tmdbId: 693134, hasFile: true }),
      ...Array.from({ length: 52 }, (_, index) => movie({
        id: 5 + index,
        title: `Archive Film ${String(index + 1).padStart(2, '0')}`,
        year: 1980 + (index % 40),
        tmdbId: 710000 + index,
        hasFile: true,
        added: new Date(Date.UTC(2019, 0, 1) + index * 86400000).toISOString(),
      })),
    ],
  }
}

function seriesEpisodes(state, seriesId) {
  return Array.from({ length: 6 }, (_, index) => {
    const id = seriesId * 100 + index + 1
    const hasFile = index < 4 && !state.deletedEpisodeFiles.includes(id)
    return {
      id,
      seriesId,
      seasonNumber: 1,
      episodeNumber: index + 1,
      title: `Episode ${index + 1}`,
      airDate: '2024-01-01',
      hasFile,
      episodeFileId: hasFile ? id : 0,
      monitored: true,
    }
  })
}

function posterSvg(letter) {
  const safe = String(letter || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 1) || '?'
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="300" height="450" fill="#2a2d26"/><text x="150" y="250" text-anchor="middle" font-family="Georgia, serif" font-size="120" fill="#eceae3">${safe}</text></svg>`
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  res.writeHead(status, { 'content-type': type, 'content-length': payload.length })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (!chunks.length) return resolve(null)
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function queueBody(state) {
  const downloading = state.slots.some((slot) => slot.status === 'Downloading')
  return {
    queue: {
      paused: state.paused,
      status: state.paused ? 'Paused' : downloading ? 'Downloading' : 'Idle',
      speed: state.paused ? '0' : '18.4 M',
      timeleft: '0:12:40',
      size: '22.1 GB',
      sizeleft: '8.4 GB',
      diskspace1_norm: '1.8 TB',
      diskspacetotal1_norm: '4.0 TB',
      noofslots: state.slots.length,
      noofslots_total: state.slots.length,
      slots: state.slots,
    },
  }
}

function historyBody(state, start, limit) {
  return {
    history: {
      day_size: '14.2 GB',
      week_size: '86 GB',
      month_size: '240 GB',
      total_size: '2.1 TB',
      slots: state.history.slice(start, start + limit),
    },
  }
}

function sonarrHistory(state) {
  return {
    records: [
      {
        seriesId: 1,
        sourceTitle: 'The.Bear.S02E08',
        quality: { quality: { name: 'WEBDL-1080p' } },
        date: hoursAgo(5),
        eventType: 'downloadFolderImported',
        series: state.series[0],
        episode: { seasonNumber: 2, episodeNumber: 8, title: 'Bolognese' },
      },
      {
        seriesId: 2,
        sourceTitle: 'Slow.Horses.S04E01',
        quality: { quality: { name: 'WEBDL-2160p' } },
        date: hoursAgo(0.5),
        eventType: 'grabbed',
        series: state.series[1],
        episode: { seasonNumber: 4, episodeNumber: 1, title: 'Identity Theft' },
      },
    ],
  }
}

function radarrHistory(state) {
  return {
    records: [
      {
        movieId: 1,
        sourceTitle: 'Past.Lives.2023',
        quality: { quality: { name: 'Bluray-1080p' } },
        date: hoursAgo(1),
        eventType: 'downloadFolderImported',
        movie: state.movies[0],
      },
    ],
  }
}

function lookupSeries(state, term, port) {
  const wire = {
    title: 'The Wire',
    year: 2002,
    overview: 'A crime drama set in Baltimore.',
    tvdbId: 79126,
    status: 'ended',
    network: 'HBO',
    monitored: false,
    seasons: [{ seasonNumber: 1, monitored: false }],
    remotePoster: `http://127.0.0.1:${port}/art/W.svg`,
    images: [],
  }
  if (/^tvdb:79126$/i.test(term) || term.toLowerCase().includes('wire')) return [wire]
  const idMatch = term.match(/^tvdb:(\d+)$/i)
  if (idMatch) {
    const found = state.series.find((item) => item.tvdbId === Number(idMatch[1]))
    return found ? [found] : []
  }
  return state.series.filter((item) => item.title.toLowerCase().includes(term.toLowerCase()))
}

function lookupMovies(state, term, port) {
  const heat = {
    title: 'Heat',
    year: 1995,
    overview: 'A heist and the detective chasing it.',
    tmdbId: 949,
    status: 'released',
    studio: 'Warner Bros.',
    minimumAvailability: 'released',
    remotePoster: `http://127.0.0.1:${port}/art/H.svg`,
    images: [],
  }
  if (/^tmdb:949$/i.test(term) || term.toLowerCase().includes('heat')) return [heat]
  const idMatch = term.match(/^tmdb:(\d+)$/i)
  if (idMatch) {
    const found = state.movies.find((item) => item.tmdbId === Number(idMatch[1]))
    return found ? [found] : []
  }
  return state.movies.filter((item) => item.title.toLowerCase().includes(term.toLowerCase()))
}

async function handle(req, res, state) {
  const url = new URL(req.url, 'http://127.0.0.1')
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const port = req.socket.localPort

  const art = pathname.match(/^\/art\/([A-Za-z0-9])\.svg$/)
  if (art) return send(res, 200, posterSvg(art[1]), 'image/svg+xml')

  const cover = pathname.match(/^\/(sonarr|radarr)\/MediaCover\/(\d+)\/poster\.svg$/)
  if (cover) {
    const key = url.searchParams.get('apikey') || req.headers['x-api-key']
    if (key !== KEY) return send(res, 401, { message: 'Unauthorized' })
    return send(res, 200, posterSvg(cover[2]), 'image/svg+xml')
  }

  if (pathname === '/sabnzbd/api') {
    if (url.searchParams.get('apikey') !== KEY) return send(res, 200, { error: 'API Key Incorrect' })
    const mode = url.searchParams.get('mode')
    const name = url.searchParams.get('name')
    const value = url.searchParams.get('value')
    if (mode === 'version') return send(res, 200, { version: '4.3.2' })
    if (mode === 'queue' && !name) return send(res, 200, queueBody(state))
    if (mode === 'history') {
      const start = Number(url.searchParams.get('start') || 0)
      const limit = Number(url.searchParams.get('limit') || 40)
      return send(res, 200, historyBody(state, start, limit))
    }
    if (mode === 'pause') {
      state.paused = true
      for (const slot of state.slots) {
        if (slot.status === 'Downloading') slot.status = 'Paused'
      }
      return send(res, 200, { status: true })
    }
    if (mode === 'resume') {
      state.paused = false
      for (const slot of state.slots) {
        if (slot.status === 'Paused') slot.status = 'Downloading'
      }
      return send(res, 200, { status: true })
    }
    if (mode === 'queue' && name === 'pause') {
      const slot = state.slots.find((item) => item.nzo_id === value)
      if (slot) slot.status = 'Paused'
      return send(res, 200, { status: true })
    }
    if (mode === 'queue' && name === 'resume') {
      const slot = state.slots.find((item) => item.nzo_id === value)
      if (slot) slot.status = 'Downloading'
      return send(res, 200, { status: true })
    }
    if (mode === 'queue' && name === 'delete') {
      state.lastSabDelete = { id: value, deleteFiles: url.searchParams.get('del_files') === '1' }
      state.slots = state.slots.filter((slot) => slot.nzo_id !== value)
      return send(res, 200, { status: true })
    }
    return send(res, 404, { error: `Unknown SABnzbd mode ${mode || ''}` })
  }

  const sonarr = pathname.startsWith('/sonarr/')
  const radarr = pathname.startsWith('/radarr/')
  if (!sonarr && !radarr) return send(res, 404, { message: 'Not Found' })
  if (req.headers['x-api-key'] !== KEY) return send(res, 401, { message: 'Unauthorized' })

  const path = pathname.replace(/^\/(sonarr|radarr)/, '')
  if (path === '/api/v3/system/status') {
    return send(res, 200, sonarr
      ? { appName: 'Sonarr', version: '4.0.10' }
      : { appName: 'Radarr', version: '5.10.1' })
  }
  if (path === '/api/v3/qualityprofile') return send(res, 200, [{ id: 1, name: 'HD-1080p' }])
  if (path === '/api/v3/rootfolder') {
    return send(res, 200, [{
      id: 1,
      path: sonarr ? '/tv' : '/movies',
      freeSpace: 1_200_000_000_000,
      accessible: true,
    }])
  }
  if (path === '/api/v3/queue') return send(res, 200, { totalRecords: sonarr ? 1 : 0, records: [] })
  if (path === '/api/v3/wanted/missing') return send(res, 200, { totalRecords: sonarr ? 8 : 1, records: [] })
  if (path === '/api/v3/history') return send(res, 200, sonarr ? sonarrHistory(state) : radarrHistory(state))

  if (sonarr && path === '/api/v3/series/lookup') {
    return send(res, 200, lookupSeries(state, url.searchParams.get('term') || '', port))
  }
  if (radarr && path === '/api/v3/movie/lookup') {
    return send(res, 200, lookupMovies(state, url.searchParams.get('term') || '', port))
  }
  if (path === '/api/v3/command' && req.method === 'POST') {
    const body = await readBody(req)
    state.lastCommand = body
    return send(res, 201, { id: 1, name: body?.name, status: 'started' })
  }
  if (path === '/api/v3/release' && req.method === 'GET') {
    const episodeId = url.searchParams.get('episodeId')
    const title = sonarr
      ? `Show.S01E${String(episodeId || '00').padStart(2, '0')}.1080p`
      : 'Movie.2023.1080p'
    return send(res, 200, [
      {
        guid: 'guid-approved',
        indexerId: 7,
        title,
        indexer: 'NZBgeek',
        size: 1_500_000_000,
        ageHours: 20,
        protocol: 'usenet',
        quality: { quality: { name: 'WEBDL-1080p' } },
        approved: true,
        rejected: false,
        rejections: [],
      },
      {
        guid: 'guid-rejected',
        indexerId: 8,
        title: `${title}.rejected`,
        indexer: 'Other',
        size: 400_000_000,
        age: 12,
        protocol: 'usenet',
        quality: { quality: { name: 'HDTV-720p' } },
        approved: false,
        rejected: true,
        rejections: ['Quality profile does not allow this quality'],
      },
    ])
  }
  if (path === '/api/v3/release' && req.method === 'POST') {
    const body = await readBody(req)
    state.lastGrab = body
    return send(res, 200, { id: 1 })
  }

  if (sonarr && path === '/api/v3/episode' && req.method === 'GET') {
    const seriesId = Number(url.searchParams.get('seriesId'))
    return send(res, 200, seriesEpisodes(state, seriesId))
  }
  const episodeMatch = path.match(/^\/api\/v3\/episode\/(\d+)$/)
  if (sonarr && episodeMatch && req.method === 'GET') {
    const id = Number(episodeMatch[1])
    const episode = seriesEpisodes(state, Math.floor(id / 100)).find((item) => item.id === id)
    if (!episode) return send(res, 404, { message: 'Not Found' })
    return send(res, 200, episode)
  }
  const episodeFileMatch = path.match(/^\/api\/v3\/episodefile\/(\d+)$/)
  if (sonarr && episodeFileMatch && req.method === 'DELETE') {
    const id = Number(episodeFileMatch[1])
    const episode = seriesEpisodes(state, Math.floor(id / 100)).find((item) => item.id === id && item.hasFile)
    if (!episode) return send(res, 404, { message: 'Not Found' })
    state.deletedEpisodeFiles.push(id)
    state.lastEpisodeDelete = { id }
    return send(res, 200, {})
  }

  if (sonarr && path === '/api/v3/series' && req.method === 'GET') return send(res, 200, state.series)
  if (radarr && path === '/api/v3/movie' && req.method === 'GET') return send(res, 200, state.movies)

  const seriesMatch = path.match(/^\/api\/v3\/series\/(\d+)$/)
  if (sonarr && seriesMatch) {
    const id = Number(seriesMatch[1])
    const item = state.series.find((entry) => entry.id === id)
    if (!item) return send(res, 404, { message: 'Not Found' })
    if (req.method === 'DELETE') {
      state.lastDelete = { service: 'sonarr', id, deleteFiles: url.searchParams.get('deleteFiles') === 'true' }
      state.series = state.series.filter((entry) => entry.id !== id)
      return send(res, 200, {})
    }
    return send(res, 200, item)
  }

  const movieMatch = path.match(/^\/api\/v3\/movie\/(\d+)$/)
  if (radarr && movieMatch) {
    const id = Number(movieMatch[1])
    const item = state.movies.find((entry) => entry.id === id)
    if (!item) return send(res, 404, { message: 'Not Found' })
    if (req.method === 'DELETE') {
      state.lastDelete = { service: 'radarr', id, deleteFiles: url.searchParams.get('deleteFiles') === 'true' }
      state.movies = state.movies.filter((entry) => entry.id !== id)
      return send(res, 200, {})
    }
    return send(res, 200, item)
  }

  if (sonarr && path === '/api/v3/series' && req.method === 'POST') {
    const body = await readBody(req)
    state.lastAdd = body
    const id = state.nextId++
    const created = series({
      id,
      title: body.title,
      year: body.year || null,
      tvdbId: body.tvdbId,
      network: body.network || '',
      monitored: body.monitored,
      qualityProfileId: body.qualityProfileId,
      overview: body.overview || '',
      seasons: body.seasons || [],
    })
    created.path = `${body.rootFolderPath}/${body.title}`
    state.series.push(created)
    return send(res, 201, created)
  }

  if (radarr && path === '/api/v3/movie' && req.method === 'POST') {
    const body = await readBody(req)
    state.lastAdd = body
    const id = state.nextId++
    const created = movie({
      id,
      title: body.title,
      year: body.year || null,
      tmdbId: body.tmdbId,
      studio: body.studio || '',
      monitored: body.monitored,
      hasFile: false,
      qualityProfileId: body.qualityProfileId,
      overview: body.overview || '',
    })
    created.path = `${body.rootFolderPath}/${body.title}`
    state.movies.push(created)
    return send(res, 201, created)
  }

  return send(res, 404, { message: `No mock route for ${req.method} ${pathname}` })
}

export function startMock(port = 0) {
  const state = createState()
  const server = http.createServer((req, res) => {
    handle(req, res, state).catch((err) => {
      if (!res.headersSent) send(res, 500, { message: err.message })
    })
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, state })
    })
  })
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const port = Number(process.env.PORT || 8791)
  startMock(port).then(() => {
    console.log(`Mock SABnzbd, Sonarr, and Radarr on http://127.0.0.1:${port}`)
    console.log('API key: test-key')
  })
}
