// Drives the real Bare worker (the same one Electron spawns) through the CLI's
// Session: create a board, use every Kanban command, restart the worker on the
// same storage and check the board comes back identical from the Autobee log.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { Session } = require('../apps/cli/lib/session.js')
const { messageTypes } = require('@opencollab/board-protocol')

const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'opencollab-kanban-'))
const password = 'kanban-test-password'
let session = null

const state = () => session.state.board
async function until(label, check) {
  if (state() && check(state())) return state()
  await session.wait((message) => message.type === messageTypes.boardState && check(message), {
    label,
    timeout: 15000
  })
  return state()
}
function start() {
  session = new Session(storage)
  session.state.board = null
  session.waiters.add((message) => {
    if (message.type === messageTypes.boardState) session.state.board = message
  })
}

try {
  start()
  await session.unlock(password, { create: true })
  const room = await session.openBoard(null, 'Kanban test')
  let board = await until('default columns', (b) => b.columns?.length === 3)
  assert.deepEqual(
    board.columns.map((column) => column.name),
    ['New', 'In progress', 'Done']
  )

  session.send({ type: messageTypes.boardCreate, title: 'First', body: '' })
  session.send({ type: messageTypes.boardCreate, title: 'Second', body: '' })
  board = await until('two cards', (b) => b.objects.length === 2)
  assert.ok(board.objects.every((object) => object.columnId === 'col:new'))
  const [first, second] = board.objects
  assert.equal(first.title, 'First')

  session.send({ type: messageTypes.columnCreate, name: 'Review', index: 2, color: '#336699' })
  board = await until('new column', (b) => b.columns.length === 4)
  const review = board.columns[2]
  assert.equal(review.name, 'Review')

  session.send({ type: messageTypes.cardMove, objectId: second.id, columnId: review.id })
  session.send({ type: messageTypes.cardMove, objectId: first.id, columnId: 'col:new', index: 0 })
  session.send({ type: messageTypes.labelUpsert, name: 'bug', color: '#ff0000' })
  board = await until('label', (b) => b.labels.length === 1)
  const label = board.labels[0]
  session.send({
    type: messageTypes.cardUpdate,
    objectId: first.id,
    title: 'First, edited',
    body: '**bold** `code`',
    dueDate: '2026-12-01',
    labelIds: [label.id]
  })
  session.send({ type: messageTypes.cardArchive, objectId: second.id, archived: true })
  session.send({ type: messageTypes.themeSet, background: 'preset:dusk', accent: '#22aa88' })
  session.send({ type: messageTypes.columnUpdate, columnId: 'col:doing', name: 'Doing' })
  session.send({ type: messageTypes.columnDelete, columnId: 'col:done' })
  session.send({ type: messageTypes.boardVote, objectId: first.id, value: 1 })
  session.send({ type: messageTypes.boardComment, objectId: first.id, text: 'looks good' })
  session.send({ type: messageTypes.boardDescribe, description: 'Launch board for **Q4**' })
  // 1×1 transparent PNG
  const pixel =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  session.send({
    type: messageTypes.cardImagesAdd,
    objectId: first.id,
    requestId: 'r1',
    images: [{ data: pixel, type: 'image/png', width: 1, height: 1 }]
  })
  const added = await session.wait((message) => message.type === 'card-images-added', {
    label: 'image upload'
  })
  assert.equal(added.requestId, 'r1')
  assert.equal(added.keys.length, 1)
  board = await until(
    'all edits',
    (b) =>
      b.objects.find((o) => o.id === first.id)?.comments.length === 1 &&
      b.columns.length === 3 &&
      b.theme.accent === '#22aa88'
  )
  const edited = board.objects.find((object) => object.id === first.id)
  assert.equal(edited.title, 'First, edited')
  assert.equal(edited.dueDate, '2026-12-01')
  assert.deepEqual(edited.labelIds, [label.id])
  assert.deepEqual(Object.values(edited.votes), [1])
  const moved = board.objects.find((object) => object.id === second.id)
  assert.equal(moved.columnId, review.id)
  assert.equal(moved.archived, true)
  assert.deepEqual(
    board.columns.map((column) => column.name),
    ['New', 'Doing', 'Review']
  )
  assert.deepEqual(board.theme, { background: 'preset:dusk', accent: '#22aa88' })
  board = await until(
    'description and image',
    (b) => b.info?.description && b.objects.find((o) => o.id === first.id)?.images.length === 1
  )
  assert.equal(board.info.description, 'Launch board for **Q4**')

  // Invalid commands are dropped in the worker, not written to the log.
  session.send({ type: messageTypes.columnDelete, columnId: 'col:missing' })
  session.send({ type: messageTypes.cardMove, objectId: first.id, columnId: 'col:missing' })
  session.send({ type: messageTypes.boardComment, objectId: first.id, text: '   ' })

  const before = JSON.stringify(board)
  await session.close()
  console.log('✓ every Kanban command applies in the worker')

  start()
  await session.unlock(password)
  await session.openBoard(room.invite)
  board = await until('restored board', (b) => b.objects.length === 2 && b.columns.length === 3)
  assert.equal(JSON.stringify(board), before, 'board after restart differs')
  console.log('✓ board restores identically from the log after a restart')
} finally {
  if (session) await session.close().catch(() => {})
  await fs.rm(storage, { recursive: true, force: true })
}
