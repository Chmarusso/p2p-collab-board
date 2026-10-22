// Notification rules: what counts as an alert for me on one board.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { deriveBoard, boardAlerts } = require('@opencollab/board-protocol')

const me = 'a'.repeat(64)
const bob = 'b'.repeat(64)
const now = Date.parse('2026-10-22T12:00:00Z')
let n = 0
const op = (identity, payload) => ({ id: `op${n++}`, identity, payload })
const create = (identity, id, ts, extra = {}) =>
  op(identity, {
    type: 'create',
    ts,
    object: { id, title: id, body: '', createdAt: new Date(ts).toISOString(), ...extra }
  })
const ts = now - 3600 * 1000

const messages = [
  op(bob, { type: 'profile', ts, displayName: 'Bob' }),
  create(me, 'mine', ts),
  create(bob, 'theirs', ts + 1),
  create(bob, 'mentions-me', ts + 2, { mentions: [me] }),
  create(me, 'due-today', ts, { dueDate: '2026-10-22T18:00:00Z' }),
  create(me, 'late', ts, { dueDate: '2026-10-01' }),
  create(bob, 'archived', ts, { dueDate: '2026-10-01' }),
  op(bob, { type: 'card:archive', ts: ts + 5, objectId: 'archived', archived: true }),
  op(bob, {
    type: 'card:move',
    ts: ts + 10,
    objectId: 'mine',
    columnId: 'col:done',
    position: 'V'
  }),
  op(bob, {
    type: 'comment',
    ts: ts + 20,
    objectId: 'mine',
    text: 'looks good',
    comment: { id: 'c1', text: 'looks good', createdAt: new Date(ts + 20).toISOString() }
  }),
  op(bob, {
    type: 'comment',
    ts: ts + 30,
    objectId: 'theirs',
    text: 'hey @me',
    comment: {
      id: 'c2',
      text: 'hey @me',
      mentions: [me],
      createdAt: new Date(ts + 30).toISOString()
    }
  }),
  // My own actions never alert me.
  op(me, {
    type: 'card:move',
    ts: ts + 40,
    objectId: 'theirs',
    columnId: 'col:done',
    position: 'V'
  }),
  // Too old to show.
  create(bob, 'ancient', now - 30 * 24 * 3600 * 1000)
]

const alerts = boardAlerts(messages, deriveBoard(messages), me, { now })
const summary = alerts.map((alert) => `${alert.kind} ${alert.cardId}`)
assert.deepEqual(summary.sort(), [
  'comment mine',
  'due-soon due-today',
  'mention mentions-me',
  'mention theirs',
  'moved mine',
  'new-card theirs',
  'overdue late'
])
const moved = alerts.find((alert) => alert.kind === 'moved')
assert.equal(moved.column, 'Done')
assert.equal(moved.authorName, 'Bob')
assert.equal(alerts.find((alert) => alert.kind === 'comment').text, 'looks good')
assert.ok(
  alerts.every((alert, i) => i === 0 || alerts[i - 1].at >= alert.at),
  'newest first'
)
assert.deepEqual(boardAlerts(messages, deriveBoard(messages), null), [], 'no identity, no alerts')
console.log(`✓ ${alerts.length} alerts: mentions, activity on my cards, new cards, due dates`)
