// A board survives its only member going offline: Alice mirrors it to a local
// blind peer and quits, then Bob joins and reads it from the blind peer alone.
// Needs network access (public DHT) and `npm install` in apps/blind-peer.
// BLIND_PEER=<key> tests a running blind peer (e.g. the VPS one) instead.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { Session } = require('../apps/cli/lib/session.js')
const { messageTypes } = require('@opencollab/board-protocol')

const bin = path.join(import.meta.dirname, '../apps/blind-peer/node_modules/.bin/blind-peer')
const roots = []
const tmp = async (name) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `opencollab-${name}-`))
  roots.push(dir)
  return dir
}

// Starts the blind peer and resolves with its public key once it listens.
async function startBlindPeer() {
  const child = spawn(bin, ['--storage', await tmp('blind-peer'), '--debug'])
  const log = []
  const key = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('blind peer did not start')), 60000)
    child.stdout.on('data', (data) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        log.push(line)
        const entry = JSON.parse(line)
        if (entry.msg === 'Listening' && entry.publicKey) {
          clearTimeout(timer)
          resolve(entry.publicKey)
        }
      }
    })
    child.once('exit', (code) => reject(new Error(`blind peer exited (${code})`)))
  })
  return { child, key, log }
}

async function peer() {
  const session = new Session(await tmp('peer'))
  session.board = null
  session.waiters.add((message) => {
    if (message.type === messageTypes.boardState) session.board = message
  })
  await session.unlock('blind-peer-password', { create: true })
  return session
}

const until = async (session, label, check, timeout = 120000) => {
  if (session.board && check(session.board)) return session.board
  await session.wait((message) => message.type === messageTypes.boardState && check(message), {
    label,
    timeout
  })
  return session.board
}

const blind = process.env.BLIND_PEER
  ? { key: process.env.BLIND_PEER, log: [], child: { kill() {} } }
  : await startBlindPeer()
const sessions = []
try {
  process.env.OPENCOLLAB_BLIND_PEERS = blind.key
  const alice = await peer()
  sessions.push(alice)
  const room = await alice.openBoard(null, 'Blind')
  alice.send({ type: messageTypes.boardCreate, title: 'Kept by the blind peer', body: '' })
  await until(alice, 'card', (b) => b.objects.length === 1)
  // Give the blind peer time to download Alice's log before she leaves.
  await new Promise((resolve) => setTimeout(resolve, 20000))
  await alice.close()
  sessions.pop()
  console.log('✓ creator mirrored the board and went offline')

  const bob = await peer()
  sessions.push(bob)
  await bob.openBoard(room.invite)
  const board = await until(bob, 'board from blind peer', (b) => b.objects.length === 1)
  assert.equal(board.objects[0].title, 'Kept by the blind peer')
  console.log('✓ joiner reads the board from the blind peer alone')
} catch (err) {
  console.error(blind.log.slice(-20).join('\n'))
  throw err
} finally {
  await Promise.all(sessions.map((session) => session.close().catch(() => {})))
  blind.child.kill()
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })))
}
