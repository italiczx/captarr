import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const SERVICE_IDS = ['sabnzbd', 'sonarr', 'radarr']
export const CONNECTION_IDS = [...SERVICE_IDS, 'plex']

export const SERVICE_LABELS = {
  sabnzbd: 'SABnzbd',
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  plex: 'Plex',
}

function emptyConnections() {
  return {
    sabnzbd: { baseUrl: '', apiKey: '' },
    sonarr: { baseUrl: '', apiKey: '' },
    radarr: { baseUrl: '', apiKey: '' },
    plex: { baseUrl: '', apiKey: '' },
  }
}

export function isConfigured(connection) {
  return Boolean(connection?.baseUrl && connection?.apiKey)
}

export function publicConnection(connection) {
  return {
    baseUrl: connection?.baseUrl || '',
    hasApiKey: Boolean(connection?.apiKey),
  }
}

export function createStore(dataDir) {
  const file = path.join(dataDir, 'config.json')

  function fresh() {
    return {
      version: 1,
      secret: randomBytes(32).toString('hex'),
      user: null,
      connections: emptyConnections(),
    }
  }

  function normalize(data) {
    if (!data || typeof data !== 'object' || typeof data.secret !== 'string' || data.secret.length < 32) {
      throw new Error(`Config file is missing its session secret: ${file}`)
    }
    if (!data.connections || typeof data.connections !== 'object') data.connections = emptyConnections()
    for (const id of CONNECTION_IDS) {
      const current = data.connections[id] || {}
      data.connections[id] = {
        baseUrl: typeof current.baseUrl === 'string' ? current.baseUrl : '',
        apiKey: typeof current.apiKey === 'string' ? current.apiKey : '',
      }
    }
    return data
  }

  function write(data) {
    fs.mkdirSync(dataDir, { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(tmp, file)
    fs.chmodSync(file, 0o600)
  }

  function read() {
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      if (err.code === 'ENOENT') {
        const created = fresh()
        write(created)
        return structuredClone(created)
      }
      if (err instanceof SyntaxError) {
        throw new Error(`Config file is not valid JSON: ${file}`)
      }
      throw err
    }
    return structuredClone(normalize(parsed))
  }

  function update(mutator) {
    const next = read()
    mutator(next)
    normalize(next)
    write(next)
    return structuredClone(next)
  }

  return { read, update, file, dataDir }
}
