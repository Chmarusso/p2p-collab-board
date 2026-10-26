const PearRuntime = require('pear-runtime')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Autobee = require('autobee')
const Hyperblobs = require('hyperblobs')
const BlindPeering = require('blind-peering')
const Wakeup = require('protomux-wakeup')
const Identity = require('keet-identity-key')
const crypto = require('hypercore-crypto')
const sodium = require('sodium-native')
const goodbye = require('graceful-goodbye')
const FramedStream = require('framed-stream')
const fs = require('bare-fs')
const path = require('bare-path')
const dir = require('bare-storage')
const { isBareKit } = require('which-runtime')
const {
  messageTypes,
  normalizeInvite,
  deriveBoard,
  boardAlerts,
  boardActivity,
  boardStats,
  myCards,
  cleanRule,
  positionAt,
  REACTIONS,
  LINK_KINDS,
  OP_TYPES,
  ROLES,
  LIMITS,
  BLIND_PEERS
} = require('@opencollab/board-protocol')

const argv = (index) => Bare.argv[index + (isBareKit ? 0 : 2)]

const updaterConfig = {
  updates: argv(0) !== 'false',
  version: argv(1),
  upgrade: argv(2),
  name: argv(3),
  dir: argv(4) || dir.persistent(),
  app: argv(5)
}

const pipe = new FramedStream(Bare.IPC)
const store = new Corestore(path.join(updaterConfig.dir, 'pear-runtime', 'corestore'))
const swarm = new Hyperswarm()
const chatSwarm = new Hyperswarm()
const replicationSwarm = new Hyperswarm()
const pear = new PearRuntime({ ...updaterConfig, swarm, store })
const chatConnections = new Map()
let replicationPeerCount = 0
let roomState = null
let boardDb = null
let boardStore = null
let identityState = null
let identityStatus = null
let identityReady = null
const identityFile = path.join(updaterConfig.dir, 'identity-mnemonic.json')
const legacyIdentityFile = path.join(updaterConfig.dir, 'identity-mnemonic.txt')
// Verified board ops by id, in log order. The board shown to the UI is always
// derived from these (see board-protocol/board.js), never merged from peers.
let boardOps = new Map()
let boardState = deriveBoard([])
// The identity that signed the first op from the board's bootstrap writer, i.e.
// the device that created the board. Moderation (roles, bans) anchors on it.
let boardOwner = null
let boardDigest = null
let reportedDisplayName = null
// Proof → hash of what it verified, so re-reading the log skips the crypto.
const verifiedOps = new Map()
// Never stamp an op lower than one already seen, even with a lagging clock.
let lastTs = 0
let boardName = ''
let roomSyncTimer = null
let replicationDiscovery = null
let boardUpdateInFlight = null
// Image attachments: each member appends images to their own Hyperblobs core,
// block-encrypted with a key derived from the board secret, and posts carry
// references to them. Readers open the author's core by key and fetch sparsely.
let blobsCore = null
let boardBlobs = null
const remoteBlobs = new Map()
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const IMAGE_FETCH_TIMEOUT = 20000
// Videos share the card's attachment set with images. They are streamed from
// a file into the blob core and played from a decrypted copy in mediaCacheDir,
// which is emptied whenever the board closes.
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const BLOB_BLOCK = 64 * 1024
const mediaCacheDir = path.join(updaterConfig.dir, 'media-cache')
const mediaCache = new Map() // media key → Promise<path>

function derivePasswordKey(password, salt) {
  const key = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES)
  sodium.crypto_pwhash(
    key,
    Buffer.from(password),
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_DEFAULT
  )
  return key
}

function encryptMnemonic(mnemonic, password) {
  const salt = Buffer.alloc(sodium.crypto_pwhash_SALTBYTES)
  const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(salt)
  sodium.randombytes_buf(nonce)
  const key = derivePasswordKey(password, salt)
  const plaintext = Buffer.from(mnemonic)
  const ciphertext = Buffer.alloc(plaintext.length + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(ciphertext, plaintext, nonce, key)
  return JSON.stringify({
    version: 1,
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  })
}

function decryptMnemonic(serialized, password) {
  const stored = JSON.parse(serialized)
  if (stored.version !== 1) throw new Error('Unsupported identity file')
  const salt = Buffer.from(stored.salt, 'base64')
  const nonce = Buffer.from(stored.nonce, 'base64')
  const ciphertext = Buffer.from(stored.ciphertext, 'base64')
  const key = derivePasswordKey(password, salt)
  const plaintext = Buffer.alloc(ciphertext.length - sodium.crypto_secretbox_MACBYTES)
  if (!sodium.crypto_secretbox_open_easy(plaintext, ciphertext, nonce, key)) {
    throw new Error('Incorrect password')
  }
  return plaintext.toString()
}

async function inspectIdentity() {
  try {
    await fs.promises.access(identityFile)
    identityStatus = 'locked'
    return
  } catch {}

  try {
    await fs.promises.access(legacyIdentityFile)
    identityStatus = 'migrate'
  } catch {
    identityStatus = 'create'
  }
}

async function activateIdentity(mnemonic, clearLocal = false) {
  const identity = await Identity.from({ mnemonic })
  const deviceKeyPair = crypto.keyPair()
  const deviceProof = await identity.bootstrap(deviceKeyPair.publicKey)
  identityState = { identity, deviceKeyPair, deviceProof }
  identityStatus = 'unlocked'
  if (clearLocal) {
    try {
      await fs.promises.unlink(identityFile)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    try {
      await fs.promises.unlink(legacyIdentityFile)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }
}

async function unlockIdentity(password, create = false) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Use a password with at least 8 characters')
  }

  let mnemonic
  if (create) {
    try {
      mnemonic = (await fs.promises.readFile(legacyIdentityFile, 'utf8')).trim()
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      mnemonic = Identity.generateMnemonic()
    }
  } else {
    mnemonic = decryptMnemonic(await fs.promises.readFile(identityFile, 'utf8'), password)
  }

  await fs.promises.mkdir(updaterConfig.dir, { recursive: true })
  await fs.promises.writeFile(identityFile, encryptMnemonic(mnemonic, password), { mode: 0o600 })
  try {
    await fs.promises.unlink(legacyIdentityFile)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  await activateIdentity(mnemonic)
}

const identityInspection = inspectIdentity()

pear.updater.on('error', console.error)
if (updaterConfig.updates !== false) {
  swarm.on('connection', (connection) => store.replicate(connection))
  swarm.join(pear.updater.drive.core.discoveryKey, {
    client: true,
    server: false
  })
}

pear.updater.on('updating', () => pipe.write('updating'))
pear.updater.on('updated', () => pipe.write('updated'))

goodbye(async () => {
  clearInterval(peekTimer)
  await clearMediaCache()
  await peekSwarm.destroy()
  if (peekStore) await peekStore.close()
  await chatSwarm.destroy()
  if (blindPeering) await blindPeering.close()
  await replicationSwarm.destroy()
  await swarm.destroy()
  await Promise.allSettled([...pendingAppends])
  if (boardDb) await boardDb.close()
  if (boardStore) await boardStore.close()
  await pear.close()
  await store.close()
})

function sendPeerCount() {
  const count =
    [...chatConnections.values()].filter((peer) => peer.authenticated).length + replicationPeerCount
  pipe.write(JSON.stringify({ type: 'peer-count', count }))
}

function sendBoardState() {
  const { objects, profiles, columns, labels, theme, info, owner, members, rules } = boardState
  pipe.write(
    JSON.stringify({
      type: 'board-state',
      objects,
      profiles,
      columns,
      labels,
      theme,
      info,
      owner,
      members,
      rules
    })
  )
}

function sendBoardSynced() {
  pipe.write(JSON.stringify({ type: 'board-synced' }))
}

function encryptBoardPayload(payload) {
  const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  const plaintext = Buffer.from(JSON.stringify(payload))
  const ciphertext = Buffer.alloc(plaintext.length + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(ciphertext, plaintext, nonce, roomState.secret)
  return { nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64') }
}

// `secret` defaults to the open board's; background checks pass their own.
function decryptBoardPayload(encrypted, secret = roomState?.secret) {
  if (
    !secret ||
    typeof encrypted?.nonce !== 'string' ||
    typeof encrypted?.ciphertext !== 'string'
  ) {
    return null
  }
  try {
    const nonce = Buffer.from(encrypted.nonce, 'base64')
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64')
    const plaintext = Buffer.alloc(ciphertext.length - sodium.crypto_secretbox_MACBYTES)
    if (!sodium.crypto_secretbox_open_easy(plaintext, ciphertext, nonce, secret)) {
      return null
    }
    return JSON.parse(plaintext.toString())
  } catch {
    return null
  }
}

function encryptBoardMessage(message) {
  return {
    type: 'board:message',
    id: message.id,
    identity: message.identity,
    proof: message.proof,
    encrypted: encryptBoardPayload(message.payload)
  }
}

function decryptBoardMessage(message, secret) {
  const payload = decryptBoardPayload(message.encrypted, secret)
  return payload
    ? {
        type: 'board:message',
        id: message.id,
        identity: message.identity,
        proof: message.proof,
        payload
      }
    : null
}

function encryptBoardOps() {
  return {
    type: 'board:ops',
    encrypted: encryptBoardPayload({
      boardName,
      ops: [...boardOps.values()].map(({ id, identity, proof, payload }) => ({
        id,
        identity,
        proof,
        payload
      }))
    })
  }
}

function learnBoardName(name) {
  if (typeof name !== 'string' || !name || boardName) return
  boardName = name
  pipe.write(JSON.stringify({ type: 'board-name', name: boardName }))
}

function opsDigest() {
  if (!boardDigest) {
    const hash = Buffer.alloc(32)
    sodium.crypto_generichash(hash, Buffer.from([...boardOps.keys()].sort().join('\n')))
    boardDigest = hash.toString('hex')
  }
  return boardDigest
}

const mediaList = (list) =>
  Array.isArray(list) ? list.filter(isMediaRef).slice(0, MAX_IMAGES) : []

function deriveState() {
  boardState = deriveBoard([...boardOps.values()], { images: mediaList, owner: boardOwner })
  lastTs = Math.max(lastTs, boardState.maxTs)
  boardDigest = null
  updateOpenBoardAlerts()
  // A display name set on another device arrives with the ops.
  const ownIdentity = identityState?.identity.identityPublicKey.toString('hex')
  const displayName = ownIdentity ? boardState.profiles[ownIdentity] : null
  if (displayName && displayName !== reportedDisplayName) {
    reportedDisplayName = displayName
    pipe.write(JSON.stringify({ type: 'profile-status', identity: ownIdentity, displayName }))
  }
}

// Adds a verified op; false for duplicates, unknown types and bad signatures.
function ingest(message) {
  if (typeof message?.id !== 'string' || boardOps.has(message.id)) return false
  if (!OP_TYPES.includes(message.payload?.type) || !verifyBoardMessage(message)) return false
  const { id, identity, proof, payload } = message
  boardOps.set(id, { type: 'board:message', id, identity, proof, payload })
  return true
}

// Reads a board's verified ops, its name and its owner from the Autobee view.
// View keys are `op:<writer>:<length>`, so the bootstrap writer's entries come
// in append order and the first verified one names the owner.
async function readBoardLog(db, secret) {
  const bootstrap = db.bootstrap.key.toString('hex')
  const ops = new Map()
  let name = ''
  let owner = null
  for await (const entry of db.view.createReadStream()) {
    try {
      const stored = JSON.parse(entry.value.toString())
      if (stored.type === 'board:meta') {
        name = decryptBoardPayload(stored.encrypted, secret)?.boardName || name
        continue
      }
      const message = decryptBoardMessage(stored, secret)
      if (
        typeof message?.id === 'string' &&
        !ops.has(message.id) &&
        OP_TYPES.includes(message.payload?.type) &&
        verifyBoardMessage(message)
      ) {
        ops.set(message.id, message)
        if (!owner && entry.key.toString().split(':')[1] === bootstrap) owner = message.identity
      }
    } catch {
      console.error('Invalid persisted board operation')
    }
  }
  return { ops, name, owner }
}

async function loadBoard() {
  if (!boardDb) return
  await boardDb.ready()
  const { ops, name, owner } = await readBoardLog(boardDb, roomState?.secret)
  if (name) boardName = name
  if (owner) boardOwner = owner
  // Ops received live but not yet in the view stay, after the persisted ones.
  for (const [id, message] of boardOps) if (!ops.has(id)) ops.set(id, message)
  boardOps = ops
  deriveState()
}

async function applyBoardNodes(nodes, view, host) {
  const batch = view.write()
  for (const node of nodes) {
    try {
      const operation = JSON.parse(node.value.toString())
      if (operation.type === 'writer-request' && typeof operation.writer === 'string') {
        await host.addWriter(Buffer.from(operation.writer, 'hex'), { isIndexer: true })
      }
    } catch {}
    const key = Buffer.from(
      `op:${node.key.toString('hex')}:${String(node.length).padStart(12, '0')}`
    )
    batch.tryPut(key, node.value)
  }
  await batch.flush()
}

async function onBoardUpdate() {
  try {
    const previousName = boardName
    await loadBoard()
    // A joiner learns the name from replicated board metadata; tell the UI.
    if (boardName && boardName !== previousName) {
      pipe.write(JSON.stringify({ type: 'board-name', name: boardName }))
    }
    sendBoardState()
    sendBoardSynced()
  } catch (error) {
    console.error('Board update refresh failed', error)
  }
}

function refreshBoard() {
  if (!boardDb || boardUpdateInFlight) return boardUpdateInFlight
  boardUpdateInFlight = boardDb
    .update()
    .catch((error) => console.error('Board replication refresh failed', error))
    .finally(() => {
      boardUpdateInFlight = null
    })
  return boardUpdateInFlight
}

async function persistBoardMetadata() {
  if (!boardName) return
  await boardDb.append(
    Buffer.from(
      JSON.stringify({ type: 'board:meta', encrypted: encryptBoardPayload({ boardName }) })
    )
  )
}

function sendIdentityStatus(error = null, mnemonic = null) {
  pipe.write(
    JSON.stringify({
      type: 'identity-status',
      status: identityStatus,
      publicKey: identityState?.identity.identityPublicKey.toString('hex') || null,
      error,
      mnemonic
    })
  )
}

function writeConnection(connection, message) {
  connection.write(JSON.stringify(message) + '\n')
}

function authenticate(challenge, secret) {
  const mac = Buffer.alloc(sodium.crypto_auth_BYTES)
  sodium.crypto_auth(mac, challenge, secret)
  return mac.toString('base64')
}

function encodeInvite(secret) {
  return secret.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function encodeBoardInvite(secret, key) {
  return Buffer.from(
    JSON.stringify({ v: 2, s: encodeInvite(secret), b: key.toString('hex') })
  ).toString('base64url')
}

function decodeInvite(invite) {
  const normalized = normalizeInvite(invite)
  try {
    const payload = JSON.parse(Buffer.from(normalized, 'base64url').toString())
    if (payload?.v === 2 && typeof payload.s === 'string' && typeof payload.b === 'string') {
      const secret = Buffer.from(payload.s.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
      const key = Buffer.from(payload.b, 'hex')
      if (secret.length === 32 && key.length === 32) return { secret, key }
    }
  } catch {}
  const secret = Buffer.from(normalized.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  return { secret, key: null }
}

function broadcast(message) {
  const data = JSON.stringify(encryptBoardMessage(message)) + '\n'
  for (const peer of chatConnections.values()) {
    if (peer.authenticated) peer.connection.write(data)
  }
}

function broadcastDigest() {
  const data = JSON.stringify({ type: 'board:digest', hash: opsDigest() }) + '\n'
  for (const peer of chatConnections.values()) {
    if (peer.authenticated) peer.connection.write(data)
  }
}

function signedPayload(message) {
  return Buffer.from(JSON.stringify(message.payload))
}

function verifyBoardMessage(message) {
  try {
    const signed = signedPayload(message)
    const hash = Buffer.alloc(32)
    sodium.crypto_generichash(hash, Buffer.concat([Buffer.from(message.identity), signed]))
    const cached = verifiedOps.get(message.proof)
    if (cached) return cached === hash.toString('hex')
    const proof = Buffer.from(message.proof, 'base64')
    const expectedIdentity = Buffer.from(message.identity, 'hex')
    if (!Identity.verify(proof, signed, { expectedIdentity })) return false
    verifiedOps.set(message.proof, hash.toString('hex'))
    return true
  } catch {
    return false
  }
}

function blobEncryption() {
  const key = Buffer.alloc(32)
  sodium.crypto_generichash(key, Buffer.from('opencollab/blobs/v1'), roomState.secret)
  return { key }
}

const isVideo = (ref) => VIDEO_TYPES.includes(ref?.type)

function isMediaRef(ref) {
  const video = isVideo(ref)
  return (
    typeof ref?.core === 'string' &&
    /^[0-9a-f]{64}$/.test(ref.core) &&
    (video || IMAGE_TYPES.includes(ref.type)) &&
    ['byteOffset', 'blockOffset', 'blockLength', 'byteLength'].every(
      (field) => Number.isSafeInteger(ref.id?.[field]) && ref.id[field] >= 0
    ) &&
    ref.id.byteLength > 0 &&
    ref.id.byteLength <= (video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES) &&
    (ref.name === undefined || ref.name === null || typeof ref.name === 'string')
  )
}

const imageKey = (ref) => `${ref.core}:${ref.id.blockOffset}:${ref.id.blockLength}`

// Every media ref the open board shows: card attachments, icon, background, avatars.
function boardMediaRefs() {
  const { info, theme, members } = boardState
  return [
    ...boardState.objects.flatMap((object) => object.images || []),
    ...(info.icon ? [info.icon] : []),
    ...(theme.backgroundImage ? [theme.backgroundImage] : []),
    ...members.flatMap((member) => (member.avatar ? [member.avatar] : []))
  ]
}

const findMediaRef = (ref) =>
  isMediaRef(ref) ? boardMediaRefs().find((known) => imageKey(known) === imageKey(ref)) : null

async function blobsOf(ref) {
  let blobs = ref.core === blobsCore.key.toString('hex') ? boardBlobs : remoteBlobs.get(ref.core)
  if (!blobs) {
    const core = boardStore.get({ key: Buffer.from(ref.core, 'hex'), encryption: blobEncryption() })
    await core.ready()
    blobs = new Hyperblobs(core)
    remoteBlobs.set(ref.core, blobs)
  }
  return blobs
}

async function readImage(ref) {
  return (await blobsOf(ref)).get(ref.id, { timeout: IMAGE_FETCH_TIMEOUT })
}

// MP4 and QuickTime files carry an `ftyp` box at byte 4, WebM starts with the
// EBML magic. Only those are accepted, so a file path can't upload anything else.
function videoTypeOf(head) {
  if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') {
    return head.toString('latin1', 8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4'
  }
  const ebml = [0x1a, 0x45, 0xdf, 0xa3]
  if (head.length >= 4 && ebml.every((byte, i) => head[i] === byte)) return 'video/webm'
  return null
}

// Streams a video file into this member's blob core; returns its ref.
async function storeVideo(file, onProgress) {
  if (typeof file?.path !== 'string' || !file.path) throw new Error('No video file')
  const local = decodeURIComponent(file.path.replace(/^file:\/\//, ''))
  const handle = await fs.promises.open(local, 'r')
  try {
    const { size } = await handle.stat()
    if (!size) throw new Error('The video is empty')
    if (size > MAX_VIDEO_BYTES) throw new Error('Videos can be up to 200 MB')
    const head = Buffer.alloc(12)
    await handle.read(head, 0, head.length, 0)
    const type = videoTypeOf(head)
    if (!type) throw new Error('Only MP4, MOV and WebM videos can be attached')
    const stream = boardBlobs.createWriteStream()
    const done = new Promise((resolve, reject) => {
      stream.once('error', reject)
      stream.once('close', resolve)
    })
    let position = 0
    let reported = 0
    try {
      while (position < size) {
        const chunk = Buffer.alloc(Math.min(BLOB_BLOCK, size - position))
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
        if (!bytesRead) break
        position += bytesRead
        if (!stream.write(chunk.subarray(0, bytesRead))) {
          await new Promise((resolve) => stream.once('drain', resolve))
        }
        if (position - reported >= 4 * 1024 * 1024) {
          reported = position
          onProgress(position, size)
        }
      }
      stream.end()
    } catch (err) {
      stream.destroy(err)
      throw err
    }
    await done
    const name = typeof file.name === 'string' ? file.name.slice(0, 120) : null
    return {
      core: blobsCore.key.toString('hex'),
      id: stream.id,
      type,
      width: Number.isSafeInteger(file.width) ? file.width : null,
      height: Number.isSafeInteger(file.height) ? file.height : null,
      name
    }
  } finally {
    await handle.close()
  }
}

// Writes a decrypted copy of a video to the cache and returns its path, so the
// UI can play (and seek) it from disk instead of receiving it over IPC.
function cachedMedia(ref) {
  const key = imageKey(ref)
  if (!mediaCache.has(key)) {
    const extension = { 'video/webm': 'webm', 'video/quicktime': 'mov' }[ref.type] || 'mp4'
    const hash = Buffer.alloc(16)
    sodium.crypto_generichash(hash, Buffer.from(key))
    const file = path.join(mediaCacheDir, `${hash.toString('hex')}.${extension}`)
    const job = (async () => {
      await fs.promises.mkdir(mediaCacheDir, { recursive: true })
      const blobs = await blobsOf(ref)
      const partial = file + '.part'
      const handle = await fs.promises.open(partial, 'w')
      try {
        let position = 0
        for await (const block of blobs.createReadStream(ref.id, {
          timeout: IMAGE_FETCH_TIMEOUT
        })) {
          await handle.write(block, 0, block.length, position)
          position += block.length
        }
      } finally {
        await handle.close()
      }
      await fs.promises.rename(partial, file)
      return file
    })()
    job.catch(() => mediaCache.delete(key))
    mediaCache.set(key, job)
  }
  return mediaCache.get(key)
}

async function clearMediaCache() {
  mediaCache.clear()
  await fs.promises.rm(mediaCacheDir, { recursive: true, force: true }).catch(() => {})
}

async function storeImages(images) {
  const refs = []
  for (const image of (Array.isArray(images) ? images : []).slice(0, MAX_IMAGES)) {
    if (!IMAGE_TYPES.includes(image?.type) || typeof image.data !== 'string') continue
    const bytes = Buffer.from(image.data, 'base64')
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) continue
    const id = await boardBlobs.put(bytes)
    refs.push({
      core: blobsCore.key.toString('hex'),
      id,
      type: image.type,
      width: Number.isSafeInteger(image.width) ? image.width : null,
      height: Number.isSafeInteger(image.height) ? image.height : null
    })
  }
  return refs
}

// Appends still being written; closing the board waits for them, or an edit
// made just before switching boards would be lost.
const pendingAppends = new Set()

function sendBoardMessage(message) {
  if (!ingest(message)) return
  const append = boardDb
    .append(Buffer.from(JSON.stringify(encryptBoardMessage(message))), { optimistic: true })
    .catch((err) => console.error('Board persistence failed', err))
  pendingAppends.add(append)
  append.finally(() => pendingAppends.delete(append))
  broadcast(message)
  deriveState()
  sendBoardState()
}

function nextTs() {
  lastTs = Math.max(Date.now(), lastTs + 1)
  return lastTs
}

async function unlockedIdentity() {
  if (!identityReady) throw new Error('Unlock your identity before editing the board')
  await identityReady
  return identityState.identity.identityPublicKey.toString('hex')
}

// Signs `payload` as the unlocked identity and applies it like a remote op.
async function sendOwnOp(payload) {
  const identity = await unlockedIdentity()
  if (!boardDb) throw new Error('Open a board before editing it')
  const message = {
    type: 'board:message',
    id: `${identity.slice(0, 12)}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${payload.type}`,
    identity,
    payload: { ...payload, ts: nextTs() }
  }
  message.proof = Identity.attestData(
    signedPayload(message),
    identityState.deviceKeyPair,
    identityState.deviceProof
  ).toString('base64')
  sendBoardMessage(message)
  return message
}

const newId = (prefix) => `${prefix}:${crypto.randomBytes(6).toString('hex')}`
// Unique even for several cards or comments created in the same millisecond.
// The counter keeps several made in the same millisecond in creation order,
// since comments sort by time and then by id.
let idSequence = 0
const uniqueId = (identity) =>
  `${identity.slice(0, 12)}-${Date.now()}-${String(idSequence++ % 1e6).padStart(6, '0')}${crypto.randomBytes(3).toString('hex')}`

const cardById = (id) => boardState.objects.find((object) => object.id === id)
const memberOf = (identity) => boardState.members.find((member) => member.identity === identity)

// Board actions the worker refuses get a reply, so the UI can say why.
function replyError(msg, error) {
  pipe.write(
    JSON.stringify({
      type: 'board-action-error',
      action: msg.type,
      requestId: msg.requestId,
      error
    })
  )
}

// Everything on the board as plain JSON. No invite or secret: the file is safe
// to share, and attachments stay references to the members' encrypted blobs.
function boardExport() {
  const { objects, columns, labels, theme, info, profiles, owner, members } = boardState
  return {
    format: 'opencollab-board',
    version: 1,
    exportedAt: new Date().toISOString(),
    board: { key: boardDb.key.toString('hex'), name: boardName, description: info.description },
    owner,
    members,
    profiles,
    columns,
    labels,
    theme,
    icon: info.icon,
    cards: objects
  }
}
const columnById = (id) => boardState.columns.find((column) => column.id === id)

function cardsIn(columnId, exceptId = null) {
  return boardState.objects.filter(
    (object) => object.columnId === columnId && object.id !== exceptId
  )
}

function columnsExcept(columnId) {
  return boardState.columns.filter((column) => column.id !== columnId)
}

// Every board gets its own namespace ("space") in one long-lived board store.
// Boards opened before spaces existed all share the root namespace: one Autobee
// with the same local writer, so boards created on one device even shared a key.
// Those keep working as they are ("legacy"); new boards are separate.
const spacesFile = path.join(updaterConfig.dir, 'board-spaces.json')
let spaces = null

async function readSpaces() {
  if (spaces) return spaces
  try {
    spaces = JSON.parse(await fs.promises.readFile(spacesFile, 'utf8'))
  } catch {
    spaces = {}
  }
  return spaces
}

async function rememberSpace(key, id) {
  const known = await readSpaces()
  if (known[key] === id) return
  known[key] = id
  await fs.promises.mkdir(updaterConfig.dir, { recursive: true })
  await fs.promises.writeFile(spacesFile, JSON.stringify(known))
}

// The store session to open a board in. `key` null means a new board.
async function boardSpace(key) {
  // One root store for the worker's life. If it ever ends up closed (a failed
  // open, a shutdown racing a request), start a fresh one instead of failing
  // every board open with "Corestore is closed".
  if (goodbye.exiting) throw new Error('OpenCollab is shutting down. Reopen the app.')
  if (!boardStore || boardStore.closing) {
    boardStore = new Corestore(path.join(updaterConfig.dir, 'board-store'))
  }
  if (!key) {
    const id = crypto.randomBytes(16).toString('hex')
    return { id, store: boardStore.namespace(id) }
  }
  const hex = key.toString('hex')
  let id = (await readSpaces())[hex]
  if (!id) {
    // First open since spaces: a board whose log is already stored here was
    // opened before, in the root namespace. Anything else is a new join.
    const core = boardStore.get({ key, active: false })
    await core.ready()
    id = core.length > 0 ? 'legacy' : hex
    await core.close()
    await rememberSpace(hex, id)
  }
  return { id, store: id === 'legacy' ? boardStore.session() : boardStore.namespace(id) }
}

// Notifications across boards. The UI passes the boards this identity joined;
// the open one's alerts follow its ops live, the others are checked in the
// background: opened read-only in a separate store, synced for a short
// window with whoever is online, read, and closed again.
const watched = new Map() // board key hex → { invite, name, secret, key, alerts, checkedAt }
const PEEK_INTERVAL = 3 * 60 * 1000
const PEEK_WINDOW = 15000
const PEEK_NO_PEERS = 6000
const peekSwarm = new Hyperswarm()
let peekStore = null
let peekTimer = null
let peeking = false
let openAlertsTimer = null
let activePeek = null

peekSwarm.on('connection', (connection) => {
  if (!peekStore) return connection.destroy()
  peekStore.replicate(connection)
})
peekSwarm.on('error', (error) => console.error('Board check swarm error', error))

const ownIdentityHex = () => identityState?.identity.identityPublicKey.toString('hex') || null

function sendAlerts() {
  pipe.write(
    JSON.stringify({
      type: messageTypes.boardAlerts,
      boards: [...watched].map(([key, board]) => ({
        key,
        invite: board.invite,
        name: board.name,
        alerts: board.alerts,
        mine: board.mine || [],
        checkedAt: board.checkedAt
      }))
    })
  )
}

function updateOpenBoardAlerts() {
  const board = boardDb && watched.get(boardDb.key.toString('hex'))
  if (!board) return
  // Ops arrive in bursts; one pass after they settle is enough.
  clearTimeout(openAlertsTimer)
  openAlertsTimer = setTimeout(() => {
    if (!boardDb || watched.get(boardDb.key.toString('hex')) !== board) return
    board.alerts = boardAlerts([...boardOps.values()], boardState, ownIdentityHex())
    board.mine = myCards(boardState, ownIdentityHex())
    board.checkedAt = Date.now()
    if (boardName) board.name = boardName
    sendAlerts()
  }, 300)
}

async function peekBoard(key, board) {
  // Boards in their own space are read from this device's store, and synced
  // with anyone online meanwhile. Legacy boards share the root namespace with
  // whatever is open, so they are synced into a separate read-only store.
  const space = await boardSpace(board.key)
  const legacy = space.id === 'legacy'
  if (legacy) {
    await space.store.close()
    peekStore ??= new Corestore(path.join(updaterConfig.dir, 'peek-store'))
  }
  const swarm = legacy ? peekSwarm : replicationSwarm
  const db = new Autobee(legacy ? peekStore.namespace(key) : space.store, board.key, {
    apply: applyBoardNodes,
    optimistic: true
  })
  let discovery = null
  try {
    await db.ready()
    discovery = swarm.join(db.discoveryKey, { client: true, server: true })
    const started = Date.now()
    while (Date.now() - started < PEEK_WINDOW) {
      await db.update().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 1500))
      if (!swarm.connections.size && Date.now() - started > PEEK_NO_PEERS) break
    }
    const { ops, name, owner } = await readBoardLog(db, board.secret)
    const messages = [...ops.values()]
    const state = deriveBoard(messages, { owner })
    board.alerts = boardAlerts(messages, state, ownIdentityHex())
    board.mine = myCards(state, ownIdentityHex())
    if (name) board.name = name
    board.checkedAt = Date.now()
  } finally {
    if (discovery) await discovery.destroy().catch(() => {})
    await db.close().catch(() => {})
  }
}

async function peekAll() {
  if (peeking || !identityState) return
  peeking = true
  try {
    for (const [key, board] of [...watched]) {
      if (boardDb?.key.toString('hex') === key || !watched.has(key)) continue
      const done = peekBoard(key, board).catch((error) =>
        console.error('Board check failed', error)
      )
      activePeek = { key, done }
      await done
      activePeek = null
      sendAlerts()
    }
  } finally {
    peeking = false
  }
}

function watchBoards(boards) {
  const keep = new Set()
  for (const entry of (Array.isArray(boards) ? boards : []).slice(0, 50)) {
    if (typeof entry?.invite !== 'string') continue
    const decoded = decodeInvite(entry.invite)
    if (!decoded.key || decoded.secret.length !== 32) continue
    const key = decoded.key.toString('hex')
    keep.add(key)
    const name = typeof entry.name === 'string' ? entry.name.slice(0, LIMITS.boardName) : ''
    const known = watched.get(key)
    if (known) known.name = known.name || name
    else {
      watched.set(key, {
        invite: entry.invite,
        name,
        secret: decoded.secret,
        key: decoded.key,
        alerts: [],
        mine: [],
        checkedAt: 0
      })
    }
  }
  for (const key of watched.keys()) if (!keep.has(key)) watched.delete(key)
  sendAlerts()
  updateOpenBoardAlerts()
  clearInterval(peekTimer)
  peekTimer = keep.size ? setInterval(peekAll, PEEK_INTERVAL) : null
  if (keep.size) setTimeout(peekAll, 5000)
}

// Presence: who has the board open, which card they're looking at, whether
// they're typing. Ephemeral, so it travels between connected peers only and
// is never written to the log. Encrypted with the board secret like ops; not
// signed, since a wrong "typing…" costs nothing.
const PRESENCE_HEARTBEAT = 10000
const PRESENCE_TTL = 30000
const presence = new Map() // identity → { cardId, typing, at, peer }
let ownPresence = { cardId: null, typing: false }
let presenceTimer = null

function presenceMessage() {
  const identity = ownIdentityHex()
  if (!identity || !roomState) return null
  return {
    type: 'board:presence',
    encrypted: encryptBoardPayload({ identity, ...ownPresence })
  }
}

function broadcastPresence() {
  const message = presenceMessage()
  if (!message) return
  const data = JSON.stringify(message) + '\n'
  for (const peer of chatConnections.values()) {
    if (peer.authenticated) peer.connection.write(data)
  }
}

function sendPresence() {
  const now = Date.now()
  for (const [identity, entry] of presence) {
    if (now - entry.at > PRESENCE_TTL) presence.delete(identity)
  }
  pipe.write(
    JSON.stringify({
      type: messageTypes.boardPresence,
      peers: [...presence]
        .map(([identity, entry]) => ({
          identity,
          name: boardState.profiles[identity] || null,
          cardId: entry.cardId,
          typing: entry.typing,
          at: entry.at
        }))
        .sort((a, b) => (a.identity < b.identity ? -1 : 1))
    })
  )
}

function receivePresence(peer, payload) {
  const identity = payload?.identity
  if (typeof identity !== 'string' || !/^[0-9a-f]{64}$/.test(identity)) return
  if (identity === ownIdentityHex()) return
  const cardId =
    typeof payload.cardId === 'string' && payload.cardId.length <= 80 ? payload.cardId : null
  presence.set(identity, { cardId, typing: payload.typing === true, at: Date.now(), peer })
  sendPresence()
}

function dropPresence(peer) {
  let changed = false
  for (const [identity, entry] of presence) {
    if (entry.peer === peer) changed = presence.delete(identity) || changed
  }
  if (changed) sendPresence()
}

// Local calendar date, the format due dates use.
function isoDate(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Rules run on the device of the member whose action triggered them, signed as
// that member, so each trigger fires once however many peers are online.
// Effects of a rule never trigger other rules.
async function runRules(kind, cardId) {
  const card = cardById(cardId)
  if (!card || card.archived) return
  const matching = boardState.rules.filter(
    (rule) =>
      rule.enabled &&
      rule.trigger.kind === kind &&
      (rule.trigger.columnId === null || rule.trigger.columnId === card.columnId)
  )
  if (!matching.length) return
  const me = ownIdentityHex()
  const labelIds = new Set(card.labelIds)
  const assignees = new Set(card.assignees)
  let dueInDays = null
  let completeChecklist = false
  let archive = false
  for (const { actions } of matching) {
    for (const id of actions.labelIds) labelIds.add(id)
    for (const identity of actions.assignees) assignees.add(identity)
    if (actions.assignActor && me) assignees.add(me)
    if (actions.dueInDays !== null) dueInDays = actions.dueInDays
    completeChecklist ||= actions.completeChecklist
    archive ||= actions.archive
  }
  const update = { type: 'card:update', objectId: card.id }
  if (labelIds.size !== card.labelIds.length) {
    update.labelIds = [...labelIds].slice(0, LIMITS.labels)
  }
  if (assignees.size !== card.assignees.length) {
    update.assignees = [...assignees].slice(0, LIMITS.assignees)
  }
  if (dueInDays !== null) {
    update.dueDate = isoDate(new Date(Date.now() + dueInDays * 24 * 3600 * 1000))
  }
  if (Object.keys(update).length > 2) await sendOwnOp(update)
  if (completeChecklist) {
    for (const item of card.checklist.filter((entry) => !entry.done)) {
      await sendOwnOp({ type: 'card:checklist', objectId: card.id, itemId: item.id, done: true })
    }
  }
  if (archive) await sendOwnOp({ type: 'card:archive', objectId: card.id, archived: true })
}

function periodKey(every, now = new Date()) {
  if (every === 'day') return isoDate(now)
  if (every === 'month') return isoDate(now).slice(0, 7)
  // Weeks start on Monday.
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7)
  )
  return `w${isoDate(monday)}`
}

// Scheduled rules make one card per period. The card id comes from the rule
// and the period, so members creating it at the same time end up with one
// card (deriveBoard keeps the earliest create of an id).
const RECURRING_INTERVAL = 10 * 60 * 1000
let recurringTimer = null
let schedulesRunning = false
async function runSchedules() {
  if (schedulesRunning || !boardDb || !identityState) return
  schedulesRunning = true
  try {
    for (const rule of boardState.rules) {
      if (!rule.enabled || rule.trigger.kind !== 'schedule' || !rule.card) continue
      const id = `recur:${rule.id.replace(/^rule:/, '')}:${periodKey(rule.trigger.every)}`
      if (cardById(id)) continue
      await createCard(id, {
        ...rule.card,
        columnId: rule.trigger.columnId,
        labelIds: rule.actions.labelIds,
        assignees: rule.actions.assignees,
        ...(rule.actions.dueInDays !== null && {
          dueDate: isoDate(new Date(Date.now() + rule.actions.dueInDays * 24 * 3600 * 1000))
        })
      })
    }
  } finally {
    schedulesRunning = false
  }
}

async function createCard(id, fields) {
  const identity = await unlockedIdentity()
  const columnId = boardState.columns.some((column) => column.id === fields.columnId)
    ? fields.columnId
    : boardState.columns[0].id
  await sendOwnOp({
    type: 'create',
    object: {
      id,
      title: String(fields.title || '')
        .trim()
        .slice(0, LIMITS.title),
      body: typeof fields.body === 'string' ? fields.body.trim() : '',
      author: identity,
      createdAt: new Date().toISOString(),
      images: fields.images || [],
      votes: {},
      comments: [],
      columnId,
      position: positionAt(cardsIn(columnId)),
      labelIds: Array.isArray(fields.labelIds) ? fields.labelIds : [],
      dueDate: fields.dueDate ?? null,
      mentions: Array.isArray(fields.mentions) ? fields.mentions : [],
      ...(Array.isArray(fields.assignees) &&
        fields.assignees.length && {
          assignees: fields.assignees
        }),
      ...(typeof fields.points === 'number' && { points: fields.points }),
      ...(Array.isArray(fields.checklist) &&
        fields.checklist.length && {
          checklist: fields.checklist.map((text) => ({ id: newId('item'), text, done: false }))
        })
    }
  })
  return id
}

// Starter boards. Applying one renames the existing columns in order, adds the
// missing ones, removes empty extras and adds labels the board doesn't have.
const BOARD_TEMPLATES = Object.freeze({
  sprint: {
    columns: ['Backlog', 'To do', 'In progress', 'Review', 'Done'],
    labels: [
      ['bug', '#e5484d'],
      ['feature', '#3e63dd'],
      ['chore', '#8b8d98']
    ]
  },
  bugs: {
    columns: ['Reported', 'Triaged', 'Fixing', 'Verifying', 'Closed'],
    labels: [
      ['critical', '#e5484d'],
      ['major', '#f76b15'],
      ['minor', '#ffc53d']
    ]
  },
  personal: {
    columns: ['Inbox', 'Today', 'This week', 'Waiting', 'Done'],
    labels: [
      ['home', '#30a46c'],
      ['work', '#3e63dd'],
      ['health', '#d6409f']
    ]
  }
})

async function applyBoardTemplate(name) {
  const template = BOARD_TEMPLATES[name]
  if (!template) throw new Error('Unknown template')
  const existing = [...boardState.columns]
  for (let i = 0; i < template.columns.length; i++) {
    if (existing[i]) {
      if (existing[i].name !== template.columns[i]) {
        await sendOwnOp({
          type: 'column:upsert',
          columnId: existing[i].id,
          name: template.columns[i]
        })
      }
    } else {
      await sendOwnOp({
        type: 'column:upsert',
        columnId: newId('col'),
        name: template.columns[i],
        position: positionAt(boardState.columns)
      })
    }
  }
  for (const column of existing.slice(template.columns.length)) {
    if (!cardsIn(column.id).length) await sendOwnOp({ type: 'column:delete', columnId: column.id })
  }
  const names = new Set(boardState.labels.map((label) => label.name.toLowerCase()))
  for (const [labelName, color] of template.labels) {
    if (names.has(labelName)) continue
    await sendOwnOp({ type: 'label:upsert', labelId: newId('label'), name: labelName, color })
  }
}

function handleRoomMessage(peer, message) {
  if (message.type === 'room:hello') {
    pipe.write(JSON.stringify({ type: 'room-debug', status: 'hello-received' }))
    writeConnection(peer.connection, {
      type: 'room:auth',
      challenge: message.challenge,
      mac: authenticate(Buffer.from(message.challenge, 'base64'), roomState.secret)
    })
    return
  }

  if (message.type === 'room:auth') {
    const actual = Buffer.from(message.mac || '', 'base64')
    const valid =
      actual.length === sodium.crypto_auth_BYTES &&
      (() => {
        const challenge = Buffer.from(message.challenge || '', 'base64')
        return (
          challenge.length === 32 && sodium.crypto_auth_verify(actual, challenge, roomState.secret)
        )
      })()
    if (valid) {
      peer.authenticated = true
      pipe.write(JSON.stringify({ type: 'room-debug', status: 'authenticated' }))
      sendPeerCount()
      writeConnection(peer.connection, encryptBoardOps())
      writeConnection(peer.connection, presenceMessage())
    } else {
      pipe.write(JSON.stringify({ type: 'room-debug', status: 'authentication-failed' }))
      peer.connection.destroy()
    }
    return
  }

  if (peer.authenticated && message.type === 'board:ops') {
    const payload = decryptBoardPayload(message.encrypted)
    learnBoardName(payload?.boardName)
    let changed = false
    for (const op of Array.isArray(payload?.ops) ? payload.ops : []) changed = ingest(op) || changed
    if (changed) {
      deriveState()
      sendBoardState()
    }
    sendBoardSynced()
  }
  // Peers announce a digest of their op ids; ask for the full set on a mismatch.
  if (peer.authenticated && message.type === 'board:digest') {
    if (message.hash !== opsDigest() && Date.now() - (peer.requestedAt || 0) > 3000) {
      peer.requestedAt = Date.now()
      writeConnection(peer.connection, { type: 'board:request' })
    }
  }
  if (peer.authenticated && message.type === 'board:request') {
    writeConnection(peer.connection, encryptBoardOps())
  }
  // Clients from before Kanban gossip unsigned object snapshots. Only the board
  // name is taken from them; their posts arrive as signed ops.
  if (peer.authenticated && message.type === 'board:state') {
    learnBoardName(decryptBoardPayload(message.encrypted)?.boardName)
    sendBoardSynced()
  }
  if (peer.authenticated && message.type === 'board:message') {
    const decrypted = decryptBoardMessage(message)
    if (decrypted) sendBoardMessage(decrypted)
  }
  if (peer.authenticated && message.type === 'board:presence') {
    receivePresence(peer, decryptBoardPayload(message.encrypted))
  }
}

chatSwarm.on('connection', (connection) => {
  if (!roomState) return connection.destroy()
  pipe.write(JSON.stringify({ type: 'room-debug', status: 'connection-received' }))
  const peer = {
    connection,
    authenticated: false,
    challenge: crypto.randomBytes(32)
  }
  chatConnections.set(connection, peer)
  let buffer = ''
  writeConnection(connection, { type: 'room:hello', challenge: peer.challenge.toString('base64') })

  connection.on('data', (data) => {
    buffer += data.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line) continue
      try {
        handleRoomMessage(peer, JSON.parse(line))
      } catch {
        console.error('Invalid chat message')
      }
    }
  })

  connection.on('close', () => {
    chatConnections.delete(connection)
    dropPresence(peer)
    sendPeerCount()
  })
  connection.on('error', () => {
    chatConnections.delete(connection)
    sendPeerCount()
  })
  sendPeerCount()
})

chatSwarm.on('error', (error) => {
  console.error('Chat swarm error', error)
  pipe.write(JSON.stringify({ type: 'room-debug', status: `network-error: ${error.message}` }))
})

replicationSwarm.on('connection', (connection) => {
  // Corestore replication carries only the encrypted board log. The relay or
  // peer does not receive plaintext board objects through this connection.
  // It serves every board in the store, so background checks use it too.
  if (!boardStore) return connection.destroy()
  if (boardDb) {
    boardDb.replicate(connection)
    refreshBoard()
  } else boardStore.replicate(connection)
  replicationPeerCount++
  sendPeerCount()
  let closed = false
  const onClose = () => {
    replicationPeerCount = Math.max(0, replicationPeerCount - 1)
    sendPeerCount()
  }
  const decrement = () => {
    if (closed) return
    closed = true
    onClose()
  }
  connection.once('close', decrement)
  connection.once('error', decrement)
})

replicationSwarm.on('error', (error) => {
  console.error('Board replication error', error)
  pipe.write(JSON.stringify({ type: 'room-debug', status: `replication-error: ${error.message}` }))
})

async function startRoom(invite, name) {
  const decoded = invite ? decodeInvite(invite) : { secret: crypto.randomBytes(32), key: null }
  const secret = decoded.secret
  if (secret.length !== 32) throw new Error('Invalid room invite')
  if (invite && !decoded.key) {
    throw new Error(
      'This invitation uses the old single-writer format. Create a new board and share its new invitation.'
    )
  }
  if (boardDb) await closeRoom()
  // A background check may have this board open; let it finish first.
  if (activePeek && decoded.key && activePeek.key === decoded.key.toString('hex')) {
    await activePeek.done
  }
  boardName = typeof name === 'string' ? name.trim().slice(0, LIMITS.boardName) : ''
  const space = await boardSpace(decoded.key)
  boardDb = new Autobee(space.store, decoded.key, {
    apply: applyBoardNodes,
    optimistic: true,
    update: onBoardUpdate,
    wakeup
  })
  await boardDb.ready()
  if (!decoded.key) await rememberSpace(boardDb.key.toString('hex'), space.id)
  roomState = {
    secret,
    topic: boardDb.discoveryKey,
    invite: encodeBoardInvite(secret, boardDb.key)
  }
  blobsCore = boardStore.get({
    name: `blobs:${boardDb.key.toString('hex')}`,
    encryption: blobEncryption()
  })
  await blobsCore.ready()
  boardBlobs = new Hyperblobs(blobsCore)
  if (invite && !boardDb.writable) {
    await boardDb.append(
      Buffer.from(
        JSON.stringify({ type: 'writer-request', writer: boardDb.local.key.toString('hex') })
      ),
      { optimistic: true }
    )
  }
  await loadBoard()
  if (!invite) await persistBoardMetadata()
  // The creator's device signs a first op, which makes its identity the owner.
  // Boards made before roles get it the next time the creator opens them.
  if (!boardOwner && boardDb.bootstrap.key.toString('hex') === boardDb.local.key.toString('hex')) {
    await sendOwnOp({ type: 'board:claim' })
    boardOwner = ownIdentityHex()
    deriveState()
  }
  // Restore the locally persisted board immediately. A remote snapshot can
  // arrive later and merge additional objects/profiles into this state.
  sendBoardState()
  replicationDiscovery = replicationSwarm.join(boardDb.discoveryKey, {
    client: true,
    server: true
  })
  mirrorBoard()
  pipe.write(JSON.stringify({ type: 'room-debug', status: 'topic-joining' }))
  replicationDiscovery
    .flushed()
    .then(() => pipe.write(JSON.stringify({ type: 'room-debug', status: 'topic-joined' })))
    .catch((error) =>
      pipe.write(
        JSON.stringify({ type: 'room-debug', status: `discovery-error: ${error.message}` })
      )
    )
  const ownIdentity = identityState?.identity.identityPublicKey.toString('hex')
  pipe.write(
    JSON.stringify({
      type: 'room-status',
      status: 'ready',
      boardKey: boardDb.key.toString('hex'),
      invite: roomState.invite,
      boardName,
      displayName: ownIdentity ? boardState.profiles[ownIdentity] || null : null,
      // A joiner is not a writer until it has synced with an existing member;
      // until then its writes only live in memory and are lost if it closes.
      writable: boardDb.writable
    })
  )
  if (!invite || boardOps.size > 0) sendBoardSynced()
  presenceTimer = setInterval(() => {
    broadcastPresence()
    sendPresence()
  }, PRESENCE_HEARTBEAT)
  recurringTimer = setInterval(() => runSchedules().catch(() => {}), RECURRING_INTERVAL)
  // Give a joiner a moment to sync, so it sees cards others already made.
  setTimeout(() => runSchedules().catch(() => {}), invite ? 20000 : 1000)
  roomSyncTimer = setInterval(() => {
    broadcastDigest()
    refreshBoard()
  }, 1000)
}

// Blind peers keep an encrypted copy of the open board (its log and this device's
// attachments) online while every member is offline. They hold no board secret,
// so they store and serve the data without being able to read it.
let blindPeerKeys = [...BLIND_PEERS]
let blindPeering = null
// Shared by the open board and the blind peers: a blind peer uses it to tell a
// joiner which members' logs it holds, so the joiner can fetch them from it.
const wakeup = new Wakeup()

function mirrorBoard() {
  if (!blindPeerKeys.length || !boardDb) return
  // Bound to the store it was made with; boardSpace() may have replaced it.
  if (blindPeering && blindPeering.store !== boardStore) {
    blindPeering.close().catch(() => {})
    blindPeering = null
  }
  try {
    if (!blindPeering) {
      blindPeering = new BlindPeering(replicationSwarm.dht, boardStore, {
        blindPeers: blindPeerKeys.map((key) => ({ key })),
        wakeup,
        client: { name: 'opencollab', version: updaterConfig.version }
      })
    }
    blindPeering.addAutobaseBackground(boardDb)
    if (blobsCore) blindPeering.addCoreBackground(blobsCore)
  } catch (err) {
    // A malformed key only costs the mirror, never the board.
    pipe.write(JSON.stringify({ type: 'room-debug', status: `blind-peer-error: ${err.message}` }))
  }
}

// Tears down the open board without notifying the UI. startRoom calls this
// when a board is already open (e.g. after a renderer reload), otherwise the
// new Corestore fails to lock the storage the old one still holds.
async function closeRoom() {
  if (roomSyncTimer) {
    clearInterval(roomSyncTimer)
    roomSyncTimer = null
  }
  for (const peer of chatConnections.values()) peer.connection.destroy()
  chatConnections.clear()
  presence.clear()
  ownPresence = { cardId: null, typing: false }
  clearInterval(presenceTimer)
  presenceTimer = null
  clearInterval(recurringTimer)
  recurringTimer = null
  if (replicationDiscovery) {
    await replicationDiscovery.destroy()
    replicationDiscovery = null
  }
  roomState = null
  for (const blobs of remoteBlobs.values()) await blobs.core.close()
  remoteBlobs.clear()
  if (blobsCore) await blobsCore.close()
  blobsCore = null
  boardBlobs = null
  if (boardDb) {
    await Promise.allSettled([...pendingAppends])
    await boardDb.close()
    boardDb = null
  }
  boardUpdateInFlight = null
  boardOps = new Map()
  boardState = deriveBoard([])
  boardOwner = null
  boardDigest = null
  reportedDisplayName = null
  await clearMediaCache()
  verifiedOps.clear()
  boardName = ''
}

// Opening and leaving boards run one at a time: messages are handled
// concurrently, and a slow leave must not report "none" after the next board
// already opened.
let roomQueue = Promise.resolve()
function inRoomQueue(task) {
  const run = roomQueue.then(task)
  roomQueue = run.catch(() => {})
  return run
}

async function leaveRoom() {
  await closeRoom()
  pipe.write(JSON.stringify({ type: 'board-state', objects: [], profiles: {} }))
  pipe.write(JSON.stringify({ type: 'room-status', status: 'none' }))
}

pipe.on('data', async (data) => {
  const message = data.toString()
  if (message === 'pear:applyUpdate') {
    await pear.ready()
    await pear.updater.applyUpdate()
    pipe.write('pear:updateApplied')
    return
  }

  try {
    const msg = JSON.parse(message)
    if (msg.type === 'ping') {
      pipe.write(JSON.stringify({ type: 'pong', time: new Date().toISOString() }))
    } else if (msg.type === messageTypes.roomStart) {
      try {
        if (!identityReady || !identityState) {
          throw new Error('Unlock your identity before opening a board')
        }
        await identityReady
        await inRoomQueue(() => startRoom(msg.invite, msg.name))
      } catch (err) {
        pipe.write(JSON.stringify({ type: 'room-status', status: 'error', error: err.message }))
      }
    } else if (msg.type === messageTypes.roomLeave) {
      try {
        await inRoomQueue(leaveRoom)
      } catch (err) {
        pipe.write(JSON.stringify({ type: 'room-status', status: 'error', error: err.message }))
      }
    } else if (msg.type === messageTypes.identityCreate) {
      try {
        const mnemonic = Identity.generateMnemonic()
        identityReady = activateIdentity(mnemonic, true)
        await identityReady
        sendIdentityStatus(null, mnemonic)
      } catch (err) {
        identityReady = null
        sendIdentityStatus(err.message)
      }
    } else if (msg.type === 'identity:load') {
      await identityInspection
      try {
        identityReady = activateIdentity(msg.mnemonic, true)
        await identityReady
        sendIdentityStatus()
      } catch (err) {
        identityReady = null
        sendIdentityStatus(err.message)
      }
    } else if (msg.type === 'identity:create' || msg.type === 'identity:unlock') {
      await identityInspection
      try {
        identityReady = unlockIdentity(msg.password, msg.type === 'identity:create')
        await identityReady
        sendIdentityStatus()
      } catch (err) {
        identityReady = null
        sendIdentityStatus(err.message)
      }
    } else if (
      msg.type === messageTypes.profileSet &&
      typeof msg.displayName === 'string' &&
      msg.displayName.trim()
    ) {
      const displayName = msg.displayName.trim().slice(0, 48)
      const reported = reportedDisplayName
      const { identity } = await sendOwnOp({ type: 'profile', displayName })
      // Setting the same name again changes nothing, but the UI waits for a reply.
      if (reportedDisplayName === reported) {
        pipe.write(JSON.stringify({ type: 'profile-status', identity, displayName }))
      }
    } else if (
      msg.type === messageTypes.boardCreate &&
      typeof msg.title === 'string' &&
      msg.title.trim()
    ) {
      const identity = await unlockedIdentity()
      const images = boardBlobs ? await storeImages(msg.images) : []
      const id = await createCard(uniqueId(identity), {
        title: msg.title,
        body: msg.body,
        images,
        columnId: msg.columnId,
        labelIds: msg.labelIds,
        dueDate: msg.dueDate,
        mentions: msg.mentions,
        assignees: msg.assignees,
        checklist: Array.isArray(msg.checklist)
          ? msg.checklist.filter((text) => typeof text === 'string' && text.trim())
          : undefined
      })
      await runRules('create', id)
    } else if (msg.type === 'board:image') {
      // Only fetch images the open board references.
      const ref = findMediaRef(msg.ref)
      if (!ref || isVideo(ref) || !boardBlobs) return
      try {
        const data = await readImage(ref)
        pipe.write(
          JSON.stringify({
            type: 'board-image',
            key: imageKey(ref),
            mime: ref.type,
            data: data.toString('base64')
          })
        )
      } catch (err) {
        pipe.write(
          JSON.stringify({
            type: 'board-image',
            key: imageKey(ref),
            error: err.code || err.message
          })
        )
      }
    } else if (msg.type === messageTypes.boardVote) {
      if (!cardById(msg.objectId) || ![1, -1, 0].includes(msg.value)) return
      await sendOwnOp({ type: 'vote', objectId: msg.objectId, value: msg.value })
    } else if (msg.type === messageTypes.boardComment) {
      const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, LIMITS.comment) : ''
      if (!cardById(msg.objectId) || !text) return
      const identity = await unlockedIdentity()
      await sendOwnOp({
        type: 'comment',
        objectId: msg.objectId,
        text,
        comment: {
          id: uniqueId(identity),
          author: identity,
          text,
          createdAt: new Date().toISOString(),
          mentions: Array.isArray(msg.mentions) ? msg.mentions : []
        }
      })
    } else if (msg.type === messageTypes.cardUpdate) {
      if (!cardById(msg.objectId)) return
      const payload = { type: 'card:update', objectId: msg.objectId }
      const fields = ['title', 'body', 'dueDate', 'labelIds', 'mentions', 'assignees', 'points']
      for (const field of [...fields, 'revealEstimates', 'template']) {
        if (msg[field] !== undefined) payload[field] = msg[field]
      }
      if (typeof payload.title === 'string') {
        payload.title = payload.title.trim().slice(0, LIMITS.title)
      }
      await sendOwnOp(payload)
    } else if (msg.type === messageTypes.cardMove) {
      const card = cardById(msg.objectId)
      if (!card || !columnById(msg.columnId)) return
      const from = card.columnId
      await sendOwnOp({
        type: 'card:move',
        objectId: card.id,
        columnId: msg.columnId,
        position: positionAt(cardsIn(msg.columnId, card.id), msg.index)
      })
      if (from !== msg.columnId) await runRules('enter', card.id)
    } else if (msg.type === messageTypes.cardArchive) {
      if (!cardById(msg.objectId) || typeof msg.archived !== 'boolean') return
      await sendOwnOp({ type: 'card:archive', objectId: msg.objectId, archived: msg.archived })
    } else if (msg.type === messageTypes.columnCreate) {
      if (typeof msg.name !== 'string' || !msg.name.trim()) return
      await sendOwnOp({
        type: 'column:upsert',
        columnId: newId('col'),
        name: msg.name.trim().slice(0, LIMITS.columnName),
        position: positionAt(boardState.columns, msg.index),
        ...(msg.color !== undefined && { color: msg.color })
      })
    } else if (msg.type === messageTypes.columnUpdate) {
      if (!columnById(msg.columnId)) return
      await sendOwnOp({
        type: 'column:upsert',
        columnId: msg.columnId,
        ...(typeof msg.name === 'string' && { name: msg.name.trim().slice(0, LIMITS.columnName) }),
        ...(msg.color !== undefined && { color: msg.color }),
        ...(msg.wipLimit !== undefined && { wipLimit: msg.wipLimit }),
        ...(msg.index !== undefined && {
          position: positionAt(columnsExcept(msg.columnId), msg.index)
        })
      })
    } else if (msg.type === messageTypes.columnDelete) {
      // Keep at least one column; its cards move to the first remaining one.
      if (!columnById(msg.columnId) || boardState.columns.length < 2) return
      await sendOwnOp({ type: 'column:delete', columnId: msg.columnId })
    } else if (msg.type === messageTypes.labelUpsert) {
      // A client may pick the id of a new label, so it can assign it right away.
      const valid = typeof msg.labelId === 'string' && /^label:[0-9a-f]{12}$/.test(msg.labelId)
      await sendOwnOp({
        type: 'label:upsert',
        labelId: valid ? msg.labelId : newId('label'),
        ...(typeof msg.name === 'string' && { name: msg.name.trim().slice(0, LIMITS.labelName) }),
        ...(msg.color !== undefined && { color: msg.color })
      })
    } else if (msg.type === messageTypes.labelDelete) {
      if (!boardState.labels.some((label) => label.id === msg.labelId)) return
      await sendOwnOp({ type: 'label:delete', labelId: msg.labelId })
    } else if (msg.type === messageTypes.boardsWatch) {
      watchBoards(msg.boards)
    } else if (msg.type === messageTypes.boardDescribe) {
      if (typeof msg.description !== 'string') return
      await sendOwnOp({
        type: 'board:info',
        description: msg.description.trim().slice(0, LIMITS.description)
      })
    } else if (msg.type === messageTypes.cardImagesAdd) {
      // Stores the images in this member's encrypted blob core, then adds the
      // refs to the card. The reply lets the UI reference them in Markdown.
      const card = cardById(msg.objectId)
      const room = LIMITS.images - (card?.images?.length || 0)
      const refs = card && boardBlobs && room > 0 ? await storeImages(msg.images) : []
      if (refs.length) {
        await sendOwnOp({ type: 'card:image', objectId: card.id, images: refs.slice(0, room) })
      }
      pipe.write(
        JSON.stringify({
          type: 'card-images-added',
          requestId: msg.requestId,
          keys: refs.slice(0, room).map(imageKey),
          error: refs.length ? null : room > 0 ? 'Could not store the image' : 'This card is full'
        })
      )
    } else if (msg.type === messageTypes.themeSet) {
      await sendOwnOp({
        type: 'board:theme',
        ...(msg.background !== undefined && { background: msg.background }),
        ...(msg.accent !== undefined && { accent: msg.accent }),
        ...(msg.template !== undefined && { template: msg.template })
      })
    } else if (msg.type === messageTypes.blindPeersSet && Array.isArray(msg.keys)) {
      blindPeerKeys = msg.keys.filter((key) => typeof key === 'string' && key.trim())
      if (blindPeering) {
        await blindPeering.close()
        blindPeering = null
      }
      mirrorBoard()
    } else if (msg.type === messageTypes.profileAvatarSet) {
      // `image` null clears it; otherwise it is stored like a card image.
      const [ref = null] = msg.image === null || !boardBlobs ? [] : await storeImages([msg.image])
      if (msg.image !== null && !ref) {
        return replyError(msg, 'Use a JPEG, PNG, WebP or GIF image up to 5 MB')
      }
      await sendOwnOp({ type: 'profile', avatar: ref })
    } else if (
      msg.type === messageTypes.boardIconSet ||
      msg.type === messageTypes.backgroundImageSet
    ) {
      // `image` null clears it; otherwise it is stored like a card image.
      const [ref = null] = msg.image === null || !boardBlobs ? [] : await storeImages([msg.image])
      if (msg.image !== null && !ref) {
        return replyError(msg, 'Use a JPEG, PNG, WebP or GIF image up to 5 MB')
      }
      await sendOwnOp(
        msg.type === messageTypes.boardIconSet
          ? { type: 'board:info', icon: ref }
          : { type: 'board:theme', backgroundImage: ref }
      )
    } else if (msg.type === messageTypes.cardMediaAdd) {
      // Videos come as file paths (from the host's file picker), not bytes.
      const card = cardById(msg.objectId)
      const room = LIMITS.images - (card?.images?.length || 0)
      const files = (Array.isArray(msg.files) ? msg.files : []).slice(0, Math.max(0, room))
      const refs = []
      let error = !card ? 'The card is gone' : room > 0 ? null : 'This card is full'
      for (const file of boardBlobs ? files : []) {
        try {
          refs.push(
            await storeVideo(file, (bytes, total) =>
              pipe.write(
                JSON.stringify({
                  type: 'card-media-progress',
                  requestId: msg.requestId,
                  bytes,
                  total
                })
              )
            )
          )
        } catch (err) {
          error = err.code === 'ENOENT' ? 'The video file is gone' : err.message
        }
      }
      if (refs.length) await sendOwnOp({ type: 'card:image', objectId: card.id, images: refs })
      pipe.write(
        JSON.stringify({
          type: 'card-media-added',
          requestId: msg.requestId,
          keys: refs.map(imageKey),
          error: refs.length ? null : error || 'Could not store the video'
        })
      )
    } else if (msg.type === messageTypes.boardMedia) {
      const ref = findMediaRef(msg.ref)
      if (!ref || !isVideo(ref) || !boardBlobs) return
      const key = imageKey(ref)
      try {
        const file = await cachedMedia(ref)
        pipe.write(JSON.stringify({ type: 'board-media', key, path: file }))
      } catch (err) {
        pipe.write(JSON.stringify({ type: 'board-media', key, error: err.code || err.message }))
      }
    } else if (msg.type === messageTypes.memberRole) {
      if (!boardOwner || ownIdentityHex() !== boardOwner) {
        return replyError(msg, 'Only the board owner can change roles')
      }
      const member = memberOf(msg.identity)
      if (!member || member.role === 'owner' || !ROLES.includes(msg.role)) return
      await sendOwnOp({ type: 'member:role', identity: member.identity, role: msg.role })
    } else if (msg.type === messageTypes.memberBan) {
      const me = memberOf(ownIdentityHex())
      const member = memberOf(msg.identity)
      if (!member || typeof msg.banned !== 'boolean') return
      if (!me || me.role === 'member' || me.banned) {
        return replyError(msg, 'Only the owner or an admin can remove members')
      }
      if (member.role === 'owner' || (me.role === 'admin' && member.role === 'admin')) {
        return replyError(
          msg,
          `You can't remove ${member.role === 'owner' ? 'the owner' : 'an admin'}`
        )
      }
      // The ban keeps what they wrote so far; anything they sign later is ignored.
      const keep = msg.banned
        ? [...boardOps.values()]
            .filter((op) => op.identity === member.identity)
            .map((op) => op.id)
            .slice(-LIMITS.banKeep)
        : []
      await sendOwnOp({ type: 'member:ban', identity: member.identity, banned: msg.banned, keep })
    } else if (msg.type === messageTypes.checklistSet) {
      // No itemId adds an item; `index` places a new or moved item.
      const card = cardById(msg.objectId)
      if (!card) return
      const known = card.checklist.find((item) => item.id === msg.itemId)
      if (msg.itemId !== undefined && !known) return
      const text =
        typeof msg.text === 'string' ? msg.text.trim().slice(0, LIMITS.checklistText) : ''
      if (!known && !text) return
      if (!known && card.checklist.length >= LIMITS.checklist) {
        return replyError(msg, 'This checklist is full')
      }
      const others = card.checklist.filter((item) => item.id !== msg.itemId)
      await sendOwnOp({
        type: 'card:checklist',
        objectId: card.id,
        itemId: known ? known.id : newId('item'),
        ...(text && { text }),
        ...(typeof msg.done === 'boolean' && { done: msg.done }),
        ...(msg.deleted === true && { deleted: true }),
        ...((!known || msg.index !== undefined) && { position: positionAt(others, msg.index) })
      })
    } else if (msg.type === messageTypes.reactionSet) {
      const card = cardById(msg.objectId)
      if (!card || !REACTIONS.includes(msg.emoji) || typeof msg.on !== 'boolean') return
      if (msg.commentId && !card.comments.some((comment) => comment.id === msg.commentId)) return
      await sendOwnOp({
        type: 'reaction',
        objectId: card.id,
        ...(msg.commentId && { commentId: msg.commentId }),
        emoji: msg.emoji,
        on: msg.on
      })
    } else if (msg.type === messageTypes.linkSet) {
      if (!cardById(msg.objectId) || !cardById(msg.targetId) || msg.objectId === msg.targetId) {
        return
      }
      if (!LINK_KINDS.includes(msg.kind) || typeof msg.linked !== 'boolean') return
      await sendOwnOp({
        type: 'card:link',
        objectId: msg.objectId,
        targetId: msg.targetId,
        kind: msg.kind,
        linked: msg.linked
      })
    } else if (msg.type === messageTypes.estimateSet) {
      const value = msg.value === null ? null : Number(msg.value)
      if (!cardById(msg.objectId)) return
      if (value !== null && !(value >= 0 && value <= LIMITS.points)) return
      await sendOwnOp({ type: 'estimate', objectId: msg.objectId, value })
    } else if (msg.type === messageTypes.ruleUpsert) {
      const rule = cleanRule(msg.rule)
      if (!rule) return replyError(msg, 'That rule is incomplete')
      const valid = typeof msg.ruleId === 'string' && /^rule:[0-9a-f]{12}$/.test(msg.ruleId)
      if (!valid && boardState.rules.length >= LIMITS.rules) {
        return replyError(msg, 'This board has too many rules')
      }
      await sendOwnOp({ type: 'rule:upsert', ruleId: valid ? msg.ruleId : newId('rule'), rule })
      if (rule.trigger.kind === 'schedule') await runSchedules()
    } else if (msg.type === messageTypes.ruleDelete) {
      if (!boardState.rules.some((rule) => rule.id === msg.ruleId)) return
      await sendOwnOp({ type: 'rule:delete', ruleId: msg.ruleId })
    } else if (msg.type === messageTypes.templateApply) {
      if (!boardDb) return replyError(msg, 'Open a board first')
      if (!BOARD_TEMPLATES[msg.template]) return replyError(msg, 'Unknown template')
      await applyBoardTemplate(msg.template)
    } else if (msg.type === messageTypes.cardFromTemplate) {
      const template = cardById(msg.templateId)
      if (!template) return replyError(msg, 'That template is gone')
      const identity = await unlockedIdentity()
      const id = await createCard(uniqueId(identity), {
        title: typeof msg.title === 'string' && msg.title.trim() ? msg.title : template.title,
        body: template.body,
        columnId: msg.columnId ?? template.columnId,
        labelIds: template.labelIds,
        assignees: template.assignees,
        points: template.points ?? undefined,
        checklist: template.checklist.map((item) => item.text)
      })
      await runRules('create', id)
      pipe.write(JSON.stringify({ type: 'card-created', requestId: msg.requestId, objectId: id }))
    } else if (msg.type === messageTypes.activityGet) {
      const cardId = typeof msg.cardId === 'string' ? msg.cardId : null
      pipe.write(
        JSON.stringify({
          type: messageTypes.boardActivity,
          requestId: msg.requestId,
          cardId,
          entries: boardActivity([...boardOps.values()], boardState, {
            cardId,
            limit: Number.isSafeInteger(msg.limit) ? msg.limit : 100
          })
        })
      )
    } else if (msg.type === messageTypes.statsGet) {
      pipe.write(
        JSON.stringify({
          type: messageTypes.boardStats,
          requestId: msg.requestId,
          stats: boardStats([...boardOps.values()], boardState)
        })
      )
    } else if (msg.type === messageTypes.presenceSet) {
      ownPresence = {
        cardId: typeof msg.cardId === 'string' && msg.cardId.length <= 80 ? msg.cardId : null,
        typing: msg.typing === true
      }
      broadcastPresence()
    } else if (msg.type === messageTypes.boardExport) {
      if (!boardDb) return replyError(msg, 'Open a board before exporting it')
      const data = boardExport()
      let file = null
      if (msg.toFile) {
        // Mobile shares a file; desktop saves the JSON itself.
        const dir = path.join(updaterConfig.dir, 'exports')
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
        await fs.promises.mkdir(dir, { recursive: true })
        const slug = (boardName || 'board').replace(/[^\w-]+/g, '-').slice(0, 40) || 'board'
        file = path.join(dir, `${slug}-${data.exportedAt.slice(0, 10)}.json`)
        await fs.promises.writeFile(file, JSON.stringify(data, null, 2))
      }
      pipe.write(
        JSON.stringify({
          type: 'board-export',
          requestId: msg.requestId,
          data: file ? null : data,
          path: file
        })
      )
    }
  } catch {
    console.log(message)
  }
})

identityInspection
  .then(() => {
    sendIdentityStatus()
    sendBoardState()
    pipe.write(JSON.stringify({ type: 'room-status', status: 'none' }))
  })
  .catch((err) => {
    identityStatus = 'error'
    sendIdentityStatus(err.message)
  })

pipe.write('Hello from worker')
