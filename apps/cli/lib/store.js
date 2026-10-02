// Local CLI state. The identity itself is stored by the worker (encrypted with
// the password in identity-mnemonic.json); remembered boards hold invites, which
// are secrets, so they are encrypted with the same password.
const fs = require('fs/promises')
const path = require('path')
const sodium = require('sodium-native')

const boardsFile = (storage) => path.join(storage, 'cli-boards.json')

function deriveKey(password, salt) {
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

async function readBoards(storage, password) {
  let stored
  try {
    stored = JSON.parse(await fs.readFile(boardsFile(storage), 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const nonce = Buffer.from(stored.nonce, 'base64')
  const ciphertext = Buffer.from(stored.ciphertext, 'base64')
  const plaintext = Buffer.alloc(ciphertext.length - sodium.crypto_secretbox_MACBYTES)
  const key = deriveKey(password, Buffer.from(stored.salt, 'base64'))
  if (!sodium.crypto_secretbox_open_easy(plaintext, ciphertext, nonce, key)) {
    throw new Error('Could not decrypt remembered boards (wrong password?)')
  }
  return JSON.parse(plaintext.toString())
}

async function writeBoards(storage, password, boards) {
  const salt = Buffer.alloc(sodium.crypto_pwhash_SALTBYTES)
  const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(salt)
  sodium.randombytes_buf(nonce)
  const plaintext = Buffer.from(JSON.stringify(boards))
  const ciphertext = Buffer.alloc(plaintext.length + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(ciphertext, plaintext, nonce, deriveKey(password, salt))
  await fs.mkdir(storage, { recursive: true })
  await fs.writeFile(
    boardsFile(storage),
    JSON.stringify({
      version: 1,
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }),
    { mode: 0o600 }
  )
}

async function rememberBoard(storage, password, board) {
  const boards = await readBoards(storage, password)
  const next = [
    { ...board, joinedAt: Date.now() },
    ...boards.filter((entry) => entry.invite !== board.invite)
  ]
  await writeBoards(storage, password, next)
  return next
}

async function forgetBoards(storage) {
  await fs.rm(boardsFile(storage), { force: true })
}

// The worker encrypts a plaintext mnemonic found in its legacy identity file
// when it receives `identity:create`, then deletes that file. The CLI uses that
// path to persist a phrase it generated or imported.
async function stageMnemonic(storage, mnemonic) {
  await fs.mkdir(storage, { recursive: true })
  await fs.writeFile(path.join(storage, 'identity-mnemonic.txt'), mnemonic, { mode: 0o600 })
}

async function hasIdentity(storage) {
  try {
    await fs.access(path.join(storage, 'identity-mnemonic.json'))
    return true
  } catch {
    return false
  }
}

async function removeIdentity(storage) {
  await fs.rm(path.join(storage, 'identity-mnemonic.json'), { force: true })
}

module.exports = {
  readBoards,
  writeBoards,
  rememberBoard,
  forgetBoards,
  stageMnemonic,
  hasIdentity,
  removeIdentity
}
