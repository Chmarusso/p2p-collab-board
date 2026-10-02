const PearRuntime = require('pear-runtime')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Autobee = require('autobee')
const Identity = require('keet-identity-key')
const crypto = require('hypercore-crypto')
const sodium = require('sodium-native')
const goodbye = require('graceful-goodbye')
const FramedStream = require('framed-stream')
const fs = require('bare-fs')
const path = require('bare-path')
const dir = require('bare-storage')
const { isBareKit } = require('which-runtime')
const { messageTypes, normalizeInvite } = require('@opencollab/board-protocol')

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
const board = new Map()
const operationIds = new Set()
const profiles = new Map()
let boardName = ''
let roomSyncTimer = null
let replicationDiscovery = null
let boardUpdateInFlight = null

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
  pipe.write(
    JSON.stringify({
      type: 'board-state',
      objects: [...board.values()],
      profiles: Object.fromEntries(profiles)
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
    if (!sodium.crypto_secretbox_open_easy(plaintext, ciphertext, nonce, roomState.secret))
      return null
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

function encryptBoardSnapshot() {
  return {
    type: 'board:state',
    encrypted: encryptBoardPayload({
      boardName,
      objects: [...board.values()],
      profiles: Object.fromEntries(profiles)
    })
  }
}

function decryptBoardSnapshot(message) {
  const payload = decryptBoardPayload(message.encrypted)
  if (payload?.boardName && !boardName) {
    boardName = payload.boardName
    pipe.write(JSON.stringify({ type: 'board-name', name: boardName }))
  }
  for (const [identity, name] of Object.entries(payload?.profiles || {}))
    profiles.set(identity, name)
  const ownIdentity = identityState?.identity.identityPublicKey.toString('hex')
  if (ownIdentity && profiles.has(ownIdentity)) {
    pipe.write(
      JSON.stringify({
        type: 'profile-status',
        identity: ownIdentity,
        displayName: profiles.get(ownIdentity)
      })
    )
  }
  return payload?.objects || null
}

async function loadBoard() {
  board.clear()
  profiles.clear()
  operationIds.clear()
  if (!boardDb) return
  await boardDb.ready()
  // The view is sorted by `op:<writer>:<length>`, not causal order, so a
  // comment/vote from one writer can precede the create from another writer.
  // Apply creates and profiles first, then the operations that reference them.
  const dependent = []
  for await (const entry of boardDb.view.createReadStream()) {
    try {
      const stored = JSON.parse(entry.value.toString())
      if (stored.type === 'board:meta') {
        const metadata = decryptBoardPayload(stored.encrypted)
        if (metadata?.boardName) boardName = metadata.boardName
      } else {
        const message = decryptBoardMessage(stored)
        if (message?.id && !operationIds.has(message.id)) {
          operationIds.add(message.id)
          if (['vote', 'comment'].includes(message.payload?.type)) dependent.push(message)
          else applyBoardMessage(message)
        }
      }
    } catch {
      console.error('Invalid persisted board operation')
    }
  }
  for (const message of dependent) applyBoardMessage(message)
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
    await loadBoard()
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

function broadcastBoardSnapshot() {
  const data = JSON.stringify(encryptBoardSnapshot()) + '\n'
  for (const peer of chatConnections.values()) {
    if (peer.authenticated) peer.connection.write(data)
  }
}

function signedPayload(message) {
  return Buffer.from(JSON.stringify(message.payload))
}

function verifyBoardMessage(message) {
  try {
    const proof = Buffer.from(message.proof, 'base64')
    const expectedIdentity = Buffer.from(message.identity, 'hex')
    return !!Identity.verify(proof, signedPayload(message), { expectedIdentity })
  } catch {
    return false
  }
}

function applyBoardMessage(message) {
  if (!verifyBoardMessage(message)) return false
  const payload = message.payload
  if (payload.type === 'create') {
    if (!board.has(payload.object.id)) {
      board.set(payload.object.id, { ...payload.object, author: message.identity })
    }
  } else if (payload.type === 'profile') {
    if (!payload.displayName?.trim()) return false
    profiles.set(message.identity, payload.displayName.trim())
  } else if (payload.type === 'vote') {
    const object = board.get(payload.objectId)
    // 0 clears the voter's vote, so votes move the score one step at a time.
    if (!object || ![1, -1, 0].includes(payload.value)) return false
    if (payload.value === 0) delete object.votes[message.identity]
    else object.votes[message.identity] = payload.value
  } else if (payload.type === 'comment') {
    const object = board.get(payload.objectId)
    if (!object || !payload.text?.trim()) return false
    object.comments ??= []
    if (!object.comments.some((comment) => comment.id === payload.comment.id)) {
      object.comments.push({ ...payload.comment, author: message.identity })
    }
  } else return false
  return true
}

function mergeBoardObject(existing, incoming) {
  if (!existing) return incoming

  const comments = new Map((existing.comments || []).map((comment) => [comment.id, comment]))
  for (const comment of incoming.comments || []) comments.set(comment.id, comment)

  return {
    ...existing,
    ...incoming,
    votes: { ...(existing.votes || {}), ...(incoming.votes || {}) },
    comments: [...comments.values()]
  }
}

function sendBoardMessage(message, local = false) {
  if (message.id && operationIds.has(message.id)) return
  if (!applyBoardMessage(message)) return
  if (message.id) {
    operationIds.add(message.id)
    boardDb
      .append(Buffer.from(JSON.stringify(encryptBoardMessage(message))), { optimistic: true })
      .catch((err) => console.error('Board persistence failed', err))
  }
  broadcast(message)
  broadcastBoardSnapshot()
  sendBoardState()
  const ownIdentity = identityState?.identity.identityPublicKey.toString('hex')
  if (message.payload.type === 'profile' && message.identity === ownIdentity) {
    pipe.write(
      JSON.stringify({
        type: 'profile-status',
        identity: ownIdentity,
        displayName: message.payload.displayName
      })
    )
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
      writeConnection(peer.connection, encryptBoardSnapshot())
      writeConnection(peer.connection, { type: 'board:request' })
    } else {
      pipe.write(JSON.stringify({ type: 'room-debug', status: 'authentication-failed' }))
      peer.connection.destroy()
    }
    return
  }

  if (peer.authenticated && message.type === 'board:state') {
    const objects = decryptBoardSnapshot(message) || []
    for (const object of objects) board.set(object.id, mergeBoardObject(board.get(object.id), object))
    sendBoardState()
    sendBoardSynced()
  }
  if (peer.authenticated && message.type === 'board:request') {
    writeConnection(peer.connection, encryptBoardSnapshot())
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
      displayName: ownIdentity ? profiles.get(ownIdentity) || null : null
    })
  )
  if (!invite || board.size > 0) sendBoardSynced()
  roomSyncTimer = setInterval(() => {
    broadcastBoardSnapshot()
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
  if (boardDb) {
    await boardDb.close()
    boardDb = null
  }
  boardStore = null
  boardUpdateInFlight = null
  board.clear()
  profiles.clear()
  operationIds.clear()
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
        if (!identityReady || !identityState)
          throw new Error('Unlock your identity before opening a board')
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
      msg.type === 'profile:set' &&
      typeof msg.displayName === 'string' &&
      msg.displayName.trim()
    ) {
      if (!identityReady) throw new Error('Unlock your identity before setting a display name')
      await identityReady
      const identity = identityState.identity.identityPublicKey.toString('hex')
      const message = {
        type: 'board:message',
        id: `${identity.slice(0, 12)}-${Date.now()}-profile`,
        identity,
        payload: { type: 'profile', displayName: msg.displayName.trim().slice(0, 48) }
      }
      message.proof = Identity.attestData(
        signedPayload(message),
        identityState.deviceKeyPair,
        identityState.deviceProof
      ).toString('base64')
      sendBoardMessage(message, true)
    } else if (msg.type === 'board:create' && typeof msg.title === 'string' && msg.title.trim()) {
      if (!identityReady) throw new Error('Unlock your identity before sending messages')
      await identityReady
      const identity = identityState.identity.identityPublicKey.toString('hex')
      const message = {
        type: 'board:message',
        id: `${identity.slice(0, 12)}-${Date.now()}-create`,
        identity,
        payload: {
          type: 'create',
          object: {
            id: `${identity.slice(0, 12)}-${Date.now()}`,
            title: msg.title.trim(),
            body: typeof msg.body === 'string' ? msg.body.trim() : '',
            author: identity,
            createdAt: new Date().toISOString(),
            votes: {},
            comments: []
          }
        }
      }
      message.proof = Identity.attestData(
        signedPayload(message),
        identityState.deviceKeyPair,
        identityState.deviceProof
      ).toString('base64')
      sendBoardMessage(message, true)
    } else if (['board:vote', 'board:comment'].includes(msg.type)) {
      if (!identityReady) throw new Error('Unlock your identity before editing the board')
      await identityReady
      const identity = identityState.identity.identityPublicKey.toString('hex')
      const payload =
        msg.type === 'board:vote'
          ? { type: 'vote', objectId: msg.objectId, value: msg.value }
          : {
              type: 'comment',
              objectId: msg.objectId,
              text: typeof msg.text === 'string' ? msg.text.trim() : '',
              comment: {
                id: `${identity.slice(0, 12)}-${Date.now()}`,
                author: identity,
                text: typeof msg.text === 'string' ? msg.text.trim() : '',
                createdAt: new Date().toISOString()
              }
            }
      const message = {
        type: 'board:message',
        id: `${identity.slice(0, 12)}-${Date.now()}-${payload.type}`,
        identity,
        payload
      }
      message.proof = Identity.attestData(
        signedPayload(message),
        identityState.deviceKeyPair,
        identityState.deviceProof
      ).toString('base64')
      sendBoardMessage(message, true)
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
