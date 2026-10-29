import http from 'node:http'
import https from 'node:https'
import { HttpError, UpstreamError } from './errors.js'

const REDIRECTS = new Set([301, 302, 303, 307, 308])

export function normalizeBaseUrl(input) {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) throw new HttpError(400, 'Host is required.')
  let url
  try {
    url = new URL(trimmed)
  } catch {
    throw new HttpError(400, 'Host must be a full URL, like http://192.168.1.10:8989.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'Host must start with http:// or https://.')
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'Put the API key in its own field, not in the host URL.')
  }
  url.hash = ''
  url.search = ''
  let pathname = url.pathname.replace(/\/+$/, '')
  if (pathname.endsWith('/api')) pathname = pathname.slice(0, -4)
  url.pathname = pathname
  return url.toString().replace(/\/+$/, '')
}

export function plexItemUrl(baseUrl, item) {
  const title = String(item?.title || '').trim()
  if (!title) return ''
  return `${plexWebPage(baseUrl)}#!/search?query=${encodeURIComponent(title)}`
}

function plexWebPage(baseUrl) {
  const url = new URL(baseUrl)
  let path = url.pathname.replace(/\/+$/, '')
  if (url.hostname.toLowerCase() === 'app.plex.tv') {
    if (!path || path === '/') path = '/desktop'
    url.pathname = path
    url.search = ''
    url.hash = ''
    return `${url.toString().replace(/\/+$/, '')}/`
  }
  if (!path.endsWith('/index.html')) {
    path = path.endsWith('/web') ? `${path}/index.html` : `${path}/web/index.html`
  }
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function normalizeApiKey(input) {
  const key = String(input ?? '').trim()
  if (!key) throw new HttpError(400, 'API key is required.')
  if (key.length > 200 || /\s/.test(key)) throw new HttpError(400, 'API key looks wrong.')
  return key
}

export function sabApiUrl(baseUrl, apiKey, params) {
  const url = new URL(baseUrl)
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith('/api') ? pathname : `${pathname}/api`
  const search = new URLSearchParams()
  search.set('output', 'json')
  search.set('apikey', apiKey)
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue
    search.set(key, String(value))
  }
  url.search = search.toString()
  return url
}

export function arrUrl(baseUrl, apiPath, query) {
  const url = new URL(String(apiPath).replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  if (query) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value == null) continue
      search.set(key, String(value))
    }
    url.search = search.toString()
  }
  return url
}

export function mediaUrl(baseUrl, mediaPath, apiKey) {
  const base = new URL(baseUrl)
  const origin = `${base.protocol}//${base.host}`
  const basePath = base.pathname.replace(/\/+$/, '')
  const extra = mediaPath.startsWith('/') ? mediaPath : `/${mediaPath}`
  const pathname = basePath && (extra === basePath || extra.startsWith(`${basePath}/`))
    ? extra
    : `${basePath}${extra}`
  const url = new URL(pathname, origin)
  if (apiKey) url.searchParams.set('apikey', apiKey)
  return url
}

export function safeMediaPath(input) {
  if (typeof input !== 'string' || input.length > 300) {
    throw new HttpError(400, 'Unsupported image path.')
  }
  const pathOnly = input.split('?')[0]
  if (!pathOnly.startsWith('/') || pathOnly.includes('\\') || pathOnly.includes('//')) {
    throw new HttpError(400, 'Unsupported image path.')
  }
  const parts = pathOnly.split('/').filter(Boolean)
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new HttpError(400, 'Unsupported image path.')
  }
  const mediaIndex = parts.indexOf('MediaCover')
  if (mediaIndex < 0 || mediaIndex !== parts.length - 3) {
    throw new HttpError(400, 'Unsupported image path.')
  }
  const id = parts[mediaIndex + 1]
  const file = parts[mediaIndex + 2]
  if (!/^\d+$/.test(id) || !/^[A-Za-z0-9._-]+$/.test(file)) {
    throw new HttpError(400, 'Unsupported image path.')
  }
  return `/${parts.join('/')}`
}

function networkMessage(err) {
  const code = err?.cause?.code || err?.code
  if (code === 'ECONNREFUSED') return 'Could not connect to the host.'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Could not resolve the host.'
  if (code === 'ETIMEDOUT' || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return 'Timed out connecting to the host.'
  }
  if (code === 'ECONNRESET') return 'The host closed the connection.'
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return 'TLS certificate was rejected.'
  }
  return 'Could not reach the host.'
}

function extractMessage(json, text) {
  if (json == null) {
    const trimmed = text.trim()
    if (!trimmed || trimmed.startsWith('<')) return ''
    return trimmed.slice(0, 240)
  }
  if (typeof json.error === 'string' && json.error) return json.error
  if (typeof json.message === 'string' && json.message) return json.message
  if (Array.isArray(json)) {
    const parts = json.map((item) => item?.errorMessage || item?.message || '').filter(Boolean)
    if (parts.length) return parts.join(' ')
  }
  return ''
}

export function upstreamRequest(url, { method = 'GET', headers = {}, body = null, timeout = 12000, maxBytes = 30 * 1024 * 1024 } = {}) {
  const target = typeof url === 'string' ? new URL(url) : url
  const lib = target.protocol === 'https:' ? https : http
  const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  const reqHeaders = {
    'user-agent': 'Captarr/1.0',
    accept: headers.accept || 'application/json',
    ...headers,
  }
  if (payload) {
    reqHeaders['content-type'] = headers['content-type'] || 'application/json'
    reqHeaders['content-length'] = String(payload.length)
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      reject(err)
    }
    const succeed = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const req = lib.request(target, {
      method,
      headers: reqHeaders,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          res.destroy()
          req.destroy()
          fail(new UpstreamError('The host returned a response that was too large.'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        succeed({
          status: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      })
      res.on('error', fail)
    })

    req.setTimeout(timeout, () => {
      req.destroy()
      const err = new Error('timeout')
      err.code = 'ETIMEDOUT'
      fail(err)
    })
    req.on('error', fail)
    if (payload) req.write(payload)
    req.end()
  })
}

export async function readUpstream(url, options) {
  let response
  try {
    response = await upstreamRequest(url, options)
  } catch (err) {
    if (err instanceof UpstreamError) throw err
    throw new UpstreamError(networkMessage(err))
  }

  if (REDIRECTS.has(response.status)) {
    throw new UpstreamError('The host redirected. Check the URL.', response.status)
  }

  const text = response.body.toString('utf8')
  let json = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }

  if (response.status === 401 || response.status === 403) {
    throw new UpstreamError(extractMessage(json, text) || 'API key was rejected.', response.status)
  }
  if (response.status >= 400) {
    throw new UpstreamError(extractMessage(json, text) || `The host returned ${response.status}.`, response.status)
  }
  if (json === null && text.trim().startsWith('<')) {
    throw new UpstreamError('The host returned a web page instead of API data. Check the URL.', response.status)
  }
  return { json, text, status: response.status, headers: response.headers, raw: response.body }
}

export async function sabRequest(connection, params, options = {}) {
  const url = sabApiUrl(connection.baseUrl, connection.apiKey, params)
  const result = await readUpstream(url, { timeout: options.timeout })
  const json = result.json
  if (json && typeof json.error === 'string' && json.error) throw new UpstreamError(json.error)
  if (json && json.status === false) throw new UpstreamError('SABnzbd refused the request.')
  if (!json && result.text.trim()) return { version: result.text.trim() }
  return json
}

export async function arrRequest(connection, apiPath, options = {}) {
  const url = arrUrl(connection.baseUrl, apiPath, options.query)
  const result = await readUpstream(url, {
    method: options.method || 'GET',
    headers: { 'x-api-key': connection.apiKey },
    body: options.body ?? null,
    timeout: options.timeout,
    maxBytes: options.maxBytes,
  })
  return result.json
}

export async function probe(service, connection) {
  if (service === 'sabnzbd') {
    const body = await sabRequest(connection, { mode: 'version' }, { timeout: 8000 })
    const version = typeof body?.version === 'string' ? body.version : ''
    if (!version) throw new UpstreamError('SABnzbd did not report a version. Check the URL.')
    return version
  }
  const status = await arrRequest(connection, '/api/v3/system/status', { timeout: 8000 })
  const version = status?.version || ''
  if (!version) throw new UpstreamError('The app did not report a version. Check the URL.')
  const appName = status?.appName || (service === 'sonarr' ? 'Sonarr' : 'Radarr')
  return `${appName} ${version}`.trim()
}

function imageType(body, declared) {
  const type = String(declared || '').split(';')[0].trim().toLowerCase()
  if (type.startsWith('image/')) return type
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg'
  if (body.length >= 4 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) return 'image/png'
  const head = body.subarray(0, Math.min(body.length, 12)).toString('ascii')
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (body.length >= 12 && head.startsWith('RIFF') && body.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  const text = body.subarray(0, Math.min(body.length, 240)).toString('utf8').trimStart().toLowerCase()
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'image/svg+xml'
  return ''
}

export async function fetchMedia(connection, mediaPath) {
  let current = mediaUrl(connection.baseUrl, mediaPath, connection.apiKey)
  let response
  for (let hop = 0; hop < 4; hop += 1) {
    try {
      response = await upstreamRequest(current, {
        headers: { 'x-api-key': connection.apiKey, accept: 'image/*,*/*' },
        timeout: 15000,
        maxBytes: 8 * 1024 * 1024,
      })
    } catch (err) {
      if (err instanceof UpstreamError) throw err
      throw new UpstreamError(networkMessage(err))
    }
    if (!REDIRECTS.has(response.status)) break
    const location = response.headers.location
    if (!location || hop === 3) throw new UpstreamError('Image was not found.', response.status)
    const next = new URL(location, current)
    if (next.hostname !== current.hostname) throw new UpstreamError('Image was not found.', response.status)
    if (connection.apiKey && !next.searchParams.has('apikey')) next.searchParams.set('apikey', connection.apiKey)
    current = next
  }
  if (!response || response.status !== 200) throw new UpstreamError('Image was not found.', response?.status)
  const type = imageType(response.body, response.headers['content-type'])
  if (!type) throw new UpstreamError('The host did not return an image.')
  return { type, body: response.body }
}
