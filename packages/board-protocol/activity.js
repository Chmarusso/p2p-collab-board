// What happened on a board, read straight from its verified ops: every change
// is already a signed, timestamped entry, so the history needs no extra data.
// Pure, like deriveBoard: hosts pass the same ops and the board built from them.

const DAY = 24 * 3600 * 1000
const WEEK = 7 * DAY

const stampOf = (payload) =>
  Number.isSafeInteger(payload.ts)
    ? payload.ts
    : Date.parse(payload.comment?.createdAt || payload.object?.createdAt) || 0

const cardIdOf = (payload) => (payload.type === 'create' ? payload.object?.id : payload.objectId)
const short = (text, max = 140) => {
  const value = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  return value.length > max ? value.slice(0, max - 1) + '…' : value
}

// One entry per op that changed something people care about. `detail` is short
// display text in English; `kind` lets hosts pick an icon or their own wording.
function describe(payload, state, columns, labels, names) {
  const listOf = (ids, map) => ids.map((id) => map.get(id)).filter(Boolean)
  switch (payload.type) {
    case 'create':
      return { kind: 'created', detail: `in ${columns.get(payload.object?.columnId) || 'New'}` }
    case 'card:move':
      return { kind: 'moved', detail: columns.get(payload.columnId) || 'another column' }
    case 'card:archive':
      return { kind: payload.archived ? 'archived' : 'restored', detail: '' }
    case 'comment':
      return { kind: 'commented', detail: short(payload.comment?.text || payload.text) }
    case 'card:update': {
      const parts = []
      if (typeof payload.title === 'string') parts.push(`renamed to "${short(payload.title, 60)}"`)
      if (typeof payload.body === 'string') parts.push('edited the description')
      if (payload.dueDate !== undefined) {
        parts.push(payload.dueDate ? `due ${payload.dueDate.slice(0, 10)}` : 'removed the due date')
      }
      if (Array.isArray(payload.labelIds)) {
        const named = listOf(payload.labelIds, labels)
        parts.push(named.length ? `labels: ${named.join(', ')}` : 'cleared labels')
      }
      if (Array.isArray(payload.assignees)) {
        const people = payload.assignees.map((id) => names(id))
        parts.push(people.length ? `assigned ${people.join(', ')}` : 'unassigned everyone')
      }
      if (payload.points !== undefined) {
        parts.push(payload.points === null ? 'cleared the estimate' : `estimate ${payload.points}`)
      }
      if (payload.revealEstimates === true) parts.push('revealed estimates')
      if (typeof payload.template === 'boolean') {
        parts.push(payload.template ? 'made it a template' : 'stopped using it as a template')
      }
      return parts.length ? { kind: 'edited', detail: parts.join('; ') } : null
    }
    case 'card:checklist': {
      if (payload.deleted === true) return { kind: 'checklist', detail: 'removed an item' }
      if (typeof payload.done === 'boolean' && typeof payload.text !== 'string') {
        return { kind: 'checklist', detail: payload.done ? 'checked an item' : 'unchecked an item' }
      }
      if (typeof payload.text === 'string') {
        return { kind: 'checklist', detail: `item "${short(payload.text, 60)}"` }
      }
      return null
    }
    case 'card:link': {
      const target = state.objects.find((object) => object.id === payload.targetId)
      const title = target ? `"${short(target.title, 60)}"` : 'a card'
      const verb = payload.kind === 'blocks' ? 'blocks' : 'relates to'
      return {
        kind: 'linked',
        detail: payload.linked ? `${verb} ${title}` : `no longer ${verb} ${title}`
      }
    }
    case 'card:image':
      return { kind: 'attached', detail: 'added an attachment' }
    case 'estimate':
      return { kind: 'estimated', detail: 'voted on the estimate' }
    default:
      return null
  }
}

function boardActivity(messages, state, { cardId = null, limit = 100 } = {}) {
  const cards = new Map(state.objects.map((object) => [object.id, object]))
  const columns = new Map(state.columns.map((column) => [column.id, column.name]))
  const labels = new Map(state.labels.map((label) => [label.id, label.name]))
  const banned = new Set(
    (state.members || []).filter((member) => member.banned).map((member) => member.identity)
  )
  const names = (identity) => state.profiles[identity] || `${String(identity).slice(0, 8)}…`
  const entries = []
  for (const message of messages) {
    const payload = message.payload
    if (!payload || banned.has(message.identity)) continue
    const id = cardIdOf(payload)
    if (cardId !== null && id !== cardId) continue
    const card = cards.get(id)
    if (!card) continue
    const described = describe(payload, state, columns, labels, names)
    if (!described) continue
    entries.push({
      id: message.id,
      ...described,
      cardId: card.id,
      cardTitle: card.title,
      author: message.identity,
      authorName: state.profiles[message.identity] || null,
      at: stampOf(payload)
    })
  }
  return entries
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
    .slice(0, Math.max(1, Math.min(limit, 500)))
}

const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const percentile = (values, p) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

// Flow numbers for a board. "Done" is the last column, like everywhere else.
// A card's done time is the last time it entered that column, so a card that
// was reopened and finished again counts once, in the week it really finished.
function boardStats(messages, state, { now = Date.now(), weeks = 8 } = {}) {
  const columns = state.columns
  const doneId = columns.length > 1 ? columns[columns.length - 1].id : null
  const cards = new Map(state.objects.map((object) => [object.id, object]))
  const createdAt = new Map()
  const doneAt = new Map()
  const ordered = messages
    .filter((message) => message.payload)
    .map((message) => ({ payload: message.payload, at: stampOf(message.payload) }))
    .sort((a, b) => a.at - b.at)
  for (const { payload, at } of ordered) {
    const id = cardIdOf(payload)
    if (!cards.has(id)) continue
    if (payload.type === 'create') {
      if (!createdAt.has(id)) createdAt.set(id, at || Date.parse(payload.object?.createdAt) || 0)
      if (doneId && payload.object?.columnId === doneId) doneAt.set(id, at)
    } else if (payload.type === 'card:move' && doneId && payload.columnId === doneId) {
      doneAt.set(id, at)
    }
  }

  const live = state.objects.filter((object) => !object.archived && !object.template)
  const isDone = (object) => doneId !== null && object.columnId === doneId
  const finished = state.objects.filter((object) => isDone(object) && doneAt.has(object.id))

  const start = now - weeks * WEEK
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    start: start + i * WEEK,
    done: 0,
    created: 0,
    points: 0
  }))
  const bucketOf = (at) => (at >= start && at < now ? Math.floor((at - start) / WEEK) : -1)
  for (const object of finished) {
    const index = bucketOf(doneAt.get(object.id))
    if (index < 0) continue
    buckets[index].done++
    buckets[index].points += object.points || 0
  }
  for (const at of createdAt.values()) {
    const index = bucketOf(at)
    if (index >= 0) buckets[index].created++
  }

  const cycle = finished
    .map((object) => doneAt.get(object.id) - (createdAt.get(object.id) || 0))
    .filter((ms) => ms >= 0 && Number.isFinite(ms))

  const members = new Map()
  const memberOf = (identity) => {
    if (!members.has(identity)) {
      members.set(identity, {
        identity,
        name: state.profiles[identity] || null,
        open: 0,
        doneThisWeek: 0
      })
    }
    return members.get(identity)
  }
  for (const object of live) {
    for (const identity of object.assignees || []) {
      if (!isDone(object)) memberOf(identity).open++
      else if ((doneAt.get(object.id) || 0) >= now - WEEK) memberOf(identity).doneThisWeek++
    }
  }

  const deadline = (due) => {
    if (!due) return null
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due)
    const [y, m, d] = due.split('-').map(Number)
    const time = dateOnly ? new Date(y, m - 1, d, 23, 59, 59).getTime() : Date.parse(due)
    return Number.isFinite(time) ? time : null
  }
  return {
    doneColumnId: doneId,
    weeks: buckets,
    cycleTime: {
      median: median(cycle),
      p85: percentile(cycle, 85),
      count: cycle.length
    },
    columns: columns.map((column) => {
      const inColumn = live.filter((object) => object.columnId === column.id)
      return {
        id: column.id,
        name: column.name,
        count: inColumn.length,
        points: inColumn.reduce((sum, object) => sum + (object.points || 0), 0),
        wipLimit: column.wipLimit ?? null
      }
    }),
    members: [...members.values()].sort(
      (a, b) =>
        b.open + b.doneThisWeek - (a.open + a.doneThisWeek) || (a.identity < b.identity ? -1 : 1)
    ),
    totals: {
      open: live.filter((object) => !isDone(object)).length,
      done: live.filter(isDone).length,
      archived: state.objects.filter((object) => object.archived).length,
      overdue: live.filter((object) => {
        const time = deadline(object.dueDate)
        return !isDone(object) && time !== null && time < now
      }).length,
      blocked: live.filter((object) => !isDone(object) && object.blockedBy?.length).length,
      pointsOpen: live
        .filter((object) => !isDone(object))
        .reduce((sum, object) => sum + (object.points || 0), 0),
      pointsDone: live.filter(isDone).reduce((sum, object) => sum + (object.points || 0), 0)
    }
  }
}

// Open cards assigned to `me` (not archived, not in the last column), soonest
// due first. Feeds "My work" across boards.
function myCards(state, me) {
  if (!me) return []
  const columns = state.columns
  const doneId = columns.length > 1 ? columns[columns.length - 1].id : null
  const names = new Map(columns.map((column) => [column.id, column.name]))
  return state.objects
    .filter(
      (object) =>
        !object.archived &&
        !object.template &&
        object.columnId !== doneId &&
        (object.assignees || []).includes(me)
    )
    .map((object) => ({
      id: object.id,
      title: object.title,
      dueDate: object.dueDate || null,
      columnId: object.columnId,
      columnName: names.get(object.columnId) || '',
      blocked: Boolean(object.blockedBy?.length),
      checklist: {
        done: (object.checklist || []).filter((item) => item.done).length,
        total: (object.checklist || []).length
      }
    }))
    .sort(
      (a, b) =>
        (a.dueDate ? 0 : 1) - (b.dueDate ? 0 : 1) ||
        String(a.dueDate).localeCompare(String(b.dueDate)) ||
        (a.id < b.id ? -1 : 1)
    )
}

module.exports = { boardActivity, boardStats, myCards }
