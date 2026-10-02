import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import crypto from 'hypercore-crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const invite = process.argv[2]?.trim()
if (!invite) {
  console.error('Usage: node scripts/board-relay.mjs <invitation-token> [storage-dir]')
  process.exit(1)
}

const storage = process.argv[3] || path.join(os.homedir(), '.opencollab-relay')
await fs.mkdir(storage, { recursive: true })

const secret = Buffer.from(invite.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
if (secret.length !== 32) throw new Error('Invalid invitation token')

const roomTopic = crypto.hash(secret)
const store = new Corestore(path.join(storage, roomTopic.toString('hex')))
const boardKeyPair = crypto.keyPair(secret)
const boardCore = store.get({ key: boardKeyPair.publicKey, keyPair: boardKeyPair })
const swarm = new Hyperswarm()

swarm.on('connection', (connection) => {
  console.log('board replica connected')
  store.replicate(connection)
})
swarm.on('error', (error) => console.error('relay error:', error.message))

await boardCore.ready()
boardCore.on('append', () => console.log(`Encrypted operations: ${boardCore.length}`))
swarm.join(boardCore.discoveryKey, { client: true, server: true })
console.log(`OpenCollab relay running for ${invite}`)
console.log(`Encrypted operations: ${boardCore.length}`)

async function shutdown() {
  await swarm.destroy()
  await store.close()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
