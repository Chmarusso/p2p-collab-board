// Runs the shared Bare backend (workers/main.js) from Node — the same worker
// Electron spawns — and speaks its pipe protocol. Every CLI command is a short
// session: unlock identity → open board → wait for peers → act → leave.
const PearRuntime = require('pear-runtime')
const FramedStream = require('framed-stream')
const { messageTypes } = require('@opencollab/board-protocol')
const runtime = require('./runtime')

class Session {
  constructor(storage, { verbose = false } = {}) {
    this.storage = storage
    this.state = {
      identity: null,
      publicKey: null,
      room: null,
      objects: [],
      profiles: {},
      members: [],
      columns: [],
      labels: [],
      rules: [],
      theme: { background: null, accent: null },
      info: { description: '' },
      alerts: [],
      peers: 0,
      synced: false,
      displayName: null,
      // OTA: null → 'downloading' → 'ready' → 'applied' (installed bundles only)
      update: null
    }
    this.waiters = new Set()
    const { version, upgrade } = runtime.manifest()
    // Six positional args, same order as getWorker() in electron/main.js.
    this.worker = PearRuntime.run(runtime.workerPath, [
      String(runtime.bundled),
      version,
      upgrade,
      runtime.appName,
      storage,
      runtime.bundled ? runtime.root : ''
    ])
    this.pipe = new FramedStream(this.worker)
    if (verbose) {
      this.worker.stdout.on('data', (data) => process.stderr.write(`[worker] ${data}`))
      this.worker.stderr.on('data', (data) => process.stderr.write(`[worker] ${data}`))
    }
    this.pipe.on('data', (data) => this._onData(data))
    this.exited = new Promise((resolve) => this.worker.once('exit', resolve))
    // The worker outlives its parent otherwise and keeps the storage locked.
    const killWorker = () => this.worker.kill()
    process.once('exit', killWorker)
    this.exited.then(() => process.removeListener('exit', killWorker))
  }

  _onData(data) {
    const text = data.toString()
    // Updater events are plain strings. An update is applied as soon as it is
    // downloaded: the bundle folder is swapped and the next run uses it.
    if (text === 'updating' || text === 'updated' || text === 'pear:updateApplied') {
      this.state.update = { updating: 'downloading', updated: 'ready' }[text] || 'applied'
      if (text === 'updated') this.pipe.write('pear:applyUpdate')
      for (const waiter of [...this.waiters]) waiter({ type: 'updater', status: this.state.update })
      return
    }
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    const state = this.state
    if (message.type === messageTypes.identityStatus) {
      state.identity = message.status
      state.publicKey = message.publicKey || state.publicKey
    }
    if (message.type === messageTypes.roomStatus) {
      state.room =
        message.status === 'ready' ? message : message.status === 'none' ? null : state.room
      if (message.status === 'ready') state.displayName = message.displayName || null
    }
    if (message.type === messageTypes.boardState) {
      state.objects = message.objects || []
      state.profiles = message.profiles || {}
      state.members = message.members || []
      state.columns = message.columns || []
      state.labels = message.labels || []
      state.rules = message.rules || []
      state.theme = message.theme || state.theme
      state.info = message.info || state.info
    }
    if (message.type === messageTypes.boardSynced) state.synced = true
    if (message.type === messageTypes.boardAlerts) state.alerts = message.boards || []
    if (message.type === messageTypes.profileStatus) state.displayName = message.displayName
    if (message.type === 'board-name' && state.room) state.room.boardName = message.name
    if (message.type === 'peer-count') state.peers = message.count || 0
    for (const waiter of [...this.waiters]) waiter(message)
  }

  send(message) {
    this.pipe.write(JSON.stringify(message))
  }

  // Resolves with the first message for which `predicate` returns true.
  wait(predicate, { timeout = 30000, label = 'worker response' } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter)
        reject(new Error(`Timed out waiting for ${label}`))
      }, timeout)
      const waiter = (message) => {
        let done
        try {
          done = predicate(message, this.state)
        } catch (err) {
          done = err
        }
        if (!done) return
        clearTimeout(timer)
        this.waiters.delete(waiter)
        if (done instanceof Error) reject(done)
        else resolve(message)
      }
      this.waiters.add(waiter)
    })
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async ready() {
    if (this.state.identity) return this.state.identity
    await this.wait((message) => message.type === messageTypes.identityStatus, {
      label: 'worker start'
    })
    return this.state.identity
  }

  identityResult(message) {
    if (message.type !== messageTypes.identityStatus) return false
    if (message.status === 'unlocked') return true
    if (message.error) return new Error(message.error)
    return false
  }

  // `create` encrypts the mnemonic the caller placed in the worker's legacy
  // identity file; `unlock` decrypts the existing one.
  async unlock(password, { create = false } = {}) {
    const status = await this.ready()
    if (!create && status === 'create') {
      throw new Error('No identity here yet. Run `opencollab identity new` or `identity import`.')
    }
    this.send({ type: create ? 'identity:create' : 'identity:unlock', password })
    await this.wait((message) => this.identityResult(message), { label: 'identity unlock' })
    return this.state.publicKey
  }

  async openBoard(invite, name) {
    this.state.synced = false
    // Comma-separated blind peer keys; replaces the built-in list (empty clears it).
    const blindPeers = process.env.OPENCOLLAB_BLIND_PEERS
    if (blindPeers !== undefined) {
      const keys = blindPeers.split(',').map((key) => key.trim())
      this.send({ type: messageTypes.blindPeersSet, keys: keys.filter(Boolean) })
    }
    this.send({ type: messageTypes.roomStart, invite: invite || null, name })
    const message = await this.wait(
      (message) =>
        message.type === messageTypes.roomStatus &&
        (message.status === 'ready' ||
          (message.status === 'error' && new Error(message.error || 'Could not open board'))),
      { timeout: 60000, label: 'board to open' }
    )
    return message
  }

  // Wait up to `seconds` for a peer, then for the board to stop changing.
  async settle(seconds) {
    const deadline = Date.now() + seconds * 1000
    while (this.state.peers === 0 && Date.now() < deadline) await this.sleep(200)
    if (this.state.peers === 0) return false
    let last = JSON.stringify(this.state.objects)
    let quietSince = Date.now()
    while (Date.now() < deadline && Date.now() - quietSince < 2000) {
      await this.sleep(250)
      const current = JSON.stringify(this.state.objects)
      if (current !== last) {
        last = current
        quietSince = Date.now()
      }
    }
    return true
  }

  async close() {
    if (this.state.room) {
      this.send({ type: messageTypes.roomLeave })
      await this.wait(
        (message) => message.type === messageTypes.roomStatus && message.status === 'none',
        {
          timeout: 10000,
          label: 'board to close'
        }
      ).catch(() => {})
    }
    // Let an update that finished downloading complete its swap.
    if (this.state.update === 'ready') {
      await this.wait((message) => message.type === 'updater' && message.status === 'applied', {
        timeout: 15000,
        label: 'update to apply'
      }).catch(() => {})
    }
    this.pipe.destroy()
    const killer = setTimeout(() => this.worker.kill(), 3000)
    await this.exited
    clearTimeout(killer)
  }
}

module.exports = { Session }
