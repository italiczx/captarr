import { safeMediaPath } from './upstream.js'

const DOWNLOAD_EVENTS = new Set(['downloadFolderImported', 'movieFileImported', 'episodeFileImported'])

export function mediaFields(images, remotePoster) {
  const poster = Array.isArray(images) ? images.find((image) => image.coverType === 'poster') : null
  let posterPath = null
  const raw = typeof poster?.url === 'string' ? poster.url : ''
  const bare = raw.split('?')[0]
  if (bare.startsWith('/')) posterPath = bare
  else if (bare.startsWith('MediaCover/')) posterPath = `/${bare}`
  else if (raw) {
    try {
      const url = new URL(raw)
      if (url.pathname.includes('/MediaCover/')) posterPath = url.pathname
    } catch {
      posterPath = null
    }
  }
  if (posterPath) {
    try {
      posterPath = safeMediaPath(posterPath)
    } catch {
      posterPath = null
    }
  }
  return {
    posterPath,
    remotePoster: poster?.remoteUrl || remotePoster || null,
  }
}

function pad(value) {
  return String(value ?? 0).padStart(2, '0')
}

export function eventKind(eventType) {
  if (DOWNLOAD_EVENTS.has(eventType)) return 'Downloaded'
  if (eventType === 'grabbed') return 'Grabbed'
  if (eventType === 'downloadFailed') return 'Failed'
  if (eventType === 'episodeFileDeleted' || eventType === 'movieFileDeleted') return 'Deleted'
  if (!eventType) return 'Activity'
  return eventType.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase()).trim()
}

export function presentSabQueue(body) {
  const queue = body?.queue || {}
  const slots = Array.isArray(queue.slots) ? queue.slots : []
  return {
    paused: Boolean(queue.paused || queue.paused_all),
    status: queue.status || (queue.paused ? 'Paused' : 'Idle'),
    speed: queue.speed || '0',
    timeleft: queue.timeleft || '',
    size: queue.size || '',
    sizeleft: queue.sizeleft || '',
    diskFree: queue.diskspace1_norm || (queue.diskspace1 ? `${queue.diskspace1} GB` : null),
    diskTotal: queue.diskspacetotal1_norm || null,
    count: Number(queue.noofslots_total ?? queue.noofslots ?? slots.length) || slots.length,
    slots: slots.map((slot) => {
      const percentage = Math.max(0, Math.min(100, Number.parseFloat(slot.percentage) || 0))
      return {
        id: slot.nzo_id,
        filename: slot.filename || 'Download',
        category: slot.cat || slot.category || '',
        percentage: Math.round(percentage * 10) / 10,
        size: slot.size || '',
        sizeleft: slot.sizeleft || '',
        timeleft: slot.timeleft || '',
        status: slot.status || '',
      }
    }),
  }
}

export function presentSabHistory(body) {
  const history = body?.history || {}
  const slots = Array.isArray(history.slots) ? history.slots : []
  return {
    day: history.day_size || null,
    week: history.week_size || null,
    month: history.month_size || null,
    total: history.total_size || null,
    slots: slots.map((slot) => ({
      id: slot.nzo_id,
      name: slot.name || slot.nzb_name || 'Download',
      category: slot.category || '',
      status: slot.status || '',
      size: slot.size || '',
      completed: unixToIso(slot.completed),
      failMessage: slot.fail_message || '',
    })),
  }
}

function unixToIso(value) {
  const num = Number(value)
  if (!num) return null
  const ms = num > 1e12 ? num : num * 1000
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function presentSeries(series) {
  const stats = series?.statistics || {}
  return {
    id: series.id,
    title: series.title || 'Untitled',
    year: series.year || null,
    overview: series.overview || '',
    status: series.status || '',
    monitored: Boolean(series.monitored),
    network: series.network || '',
    path: series.path || '',
    ...mediaFields(series.images, series.remotePoster),
    episodeFileCount: stats.episodeFileCount ?? 0,
    episodeCount: stats.episodeCount ?? stats.totalEpisodeCount ?? 0,
    sizeOnDisk: stats.sizeOnDisk ?? 0,
    qualityProfileId: series.qualityProfileId ?? null,
    tvdbId: series.tvdbId ?? null,
    genres: Array.isArray(series.genres) ? series.genres : [],
    added: series.added || null,
    seasons: (Array.isArray(series.seasons) ? series.seasons : [])
      .map((season) => ({
        seasonNumber: season.seasonNumber,
        monitored: Boolean(season.monitored),
        episodeFileCount: season.statistics?.episodeFileCount ?? 0,
        episodeCount: season.statistics?.episodeCount ?? season.statistics?.totalEpisodeCount ?? 0,
      }))
      .sort((a, b) => a.seasonNumber - b.seasonNumber),
  }
}

export function presentEpisode(episode) {
  const fileId = Number(episode?.episodeFileId)
  return {
    id: episode.id,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    title: episode.title || `Episode ${episode.episodeNumber}`,
    airDate: episode.airDate || null,
    hasFile: Boolean(episode.hasFile),
    episodeFileId: Number.isInteger(fileId) && fileId > 0 ? fileId : null,
    monitored: Boolean(episode.monitored),
  }
}

export function presentMovie(movie) {
  const file = movie?.movieFile
  return {
    id: movie.id,
    title: movie.title || 'Untitled',
    year: movie.year || null,
    overview: movie.overview || '',
    status: movie.status || '',
    monitored: Boolean(movie.monitored),
    studio: movie.studio || '',
    path: movie.path || '',
    ...mediaFields(movie.images, movie.remotePoster),
    hasFile: Boolean(movie.hasFile),
    sizeOnDisk: movie.sizeOnDisk || file?.size || 0,
    runtime: movie.runtime || 0,
    qualityProfileId: movie.qualityProfileId ?? null,
    tmdbId: movie.tmdbId ?? null,
    genres: Array.isArray(movie.genres) ? movie.genres : [],
    added: movie.added || null,
    file: file ? {
      relativePath: file.relativePath || file.path || '',
      size: file.size || 0,
      quality: file.quality?.quality?.name || '',
      resolution: file.mediaInfo?.resolution || '',
      videoCodec: file.mediaInfo?.videoCodec || '',
      audioCodec: file.mediaInfo?.audioCodec || '',
    } : null,
  }
}

export function presentLookup(service, item, existingIds) {
  const presented = service === 'sonarr' ? presentSeries(item) : presentMovie(item)
  const externalId = service === 'sonarr' ? item.tvdbId : item.tmdbId
  return {
    title: presented.title,
    year: presented.year,
    overview: presented.overview,
    externalId,
    remotePoster: presented.remotePoster,
    posterPath: presented.posterPath,
    network: presented.network || '',
    studio: presented.studio || '',
    status: presented.status,
    alreadyAdded: existingIds.has(externalId),
  }
}

export function seriesCounts(list) {
  let episodeFiles = 0
  let episodeCount = 0
  for (const series of list) {
    episodeFiles += series.episodeFileCount || 0
    episodeCount += series.episodeCount || 0
  }
  return {
    seriesCount: list.length,
    episodeFiles,
    episodeCount,
    missing: Math.max(0, episodeCount - episodeFiles),
  }
}

export function movieCounts(list) {
  const downloaded = list.filter((movie) => movie.hasFile).length
  return {
    movieCount: list.length,
    downloaded,
    missing: list.length - downloaded,
  }
}

export function queueTotal(body) {
  if (Array.isArray(body)) return body.length
  if (typeof body?.totalRecords === 'number') return body.totalRecords
  if (Array.isArray(body?.records)) return body.records.length
  return 0
}

export function presentArrHistory(service, body) {
  const records = Array.isArray(body?.records) ? body.records : []
  return records.map((record) => {
    const kind = eventKind(record.eventType)
    if (service === 'sonarr') {
      const episode = record.episode
      const subtitle = episode
        ? `S${pad(episode.seasonNumber)}E${pad(episode.episodeNumber)}${episode.title ? ` · ${episode.title}` : ''}`
        : (record.sourceTitle || '')
      return {
        source: 'sonarr',
        id: record.seriesId || record.series?.id || null,
        title: record.series?.title || record.sourceTitle || 'Series',
        subtitle,
        quality: record.quality?.quality?.name || '',
        date: record.date || null,
        kind,
        ...mediaFields(record.series?.images),
      }
    }
    const year = record.movie?.year
    return {
      source: 'radarr',
      id: record.movieId || record.movie?.id || null,
      title: record.movie?.title || record.sourceTitle || 'Movie',
      subtitle: [year, record.quality?.quality?.name].filter(Boolean).join(' · '),
      quality: record.quality?.quality?.name || '',
      date: record.date || null,
      kind,
      ...mediaFields(record.movie?.images),
    }
  })
}

export function presentRelease(release) {
  const rejections = Array.isArray(release?.rejections)
    ? release.rejections.map((item) => String(item)).filter(Boolean).slice(0, 4)
    : []
  return {
    guid: String(release?.guid || ''),
    indexerId: release?.indexerId ?? null,
    title: release?.title || 'Release',
    indexer: release?.indexer || '',
    quality: release?.quality?.quality?.name || '',
    size: Number(release?.size) || 0,
    protocol: String(release?.protocol || '').toLowerCase(),
    seeders: Number.isFinite(Number(release?.seeders)) ? Number(release.seeders) : null,
    age: ageLabel(release),
    approved: release?.approved !== false && !release?.rejected,
    rejections,
  }
}

function ageLabel(release) {
  const hours = Number(release?.ageHours)
  const minutes = Number(release?.ageMinutes)
  const days = Number(release?.age)
  if (Number.isFinite(hours) && hours > 0 && hours < 48) {
    if (hours < 1 && Number.isFinite(minutes) && minutes > 0) return `${Math.round(minutes)}m`
    const rounded = Math.round(hours)
    return rounded < 1 ? '1h' : `${rounded}h`
  }
  if (Number.isFinite(days) && days > 0) return `${Math.round(days)}d`
  return ''
}

export function pickRecent(items, limit = 12) {
  return items
    .filter((item) => item.kind === 'Downloaded' && item.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit)
}
