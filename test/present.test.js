import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { mediaUrl, normalizeBaseUrl, plexItemUrl, sabApiUrl, safeMediaPath } from '../server/upstream.js'
import { pickRecent, presentSabHistory, presentSabQueue, presentSeries } from '../server/present.js'
import { HttpError } from '../server/errors.js'

describe('host urls', () => {
  test('normalizes host urls and sab api paths', () => {
    assert.equal(normalizeBaseUrl('http://192.168.1.10:8989/sonarr/'), 'http://192.168.1.10:8989/sonarr')
    assert.equal(normalizeBaseUrl('http://host:8080/sabnzbd/api/'), 'http://host:8080/sabnzbd')
    assert.throws(() => normalizeBaseUrl('ftp://nas/sonarr'), HttpError)
    assert.throws(() => normalizeBaseUrl('http://user:secret@nas:8989'), HttpError)

    const queue = sabApiUrl('http://host:8080/sabnzbd', 'secret', { mode: 'queue' })
    assert.equal(queue.pathname, '/sabnzbd/api')
    assert.equal(queue.searchParams.get('mode'), 'queue')
    assert.equal(queue.searchParams.get('output'), 'json')
    assert.equal(queue.searchParams.get('apikey'), 'secret')

    const already = sabApiUrl('http://host:8080/sabnzbd/api', 'secret', { mode: 'version' })
    assert.equal(already.pathname, '/sabnzbd/api')
  })

  test('joins media covers without doubling a url base', () => {
    const url = mediaUrl('http://192.168.1.10:8989/sonarr', '/MediaCover/3/poster.jpg', 'secret')
    assert.equal(url.pathname, '/sonarr/MediaCover/3/poster.jpg')
    assert.equal(url.searchParams.get('apikey'), 'secret')

    const prefixed = mediaUrl('http://192.168.1.10:8989/sonarr', '/sonarr/MediaCover/3/poster.jpg', 'secret')
    assert.equal(prefixed.pathname, '/sonarr/MediaCover/3/poster.jpg')
  })

  test('builds a plex search link from a server address', () => {
    const bear = { title: 'The Bear', year: 2022 }
    assert.equal(
      plexItemUrl('http://192.168.1.10:32400', bear),
      'http://192.168.1.10:32400/web/index.html#!/search?query=The%20Bear',
    )
    assert.equal(
      plexItemUrl('http://192.168.1.10:32400/web', bear),
      'http://192.168.1.10:32400/web/index.html#!/search?query=The%20Bear',
    )
    assert.equal(
      plexItemUrl('http://192.168.1.10:32400/web/index.html', bear),
      'http://192.168.1.10:32400/web/index.html#!/search?query=The%20Bear',
    )
    assert.equal(
      plexItemUrl('https://app.plex.tv/desktop', bear),
      'https://app.plex.tv/desktop/#!/search?query=The%20Bear',
    )
    assert.equal(
      plexItemUrl('https://app.plex.tv', { title: 'Past Lives' }),
      'https://app.plex.tv/desktop/#!/search?query=Past%20Lives',
    )
  })

  test('rejects image paths that leave MediaCover', () => {
    assert.equal(safeMediaPath('/MediaCover/12/poster.jpg'), '/MediaCover/12/poster.jpg')
    assert.equal(safeMediaPath('/apps/sonarr/MediaCover/12/poster.svg'), '/apps/sonarr/MediaCover/12/poster.svg')
    assert.throws(() => safeMediaPath('/MediaCover/1/../../secret'), HttpError)
    assert.throws(() => safeMediaPath('/etc/passwd'), HttpError)
  })
})

describe('api shapes', () => {
  test('presents sab queue, history, and recent imports', () => {
    const queue = presentSabQueue({
      queue: {
        paused: false,
        status: 'Downloading',
        speed: '18.4 M',
        sizeleft: '8.4 GB',
        timeleft: '0:12:40',
        diskspace1_norm: '1.8 TB',
        noofslots_total: 2,
        slots: [{ nzo_id: 'abc', filename: 'Show', cat: 'tv', percentage: '42.25', size: '1 GB', sizeleft: '0.5 GB', timeleft: '0:01:00', status: 'Downloading' }],
      },
    })
    assert.equal(queue.count, 2)
    assert.equal(queue.slots[0].percentage, 42.3)
    assert.equal(queue.diskFree, '1.8 TB')

    const history = presentSabHistory({
      history: {
        day_size: '14.2 GB',
        slots: [{ nzo_id: 'h1', name: 'Done', status: 'Completed', size: '1 GB', completed: 1_700_000_000, fail_message: '' }],
      },
    })
    assert.equal(history.day, '14.2 GB')
    assert.equal(history.slots[0].completed, new Date(1_700_000_000 * 1000).toISOString())

    const recent = pickRecent([
      { kind: 'Grabbed', date: '2024-01-03T00:00:00Z', title: 'Skip' },
      { kind: 'Downloaded', date: '2024-01-01T00:00:00Z', title: 'Older' },
      { kind: 'Downloaded', date: '2024-01-02T00:00:00Z', title: 'Newer' },
    ])
    assert.deepEqual(recent.map((item) => item.title), ['Newer', 'Older'])
  })

  test('presents series posters and episode counts', () => {
    const series = presentSeries({
      id: 4,
      title: 'The Bear',
      year: 2022,
      monitored: true,
      statistics: { episodeFileCount: 8, episodeCount: 10, sizeOnDisk: 1000 },
      images: [{ coverType: 'poster', url: '/MediaCover/4/poster.jpg?lastWrite=1' }],
      seasons: [{ seasonNumber: 1, monitored: true, statistics: { episodeFileCount: 8, episodeCount: 10 } }],
    })
    assert.equal(series.posterPath, '/MediaCover/4/poster.jpg')
    const relative = presentSeries({
      id: 9,
      title: 'Relative',
      images: [{ coverType: 'poster', url: 'MediaCover/9/poster.jpg', remoteUrl: 'https://images.example/p.jpg' }],
    })
    assert.equal(relative.posterPath, '/MediaCover/9/poster.jpg')
    assert.equal(relative.remotePoster, 'https://images.example/p.jpg')
    assert.equal(series.episodeFileCount, 8)
    assert.equal(series.seasons[0].episodeCount, 10)
  })
})
