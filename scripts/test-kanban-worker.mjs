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
  assert.deepEqual(board.theme, {
    background: 'preset:dusk',
    accent: '#22aa88',
    backgroundImage: null
  })
  board = await until(
    'description and image',
    (b) => b.info?.description && b.objects.find((o) => o.id === first.id)?.images.length === 1
  )
  assert.equal(board.info.description, 'Launch board for **Q4**')

  // Checklists, reactions, assignees, links, estimates, WIP limits.
  const owner = board.owner
  session.send({ type: messageTypes.checklistSet, objectId: first.id, text: 'Write tests' })
  session.send({ type: messageTypes.checklistSet, objectId: first.id, text: 'Ship it' })
  board = await until(
    'checklist',
    (b) => b.objects.find((o) => o.id === first.id)?.checklist.length === 2
  )
  const [item] = board.objects.find((o) => o.id === first.id).checklist
  session.send({ type: messageTypes.checklistSet, objectId: first.id, itemId: item.id, done: true })
  session.send({ type: messageTypes.reactionSet, objectId: first.id, emoji: '🎉', on: true })
  session.send({ type: messageTypes.cardUpdate, objectId: first.id, assignees: [owner], points: 3 })
  session.send({
    type: messageTypes.linkSet,
    objectId: second.id,
    targetId: first.id,
    kind: 'blocks',
    linked: true
  })
  session.send({ type: messageTypes.estimateSet, objectId: first.id, value: 5 })
  session.send({ type: messageTypes.columnUpdate, columnId: 'col:doing', wipLimit: 2 })
  board = await until('new card fields', (b) => {
    const o = b.objects.find((x) => x.id === first.id)
    return o?.checklist[0].done && o.reactions['🎉'] && o.points === 3 && o.estimates[owner] === 5
  })
  let firstCard = board.objects.find((o) => o.id === first.id)
  assert.deepEqual(firstCard.assignees, [owner])
  assert.deepEqual(board.columns.find((c) => c.id === 'col:doing').wipLimit, 2)
  // `second` is archived, so it no longer blocks.
  assert.deepEqual(firstCard.blockedBy, [])

  // Rules: entering Doing assigns the mover, adds the label and sets a due date.
  session.send({
    type: messageTypes.ruleUpsert,
    rule: {
      name: 'Start work',
      trigger: { kind: 'enter', columnId: 'col:doing' },
      actions: { assignActor: true, labelIds: [label.id], dueInDays: 3 }
    }
  })
  board = await until('rule', (b) => b.rules?.length === 1)
  session.send({ type: messageTypes.boardCreate, title: 'Third', body: '', checklist: ['a', 'b'] })
  board = await until('third', (b) => b.objects.some((o) => o.title === 'Third'))
  const third = board.objects.find((o) => o.title === 'Third')
  assert.equal(third.checklist.length, 2)
  session.send({ type: messageTypes.cardMove, objectId: third.id, columnId: 'col:doing' })
  board = await until('rule applied', (b) => {
    const o = b.objects.find((x) => x.id === third.id)
    return o?.assignees.includes(owner) && o.labelIds.includes(label.id) && o.dueDate
  })

  // Card templates, activity and stats.
  session.send({ type: messageTypes.cardUpdate, objectId: third.id, template: true })
  board = await until('template', (b) => b.objects.find((o) => o.id === third.id)?.template)
  session.send({ type: messageTypes.cardFromTemplate, templateId: third.id, requestId: 't1' })
  const created = await session.wait((m) => m.type === 'card-created' && m.requestId === 't1', {
    label: 'card from template'
  })
  board = await until('copy', (b) => b.objects.some((o) => o.id === created.objectId))
  const copy = board.objects.find((o) => o.id === created.objectId)
  assert.equal(copy.title, 'Third')
  assert.equal(copy.template, false)
  assert.deepEqual(
    copy.checklist.map((entry) => entry.text),
    ['a', 'b']
  )
  session.send({ type: messageTypes.activityGet, cardId: first.id, requestId: 'a1' })
  const activity = await session.wait((m) => m.type === messageTypes.boardActivity, {
    label: 'activity'
  })
  assert.ok(activity.entries.some((entry) => entry.kind === 'checklist'))
  assert.ok(activity.entries.every((entry) => entry.cardId === first.id))
  session.send({ type: messageTypes.statsGet, requestId: 's1' })
  const { stats } = await session.wait((m) => m.type === messageTypes.boardStats, {
    label: 'stats'
  })
  assert.equal(stats.weeks.length, 8)
  assert.ok(stats.totals.open >= 2)

  // Scheduled rules make this period's card right away, once.
  session.send({
    type: messageTypes.ruleUpsert,
    rule: {
      name: 'Weekly review',
      trigger: { kind: 'schedule', every: 'week', columnId: null },
      card: { title: 'Weekly review', checklist: ['Inbox zero'] }
    }
  })
  board = await until('scheduled card', (b) => b.objects.some((o) => o.id.startsWith('recur:')))
  assert.equal(board.objects.filter((o) => o.id.startsWith('recur:')).length, 1)
  firstCard = board.objects.find((o) => o.id === first.id)
  assert.equal(firstCard.checklist[0].done, true)

  // Invalid commands are dropped in the worker, not written to the log.
  session.send({ type: messageTypes.columnDelete, columnId: 'col:missing' })
  session.send({ type: messageTypes.cardMove, objectId: first.id, columnId: 'col:missing' })
  session.send({ type: messageTypes.boardComment, objectId: first.id, text: '   ' })

  // The creator owns the board; the owner can't be removed.
  const me = board.members.find((member) => member.role === 'owner')
  assert.equal(board.owner, me?.identity, 'the creator is the owner')
  session.send({ type: messageTypes.memberBan, identity: me.identity, banned: true })
  const refused = await session.wait((message) => message.type === 'board-action-error', {
    label: 'ban refused'
  })
  assert.match(refused.error, /owner/)

  // Board icon and background image.
  session.send({
    type: messageTypes.boardIconSet,
    image: { data: pixel, type: 'image/png', width: 1, height: 1 }
  })
  session.send({
    type: messageTypes.backgroundImageSet,
    image: { data: pixel, type: 'image/png', width: 1, height: 1 }
  })
  board = await until('icon and background', (b) => b.info.icon && b.theme.backgroundImage)
  session.send({ type: 'board:image', ref: board.info.icon })
  const icon = await session.wait((message) => message.type === 'board-image', {
    label: 'icon fetch'
  })
  assert.equal(icon.data, pixel)

  // Videos: streamed from a file, served back as a decrypted copy on disk.
  const video = path.join(storage, 'clip.mp4')
  const bytes = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.alloc(300 * 1024, 7)
  ])
  await fs.writeFile(video, bytes)
  await fs.writeFile(path.join(storage, 'notes.txt'), 'not a video at all')
  session.send({
    type: messageTypes.cardMediaAdd,
    objectId: first.id,
    requestId: 'v1',
    files: [{ path: `file://${video}`, name: 'clip.mp4' }]
  })
  const uploaded = await session.wait(
    (message) => message.type === 'card-media-added' && message.requestId === 'v1',
    { label: 'video upload' }
  )
  assert.equal(uploaded.keys.length, 1, uploaded.error)
  session.send({
    type: messageTypes.cardMediaAdd,
    objectId: first.id,
    requestId: 'v2',
    files: [{ path: path.join(storage, 'notes.txt') }]
  })
  const rejected = await session.wait(
    (message) => message.type === 'card-media-added' && message.requestId === 'v2',
    { label: 'non-video upload' }
  )
  assert.deepEqual(rejected.keys, [])
  assert.match(rejected.error, /MP4/)
  board = await until('video on card', (b) =>
    b.objects.find((o) => o.id === first.id)?.images.some((i) => i.type === 'video/mp4')
  )
  const clip = board.objects
    .find((o) => o.id === first.id)
    .images.find((image) => image.type === 'video/mp4')
  assert.equal(clip.name, 'clip.mp4')
  assert.equal(clip.id.byteLength, bytes.length)
  session.send({ type: messageTypes.boardMedia, ref: clip })
  const served = await session.wait((message) => message.type === 'board-media', {
    label: 'video served'
  })
  assert.ok(served.path, served.error)
  assert.ok((await fs.readFile(served.path)).equals(bytes), 'cached video differs')

  // Export: the whole board as JSON, without the invite or secret.
  session.send({ type: messageTypes.boardExport, requestId: 'e1' })
  const exported = await session.wait((message) => message.type === 'board-export', {
    label: 'export'
  })
  assert.equal(exported.data.format, 'opencollab-board')
  assert.equal(exported.data.cards.length, 5)
  assert.equal(exported.data.board.name, 'Kanban test')
  assert.ok(!JSON.stringify(exported).includes(room.invite), 'export leaks the invite')
  session.send({ type: messageTypes.boardExport, requestId: 'e2', toFile: true })
  const file = await session.wait(
    (message) => message.type === 'board-export' && message.requestId === 'e2',
    { label: 'export to file' }
  )
  assert.equal(JSON.parse(await fs.readFile(file.path, 'utf8')).cards.length, 5)
  console.log('✓ owner, icon, background image, video upload/playback and export work')

  const before = JSON.stringify(board)
  await session.close()
  console.log('✓ every Kanban command applies in the worker')

  start()
  await session.unlock(password)
  await session.openBoard(room.invite)
  board = await until('restored board', (b) => b.objects.length === 5 && b.columns.length === 3)
  assert.equal(JSON.stringify(board), before, 'board after restart differs')
  console.log('✓ board restores identically from the log after a restart')
} finally {
  if (session) await session.close().catch(() => {})
  await fs.rm(storage, { recursive: true, force: true })
}
