const PearRuntime = require('pear-runtime')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Autobee = require('autobee')
const Hyperblobs = require('hyperblobs')
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
  positionAt,
  OP_TYPES,
  LIMITS
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
  await chatSwarm.destroy()
  await replicationSwarm.destroy()
  await swarm.destroy()
  if (boardDb) await boardDb.close()
  else if (boardStore) await boardStore.close()
  await pear.close()
  await store.close()
})

function sendPeerCount() {
  const count =
    [...chatConnections.values()].filter((peer) => peer.authenticated).length + replicationPeerCount
  pipe.write(JSON.stringify({ type: 'peer-count', count }))
}

function sendBoardState() {
  const { objects, profiles, columns, labels, theme } = boardState
  pipe.write(JSON.stringify({ type: 'board-state', objects, profiles, columns, labels, theme }))
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

function decryptBoardPayload(encrypted) {
  if (
    !roomState ||
    typeof encrypted?.nonce !== 'string' ||
    typeof encrypted?.ciphertext !== 'string'
  ) {
    return null
  }
  try {
    const nonce = Buffer.from(encrypted.nonce, 'base64')
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64')
    const plaintext = Buffer.alloc(ciphertext.length - sodium.crypto_secretbox_MACBYTES)
    if (!sodium.crypto_secretbox_open_easy(plaintext, ciphertext, nonce, roomState.secret)) {
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

function decryptBoardMessage(message) {
  const payload = decryptBoardPayload(message.encrypted)
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

function deriveState() {
  boardState = deriveBoard([...boardOps.values()], {
    images: (list) => (Array.isArray(list) ? list.filter(isImageRef).slice(0, MAX_IMAGES) : [])
  })
  lastTs = Math.max(lastTs, boardState.maxTs)
  boardDigest = null
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

async function loadBoard() {
  if (!boardDb) return
  await boardDb.ready()
  const ops = new Map()
  for await (const entry of boardDb.view.createReadStream()) {
    try {
      const stored = JSON.parse(entry.value.toString())
      if (stored.type === 'board:meta') {
        const metadata = decryptBoardPayload(stored.encrypted)
        if (metadata?.boardName) boardName = metadata.boardName
      } else {
        const message = decryptBoardMessage(stored)
        if (
          typeof message?.id === 'string' &&
          !ops.has(message.id) &&
          OP_TYPES.includes(message.payload?.type) &&
          verifyBoardMessage(message)
        ) {
          ops.set(message.id, message)
        }
      }
    } catch {
      console.error('Invalid persisted board operation')
    }
  }
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

function isImageRef(ref) {
  return (
    typeof ref?.core === 'string' &&
    /^[0-9a-f]{64}$/.test(ref.core) &&
    IMAGE_TYPES.includes(ref.type) &&
    ['byteOffset', 'blockOffset', 'blockLength', 'byteLength'].every(
      (field) => Number.isSafeInteger(ref.id?.[field]) && ref.id[field] >= 0
    ) &&
    ref.id.byteLength > 0 &&
    ref.id.byteLength <= MAX_IMAGE_BYTES
  )
}

const imageKey = (ref) => `${ref.core}:${ref.id.blockOffset}:${ref.id.blockLength}`

async function readImage(ref) {
  let blobs = ref.core === blobsCore.key.toString('hex') ? boardBlobs : remoteBlobs.get(ref.core)
  if (!blobs) {
    const core = boardStore.get({ key: Buffer.from(ref.core, 'hex'), encryption: blobEncryption() })
    await core.ready()
    blobs = new Hyperblobs(core)
    remoteBlobs.set(ref.core, blobs)
  }
  return blobs.get(ref.id, { timeout: IMAGE_FETCH_TIMEOUT })
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

function sendBoardMessage(message) {
  if (!ingest(message)) return
  boardDb
    .append(Buffer.from(JSON.stringify(encryptBoardMessage(message))), { optimistic: true })
    .catch((err) => console.error('Board persistence failed', err))
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
const uniqueId = (identity) =>
  `${identity.slice(0, 12)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`

const cardById = (id) => boardState.objects.find((object) => object.id === id)
const columnById = (id) => boardState.columns.find((column) => column.id === id)

function cardsIn(columnId, exceptId = null) {
  return boardState.objects.filter(
    (object) => object.columnId === columnId && object.id !== exceptId
  )
}

function columnsExcept(columnId) {
  return boardState.columns.filter((column) => column.id !== columnId)
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
  if (!boardDb) return connection.destroy()
  boardDb.replicate(connection)
  refreshBoard()
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
  boardName = typeof name === 'string' ? name.trim() : ''
  boardStore = new Corestore(path.join(updaterConfig.dir, 'board-store'))
  boardDb = new Autobee(boardStore, decoded.key, {
    apply: applyBoardNodes,
    optimistic: true,
    update: onBoardUpdate
  })
  await boardDb.ready()
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
  // Restore the locally persisted board immediately. A remote snapshot can
  // arrive later and merge additional objects/profiles into this state.
  sendBoardState()
  replicationDiscovery = replicationSwarm.join(boardDb.discoveryKey, {
    client: true,
    server: true
  })
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
      invite: roomState.invite,
      boardName,
      displayName: ownIdentity ? boardState.profiles[ownIdentity] || null : null,
      // A joiner is not a writer until it has synced with an existing member;
      // until then its writes only live in memory and are lost if it closes.
      writable: boardDb.writable
    })
  )
  if (!invite || boardOps.size > 0) sendBoardSynced()
  roomSyncTimer = setInterval(() => {
    broadcastDigest()
    refreshBoard()
  }, 1000)
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
    await boardDb.close()
    boardDb = null
  }
  boardStore = null
  boardUpdateInFlight = null
  boardOps = new Map()
  boardState = deriveBoard([])
  boardDigest = null
  reportedDisplayName = null
  verifiedOps.clear()
  boardName = ''
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
        await startRoom(msg.invite, msg.name)
      } catch (err) {
        pipe.write(JSON.stringify({ type: 'room-status', status: 'error', error: err.message }))
      }
    } else if (msg.type === messageTypes.roomLeave) {
      try {
        await leaveRoom()
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
      const columnId = boardState.columns.some((column) => column.id === msg.columnId)
        ? msg.columnId
        : boardState.columns[0].id
      await sendOwnOp({
        type: 'create',
        object: {
          id: uniqueId(identity),
          title: msg.title.trim().slice(0, LIMITS.title),
          body: typeof msg.body === 'string' ? msg.body.trim() : '',
          author: identity,
          createdAt: new Date().toISOString(),
          images,
          votes: {},
          comments: [],
          columnId,
          position: positionAt(cardsIn(columnId)),
          labelIds: Array.isArray(msg.labelIds) ? msg.labelIds : [],
          dueDate: msg.dueDate ?? null,
          mentions: Array.isArray(msg.mentions) ? msg.mentions : []
        }
      })
    } else if (msg.type === 'board:image') {
      // Only fetch images referenced by a post on the open board.
      const ref = boardState.objects
        .flatMap((object) => object.images || [])
        .find((image) => isImageRef(msg.ref) && imageKey(image) === imageKey(msg.ref))
      if (!ref || !boardBlobs) return
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
      const text = typeof msg.text === 'string' ? msg.text.trim() : ''
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
      for (const field of ['title', 'body', 'dueDate', 'labelIds', 'mentions']) {
        if (msg[field] !== undefined) payload[field] = msg[field]
      }
      if (typeof payload.title === 'string') {
        payload.title = payload.title.trim().slice(0, LIMITS.title)
      }
      await sendOwnOp(payload)
    } else if (msg.type === messageTypes.cardMove) {
      const card = cardById(msg.objectId)
      if (!card || !columnById(msg.columnId)) return
      await sendOwnOp({
        type: 'card:move',
        objectId: card.id,
        columnId: msg.columnId,
        position: positionAt(cardsIn(msg.columnId, card.id), msg.index)
      })
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
        ...(msg.index !== undefined && {
          position: positionAt(columnsExcept(msg.columnId), msg.index)
        })
      })
    } else if (msg.type === messageTypes.columnDelete) {
      // Keep at least one column; its cards move to the first remaining one.
      if (!columnById(msg.columnId) || boardState.columns.length < 2) return
      await sendOwnOp({ type: 'column:delete', columnId: msg.columnId })
    } else if (msg.type === messageTypes.labelUpsert) {
      const exists = boardState.labels.some((label) => label.id === msg.labelId)
      await sendOwnOp({
        type: 'label:upsert',
        labelId: exists ? msg.labelId : newId('label'),
        ...(typeof msg.name === 'string' && { name: msg.name.trim().slice(0, LIMITS.labelName) }),
        ...(msg.color !== undefined && { color: msg.color })
      })
    } else if (msg.type === messageTypes.labelDelete) {
      if (!boardState.labels.some((label) => label.id === msg.labelId)) return
      await sendOwnOp({ type: 'label:delete', labelId: msg.labelId })
    } else if (msg.type === messageTypes.themeSet) {
      await sendOwnOp({
        type: 'board:theme',
        ...(msg.background !== undefined && { background: msg.background }),
        ...(msg.accent !== undefined && { accent: msg.accent })
      })
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
