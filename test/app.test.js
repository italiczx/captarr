import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../server/index.js'
import { hashPassword, verifyPassword } from '../server/auth.js'
import { startMock } from '../scripts/mock-upstream.js'

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

async function request(base, pathname, { method = 'GET', cookie = '', json } = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  })
  const text = await response.text()
  let data = null
  if (text) data = JSON.parse(text)
  const setCookie = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  return {
    status: response.status,
    data,
    cookie: setCookie.map((line) => line.split(';')[0]).join('; '),
    headers: response.headers,
    text,
  }
}

test('passwords hash and verify', async () => {
  const hash = await hashPassword('s3cure-pass')
  assert.equal(await verifyPassword('s3cure-pass', hash), true)
  assert.equal(await verifyPassword('wrong-pass', hash), false)
  assert.equal(hash.includes('s3cure-pass'), false)
})

test('wizard, libraries, and sab queue', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'captarr-'))
  const mock = await startMock()
  const { server, url } = await listen(createApp({ dataDir: dir }))
  const host = `http://127.0.0.1:${mock.port}`
  try {
    const status = await request(url, '/api/setup/status')
    assert.equal(status.data.needsSetup, true)
    assert.equal((await request(url, '/api/dashboard')).status, 401)

    const shortPassword = await request(url, '/api/setup', {
      method: 'POST',
      json: { username: 'Ada', password: '12345' },
    })
    assert.equal(shortPassword.status, 400)
    assert.equal(shortPassword.data.error, 'Password must be at least 6 characters.')

    const setup = await request(url, '/api/setup', {
      method: 'POST',
      json: {
        username: 'Ada',
        password: 's3cure-pass',
        connections: {
          sabnzbd: { baseUrl: `${host}/sabnzbd`, apiKey: 'test-key' },
          sonarr: { baseUrl: `${host}/sonarr`, apiKey: 'test-key' },
          radarr: { baseUrl: `${host}/radarr`, apiKey: 'test-key' },
        },
      },
    })
    assert.equal(setup.status, 200)
    let cookie = setup.cookie
    const raw = await readFile(path.join(dir, 'config.json'), 'utf8')
    assert.equal(raw.includes('s3cure-pass'), false)
    assert.match(raw, /scrypt\$/)
    assert.equal((await stat(path.join(dir, 'config.json'))).mode & 0o777, 0o600)
    assert.equal((await request(url, '/api/setup', { method: 'POST', json: { username: 'Ada', password: 's3cure-pass' } })).status, 409)

    const me = await request(url, '/api/auth/me', { cookie })
    assert.equal(me.data.username, 'Ada')
    const settings = await request(url, '/api/settings', { cookie })
    assert.equal(settings.data.connections.sonarr.hasApiKey, true)
    assert.equal(JSON.stringify(settings.data).includes('test-key'), false)

    const dash = await request(url, '/api/dashboard', { cookie })
    assert.equal(dash.data.sab.queueCount, 2)
    assert.equal(dash.data.sab.diskFree, '1.8 TB')
    assert.equal(dash.data.sab.day, '14.2 GB')
    assert.equal(dash.data.sonarr.seriesCount, 56)
    assert.equal(dash.data.sonarr.missing, 8)
    assert.equal(dash.data.sonarr.queueCount, 1)
    assert.equal(dash.data.radarr.movieCount, 56)
    assert.equal(dash.data.radarr.downloaded, 55)
    assert.equal(dash.data.radarr.missing, 1)
    assert.equal(dash.data.recent[0].title, 'Past Lives')
    assert.equal(dash.data.recent.some((item) => item.kind !== 'Downloaded'), false)

    const queue = await request(url, '/api/sab/queue', { cookie })
    assert.equal(queue.data.slots[0].filename, 'The.Bear.S02E08.2160p')
    const pausedJob = await request(url, '/api/sab/queue/SABnzbd_nzo_show/pause', { method: 'POST', cookie })
    assert.equal(pausedJob.data.slots.find((slot) => slot.id === 'SABnzbd_nzo_show').status, 'Paused')
    const pausedAll = await request(url, '/api/sab/pause', { method: 'POST', cookie })
    assert.equal(pausedAll.data.paused, true)
    const removed = await request(url, '/api/sab/queue/SABnzbd_nzo_movie?deleteFiles=true', { method: 'DELETE', cookie })
    assert.equal(removed.data.slots.length, 1)
    assert.equal(mock.state.lastSabDelete.deleteFiles, true)
    const history = await request(url, '/api/sab/history?start=0&limit=40', { cookie })
    assert.equal(history.data.slots.find((slot) => slot.status === 'Failed').failMessage, 'Not enough repair blocks')

    const series = await request(url, '/api/sonarr/series', { cookie })
    assert.equal(series.data.total, 56)
    assert.equal(series.data.items.length, 48)
    assert.equal(series.data.page, 1)
    const seriesPage = await request(url, '/api/sonarr/series?page=2&pageSize=48&sort=title', { cookie })
    assert.equal(seriesPage.data.items.length, 8)
    assert.equal(seriesPage.data.items.some((item) => item.title === 'The Bear'), true)
    assert.notEqual(seriesPage.data.items[0].id, series.data.items[0].id)
    const detail = await request(url, '/api/sonarr/series/1', { cookie })
    assert.equal(detail.data.item.title, 'The Bear')
    assert.equal(detail.data.episodes.length, 6)
    assert.equal(detail.data.item.qualityProfileName, 'HD-1080p')
    const lookup = await request(url, '/api/sonarr/lookup?term=wire', { cookie })
    assert.equal(lookup.data.results[0].title, 'The Wire')
    assert.equal(lookup.data.results[0].alreadyAdded, false)
    const added = await request(url, '/api/sonarr/series', {
      method: 'POST',
      cookie,
      json: { externalId: 79126, qualityProfileId: 1, rootFolderPath: '/tv', monitored: true, search: false },
    })
    assert.equal(added.status, 201)
    assert.equal(added.data.item.title, 'The Wire')
    assert.equal(mock.state.lastAdd.rootFolderPath, '/tv')
    assert.equal(mock.state.lastAdd.qualityProfileId, 1)
    const removedSeries = await request(url, `/api/sonarr/series/${added.data.item.id}?deleteFiles=true`, { method: 'DELETE', cookie })
    assert.equal(removedSeries.data.ok, true)
    assert.equal(mock.state.lastDelete.deleteFiles, true)
    assert.equal((await request(url, '/api/sonarr/series?q=wire', { cookie })).data.total, 0)

    const movieLookup = await request(url, '/api/radarr/lookup?term=heat', { cookie })
    assert.equal(movieLookup.data.results[0].externalId, 949)
    const addedMovie = await request(url, '/api/radarr/movies', {
      method: 'POST',
      cookie,
      json: { externalId: 949, qualityProfileId: 1, rootFolderPath: '/movies', monitored: true, search: true },
    })
    assert.equal(addedMovie.status, 201)
    assert.equal(mock.state.lastAdd.addOptions.searchForMovie, true)
    const movieDetail = await request(url, '/api/radarr/movies/1', { cookie })
    assert.equal(movieDetail.data.item.file.quality, 'Bluray-1080p')
    const searched = await request(url, '/api/sonarr/series/1/search', { method: 'POST', cookie })
    assert.equal(searched.data.ok, true)
    assert.equal(mock.state.lastCommand.name, 'SeriesSearch')
    assert.equal(mock.state.lastCommand.seriesId, 1)
    const seasonSearch = await request(url, '/api/sonarr/series/1/search', { method: 'POST', cookie, json: { seasonNumber: 1 } })
    assert.equal(seasonSearch.data.ok, true)
    assert.equal(mock.state.lastCommand.name, 'SeasonSearch')
    assert.equal(mock.state.lastCommand.seriesId, 1)
    assert.equal(mock.state.lastCommand.seasonNumber, 1)
    assert.equal(detail.data.episodes[0].episodeFileId, 101)
    const deletedEpisode = await request(url, '/api/sonarr/series/1/episodes/101', { method: 'DELETE', cookie })
    assert.equal(deletedEpisode.data.ok, true)
    assert.equal(mock.state.lastEpisodeDelete.id, 101)
    const afterDelete = await request(url, '/api/sonarr/series/1', { cookie })
    assert.equal(afterDelete.data.episodes.find((episode) => episode.id === 101).hasFile, false)
    assert.equal((await request(url, '/api/sonarr/series/1/episodes/105', { method: 'DELETE', cookie })).status, 400)
    const releases = await request(url, '/api/sonarr/series/1/releases?episodeId=105', { cookie })
    assert.equal(releases.data.releases[0].approved, true)
    assert.equal(releases.data.releases[1].approved, false)
    const grabbed = await request(url, '/api/sonarr/series/1/releases', {
      method: 'POST',
      cookie,
      json: { guid: 'guid-approved', indexerId: 7 },
    })
    assert.equal(grabbed.data.ok, true)
    assert.equal(mock.state.lastGrab.guid, 'guid-approved')
    assert.equal(mock.state.lastGrab.indexerId, 7)
    const movieSearch = await request(url, '/api/radarr/movies/1/search', { method: 'POST', cookie })
    assert.equal(movieSearch.data.ok, true)
    assert.equal(mock.state.lastCommand.name, 'MoviesSearch')
    assert.deepEqual(mock.state.lastCommand.movieIds, [1])
    const movieReleases = await request(url, '/api/radarr/movies/1/releases', { cookie })
    assert.equal(movieReleases.data.releases[0].title, 'Movie.2023.1080p')
    assert.equal((await request(url, `/api/radarr/movies/${addedMovie.data.item.id}?deleteFiles=true`, { method: 'DELETE', cookie })).data.ok, true)

    const image = await fetch(`${url}/api/images/sonarr?path=${encodeURIComponent('/MediaCover/1/poster.svg')}`, { headers: { cookie } })
    assert.equal(image.status, 200)
    assert.match(image.headers.get('content-type'), /^image\//)
    const traversal = await request(url, `/api/images/sonarr?path=${encodeURIComponent('/MediaCover/1/../../secret')}`, { cookie })
    assert.equal(traversal.status, 400)

    const loggedOut = await request(url, '/api/auth/logout', { method: 'POST', cookie })
    assert.equal((await request(url, '/api/auth/me', { cookie: loggedOut.cookie })).data.username, null)
    assert.equal((await request(url, '/api/auth/login', { method: 'POST', json: { username: 'ada', password: 'nope' } })).status, 401)
    const login = await request(url, '/api/auth/login', { method: 'POST', json: { username: 'ada', password: 's3cure-pass' } })
    assert.equal(login.status, 200)
    cookie = login.cookie

    const changed = await request(url, '/api/settings/password', {
      method: 'POST',
      cookie,
      json: { currentPassword: 's3cure-pass', newPassword: 's3cure-pass-2' },
    })
    assert.equal(changed.status, 200)
    assert.equal((await request(url, '/api/auth/me', { cookie })).data.username, null)
    assert.equal((await request(url, '/api/auth/me', { cookie: changed.cookie })).data.username, 'Ada')
  } finally {
    await close(server)
    await close(mock.server)
    await rm(dir, { recursive: true, force: true })
  }
})

test('plex address opens a sonarr title in plex search', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'captarr-'))
  const mock = await startMock()
  const { server, url } = await listen(createApp({ dataDir: dir }))
  const host = `http://127.0.0.1:${mock.port}`
  try {
    const setup = await request(url, '/api/setup', {
      method: 'POST',
      json: {
        username: 'ada',
        password: 's3cure-pass',
        connections: {
          sonarr: { baseUrl: `${host}/sonarr`, apiKey: 'test-key' },
          radarr: { baseUrl: `${host}/radarr`, apiKey: 'test-key' },
          plex: { baseUrl: 'http://192.168.1.20:32400' },
        },
      },
    })
    assert.equal(setup.status, 200)
    const cookie = setup.cookie
    const settings = await request(url, '/api/settings', { cookie })
    assert.equal(settings.data.connections.plex.baseUrl, 'http://192.168.1.20:32400')
    assert.equal(settings.data.connections.plex.hasApiKey, false)
    const detail = await request(url, '/api/sonarr/series/1', { cookie })
    assert.equal(detail.data.plexUrl, 'http://192.168.1.20:32400/web/index.html#!/search?query=The%20Bear')
    const movie = await request(url, '/api/radarr/movies/1', { cookie })
    assert.equal(movie.data.plexUrl, 'http://192.168.1.20:32400/web/index.html#!/search?query=Past%20Lives')
    const saved = await request(url, '/api/settings/connections/plex', {
      method: 'PUT',
      cookie,
      json: { baseUrl: 'https://app.plex.tv/desktop' },
    })
    assert.equal(saved.status, 200)
    const linked = await request(url, '/api/sonarr/series/1', { cookie })
    assert.equal(linked.data.plexUrl, 'https://app.plex.tv/desktop/#!/search?query=The%20Bear')
    const removed = await request(url, '/api/settings/connections/plex', { method: 'DELETE', cookie })
    assert.equal(removed.data.baseUrl, '')
    const plain = await request(url, '/api/sonarr/series/1', { cookie })
    assert.equal(plain.data.plexUrl, null)
    const bad = await request(url, '/api/settings/connections/plex', {
      method: 'PUT',
      cookie,
      json: { baseUrl: 'not a url' },
    })
    assert.equal(bad.status, 400)
  } finally {
    await close(server)
    await close(mock.server)
    await rm(dir, { recursive: true, force: true })
  }
})

test('skipped apps stay disconnected', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'captarr-'))
  const { server, url } = await listen(createApp({ dataDir: dir }))
  try {
    const setup = await request(url, '/api/setup', {
      method: 'POST',
      json: { username: 'ada', password: 's3cure-pass', connections: { sabnzbd: null, sonarr: null, radarr: null } },
    })
    const queue = await request(url, '/api/sab/queue', { cookie: setup.cookie })
    assert.equal(queue.status, 400)
    assert.equal(queue.data.code, 'not_configured')
    const dash = await request(url, '/api/dashboard', { cookie: setup.cookie })
    assert.equal(dash.data.sab.configured, false)
    assert.equal(dash.data.recent.length, 0)
  } finally {
    await close(server)
    await rm(dir, { recursive: true, force: true })
  }
})

test('login locks out after repeated failures', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'captarr-'))
  const { server, url } = await listen(createApp({ dataDir: dir }))
  try {
    await request(url, '/api/setup', {
      method: 'POST',
      json: { username: 'ada', password: 's3cure-pass', connections: {} },
    })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await request(url, '/api/auth/login', { method: 'POST', json: { username: 'ada', password: 'wrong-password' } })
      assert.equal(failed.status, 401)
    }
    const locked = await request(url, '/api/auth/login', { method: 'POST', json: { username: 'ada', password: 'wrong-password' } })
    assert.equal(locked.status, 429)
  } finally {
    await close(server)
    await rm(dir, { recursive: true, force: true })
  }
})
