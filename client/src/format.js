export function formatBytes(bytes) {
  const value = Number(bytes)
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  const digits = size >= 10 || index === 0 ? 0 : 1
  return `${size.toFixed(digits)} ${units[index]}`
}

export function formatWhen(iso) {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return ''
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatRuntime(minutes) {
  const value = Number(minutes)
  if (!value) return ''
  const hours = Math.floor(value / 60)
  const rest = value % 60
  if (!hours) return `${rest}m`
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export function formatSpeed(speed, paused) {
  if (paused) return 'Paused'
  const match = String(speed || '').trim().match(/^([\d.]+)\s*([KMG])?$/i)
  if (!match) return speed || '0 MB/s'
  const unit = (match[2] || 'K').toUpperCase()
  const label = unit === 'G' ? 'GB/s' : unit === 'M' ? 'MB/s' : 'KB/s'
  return `${match[1]} ${label}`
}

export function formatPercent(value) {
  const rounded = Math.round(Number(value) * 10) / 10
  if (!Number.isFinite(rounded)) return '0'
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function statusTone(status) {
  const value = String(status || '').toLowerCase()
  if (value.includes('fail') || value.includes('error')) return 'bad'
  if (value.includes('complete')) return 'ok'
  if (value.includes('pause')) return 'warn'
  return ''
}

export function sortTitle(title) {
  return String(title || '').toLocaleLowerCase().replace(/^(the|a|an)\s+/, '')
}
