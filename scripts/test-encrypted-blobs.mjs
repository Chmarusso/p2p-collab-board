// Proves the image attachment model used by workers/main.js: a member's
// Hyperblobs core encrypted with a key derived from the board secret replicates
// to another member, is readable with the key, unreadable without it, and is
// fetched sparsely (only the requested blob's blocks are downloaded).
import Corestore from 'corestore'
import Hyperblobs from 'hyperblobs'
import sodium from 'sodium-native'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function blobEncryptionKey(secret) {
  const key = Buffer.alloc(32)
  sodium.crypto_generichash(key, Buffer.from('opencollab/blobs/v1'), secret)
  return key
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencollab-blobs-'))
const secret = crypto.randomBytes(32)
const encryption = { key: blobEncryptionKey(secret) }

const author = new Corestore(path.join(root, 'author'))
const member = new Corestore(path.join(root, 'member'))
const outsider = new Corestore(path.join(root, 'outsider'))

function link(a, b) {
  const s1 = a.replicate(true)
  const s2 = b.replicate(false)
  s1.pipe(s2).pipe(s1)
}
link(author, member)
link(author, outsider)

const authorCore = author.get({ name: 'blobs:test-board', encryption })
await authorCore.ready()
const blobs = new Hyperblobs(authorCore)
const first = crypto.randomBytes(200 * 1024)
const image = crypto.randomBytes(300 * 1024)
await blobs.put(first)
const id = await blobs.put(image)

const memberCore = member.get({ key: authorCore.key, encryption })
await memberCore.ready()
const fetched = await new Hyperblobs(memberCore).get(id, { timeout: 10000 })
assert.ok(fetched.equals(image), 'member with the board key reads the image')
assert.equal(await memberCore.has(0), false, 'blocks of other blobs are not downloaded')

const outsiderCore = outsider.get({ key: authorCore.key })
await outsiderCore.ready()
const raw = await outsiderCore.get(id.blockOffset, { timeout: 10000, decrypt: false })
assert.ok(raw, 'outsider can replicate a block')
assert.ok(!image.includes(raw.subarray(-1024)), 'outsider only sees ciphertext')

const onDisk = await fs.readdir(path.join(root, 'author'), { recursive: true })
console.log(
  JSON.stringify({
    ok: true,
    blobBytes: image.length,
    memberDownloadedOtherBlob: false,
    outsiderSawPlaintext: false,
    authorFiles: onDisk.length
  })
)

await Promise.all([author.close(), member.close(), outsider.close()])
await fs.rm(root, { recursive: true, force: true })
