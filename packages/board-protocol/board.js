// Derives the Kanban board from verified board operations. Peers see ops in
// different orders (the Autobee view is sorted by writer, not causally, and live
// broadcasts arrive whenever), so every mutable field is last-writer-wins on a
// stamp taken from the signed payload: (ts, author identity, payload JSON).
// Same ops in, same board out, on every peer.
const { isTemplateId } = require('./themes')
const { isBoardKind, DEFAULT_BOARD_KIND } = require('./kinds')

const DEFAULT_COLUMNS = Object.freeze([
  { id: 'col:new', name: 'New', position: 'H' },
  { id: 'col:doing', name: 'In progress', position: 'V' },
  { id: 'col:done', name: 'Done', position: 'k' }
])
const DEFAULT_COLUMN = DEFAULT_COLUMNS[0].id

const LIMITS = Object.freeze({
  title: 200,
  boardName: 100,
  description: 2000,
  images: 12,
  comment: 5000,
  body: 20000,
  columnName: 60,
  labelName: 40,
  labels: 20,
  mentions: 50,
  position: 128,
  banKeep: 5000,
  checklist: 100,
  checklistText: 300,
  assignees: 20,
  links: 50,
  rules: 50,
  ruleName: 80,
  wipLimit: 999,
  points: 1000
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
  'board:theme',
  'board:info',
  'card:image',
  'board:claim',
  'member:role',
  'member:ban',
  'card:checklist',
  'reaction',
  'card:link',
  'estimate',
  'rule:upsert',
  'rule:delete'
])

const ROLES = Object.freeze(['admin', 'member'])
// A fixed set, so a reaction is a short known string and every host can draw it.
const REACTIONS = Object.freeze(['👍', '❤️', '🎉', '😂', '😮', '🚀', '👀', '🔥'])
const LINK_KINDS = Object.freeze(['blocks', 'relates'])
const RULE_EVERY = Object.freeze(['day', 'week', 'month'])

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

const isPoints = (value) =>
  value === null || (typeof value === 'number' && value >= 0 && value <= LIMITS.points)
const isWipLimit = (value) =>
  value === null || (Number.isInteger(value) && value > 0 && value <= LIMITS.wipLimit)
const isDays = (value) => Number.isInteger(value) && value >= 0 && value <= 365

// Automation rules. A rule fires on a card entering a column, on a card being
// created, or on a schedule. Rules are only data here: the member whose action
// triggers a rule signs its effects (workers/main.js), and scheduled cards get
// a deterministic id so several members creating the same one converge.
function cleanRule(value) {
  if (!value || typeof value !== 'object') return null
  const trigger = value.trigger
  const kind = trigger?.kind
  const columnId = isId(trigger?.columnId) ? trigger.columnId : null
  let cleanTrigger
  if (kind === 'enter' && columnId) cleanTrigger = { kind, columnId }
  else if (kind === 'create') cleanTrigger = { kind, columnId }
  else if (kind === 'schedule' && RULE_EVERY.includes(trigger.every)) {
    cleanTrigger = { kind, every: trigger.every, columnId }
  } else return null
  const actions = value.actions && typeof value.actions === 'object' ? value.actions : {}
  const clean = {
    name: cleanName(value.name, LIMITS.ruleName) || '',
    enabled: value.enabled !== false,
    trigger: cleanTrigger,
    actions: {
      labelIds: cleanList(actions.labelIds, isId, LIMITS.labels) || [],
      assignees: cleanList(actions.assignees, isIdentity, LIMITS.assignees) || [],
      assignActor: actions.assignActor === true,
      dueInDays: isDays(actions.dueInDays) ? actions.dueInDays : null,
      completeChecklist: actions.completeChecklist === true,
      archive: actions.archive === true
    }
  }
  if (kind === 'schedule') {
    const title = cleanTitle(value.card?.title)
    if (!title) return null
    clean.card = {
      title,
      body: cleanBody(value.card?.body) ?? '',
      checklist: (Array.isArray(value.card?.checklist) ? value.card.checklist : [])
        .map((text) => cleanName(text, LIMITS.checklistText))
        .filter(Boolean)
        .slice(0, LIMITS.checklist)
    }
  }
  return clean
}

// Stable sort key for a stamp; the earliest create of a duplicated card id wins.
const stampKey = (stamp) => [String(stamp.ts).padStart(16, '0'), stamp.identity, stamp.tie]
function earlier(a, b) {
  const x = stampKey(a)
  const y = stampKey(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

const imageKey = (ref) => JSON.stringify([ref?.core, ref?.id?.blockOffset, ref?.id?.blockLength])

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

// Moderation. The owner is the board's creator, worked out by the host from the
// log (see workers/main.js) and passed in. Only the owner grants roles; the
// owner and admins ban, and an admin can't ban the owner or another admin. A
// ban lists the op ids of the banned member it keeps: everything else they
// sign is ignored, including ops backdated to before the ban.
function moderate(messages, owner) {
  const roles = new Map()
  for (const message of messages) {
    const payload = message.payload
    if (payload?.type !== 'member:role' || !owner || message.identity !== owner) continue
    if (!isIdentity(payload.identity) || payload.identity === owner) continue
    if (!ROLES.includes(payload.role)) continue
    const registers = roles.get(payload.identity) || {}
    assign(registers, 'role', payload.role, stampOf(message))
    roles.set(payload.identity, registers)
  }
  const roleOf = (identity) =>
    identity && identity === owner
      ? 'owner'
      : roles.has(identity)
        ? read(roles.get(identity), 'role')
        : 'member'

  // Two rounds: an admin banned in the first loses the bans they signed
  // after it in the second.
  let bans = new Map()
  for (let round = 0; round < 2; round++) {
    const previous = bans
    bans = new Map()
    for (const message of messages) {
      const payload = message.payload
      if (payload?.type !== 'member:ban' || !isIdentity(payload.identity)) continue
      if (typeof payload.banned !== 'boolean') continue
      if (!visible(previous, message)) continue
      const by = roleOf(message.identity)
      const target = roleOf(payload.identity)
      if (by === 'member' || target === 'owner') continue
      if (by === 'admin' && target === 'admin') continue
      const keep = Array.isArray(payload.keep)
        ? payload.keep.filter((id) => typeof id === 'string').slice(0, LIMITS.banKeep)
        : []
      const registers = bans.get(payload.identity) || {}
      assign(
        registers,
        'ban',
        { banned: payload.banned, keep, by: message.identity },
        stampOf(message)
      )
      bans.set(payload.identity, registers)
    }
  }
  return { roles, roleOf, bans }
}

function visible(bans, message) {
  const ban = bans.has(message.identity) ? read(bans.get(message.identity), 'ban') : null
  return !ban?.banned || ban.keep.includes(message.id)
}

function deriveBoard(
  allMessages,
  { images = (list) => (Array.isArray(list) ? list : []), owner = null } = {}
) {
  const moderation = moderate(allMessages, isIdentity(owner) ? owner : null)
  const messages = allMessages.filter((message) => visible(moderation.bans, message))
  const isStill = (ref) => typeof ref?.type === 'string' && ref.type.startsWith('image/')
  const imageRef = (value) => {
    if (value === null) return null
    const [ref] = images([value])
    return isStill(ref) ? ref : undefined
  }
  const cards = new Map()
  const profiles = new Map()
  const columns = new Map()
  const labels = new Map()
  const rules = new Map()
  const theme = {}
  const info = {}
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
      if (!isId(object?.id)) continue
      // Scheduled cards share an id on purpose; keep the same one everywhere.
      const existing = cards.get(object.id)
      if (existing && !earlier(stamp, existing.stamp)) continue
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
        'assignees',
        cleanList(object.assignees, isIdentity, LIMITS.assignees) || [],
        stamp
      )
      assign(
        registers,
        'points',
        isPoints(object.points ?? null) ? (object.points ?? null) : null,
        stamp
      )
      assign(registers, 'template', object.template === true, stamp)
      // A card can start with checklist items (templates, scheduled cards).
      const checklist = new Map()
      let itemPosition = null
      for (const item of Array.isArray(object.checklist) ? object.checklist : []) {
        const text = cleanName(item?.text, LIMITS.checklistText)
        if (!isId(item?.id) || !text || checklist.has(item.id)) continue
        if (checklist.size >= LIMITS.checklist) break
        itemPosition = positionBetween(itemPosition, null)
        const entry = {}
        assign(entry, 'text', text, stamp)
        assign(entry, 'done', item.done === true, stamp)
        assign(entry, 'position', itemPosition, stamp)
        checklist.set(item.id, entry)
      }
      assign(
        registers,
        'place',
        {
          columnId: isId(object.columnId) ? object.columnId : DEFAULT_COLUMN,
          position: isPosition(object.position) ? object.position : legacyPosition(object)
        },
        stamp
      )
      const { checklist: _items, assignees: _assignees, points: _points, ...base } = object
      cards.set(object.id, {
        base: { ...base, images: images(object.images), author: message.identity },
        stamp,
        registers,
        votes: {},
        comments: new Map(),
        added: new Map(),
        checklist,
        reactions: new Map(),
        links: new Map(),
        estimates: new Map(),
        touched: stamp.ts || Date.parse(object.createdAt) || 0
      })
    } else if (payload.type === 'profile') {
      // A profile op sets the name, the avatar (null clears it), or both.
      const name = cleanName(payload.displayName, 48)
      const avatar = payload.avatar === undefined ? undefined : imageRef(payload.avatar)
      if (!name && avatar === undefined) continue
      const registers = profiles.get(message.identity) || {}
      if (name) assign(registers, 'name', name, stamp)
      if (avatar !== undefined) assign(registers, 'avatar', avatar, stamp)
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
        if (payload.wipLimit !== undefined && isWipLimit(payload.wipLimit)) {
          assign(registers, 'wipLimit', payload.wipLimit, stamp)
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
    } else if (payload.type === 'rule:upsert' || payload.type === 'rule:delete') {
      if (!isId(payload.ruleId)) continue
      const registers = rules.get(payload.ruleId) || {}
      if (payload.type === 'rule:delete') assign(registers, 'deleted', true, stamp)
      else {
        const rule = cleanRule(payload.rule)
        if (rule) {
          assign(registers, 'rule', rule, stamp)
          // Rules list in the order they were first made.
          if (!registers.first || earlier(stamp, registers.first)) registers.first = stamp
        }
      }
      rules.set(payload.ruleId, registers)
    } else if (payload.type === 'board:info') {
      if (typeof payload.description === 'string') {
        assign(info, 'description', payload.description.slice(0, LIMITS.description), stamp)
      }
      const icon = payload.icon === undefined ? undefined : imageRef(payload.icon)
      if (icon !== undefined) assign(info, 'icon', icon, stamp)
      // Only the owner picks the board's type.
      if (isBoardKind(payload.kind) && owner && message.identity === owner) {
        assign(info, 'kind', payload.kind, stamp)
      }
    } else if (payload.type === 'board:theme') {
      if (payload.background === null || isBackground(payload.background)) {
        assign(theme, 'background', payload.background, stamp)
      }
      if (payload.accent === null || isColor(payload.accent)) {
        assign(theme, 'accent', payload.accent, stamp)
      }
      if (payload.template === null || isTemplateId(payload.template)) {
        assign(theme, 'template', payload.template, stamp)
      }
      const backgroundImage =
        payload.backgroundImage === undefined ? undefined : imageRef(payload.backgroundImage)
      if (backgroundImage !== undefined) assign(theme, 'backgroundImage', backgroundImage, stamp)
    } else dependent.push({ message, stamp })
  }

  for (const { message, stamp } of dependent) {
    const payload = message.payload
    const card = cards.get(payload.objectId)
    if (!card) continue
    const registers = card.registers
    if (payload.type !== 'reaction' && payload.type !== 'estimate') {
      card.touched = Math.max(card.touched, stamp.ts)
    }
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
      const assignees = cleanList(payload.assignees, isIdentity, LIMITS.assignees)
      if (assignees) assign(registers, 'assignees', assignees, stamp)
      if (payload.points !== undefined && isPoints(payload.points)) {
        assign(registers, 'points', payload.points, stamp)
      }
      if (typeof payload.revealEstimates === 'boolean') {
        assign(registers, 'revealEstimates', payload.revealEstimates, stamp)
      }
      if (typeof payload.template === 'boolean') {
        assign(registers, 'template', payload.template, stamp)
      }
    } else if (payload.type === 'card:checklist') {
      // One register set per item: concurrent ticks of different items, or a
      // tick and a rename of the same item, all survive.
      if (!isId(payload.itemId)) continue
      const known = card.checklist.get(payload.itemId)
      if (!known && card.checklist.size >= LIMITS.checklist) continue
      const item = known || {}
      const text = cleanName(payload.text, LIMITS.checklistText)
      if (text) assign(item, 'text', text, stamp)
      if (typeof payload.done === 'boolean') assign(item, 'done', payload.done, stamp)
      if (isPosition(payload.position)) assign(item, 'position', payload.position, stamp)
      if (payload.deleted === true) assign(item, 'deleted', true, stamp)
      card.checklist.set(payload.itemId, item)
    } else if (payload.type === 'reaction') {
      if (!REACTIONS.includes(payload.emoji) || typeof payload.on !== 'boolean') continue
      if (payload.commentId !== undefined && !isId(payload.commentId)) continue
      const key = JSON.stringify([payload.commentId || null, payload.emoji, message.identity])
      const known = card.reactions.get(key)
      if (newer(stamp, known?.stamp)) card.reactions.set(key, { on: payload.on, stamp })
    } else if (payload.type === 'card:link') {
      if (!isId(payload.targetId) || payload.targetId === payload.objectId) continue
      if (!LINK_KINDS.includes(payload.kind) || typeof payload.linked !== 'boolean') continue
      const key = JSON.stringify([payload.targetId, payload.kind])
      if (!card.links.has(key) && card.links.size >= LIMITS.links) continue
      const known = card.links.get(key)
      if (newer(stamp, known?.stamp)) card.links.set(key, { linked: payload.linked, stamp })
    } else if (payload.type === 'estimate') {
      if (!isPoints(payload.value)) continue
      const known = card.estimates.get(message.identity)
      if (newer(stamp, known?.stamp)) {
        card.estimates.set(message.identity, { value: payload.value, stamp })
      }
    } else if (payload.type === 'card:move') {
      if (isId(payload.columnId) && isPosition(payload.position)) {
        assign(
          registers,
          'place',
          { columnId: payload.columnId, position: payload.position },
          stamp
        )
      }
    } else if (payload.type === 'card:image') {
      // Images are only ever added, so concurrent uploads all survive: a set
      // keyed by blob, each kept with its oldest stamp.
      for (const ref of images(payload.images)) {
        const key = imageKey(ref)
        const known = card.added.get(key)
        if (!known || newer(known.stamp, stamp)) card.added.set(key, { ref, stamp })
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
      color: read(registers, 'color', null),
      wipLimit: read(registers, 'wipLimit', null)
    }))
    .sort(byPosition)
  // Concurrent deletes can remove every column; cards still need a home.
  if (!liveColumns.length) liveColumns = [{ ...DEFAULT_COLUMNS[0], color: null, wipLimit: null }]
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
    const base = card.base.images || []
    const baseKeys = new Set(base.map(imageKey))
    const added = [...card.added.values()]
      .filter((entry) => !baseKeys.has(imageKey(entry.ref)))
      // Images from one op share a stamp; their key keeps the order stable.
      .sort((a, b) =>
        a.stamp.tie === b.stamp.tie
          ? imageKey(a.ref) < imageKey(b.ref)
            ? -1
            : 1
          : newer(a.stamp, b.stamp)
            ? 1
            : -1
      )
      .map((entry) => entry.ref)
    const reactions = new Map()
    for (const [key, entry] of [...card.reactions].sort(byKey)) {
      if (!entry.on) continue
      const [commentId, emoji, identity] = JSON.parse(key)
      const target = commentId || ''
      if (!reactions.has(target)) reactions.set(target, {})
      const set = reactions.get(target)
      ;(set[emoji] ||= []).push(identity)
    }
    const checklist = [...card.checklist]
      .filter(([, item]) => item.text && !read(item, 'deleted', false))
      .map(([id, item]) => ({
        id,
        text: read(item, 'text'),
        done: read(item, 'done', false),
        position: read(item, 'position', 'V')
      }))
      .sort(byPosition)
    const links = [...card.links]
      .sort(byKey)
      .filter(([, entry]) => entry.linked)
      .map(([key]) => JSON.parse(key))
      .filter(([target]) => cards.has(target))
      .map(([cardId, kind]) => ({ cardId, kind }))
    const estimates = {}
    for (const [identity, entry] of [...card.estimates].sort(byKey)) {
      if (entry.value !== null) estimates[identity] = entry.value
    }
    return {
      ...card.base,
      images: [...base, ...added].slice(0, LIMITS.images),
      title: read(registers, 'title'),
      body: read(registers, 'body'),
      mentions: read(registers, 'mentions'),
      dueDate: read(registers, 'dueDate'),
      labelIds: read(registers, 'labelIds').filter((id) => labelIds.has(id)),
      // A card whose column was deleted shows in the first remaining column.
      columnId: columnIndex.has(place.columnId) ? place.columnId : liveColumns[0].id,
      position: place.position,
      archived: read(registers, 'archived', false),
      assignees: read(registers, 'assignees'),
      points: read(registers, 'points'),
      revealEstimates: read(registers, 'revealEstimates', false),
      template: read(registers, 'template'),
      checklist,
      links,
      estimates,
      reactions: reactions.get('') || {},
      updatedAt: card.touched,
      votes,
      comments: [...card.comments.values()]
        .sort(
          (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || (a.id < b.id ? -1 : 1)
        )
        .map((comment) => ({ ...comment, reactions: reactions.get(comment.id) || {} }))
    }
  })
  // A card is blocked while a card that blocks it is still open: not archived
  // and not in the last column.
  const doneColumn = liveColumns[liveColumns.length - 1].id
  const open = new Map(
    objects
      .filter(
        (object) => !object.archived && (liveColumns.length < 2 || object.columnId !== doneColumn)
      )
      .map((object) => [object.id, object])
  )
  const blockedBy = new Map()
  for (const object of objects) {
    if (!open.has(object.id)) continue
    for (const link of object.links) {
      if (link.kind !== 'blocks') continue
      if (!blockedBy.has(link.cardId)) blockedBy.set(link.cardId, [])
      blockedBy.get(link.cardId).push(object.id)
    }
  }
  for (const object of objects) object.blockedBy = (blockedBy.get(object.id) || []).sort()
  objects.sort(
    (a, b) => columnIndex.get(a.columnId) - columnIndex.get(b.columnId) || byPosition(a, b)
  )

  return {
    objects,
    columns: liveColumns,
    labels: liveLabels,
    theme: {
      background: read(theme, 'background', null),
      accent: read(theme, 'accent', null),
      template: read(theme, 'template', null),
      backgroundImage: read(theme, 'backgroundImage', null)
    },
    info: {
      description: read(info, 'description', ''),
      icon: read(info, 'icon', null),
      kind: read(info, 'kind', DEFAULT_BOARD_KIND)
    },
    rules: [...rules]
      .filter(([, registers]) => !read(registers, 'deleted', false) && registers.rule)
      .sort(([a, x], [b, y]) =>
        earlier(x.first, y.first) ? -1 : earlier(y.first, x.first) ? 1 : a < b ? -1 : 1
      )
      .map(([id, registers]) => ({ id, ...read(registers, 'rule') }))
      .slice(0, LIMITS.rules),
    owner: isIdentity(owner) ? owner : null,
    members: members(allMessages, isIdentity(owner) ? owner : null, moderation, profiles),
    profiles: Object.fromEntries(
      [...profiles]
        .filter(([, r]) => r.name)
        .sort(byKey)
        .map(([identity, r]) => [identity, r.name.value])
    ),
    maxTs
  }
}

// Everyone who ever signed an op, plus the owner, banned members included.
function members(messages, owner, { roleOf, bans }, profiles) {
  const seen = new Set(owner ? [owner] : [])
  for (const message of messages) if (isIdentity(message.identity)) seen.add(message.identity)
  return [...seen].sort().map((identity) => {
    const ban = bans.has(identity) ? read(bans.get(identity), 'ban') : null
    return {
      identity,
      name: profiles.has(identity) ? read(profiles.get(identity), 'name', null) : null,
      avatar: profiles.has(identity) ? read(profiles.get(identity), 'avatar', null) : null,
      role: roleOf(identity),
      banned: Boolean(ban?.banned),
      bannedBy: ban?.banned ? ban.by : null
    }
  })
}

module.exports = {
  ROLES,
  REACTIONS,
  LINK_KINDS,
  RULE_EVERY,
  cleanRule,
  DEFAULT_COLUMNS,
  DEFAULT_COLUMN,
  LIMITS,
  OP_TYPES,
  deriveBoard,
  isPosition,
  positionBetween,
  positionAt
}
