// Two real workers on one machine, connected over the public DHT: a joiner
// gets the board through the signed-op gossip, edits flow both ways, and the
// live channel carries presence, bot statuses and who is sending changes.
// Needs network access; a firewalled machine fails here, not in app code.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { Session } = require('../apps/cli/lib/session.js')
const { messageTypes } = require('@opencollab/board-protocol')

const roots = []
const sessions = []
async function peer() {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'opencollab-kanban-peer-'))
  roots.push(storage)
  const session = new Session(storage)
  sessions.push(session)
  session.board = null
  session.waiters.add((message) => {
    if (message.type === messageTypes.boardState) session.board = message
  })
  await session.unlock('kanban-peer-password', { create: true })
  return session
}
async function until(session, label, check) {
  if (session.board && check(session.board)) return session.board
  await session.wait((message) => message.type === messageTypes.boardState && check(message), {
    label,
    timeout: 90000
  })
  return session.board
}

try {
  const alice = await peer()
  const room = await alice.openBoard(null, 'Peers')
  alice.send({ type: messageTypes.boardCreate, title: 'Shared card', body: '' })
  alice.send({ type: messageTypes.columnCreate, name: 'Review' })
  const board = await until(alice, 'card', (b) => b.objects.length === 1 && b.columns.length === 4)
  const cardId = board.objects[0].id
  const review = board.columns[3].id

  const bob = await peer()
  await bob.openBoard(room.invite)
  await until(bob, 'gossiped board', (b) => b.objects.length === 1 && b.columns.length === 4)
  console.log('✓ joiner receives cards and columns from a peer')

  // The apps show "Syncing changes from …" from this: who sent what, live.
  const activity = alice.wait(
    (message) =>
      message.type === messageTypes.peerActivity &&
      message.authors.length === 1 &&
      message.cardIds.includes(cardId),
    { label: 'peer activity', timeout: 30000 }
  )
  bob.send({ type: messageTypes.cardMove, objectId: cardId, columnId: review })
  await until(alice, 'move from joiner', (b) => b.objects[0]?.columnId === review)
  await activity
  alice.send({ type: messageTypes.themeSet, accent: '#22aa88' })
  await until(bob, 'theme from creator', (b) => b.theme?.accent === '#22aa88')
  console.log('✓ edits flow both ways and converge; the receiver hears who changed which card')

  // Presence is gossiped between connected peers only, never logged.
  const seen = bob.wait(
    (message) =>
      message.type === messageTypes.boardPresence &&
      message.peers.some((entry) => entry.cardId === cardId && entry.typing),
    { label: 'presence', timeout: 30000 }
  )
  alice.send({ type: messageTypes.presenceSet, cardId, typing: true })
  await seen
  console.log('✓ presence reaches the other peer')

  // A bot says what it is busy with; only the live channel carries it.
  const busy = bob.wait(
    (message) =>
      message.type === messageTypes.boardPresence &&
      message.peers.some(
        (entry) => entry.cardId === cardId && entry.status === 'Making key points'
      ),
    { label: 'status', timeout: 30000 }
  )
  alice.send({
    type: messageTypes.presenceSet,
    cardId,
    typing: false,
    status: '  Making key points '
  })
  await busy
  console.log('✓ a status (what a bot is doing) reaches the other peer, trimmed')
} finally {
  await Promise.all(sessions.map((session) => session.close().catch(() => {})))
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })))
}
