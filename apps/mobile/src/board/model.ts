// Board data as the worker sends it, and the small pure helpers the screens
// share. The rules match the desktop renderer so both clients show a board the
// same way.
import type { ImageRef } from '../ui'
import { language, locale, plural, t, tx } from '../i18n'

export type Reactions = Record<string, string[]>
export type BoardComment = {
  id: string
  author: string
  text: string
  createdAt?: string
  mentions?: string[]
  reactions?: Reactions
}
export type ChecklistItem = { id: string; text: string; done: boolean; position: string }
export type CardLink = { cardId: string; kind: 'blocks' | 'relates' }
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
  // Older workers leave these out, so every reader falls back to empty.
  checklist?: ChecklistItem[]
  assignees?: string[]
  points?: number | null
  estimates?: Record<string, number>
  revealEstimates?: boolean
  template?: boolean
  links?: CardLink[]
  blockedBy?: string[]
  reactions?: Reactions
  updatedAt?: number
  // Where it came from, e.g. a shared post ("View original").
  source?: CardSource | null
}
export type CardSource = { url: string; site: string | null; title: string | null }
export type Column = {
  id: string
  name: string
  position: string
  color: string | null
  wipLimit?: number | null
}
export type Label = { id: string; name: string; color: string | null }
export type Theme = {
  background: string | null
  accent: string | null
  template?: string | null
  backgroundImage?: ImageRef | null
}
export type BoardInfo = { description: string; icon?: ImageRef | null; kind?: string }
export type MemberRole = 'owner' | 'admin' | 'member'
export const avatarOf = (data: BoardData, identity: string) =>
  data.members.find((member) => member.identity === identity)?.avatar || null

export type Member = {
  identity: string
  name: string | null
  avatar: ImageRef | null
  role: MemberRole
  banned: boolean
  bannedBy: string | null
}
export type BoardAlert = {
  id: string
  kind:
    | 'mention'
    | 'assigned'
    | 'comment'
    | 'moved'
    | 'edited'
    | 'new-card'
    | 'due-soon'
    | 'overdue'
    | 'chat-mention'
  // null for chat mentions: they open the board chat, not a card.
  cardId: string | null
  cardTitle: string
  author: string | null
  authorName: string | null
  at: number
  where?: 'description' | 'comment'
  text?: string
  column?: string | null
  due?: string
}
// A card assigned to me, as the worker lists it per joined board.
export type MyCard = {
  id: string
  title: string
  dueDate: string | null
  columnId: string
  columnName: string
  blocked: boolean
  checklist: { done: number; total: number }
}
export type AlertBoard = {
  key: string
  invite: string
  name: string
  alerts: BoardAlert[]
  mine?: MyCard[]
  checkedAt: number
}
export type RuleTrigger =
  | { kind: 'enter'; columnId: string }
  | { kind: 'create'; columnId: string | null }
  | { kind: 'schedule'; every: 'day' | 'week' | 'month'; columnId: string | null }
export type RuleActions = {
  labelIds: string[]
  assignees: string[]
  assignActor: boolean
  dueInDays: number | null
  completeChecklist: boolean
  archive: boolean
}
export type BoardRule = {
  id: string
  name: string
  enabled: boolean
  trigger: RuleTrigger
  actions: RuleActions
  card?: { title: string; body: string; checklist: string[] }
}
// Other members connected to the board right now.
export type PresencePeer = {
  identity: string
  name: string | null
  cardId: string | null
  typing: boolean
  // What a bot is busy with ("Making key points"), shown live.
  status?: string | null
  at: number
}
export type ActivityEntry = {
  id: string
  kind: string
  detail: string
  cardId: string
  cardTitle: string
  author: string
  authorName: string | null
  at: number
}
export type BoardStats = {
  doneColumnId: string | null
  weeks: Array<{ start: number; done: number; created: number; points: number }>
  cycleTime: { median: number | null; p85: number | null; count: number }
  columns: Array<{
    id: string
    name: string
    count: number
    points: number
    wipLimit: number | null
  }>
  members: Array<{ identity: string; name: string | null; open: number; doneThisWeek: number }>
  totals: {
    open: number
    done: number
    archived: number
    overdue: number
    blocked: number
    pointsOpen: number
    pointsDone: number
  }
}
export type ChatMessage = {
  id: string
  author: string
  text: string
  createdAt: string
  mentions?: string[]
}
export type BoardData = {
  objects: Card[]
  chat?: ChatMessage[]
  columns: Column[]
  labels: Label[]
  theme: Theme
  info: BoardInfo
  profiles: Record<string, string>
  owner: string | null
  members: Member[]
  rules?: BoardRule[]
}
export type Filters = {
  labels: string[]
  member: string
  assignee: string
  due: '' | 'overdue' | 'week' | 'none'
}
export const NO_FILTERS: Filters = { labels: [], member: '', assignee: '', due: '' }

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
// Names are getters so they follow a language change.
export const BACKGROUNDS: Record<string, { name: string; color: string }> = {
  'preset:ocean': {
    get name() {
      return t('Ocean')
    },
    color: '#203a43'
  },
  'preset:dusk': {
    get name() {
      return t('Dusk')
    },
    color: '#4b3b8f'
  },
  'preset:forest': {
    get name() {
      return t('Forest')
    },
    color: '#135c44'
  },
  'preset:sunset': {
    get name() {
      return t('Sunset')
    },
    color: '#734b6d'
  },
  'preset:ember': {
    get name() {
      return t('Ember')
    },
    color: '#5c2318'
  },
  'preset:slate': {
    get name() {
      return t('Slate')
    },
    color: '#323f4b'
  }
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
  const date = deadline.toLocaleDateString(locale(), {
    month: 'short',
    day: 'numeric',
    ...(deadline.getFullYear() !== new Date().getFullYear() && { year: 'numeric' })
  })
  const time = deadline.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
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
  if (filters.assignee && !card.assignees?.includes(filters.assignee)) return false
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
  filters.labels.length +
  (filters.member ? 1 : 0) +
  (filters.assignee ? 1 : 0) +
  (filters.due ? 1 : 0)

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

export function kindLabel(kind: BoardAlert['kind']) {
  switch (kind) {
    case 'mention':
      return t('Mention')
    case 'assigned':
      return t('Assigned')
    case 'comment':
      return tx('activity', 'Comment')
    case 'moved':
      return t('Moved')
    case 'edited':
      return t('Edited')
    case 'new-card':
      return t('New card')
    case 'due-soon':
      return t('Due soon')
    case 'overdue':
      return t('Overdue')
    case 'chat-mention':
      return tx('alert', 'Chat')
  }
}

export function alertText(alert: BoardAlert, shortKey: (hex: string) => string) {
  const who = alert.authorName || shortKey(alert.author || '')
  const card = `“${alert.cardTitle}”`
  const due = alert.due ? dueInfo(alert.due)?.text || alert.due : ''
  switch (alert.kind) {
    case 'mention':
      return alert.where === 'comment'
        ? t('{who} mentioned you in a comment on {card}', { who, card })
        : t('{who} mentioned you on {card}', { who, card })
    case 'chat-mention':
      return t('{who} mentioned you in the board chat', { who })
    case 'assigned':
      return t('{who} assigned you to {card}', { who, card })
    case 'comment':
      return t('{who} commented on {card}', { who, card })
    case 'moved':
      return alert.column
        ? t('{who} moved {card} to {column}', { who, card, column: alert.column })
        : t('{who} moved {card}', { who, card })
    case 'edited':
      return t('{who} edited {card}', { who, card })
    case 'new-card':
      return t('{who} added {card}', { who, card })
    case 'due-soon':
      return t('{card} is due {due}', { card, due })
    case 'overdue':
      return t('{card} is overdue ({due})', { card, due })
  }
}

// Cards hold images and videos in one list. Videos are fetched as files and
// played, never shown as a cover or requested as an image.
export const isVideo = (ref: ImageRef) => ref.type.startsWith('video/')
// The source's site name, or the link's host when the page had none.
export const sourceSite = (source: CardSource) =>
  source.site || source.url.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i)?.[1] || source.url

export const imagesOf = (card: Card) => (card.images || []).filter((ref) => !isVideo(ref))
export const videosOf = (card: Card) => (card.images || []).filter(isVideo)

// What the given identity may do to members of the board. A banned member
// can still read the board but nothing it signs counts, so it may do nothing.
export function memberPowers(data: BoardData, me: string) {
  const self = data.members.find((member) => member.identity === me)
  const role: MemberRole | null = self?.role || (data.owner === me ? 'owner' : null)
  const active = !!role && !self?.banned
  return {
    role,
    banned: !!self?.banned,
    canChangeRoles: active && role === 'owner',
    canBan: (target: Member) =>
      active &&
      role !== 'member' &&
      target.identity !== me &&
      target.role !== 'owner' &&
      !(role === 'admin' && target.role === 'admin')
  }
}

// Blocking is local to this device: a blocked member's comments and the
// notifications they cause are hidden here. Nothing is sent to the board.
export function hideBlocked(data: BoardData, blocked: string[]): BoardData {
  if (!blocked.length) return data
  return {
    ...data,
    objects: data.objects.map((card) =>
      card.comments?.some((comment) => blocked.includes(comment.author))
        ? { ...card, comments: card.comments.filter((c) => !blocked.includes(c.author)) }
        : card
    )
  }
}

export function hideBlockedAlerts(boards: AlertBoard[], blocked: string[]): AlertBoard[] {
  if (!blocked.length) return boards
  return boards.map((board) => ({
    ...board,
    alerts: board.alerts.filter((alert) => !alert.author || !blocked.includes(alert.author))
  }))
}

export const newLabelId = () =>
  `label:${Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`

// The last column is the board's "Done": moving a card there celebrates, and
// its cards neither age nor count as open.
export const doneColumnOf = (data: BoardData) => data.columns[data.columns.length - 1]?.id || null

// Cards shown in columns, counts and pickers; templates live in their own list.
export const isTemplate = (card: Card) => !!card.template
export const templatesOf = (data: BoardData) =>
  data.objects.filter((card) => card.template && !card.archived)

export const checklistOf = (card: Card) => card.checklist || []
export function checklistProgress(card: Card) {
  const items = checklistOf(card)
  return { done: items.filter((item) => item.done).length, total: items.length }
}

// Columns count the cards they show: not archived, not templates.
export const columnCards = (data: BoardData, columnId: string) =>
  data.objects.filter((card) => card.columnId === columnId && !card.archived && !card.template)
export const pointsOf = (cards: Card[]) =>
  cards.reduce((sum, card) => sum + (typeof card.points === 'number' ? card.points : 0), 0)

// 'over' only once the column holds more than its limit; 'full' at the limit.
export function wipState(count: number, limit: number | null | undefined) {
  if (!limit) return ''
  return count > limit ? 'over' : count === limit ? 'full' : ''
}

const DAY = 24 * 3600 * 1000
// Cards nobody touched for a week fade a little, after two weeks more.
export function ageOf(card: Card, now = Date.now()) {
  if (!card.updatedAt) return ''
  const idle = now - card.updatedAt
  return idle >= 14 * DAY ? 'old' : idle >= 7 * DAY ? 'stale' : ''
}
export const idleDays = (card: Card, now = Date.now()) =>
  card.updatedAt ? Math.floor((now - card.updatedAt) / DAY) : 0

export function timeAgo(at: number, now = Date.now()) {
  const seconds = Math.max(0, (now - at) / 1000)
  if (seconds < 60) return t('just now')
  if (seconds < 3600) return t('{n}m ago', { n: Math.floor(seconds / 60) })
  if (seconds < 86400) return t('{n}h ago', { n: Math.floor(seconds / 3600) })
  if (seconds < 30 * 86400) {
    return plural(
      Math.floor(seconds / 86400),
      ['{n}d ago', '{n}d ago'],
      ['{n} dzień temu', '{n} dni temu', '{n} dni temu']
    )
  }
  return new Date(at).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })
}

export const formatDuration = (ms: number | null) => {
  if (ms === null) return '–'
  const hours = ms / 3600000
  if (hours < 1) return t('{n}m', { n: Math.max(1, Math.round(ms / 60000)) })
  if (hours < 24) return t('{n}h', { n: Math.round(hours) })
  const days = hours / 24
  const shown = days < 10 ? days.toFixed(1).replace(/\.0$/, '') : String(Math.round(days))
  return t('{n}d', { n: language() === 'pl' ? shown.replace('.', ',') : shown })
}

// Links point one way; the other side of each comes from the other cards.
export type ShownLink = { card: Card; kind: 'blocks' | 'relates'; outgoing: boolean }
export function linksOf(data: BoardData, card: Card): ShownLink[] {
  const byId = new Map(data.objects.map((entry) => [entry.id, entry]))
  const outgoing = (card.links || []).flatMap((link) => {
    const target = byId.get(link.cardId)
    return target ? [{ card: target, kind: link.kind, outgoing: true }] : []
  })
  const incoming = data.objects.flatMap((other) =>
    other.id === card.id
      ? []
      : (other.links || [])
          .filter((link) => link.cardId === card.id)
          .map((link) => ({ card: other, kind: link.kind, outgoing: false }))
  )
  return [...outgoing, ...incoming]
}
export const linkText = (link: ShownLink) =>
  link.kind === 'relates' ? t('Relates to') : link.outgoing ? t('Blocks') : t('Blocked by')

// Planning poker. "?" withdraws the vote: the protocol keeps numbers only.
export const POKER_VALUES = [0, 1, 2, 3, 5, 8, 13, 21]

// Agenda groups by due date, local time, soonest first inside each group.
export const AGENDA_GROUPS = ['Overdue', 'Today', 'This week', 'Later', 'No date'] as const
export type AgendaGroup = (typeof AGENDA_GROUPS)[number]
export function agendaGroup(card: Card, now = new Date()): AgendaGroup {
  const due = dueInfo(card.dueDate)
  if (!due) return 'No date'
  if (due.status === 'overdue') return 'Overdue'
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  if (due.deadline <= endOfToday) return 'Today'
  return due.deadline.getTime() - endOfToday.getTime() <= 6 * DAY ? 'This week' : 'Later'
}
export function agenda(cards: Card[], now = new Date()) {
  const groups = new Map<AgendaGroup, Card[]>(AGENDA_GROUPS.map((name) => [name, []]))
  for (const card of cards) groups.get(agendaGroup(card, now))?.push(card)
  const time = (card: Card) => dueInfo(card.dueDate)?.deadline.getTime() ?? 0
  for (const list of groups.values()) list.sort((a, b) => time(a) - time(b))
  return AGENDA_GROUPS.map((name) => ({ name, cards: groups.get(name) || [] }))
}

export const requestId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

// Members who can be assigned: everyone not banned, the viewer included.
export function assignable(data: BoardData, me: string) {
  const members = data.members.filter((member) => !member.banned)
  if (me && !members.some((member) => member.identity === me)) {
    return [
      {
        identity: me,
        name: data.profiles[me] || null,
        avatar: null,
        role: 'member' as MemberRole,
        banned: false,
        bannedBy: null
      },
      ...members
    ]
  }
  return members
}
