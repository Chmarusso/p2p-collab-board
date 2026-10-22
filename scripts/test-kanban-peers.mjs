// Two real workers on one machine, connected over the public DHT: a joiner
// gets the board through the signed-op gossip, and edits flow both ways.
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

  bob.send({ type: messageTypes.cardMove, objectId: cardId, columnId: review })
  await until(alice, 'move from joiner', (b) => b.objects[0]?.columnId === review)
  alice.send({ type: messageTypes.themeSet, accent: '#22aa88' })
  await until(bob, 'theme from creator', (b) => b.theme?.accent === '#22aa88')
  console.log('✓ edits flow both ways and converge')
} finally {
  await Promise.all(sessions.map((session) => session.close().catch(() => {})))
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })))
}
