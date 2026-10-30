// Board chat: the reducer must give every peer the same chat whatever order the
// ops arrive in, honour who may delete, and raise chat-mention alerts.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { deriveBoard, boardAlerts, LIMITS } = require('@opencollab/board-protocol')

const owner = 'a'.repeat(64)
const bob = 'b'.repeat(64)
const carol = 'c'.repeat(64)
let n = 0
const op = (identity, payload) => ({ id: `op-${n++}`, identity, payload })
const say = (identity, id, ts, text, mentions = []) =>
  op(identity, {
    type: 'chat',
    ts,
    message: { id, text, createdAt: new Date(1e12 + ts).toISOString(), mentions }
  })
const remove = (identity, messageId, ts) => op(identity, { type: 'chat:delete', ts, messageId })
const profile = (identity, ts, displayName) => op(identity, { type: 'profile', ts, displayName })
const shuffle = (list, seed) => {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    const j = seed % (i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
const ids = (state) => state.chat.map((entry) => entry.id)

// Order by stamp, same result for any arrival order; duplicates collapse.
{
  const ops = [
    profile(owner, 1, 'Ann'),
    profile(bob, 2, 'Bob'),
    say(bob, 'm2', 20, 'second'),
    say(owner, 'm1', 10, 'first'),
    say(carol, 'm3', 30, '  third  '),
    say(carol, 'm3', 30, '  third  ')
  ]
  const expected = ['m1', 'm2', 'm3']
  for (let seed = 1; seed < 30; seed++) {
    assert.deepEqual(ids(deriveBoard(shuffle(ops, seed), { owner })), expected)
  }
  const state = deriveBoard(ops, { owner })
  assert.equal(state.chat[2].text, 'third', 'text is trimmed')
  assert.equal(state.chat[0].author, owner, 'author comes from the signed op, not the payload')
}

// Empty or invalid messages are dropped; long ones are cut.
{
  const state = deriveBoard(
    [
      say(bob, 'ok', 1, 'x'.repeat(LIMITS.chat + 50)),
      say(bob, 'blank', 2, '   '),
      op(bob, { type: 'chat', ts: 3, message: { id: 'bad id!', text: 'hi' } })
    ],
    { owner }
  )
  assert.deepEqual(ids(state), ['ok'])
  assert.equal(state.chat[0].text.length, LIMITS.chat)
}

// Deletes: the author and the owner may, another member may not, in any order.
{
  const ops = [
    say(bob, 'b1', 1, 'from bob'),
    say(bob, 'b2', 2, 'also from bob'),
    say(carol, 'c1', 3, 'from carol'),
    remove(carol, 'b1', 4), // ignored: not the author, not an admin
    remove(bob, 'b2', 5), // author
    remove(owner, 'c1', 6) // owner
  ]
  for (let seed = 1; seed < 20; seed++) {
    assert.deepEqual(ids(deriveBoard(shuffle(ops, seed), { owner })), ['b1'])
  }
  // An admin (role set by the owner) may delete too.
  const withAdmin = [
    ...ops,
    op(owner, { type: 'member:role', ts: 7, identity: carol, role: 'admin' }),
    remove(carol, 'b1', 8)
  ]
  assert.deepEqual(ids(deriveBoard(withAdmin, { owner })), [])
}

// Only the latest LIMITS.chatShown messages are in the state.
{
  const ops = []
  for (let i = 0; i < LIMITS.chatShown + 20; i++) ops.push(say(bob, `m${i}`, i + 1, `#${i}`))
  const state = deriveBoard(ops, { owner })
  assert.equal(state.chat.length, LIMITS.chatShown)
  assert.equal(state.chat[0].id, 'm20')
}

// Alerts: a chat mention alerts the mentioned member, not the author or others,
// and a deleted message no longer alerts.
{
  const now = 1e12 + 100
  const ops = [
    profile(owner, 1, 'Ann'),
    profile(bob, 2, 'Bob'),
    say(bob, 'hey', 50, '@Ann can you look?', [owner]),
    say(bob, 'gone', 60, '@Ann ignore', [owner]),
    remove(bob, 'gone', 70)
  ].map((entry) => ({ ...entry, payload: { ...entry.payload, ts: 1e12 + entry.payload.ts } }))
  const state = deriveBoard(ops, { owner })
  const forAnn = boardAlerts(ops, state, owner, { now })
  assert.deepEqual(
    forAnn.map((alert) => [alert.kind, alert.cardId, alert.text]),
    [['chat-mention', null, '@Ann can you look?']]
  )
  assert.equal(forAnn[0].authorName, 'Bob')
  assert.deepEqual(boardAlerts(ops, state, bob, { now }), [])
  assert.deepEqual(boardAlerts(ops, state, carol, { now }), [])
}

console.log('board chat ok')
