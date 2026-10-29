import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { HttpError } from './errors.js'

const scryptAsync = promisify(scrypt)
const SESSION_MS = 7 * 24 * 60 * 60 * 1000
const COOKIE = 'captarr_session'

let dummyHashPromise

function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('not-a-real-password')
  return dummyHashPromise
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await scryptAsync(password, salt, 32)
  return `scrypt$${salt}$${key.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const candidate = typeof password === 'string' && password.length <= 200 ? password : ''
  const [algo, salt, hex] = String(stored || '').split('$')
  if (algo !== 'scrypt' || !salt || !hex) return false
  const actual = await scryptAsync(candidate, salt, 32)
  const expected = Buffer.from(hex, 'hex')
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export function assertUsername(username) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9._-]{2,32}$/.test(username)) {
    throw new HttpError(400, 'Username must be 2–32 characters: letters, numbers, dot, dash, or underscore.')
  }
}

export function assertPassword(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 200) {
    throw new HttpError(400, 'Password must be at least 6 characters.')
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim())
      } catch {
        return ''
      }
    }
  }
  return ''
}

export function createAuth(store) {
  function sign(username, tokenVersion) {
    const payload = Buffer.from(JSON.stringify({
      u: username,
      v: tokenVersion,
      exp: Date.now() + SESSION_MS,
    })).toString('base64url')
    const sig = createHmac('sha256', store.read().secret).update(payload).digest('base64url')
    return `${payload}.${sig}`
  }

  function sessionUser(req) {
    const raw = readCookie(req, COOKIE)
    const dot = raw.lastIndexOf('.')
    if (dot <= 0) return null
    const payload = raw.slice(0, dot)
    const sig = raw.slice(dot + 1)
    const expected = createHmac('sha256', store.read().secret).update(payload).digest('base64url')
    const left = Buffer.from(sig)
    const right = Buffer.from(expected)
    if (left.length !== right.length || !timingSafeEqual(left, right)) return null
    let data
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    } catch {
      return null
    }
    if (!data?.u || !data.exp || data.exp < Date.now()) return null
    const user = store.read().user
    if (!user || user.username.toLowerCase() !== String(data.u).toLowerCase()) return null
    if (user.tokenVersion !== data.v) return null
    return { username: user.username }
  }

  function setCookie(res, value, maxAge) {
    const parts = [
      `${COOKIE}=${value}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${maxAge}`,
    ]
    if (process.env.COOKIE_SECURE === '1') parts.push('Secure')
    res.setHeader('Set-Cookie', parts.join('; '))
  }

  return {
    sessionUser,
    establish(res, user) {
      setCookie(res, sign(user.username, user.tokenVersion), Math.floor(SESSION_MS / 1000))
    },
    clear(res) {
      setCookie(res, '', 0)
    },
    async authenticate(username, password) {
      const user = store.read().user
      const hash = user?.passwordHash || await dummyHash()
      const matches = await verifyPassword(password, hash)
      if (!user || user.username.toLowerCase() !== String(username || '').toLowerCase() || !matches) {
        throw new HttpError(401, 'Wrong username or password.')
      }
      return user
    },
  }
}
