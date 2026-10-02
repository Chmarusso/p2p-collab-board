import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const invite = process.argv[2] || 'EOKIEyGA52UcFoMwBkNmE2t0RpHdcPAqdSm3AaVZ_3o'
const secret = Buffer.from(invite.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
if (secret.length !== 32) throw new Error('Invalid invitation token')

const keyPair = crypto.keyPair(secret)
const stores = await Promise.all(
  [1, 2].map(async (peer) => {
    const store = new Corestore(await fs.mkdtemp(path.join(os.tmpdir(), `opencollab-peer-${peer}-`)))
    const core = store.get({ key: keyPair.publicKey, keyPair: crypto.keyPair(secret) })
    await core.ready()
    return { store, core, swarm: new Hyperswarm(), peer }
  })
)

console.log('invite:', invite)
console.log('core key:', stores[0].core.key.toString('hex'))
console.log('discovery key:', stores[0].core.discoveryKey.toString('hex'))
console.log('same core key:', stores[0].core.key.equals(stores[1].core.key))
console.log('same discovery key:', stores[0].core.discoveryKey.equals(stores[1].core.discoveryKey))

let connections = 0
for (const { store, swarm, core, peer } of stores) {
  swarm.on('connection', (connection) => {
    connections++
    console.log(`peer ${peer}: connection`)
    store.replicate(connection)
  })
  swarm.join(core.discoveryKey, { client: true, server: true })
}

await stores[0].core.append(Buffer.from(JSON.stringify({ type: 'encrypted-test-record' })))
await new Promise((resolve) => setTimeout(resolve, 10000))
await stores[1].core.update()

const received = []
for await (const block of stores[1].core.createReadStream()) received.push(block.toString())
console.log({ connections, received })

await Promise.all(stores.map(({ swarm }) => swarm.destroy()))
await Promise.all(stores.map(({ store }) => store.close()))

if (!received.some((block) => block.includes('encrypted-test-record'))) {
  throw new Error('Encrypted record did not replicate')
}
