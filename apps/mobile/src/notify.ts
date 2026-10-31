// Phone notifications for board alerts: mentions, new cards, assignments.
// The worker works out the alerts on this device from boards it synced, so
// nothing about a board leaves the phone; this file decides which are new and
// posts them as local notifications (modules/opencollab-notify, Android only).
import { PermissionsAndroid, Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { OpenCollabNotify } from '../modules/opencollab-notify'
import { t } from './i18n'
import { AlertBoard, BoardAlert, alertText } from './board/model'

export const notifySupported = OpenCollabNotify !== null

// Kinds of notification the user can turn on or off, and the alert kinds each covers.
export const NOTIFY_KINDS = {
  mention: ['mention', 'chat-mention'],
  'new-card': ['new-card'],
  assigned: ['assigned'],
  comment: ['comment']
} as const
export type NotifyKind = keyof typeof NOTIFY_KINDS
const DEFAULT_KINDS: NotifyKind[] = ['mention', 'new-card', 'assigned']

// 'on' or 'off'; missing until the user was asked.
const notifyKey = 'opencollab.notify'
const kindsKey = 'opencollab.notify-kinds'
const seenKey = (identity: string) => `opencollab.notified.${identity}`

// Up to this many notifications per check; the rest are summed up in one more.
const MAX_POSTED = 4
// Alert ids remembered per board, newest first. The worker reports at most 50.
const SEEN_PER_BOARD = 80

export async function notifyChoice() {
  const value = await SecureStore.getItemAsync(notifyKey)
  return value === 'on' || value === 'off' ? value : null
}

export async function notifyKinds(): Promise<NotifyKind[]> {
  try {
    const saved = JSON.parse((await SecureStore.getItemAsync(kindsKey)) || 'null')
    if (Array.isArray(saved)) return saved.filter((kind) => kind in NOTIFY_KINDS)
  } catch {}
  return DEFAULT_KINDS
}

export const saveNotifyKinds = (kinds: NotifyKind[]) =>
  SecureStore.setItemAsync(kindsKey, JSON.stringify(kinds))

// Turns notifications on (asking Android for permission) or off. Returns
// whether they ended up on.
export async function setNotify(on: boolean) {
  if (on && Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS')
    if (result !== PermissionsAndroid.RESULTS.GRANTED) on = false
  }
  await SecureStore.setItemAsync(notifyKey, on ? 'on' : 'off')
  return on
}

// Short, stable stand-in for an alert id (FNV-1a), to keep the stored list small.
function hash(text: string) {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

type Fresh = { board: AlertBoard; alert: BoardAlert }

// Records the alerts in `boards` as seen and returns the ones that weren't.
// A board seen for the first time only sets the baseline: joining a board must
// not bring two weeks of history as notifications.
async function takeFresh(identity: string, boards: AlertBoard[]) {
  let seen: Record<string, number[]> = {}
  try {
    seen = JSON.parse((await SecureStore.getItemAsync(seenKey(identity))) || '{}') || {}
  } catch {}
  const fresh: Fresh[] = []
  for (const board of boards) {
    if (!board.checkedAt) continue
    const ids = board.alerts.map((alert) => hash(alert.id))
    const known = seen[board.key]
    if (known) {
      const set = new Set(known)
      for (const alert of board.alerts) if (!set.has(hash(alert.id))) fresh.push({ board, alert })
    }
    seen[board.key] = [...new Set([...ids, ...(known || [])])].slice(0, SEEN_PER_BOARD)
  }
  for (const key of Object.keys(seen)) {
    if (!boards.some((board) => board.key === key)) delete seen[key]
  }
  await SecureStore.setItemAsync(seenKey(identity), JSON.stringify(seen))
  return fresh
}

const shortKey = (hex: string) => (hex.length > 10 ? `${hex.slice(0, 4)}…${hex.slice(-4)}` : hex)

// Link a tapped notification opens: the board, and the card (or the chat).
export const alertLink = (board: AlertBoard, alert: BoardAlert) =>
  `opencollab://alert?board=${board.key}&card=${encodeURIComponent(alert.cardId || '')}`

// The board key and card id (empty for the chat or a summary) of an alert link.
export function parseAlertLink(url: string | null) {
  if (!url?.startsWith('opencollab://alert')) return null
  const query = new URLSearchParams(url.split('?')[1] || '')
  return { board: query.get('board') || '', card: query.get('card') || '' }
}

// Call with every boardAlerts report. Alerts the user could already see (the
// app in front) are only recorded; otherwise the new ones are posted.
export async function notifyAlerts(
  identity: string,
  boards: AlertBoard[],
  { post, blocked = [] }: { post: boolean; blocked?: string[] }
) {
  if (!identity || !notifySupported) return 0
  const fresh = await takeFresh(identity, boards)
  if (!post || !fresh.length || (await notifyChoice()) !== 'on') return 0
  const kinds = new Set<string>((await notifyKinds()).flatMap((kind) => NOTIFY_KINDS[kind]))
  const wanted = fresh
    .filter(({ alert }) => kinds.has(alert.kind))
    .filter(({ alert }) => !alert.author || !blocked.includes(alert.author))
    .sort((a, b) => a.alert.at - b.alert.at)
  const channel = t('Board activity')
  const hidden = t('New activity on your boards')
  for (const { board, alert } of wanted.slice(-MAX_POSTED)) {
    OpenCollabNotify!.post(
      hash(`${board.key}:${alert.id}`) & 0x7fffffff,
      board.name || 'OpenCollab',
      alertText(alert, shortKey),
      alertLink(board, alert),
      channel,
      hidden
    )
  }
  const more = wanted.length - MAX_POSTED
  if (more > 0) {
    OpenCollabNotify!.post(
      1,
      'OpenCollab',
      t('{count} more updates on your boards', { count: more }),
      'opencollab://alert',
      channel,
      hidden
    )
  }
  return wanted.length
}
