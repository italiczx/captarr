export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class UpstreamError extends HttpError {
  constructor(message, upstreamStatus) {
    super(502, message, 'upstream')
    this.upstreamStatus = upstreamStatus
  }
}
