// Notifications for one board, derived from its verified ops and the board
// built from them (deriveBoard). Pure, so every board — the open one and the
// ones checked in the background — produces alerts the same way.
//
// Kinds: mention (you were @mentioned), comment / moved / edited / archived
// (someone else acted on a card you created), new-card (someone else added a
// card), due-soon / overdue (any open card with a due date).

const DAY = 24 * 3600 * 1000
const MAX_ALERTS = 50

const stampOf = (payload) =>
  Number.isSafeInteger(payload.ts)
    ? payload.ts
    : Date.parse(payload.comment?.createdAt || payload.object?.createdAt) || 0

// Date-only due dates are due at the end of that day, local time.
function deadlineOf(dueDate) {
  if (!dueDate) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
  const [year, month, day] = dueDate.split('-').map(Number)
  const deadline = dateOnly ? new Date(year, month - 1, day, 23, 59, 59) : new Date(dueDate)
  return Number.isNaN(deadline.getTime()) ? null : deadline.getTime()
}

function boardAlerts(messages, state, me, { now = Date.now(), since = now - 14 * DAY } = {}) {
  if (!me) return []
  const cards = new Map(state.objects.map((object) => [object.id, object]))
  const columns = new Map(state.columns.map((column) => [column.id, column.name]))
  const alerts = []
  const push = (message, kind, card, extra = {}) => {
    alerts.push({
      id: `${kind}:${message.id}`,
      kind,
      cardId: card.id,
      cardTitle: card.title,
      author: message.identity,
      authorName: state.profiles[message.identity] || null,
      at: stampOf(message.payload),
      ...extra
    })
  }

  for (const message of messages) {
    const payload = message.payload
    if (message.identity === me || !payload) continue
    if (stampOf(payload) < since) continue
    const card = cards.get(payload.type === 'create' ? payload.object?.id : payload.objectId)
    if (!card || card.archived) continue
    const mine = card.author === me
    if (payload.type === 'create') {
      if (card.mentions?.includes(me)) push(message, 'mention', card, { where: 'description' })
      else push(message, 'new-card', card)
    } else if (payload.type === 'comment') {
      const text = payload.comment?.text || payload.text || ''
      if (payload.comment?.mentions?.includes(me)) {
        push(message, 'mention', card, { where: 'comment', text })
      } else if (mine) push(message, 'comment', card, { text })
    } else if (payload.type === 'card:update') {
      if (Array.isArray(payload.mentions) && payload.mentions.includes(me)) {
        push(message, 'mention', card, { where: 'description' })
      } else if (mine) push(message, 'edited', card)
    } else if (payload.type === 'card:move') {
      if (mine) push(message, 'moved', card, { column: columns.get(payload.columnId) || null })
    }
  }

  for (const card of state.objects) {
    const deadline = deadlineOf(card.dueDate)
    if (card.archived || deadline === null || deadline - now > DAY) continue
    const kind = deadline < now ? 'overdue' : 'due-soon'
    alerts.push({
      // One alert per due date and state: moving the date or crossing the
      // deadline is news again.
      id: `${kind}:${card.id}:${card.dueDate}`,
      kind,
      cardId: card.id,
      cardTitle: card.title,
      author: null,
      authorName: null,
      at: Math.min(deadline, now),
      due: card.dueDate
    })
  }

  return alerts.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1)).slice(0, MAX_ALERTS)
}

module.exports = { boardAlerts }
