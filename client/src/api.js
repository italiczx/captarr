export class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api(path, { method = 'GET', json, signal } = {}) {
  const response = await fetch(path, {
    method,
    signal,
    headers: json !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  })
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new ApiError('Unexpected response from the server.', response.status)
    }
  }
  if (!response.ok) {
    const error = new ApiError(data?.error || `Request failed (${response.status}).`, response.status, data?.code)
    if (response.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/me') {
      window.dispatchEvent(new Event('auth:lost'))
    }
    throw error
  }
  return data
}
