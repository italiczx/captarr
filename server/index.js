import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import express from 'express'
import { mountRoutes } from './routes.js'
import { createStore } from './store.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))

export function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data')
  const store = createStore(dataDir)
  store.read()

  const app = express()
  app.disable('x-powered-by')
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: http:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    }
    next()
  })
  app.use(express.json({ limit: '1mb' }))
  mountRoutes(app, { store, version })

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' })
  })

  const dist = path.join(rootDir, 'dist')
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON.' })
      return
    }
    const status = Number(err.status) || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: status >= 500 ? 'Something went wrong.' : err.message })
  })

  return app
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  const port = Number(process.env.PORT || 8787)
  const app = createApp()
  const server = app.listen(port, '0.0.0.0', () => {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data')
    console.log(`Captarr listening on http://0.0.0.0:${port}`)
    console.log(`Data directory: ${dataDir}`)
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => process.exit(0))
    })
  }
}
