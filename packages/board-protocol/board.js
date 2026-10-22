// Derives the Kanban board from verified board operations. Peers see ops in
// different orders (the Autobee view is sorted by writer, not causally, and live
// broadcasts arrive whenever), so every mutable field is last-writer-wins on a
// stamp taken from the signed payload: (ts, author identity, payload JSON).
// Same ops in, same board out, on every peer.

const DEFAULT_COLUMNS = Object.freeze([
  { id: 'col:new', name: 'New', position: 'H' },
  { id: 'col:doing', name: 'In progress', position: 'V' },
  { id: 'col:done', name: 'Done', position: 'k' }
])
const DEFAULT_COLUMN = DEFAULT_COLUMNS[0].id

const LIMITS = Object.freeze({
  title: 200,
  boardName: 100,
  comment: 5000,
  body: 20000,
  columnName: 60,
  labelName: 40,
  labels: 20,
  mentions: 50,
  position: 128
})

const OP_TYPES = Object.freeze([
  'create',
  'profile',
  'vote',
  'comment',
  'card:update',
  'card:move',
  'card:archive',
  'column:upsert',
  'column:delete',
  'label:upsert',
  'label:delete',
  'board:theme'
])

// Positions are base-62 fractions compared as plain strings ("fractional
// indexing"), so a move is one op and never renumbers neighbours. A valid
// position never ends in '0', which guarantees a key always fits between two.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function isPosition(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= LIMITS.position &&
    /^[0-9A-Za-z]+$/.test(value) &&
    !value.endsWith('0')
  )
}

// A key strictly between `a` and `b`; null means the open start or end.
function positionBetween(a = null, b = null) {
  if (a !== null && !isPosition(a)) throw new Error('Invalid lower position')
  if (b !== null && !isPosition(b)) throw new Error('Invalid upper position')
  if (a !== null && b !== null && a >= b) throw new Error('Positions out of order')
  // At the open ends step one digit instead of halving, so appending a card to
  // a column (the common case) adds a character only every ~60 cards.
  if (b === null) {
    if (a === null) return 'V'
    for (let i = 0; i < a.length; i++) {
      const digit = DIGITS.indexOf(a[i])
      if (digit < DIGITS.length - 1) return a.slice(0, i) + DIGITS[digit + 1]
    }
    return a + '1'
  }
  if (a === null) {
    for (let i = 0; ; i++) {
      const digit = DIGITS.indexOf(b[i])
      if (digit > 1) return b.slice(0, i) + DIGITS[digit - 1]
      if (digit === 1 && i === b.length - 1) return b.slice(0, i) + '0z'
    }
  }
  let out = ''
  let bounded = true
  for (let i = 0; ; i++) {
    const low = i < a.length ? DIGITS.indexOf(a[i]) : 0
    const high = bounded && i < b.length ? DIGITS.indexOf(b[i]) : DIGITS.length
    if (high - low > 1) return out + DIGITS[(low + high) >> 1]
    out += DIGITS[low]
    if (high - low === 1) bounded = false
  }
}

// Position for inserting at `index` into an already sorted list of items that
// carry a `position`. Tolerates equal neighbours (concurrent inserts).
function positionAt(items, index) {
  const at = Math.max(0, Math.min(Number.isSafeInteger(index) ? index : items.length, items.length))
  const prev = at > 0 ? items[at - 1].position : null
  const next = items.slice(at).find((item) => prev === null || item.position > prev)
  return positionBetween(prev, next ? next.position : null)
}

// Posts created before Kanban have no position; order them by creation time.
function legacyPosition(object) {
  let ms = Date.parse(object?.createdAt)
  if (!Number.isFinite(ms) || ms < 0) return 'V'
  let digits = ''
  for (let i = 0; i < 8; i++) {
    digits = DIGITS[ms % 62] + digits
    ms = Math.floor(ms / 62)
  }
  return digits + 'V'
}

const isId = (value) => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,80}$/.test(value)
const isColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
const isBackground = (value) =>
  isColor(value) || (typeof value === 'string' && /^preset:[a-z0-9-]{1,32}$/.test(value))
const isIdentity = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

function isDueDate(value) {
  return (
    value === null ||
    (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)))
  )
}

const cleanTitle = (value) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, LIMITS.title) : null
const cleanBody = (value) => (typeof value === 'string' ? value.slice(0, LIMITS.body) : null)
const cleanName = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : null)
const cleanList = (value, valid, max) =>
  Array.isArray(value) ? [...new Set(value.filter(valid))].slice(0, max) : null

function stampOf(message) {
  const ts = message.payload.ts
  const legacy = !Number.isSafeInteger(ts) || ts < 0
  return {
    ts: legacy ? 0 : ts,
    legacy,
    identity: message.identity,
    tie: JSON.stringify(message.payload)
  }
}

function newer(a, b) {
  if (!b) return true
  // Ops from clients without stamps keep their old meaning: later in the log wins.
  if (a.legacy && b.legacy) return true
  if (a.ts !== b.ts) return a.ts > b.ts
  if (a.identity !== b.identity) return a.identity > b.identity
  return a.tie > b.tie
}

function assign(registers, field, value, stamp) {
  if (newer(stamp, registers[field]?.stamp)) registers[field] = { value, stamp }
}

const read = (registers, field, fallback) => (registers[field] ? registers[field].value : fallback)

function deriveBoard(messages, { images = (list) => (Array.isArray(list) ? list : []) } = {}) {
  const cards = new Map()
  const profiles = new Map()
  const columns = new Map()
  const labels = new Map()
  const theme = {}
  let maxTs = 0
  const virtual = { ts: -1, legacy: false, identity: '', tie: '' }
  for (const column of DEFAULT_COLUMNS) {
    columns.set(column.id, {
      name: { value: column.name, stamp: virtual },
      position: { value: column.position, stamp: virtual }
    })
  }

  // Creates and board-level ops first: the view isn't causal, so a vote or
  // move can come before the create of the card it targets.
  const dependent = []
  for (const message of messages) {
    const payload = message.payload
    if (!payload || !OP_TYPES.includes(payload.type)) continue
    const stamp = stampOf(message)
    maxTs = Math.max(maxTs, stamp.ts)
    if (payload.type === 'create') {
      const object = payload.object
      if (!isId(object?.id) || cards.has(object.id)) continue
      const registers = {}
      // Posts from before Kanban had no title limit; keep them whole.
      assign(registers, 'title', typeof object.title === 'string' ? object.title.trim() : '', stamp)
      assign(registers, 'body', cleanBody(object.body) ?? '', stamp)
      assign(
        registers,
        'mentions',
        cleanList(object.mentions, isIdentity, LIMITS.mentions) || [],
        stamp
      )
      assign(
        registers,
        'dueDate',
        isDueDate(object.dueDate ?? null) ? (object.dueDate ?? null) : null,
        stamp
      )
      assign(registers, 'labelIds', cleanList(object.labelIds, isId, LIMITS.labels) || [], stamp)
      assign(
        registers,
        'place',
        {
          columnId: isId(object.columnId) ? object.columnId : DEFAULT_COLUMN,
          position: isPosition(object.position) ? object.position : legacyPosition(object)
        },
        stamp
      )
      cards.set(object.id, {
        base: { ...object, images: images(object.images), author: message.identity },
        registers,
        votes: {},
        comments: new Map()
      })
    } else if (payload.type === 'profile') {
      const name = cleanName(payload.displayName, 48)
      if (!name) continue
      const registers = profiles.get(message.identity) || {}
      assign(registers, 'name', name, stamp)
      profiles.set(message.identity, registers)
    } else if (payload.type === 'column:upsert' || payload.type === 'column:delete') {
      if (!isId(payload.columnId)) continue
      const registers = columns.get(payload.columnId) || {}
      if (payload.type === 'column:delete') assign(registers, 'deleted', true, stamp)
      else {
        const name = cleanName(payload.name, LIMITS.columnName)
        if (name) assign(registers, 'name', name, stamp)
        if (isPosition(payload.position)) assign(registers, 'position', payload.position, stamp)
        if (payload.color === null || isColor(payload.color)) {
          assign(registers, 'color', payload.color, stamp)
        }
      }
      columns.set(payload.columnId, registers)
    } else if (payload.type === 'label:upsert' || payload.type === 'label:delete') {
      if (!isId(payload.labelId)) continue
      const registers = labels.get(payload.labelId) || {}
      if (payload.type === 'label:delete') assign(registers, 'deleted', true, stamp)
      else {
        const name = cleanName(payload.name, LIMITS.labelName)
        if (name !== null) assign(registers, 'name', name, stamp)
        if (isColor(payload.color)) assign(registers, 'color', payload.color, stamp)
      }
      labels.set(payload.labelId, registers)
    } else if (payload.type === 'board:theme') {
      if (payload.background === null || isBackground(payload.background)) {
        assign(theme, 'background', payload.background, stamp)
      }
      if (payload.accent === null || isColor(payload.accent)) {
        assign(theme, 'accent', payload.accent, stamp)
      }
    } else dependent.push({ message, stamp })
  }

  for (const { message, stamp } of dependent) {
    const payload = message.payload
    const card = cards.get(payload.objectId)
    if (!card) continue
    const registers = card.registers
    if (payload.type === 'vote') {
      // 0 clears the voter's vote, so votes move the score one step at a time.
      if (![1, -1, 0].includes(payload.value)) continue
      const current = card.votes[message.identity]
      if (newer(stamp, current?.stamp)) {
        card.votes[message.identity] = { value: payload.value, stamp }
      }
    } else if (payload.type === 'comment') {
      if (!payload.text?.trim() || !isId(payload.comment?.id)) continue
      if (card.comments.has(payload.comment.id)) continue
      card.comments.set(payload.comment.id, {
        ...payload.comment,
        mentions: cleanList(payload.comment.mentions, isIdentity, LIMITS.mentions) || [],
        author: message.identity
      })
    } else if (payload.type === 'card:update') {
      const title = cleanTitle(payload.title)
      if (title) assign(registers, 'title', title, stamp)
      const body = cleanBody(payload.body)
      if (body !== null) {
        assign(registers, 'body', body, stamp)
        assign(
          registers,
          'mentions',
          cleanList(payload.mentions, isIdentity, LIMITS.mentions) || [],
          stamp
        )
      }
      if (payload.dueDate !== undefined && isDueDate(payload.dueDate)) {
        assign(registers, 'dueDate', payload.dueDate, stamp)
      }
      const labelIds = cleanList(payload.labelIds, isId, LIMITS.labels)
      if (labelIds) assign(registers, 'labelIds', labelIds, stamp)
    } else if (payload.type === 'card:move') {
      if (isId(payload.columnId) && isPosition(payload.position)) {
        assign(
          registers,
          'place',
          { columnId: payload.columnId, position: payload.position },
          stamp
        )
      }
    } else if (payload.type === 'card:archive') {
      if (typeof payload.archived === 'boolean') {
        assign(registers, 'archived', payload.archived, stamp)
      }
    }
  }

  // Output key order is stable too, so peers can compare boards as JSON.
  const byKey = ([a], [b]) => (a < b ? -1 : 1)
  const byPosition = (a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1

  let liveColumns = [...columns]
    .filter(([, registers]) => !read(registers, 'deleted', false))
    .map(([id, registers]) => ({
      id,
      name: read(registers, 'name', 'Untitled'),
      position: read(registers, 'position', 'V'),
      color: read(registers, 'color', null)
    }))
    .sort(byPosition)
  // Concurrent deletes can remove every column; cards still need a home.
  if (!liveColumns.length) liveColumns = [{ ...DEFAULT_COLUMNS[0], color: null }]
  const columnIndex = new Map(liveColumns.map((column, index) => [column.id, index]))

  const liveLabels = [...labels]
    .sort(byKey)
    .filter(([, registers]) => !read(registers, 'deleted', false))
    .map(([id, registers]) => ({
      id,
      name: read(registers, 'name', ''),
      color: read(registers, 'color', null)
    }))
  const labelIds = new Set(liveLabels.map((label) => label.id))

  const objects = [...cards.values()].map((card) => {
    const registers = card.registers
    const place = read(registers, 'place')
    const votes = {}
    for (const [voter, vote] of Object.entries(card.votes).sort(byKey)) {
      if (vote.value !== 0) votes[voter] = vote.value
    }
    return {
      ...card.base,
      title: read(registers, 'title'),
      body: read(registers, 'body'),
      mentions: read(registers, 'mentions'),
      dueDate: read(registers, 'dueDate'),
      labelIds: read(registers, 'labelIds').filter((id) => labelIds.has(id)),
      // A card whose column was deleted shows in the first remaining column.
      columnId: columnIndex.has(place.columnId) ? place.columnId : liveColumns[0].id,
      position: place.position,
      archived: read(registers, 'archived', false),
      votes,
      comments: [...card.comments.values()].sort(
        (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || (a.id < b.id ? -1 : 1)
      )
    }
  })
  objects.sort(
    (a, b) => columnIndex.get(a.columnId) - columnIndex.get(b.columnId) || byPosition(a, b)
  )

  return {
    objects,
    columns: liveColumns,
    labels: liveLabels,
    theme: { background: read(theme, 'background', null), accent: read(theme, 'accent', null) },
    profiles: Object.fromEntries(
      [...profiles].sort(byKey).map(([identity, r]) => [identity, r.name.value])
    ),
    maxTs
  }
}

module.exports = {
  DEFAULT_COLUMNS,
  DEFAULT_COLUMN,
  LIMITS,
  OP_TYPES,
  deriveBoard,
  isPosition,
  positionBetween,
  positionAt
}
