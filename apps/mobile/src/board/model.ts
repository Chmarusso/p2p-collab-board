// Board data as the worker sends it, and the small pure helpers the screens
// share. The rules match the desktop renderer so both clients show a board the
// same way.
import type { ImageRef } from '../ui'

export type BoardComment = {
  id: string
  author: string
  text: string
  createdAt?: string
  mentions?: string[]
}
export type Card = {
  id: string
  title: string
  body: string
  author: string
  createdAt?: string
  images?: ImageRef[]
  votes: Record<string, number>
  comments: BoardComment[]
  columnId: string
  position: string
  labelIds: string[]
  dueDate: string | null
  mentions: string[]
  archived: boolean
}
export type Column = { id: string; name: string; position: string; color: string | null }
export type Label = { id: string; name: string; color: string | null }
export type Theme = { background: string | null; accent: string | null }
export type BoardInfo = { description: string }
export type BoardAlert = {
  id: string
  kind: 'mention' | 'comment' | 'moved' | 'edited' | 'new-card' | 'due-soon' | 'overdue'
  cardId: string
  cardTitle: string
  author: string | null
  authorName: string | null
  at: number
  where?: 'description' | 'comment'
  text?: string
  column?: string | null
  due?: string
}
export type AlertBoard = {
  key: string
  invite: string
  name: string
  alerts: BoardAlert[]
  checkedAt: number
}
export type BoardData = {
  objects: Card[]
  columns: Column[]
  labels: Label[]
  theme: Theme
  info: BoardInfo
  profiles: Record<string, string>
}
export type Filters = { labels: string[]; member: string; due: '' | 'overdue' | 'week' | 'none' }

// Trello's label palette, the same as on desktop.
export const LABEL_COLORS = [
  '#4bce97',
  '#f5cd47',
  '#fea362',
  '#f87168',
  '#9f8fef',
  '#579dff',
  '#6cc3e0',
  '#94c748',
  '#e774bb',
  '#8590a2'
]
// Desktop draws these presets as gradients; React Native has no CSS gradients,
// so each shows as its middle color.
export const BACKGROUNDS: Record<string, { name: string; color: string }> = {
  'preset:ocean': { name: 'Ocean', color: '#203a43' },
  'preset:dusk': { name: 'Dusk', color: '#4b3b8f' },
  'preset:forest': { name: 'Forest', color: '#135c44' },
  'preset:sunset': { name: 'Sunset', color: '#734b6d' },
  'preset:ember': { name: 'Ember', color: '#5c2318' },
  'preset:slate': { name: 'Slate', color: '#323f4b' }
}
export const ACCENTS = ['#39ff88', '#22d3ee', '#579dff', '#9f8fef', '#e774bb', '#fea362', '#f5cd47']
export const COMMENTS_SHOWN = 10
export const MAX_LABELS_ON_CARD = 4

export function luminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

export const inkOn = (hex: string) => (luminance(hex) > 0.4 ? '#04110a' : '#ffffff')

export function backgroundColor(theme: Theme) {
  const value = theme.background
  if (!value) return null
  return BACKGROUNDS[value]?.color || (value.startsWith('#') ? value : null)
}

// Date-only due dates are due at the end of that day, local time.
export function dueInfo(dueDate: string | null | undefined) {
  if (!dueDate) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
  const [year, month, day] = dueDate.split('-').map(Number)
  const deadline = dateOnly ? new Date(year, month - 1, day, 23, 59, 59) : new Date(dueDate)
  if (Number.isNaN(deadline.getTime())) return null
  const left = deadline.getTime() - Date.now()
  // The year shows when it isn't this one, or a date two years late reads as recent.
  const date = deadline.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(deadline.getFullYear() !== new Date().getFullYear() && { year: 'numeric' })
  })
  const time = deadline.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return {
    deadline,
    dateOnly,
    status: left < 0 ? 'overdue' : left < 24 * 3600 * 1000 ? 'soon' : '',
    text: dateOnly ? date : `${date}, ${time}`
  } as const
}

export const pad = (n: number) => String(n).padStart(2, '0')
export const dayString = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const scoreOf = (card: Card) =>
  Object.values(card.votes || {}).reduce((sum, value) => sum + value, 0)

export function matchesFilters(card: Card, filters: Filters) {
  if (filters.labels.length && !card.labelIds?.some((id) => filters.labels.includes(id))) {
    return false
  }
  if (
    filters.member &&
    !card.mentions?.includes(filters.member) &&
    !card.comments?.some((comment) => comment.mentions?.includes(filters.member))
  ) {
    return false
  }
  if (filters.due) {
    const due = dueInfo(card.dueDate)
    if (filters.due === 'none') return !due
    if (!due) return false
    if (filters.due === 'overdue') return due.status === 'overdue'
    const left = due.deadline.getTime() - Date.now()
    return left >= 0 && left <= 7 * 24 * 3600 * 1000
  }
  return true
}

export const filterCount = (filters: Filters) =>
  filters.labels.length + (filters.member ? 1 : 0) + (filters.due ? 1 : 0)

// The worker places a card by index among all cards of the column, archived
// and filtered-out ones included; the UI counts only the cards it shows.
export function workerIndex(all: Card[], visible: Card[], cardId: string, visibleIndex: number) {
  const others = all.filter((card) => card.id !== cardId)
  const shown = visible.filter((card) => card.id !== cardId)
  if (visibleIndex <= 0) return shown.length ? others.indexOf(shown[0]) : others.length
  return others.indexOf(shown[Math.min(visibleIndex, shown.length) - 1]) + 1
}

// Identity keys of the members whose `@Name` appears in `text`. Longest names
// match first and are blanked out, so "@Ann Lee" doesn't also mention "Ann".
export function findMentions(text: string, profiles: Record<string, string>) {
  const found = new Set<string>()
  let rest = text || ''
  const members = Object.entries(profiles).sort((a, b) => b[1].length - a[1].length)
  for (const [identity, name] of members) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|[^\\w])@${escaped}(?![\\w])`, 'g')
    if (!pattern.test(rest)) continue
    found.add(identity)
    rest = rest.replace(pattern, '$1 ')
  }
  return [...found]
}

export const KIND_LABELS: Record<BoardAlert['kind'], string> = {
  mention: 'Mention',
  comment: 'Comment',
  moved: 'Moved',
  edited: 'Edited',
  'new-card': 'New card',
  'due-soon': 'Due soon',
  overdue: 'Overdue'
}

export function alertText(alert: BoardAlert, shortKey: (hex: string) => string) {
  const who = alert.authorName || shortKey(alert.author || '')
  const card = `“${alert.cardTitle}”`
  const due = alert.due ? dueInfo(alert.due)?.text || alert.due : ''
  switch (alert.kind) {
    case 'mention':
      return `${who} mentioned you ${alert.where === 'comment' ? 'in a comment on' : 'on'} ${card}`
    case 'comment':
      return `${who} commented on ${card}`
    case 'moved':
      return `${who} moved ${card}${alert.column ? ` to ${alert.column}` : ''}`
    case 'edited':
      return `${who} edited ${card}`
    case 'new-card':
      return `${who} added ${card}`
    case 'due-soon':
      return `${card} is due ${due}`
    case 'overdue':
      return `${card} is overdue (${due})`
  }
}

export const newLabelId = () =>
  `label:${Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
