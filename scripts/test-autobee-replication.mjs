import Autobee from 'autobee'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencollab-autobee-'))
const apply = async (nodes, view, host) => {
  const batch = view.write()
  for (const node of nodes) {
    const operation = JSON.parse(node.value.toString())
    if (operation.type === 'writer-request')
      await host.addWriter(Buffer.from(operation.writer, 'hex'))
    batch.tryPut(Buffer.from(`op:${node.key.toString('hex')}:${node.length}`), node.value)
  }
  await batch.flush()
}

const store1 = new Corestore(path.join(root, 'one'))
const db1 = new Autobee(store1, null, { apply, optimistic: true })
await db1.ready()
const store2 = new Corestore(path.join(root, 'two'))
const db2 = new Autobee(store2, db1.key, { apply, optimistic: true })
await db2.ready()

const swarm1 = new Hyperswarm()
const swarm2 = new Hyperswarm()
let connections = 0
swarm1.on('connection', (conn) => {
  connections++
  store1.replicate(conn)
})
swarm2.on('connection', (conn) => {
  connections++
  store2.replicate(conn)
})
await Promise.all([
  swarm1.join(db1.discoveryKey, { client: true, server: true }).flushed(),
  swarm2.join(db2.discoveryKey, { client: true, server: true }).flushed()
])
// Keep the assertion deterministic even when the public DHT is slow or
// unavailable in CI. The production worker uses the Hyperswarm path above;
// this direct Autobee stream proves the multiwriter protocol itself.
const direct1 = db1.replicate(true)
const direct2 = db2.replicate(false)
direct1.pipe(direct2).pipe(direct1)

await db1.append(Buffer.from(JSON.stringify({ test: 'electron-to-ios' })))
await db2.append(
  Buffer.from(JSON.stringify({ type: 'writer-request', writer: db2.local.key.toString('hex') })),
  { optimistic: true }
)
for (let i = 0; i < 50; i++) {
  await new Promise((resolve) => setTimeout(resolve, 200))
  await db2.update()
  const result = await db2.view.get(Buffer.from(`op:${db1.local.key.toString('hex')}:1`))
  if (result) {
    await db2.append(Buffer.from(JSON.stringify({ test: 'ios-to-electron' })), { optimistic: true })
    for (let j = 0; j < 20; j++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      await db1.update()
      const reverse = await db1.view.get(Buffer.from(`op:${db2.local.key.toString('hex')}:1`))
      if (reverse) {
        console.log(
          JSON.stringify({
            ok: true,
            transport: 'autobee-direct',
            dhtConnections: connections,
            boardKey: db1.key.toString('hex')
          })
        )
        await Promise.all([swarm1.destroy(), swarm2.destroy(), store1.close(), store2.close()])
        await fs.rm(root, { recursive: true, force: true })
        process.exit(0)
      }
    }
  }
}

console.error(
  JSON.stringify({
    ok: false,
    transport: 'autobee-direct',
    dhtConnections: connections,
    boardKey: db1.key.toString('hex')
  })
)
await Promise.all([swarm1.destroy(), swarm2.destroy(), store1.close(), store2.close()])
await fs.rm(root, { recursive: true, force: true })
process.exit(1)
