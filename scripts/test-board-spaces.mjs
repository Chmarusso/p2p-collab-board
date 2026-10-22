// Boards created on one device must be separate (own key, own log), an edit
// made right before switching boards must survive, and a board that isn't open
// must still produce notifications from this device's own data.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Session } = require('../apps/cli/lib/session.js')
const { messageTypes } = require('@opencollab/board-protocol')

const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'opencollab-spaces-'))
const session = new Session(storage)
let board = null
let alerts = null
session.waiters.add((message) => {
  if (message.type === messageTypes.boardState) board = message
  if (message.type === messageTypes.boardAlerts) alerts = message
})
const until = (label, check, timeout = 30000) =>
  check() ? Promise.resolve() : session.wait(() => check(), { label, timeout })

try {
  await session.unlock('spaces-test-password', { create: true })
  const a = await session.openBoard(null, 'Board A')
  const soon = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
  session.send({ type: messageTypes.boardCreate, title: 'Due on A', body: '', dueDate: soon })
  await until('card on A', () => board?.objects?.some((object) => object.title === 'Due on A'))
  // Switch straight away: the append may still be in flight.
  const b = await session.openBoard(null, 'Board B')
  assert.notEqual(a.boardKey, b.boardKey, 'each new board gets its own key')
  await until('B is empty', () => board?.objects?.length === 0 && board.columns.length === 3)
  console.log('✓ boards created on one device are separate')

  session.send({
    type: messageTypes.boardsWatch,
    boards: [
      { invite: a.invite, name: 'Board A' },
      { invite: b.invite, name: 'Board B' }
    ]
  })
  const checked = () => alerts?.boards?.find((entry) => entry.key === a.boardKey)
  await until('A checked in the background', () => checked()?.checkedAt > 0, 60000)
  assert.ok(
    checked().alerts.some((alert) => alert.kind === 'due-soon' && alert.cardTitle === 'Due on A'),
    'background check reads the closed board from local data'
  )
  console.log('✓ a closed board is checked in the background from local data')

  await session.openBoard(a.invite)
  await until('A reopened', () => board?.objects?.some((object) => object.title === 'Due on A'))
  console.log('✓ an edit made right before switching boards is kept')
} finally {
  await session.close().catch(() => {})
  await fs.rm(storage, { recursive: true, force: true })
}
