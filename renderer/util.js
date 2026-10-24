// Small helpers shared by the renderer modules.

export function escape(value) {
  const div = document.createElement('div')
  div.textContent = value ?? ''
  return div.innerHTML
}

export function relativeTime(value) {
  const time = typeof value === 'number' ? value : new Date(value).getTime()
  if (!time) return ''
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(time).toLocaleDateString()
}

const pad = (n) => String(n).padStart(2, '0')

// Local calendar date, the format date-only due dates use.
export const isoDay = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—'
  const hours = ms / 3600000
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60000))}m`
  if (hours < 48) return `${Math.round(hours)}h`
  const days = hours / 24
  return `${days < 10 ? days.toFixed(1).replace(/\.0$/, '') : Math.round(days)}d`
}
