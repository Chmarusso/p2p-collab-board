const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const keytar = require('keytar')
const nodeCrypto = require('crypto')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const PearRuntime = require('pear-runtime')
const FramedStream = require('framed-stream')
const Identity = require('keet-identity-key')

const { isMac, isLinux, isWindows } = require('which-runtime')
const { command, flag } = require('paparam')
const pkg = require('../package.json')
const { name, productName, version, upgrade } = pkg

const protocol = name
const mainWorkerSpecifier = '/workers/main.js'

const workers = new Map()

const appName = productName ?? name

const cmd = command(
  appName,
  flag('--storage <dir>', 'pass custom storage to pear-runtime'),
  flag('--no-updates', 'start without OTA updates'),
  flag('--remote-debugging-port <port>', 'enable Chromium remote debugging').hide(),
  flag('--no-sandbox', 'start without Chromium sandbox').hide()
)

cmd.parse(app.isPackaged ? process.argv.slice(1) : process.argv.slice(2))

const pearStore = cmd.flags.storage
const updates = cmd.flags.updates
if (cmd.flags.remoteDebuggingPort) {
  app.commandLine.appendSwitch('remote-debugging-port', cmd.flags.remoteDebuggingPort)
}

if (pearStore) app.setPath('userData', pearStore)

ipcMain.on('pkg', (evt) => {
  evt.returnValue = pkg
})

function getAppPath() {
  if (!app.isPackaged) return null
  if (isLinux && process.env.APPIMAGE) return process.env.APPIMAGE
  if (isWindows) return process.execPath
  return path.join(process.resourcesPath, '..', '..')
}

function sendToAll(name, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(name, data)
  }
}

function getWorkerDir() {
  const appPath = getAppPath()
  if (pearStore) return pearStore
  if (appPath === null) return path.join(os.tmpdir(), 'pear', appName)

  const isSnap = !!process.env.SNAP_USER_COMMON
  const linuxConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return isMac
    ? path.join(os.homedir(), 'Library', 'Application Support', appName)
    : isLinux
      ? isSnap
        ? path.join(process.env.SNAP_USER_COMMON, appName)
        : path.join(linuxConfigHome, appName)
      : path.join(os.homedir(), 'AppData', 'Local', appName)
}

function getKeychainPath() {
  return path.join(app.getPath('userData'), 'identity-keychain.bin')
}

function getKeychainService() {
  return `${appName} Identity`
}

function getBoardsKeychainService() {
  return `${appName} Boards`
}

function getLegacyKeychainService() {
  return 'HelloPear Identity'
}

function getKeychainAccount() {
  const storage = pearStore || getWorkerDir()
  const suffix = nodeCrypto.createHash('sha256').update(storage).digest('hex').slice(0, 16)
  return `${name}:${suffix}`
}

async function saveKeychainMnemonic(mnemonic) {
  await keytar.setPassword(getKeychainService(), getKeychainAccount(), mnemonic)
  await fs.rm(getKeychainPath(), { force: true })
}

async function loadKeychainMnemonic() {
  const stored = await keytar.getPassword(getKeychainService(), getKeychainAccount())
  if (stored) return stored
  const legacyStored = await keytar.getPassword(getLegacyKeychainService(), getKeychainAccount())
  if (legacyStored) {
    await saveKeychainMnemonic(legacyStored)
    return legacyStored
  }

  try {
    const encrypted = await fs.readFile(getKeychainPath())
    const mnemonic = safeStorage.decryptString(encrypted)
    await saveKeychainMnemonic(mnemonic)
    return mnemonic
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    const missing = new Error('No saved identity found')
    missing.code = 'ENOENT'
    throw missing
  }
}

async function getExistingLocalMnemonic() {
  try {
    return (await fs.readFile(path.join(getWorkerDir(), 'identity-mnemonic.txt'), 'utf8')).trim()
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

async function sendIdentityToWorker(mnemonic) {
  await Identity.from({ mnemonic })
  const pipe = getWorker(mainWorkerSpecifier)
  await pipe.write(JSON.stringify({ type: 'identity:load', mnemonic }))
}

function getWorker(specifier) {
  if (workers.has(specifier)) return workers.get(specifier)
  const appPath = getAppPath()
  const dir = getWorkerDir()
  if (pearStore) console.log('pear store: ' + pearStore)

  const extension = isLinux ? '.AppImage' : isMac ? '.app' : '.msix'

  const worker = PearRuntime.run(require.resolve('..' + specifier), [
    updates,
    version,
    upgrade,
    productName + extension,
    dir,
    appPath
  ])
  const pipe = new FramedStream(worker)

  function sendWorkerStdout(data) {
    sendToAll('pear:worker:stdout:' + specifier, data)
  }
  function sendWorkerStderr(data) {
    sendToAll('pear:worker:stderr:' + specifier, data)
  }
  function sendWorkerIPC(data) {
    sendToAll('pear:worker:ipc:' + specifier, data)
  }
  function onBeforeQuit() {
    pipe.destroy()
  }
  ipcMain.handle('pear:worker:writeIPC:' + specifier, (evt, data) => {
    return pipe.write(data)
  })
  workers.set(specifier, pipe)
  pipe.on('data', sendWorkerIPC)
  worker.stdout.on('data', sendWorkerStdout)
  worker.stderr.on('data', sendWorkerStderr)
  worker.once('exit', (code) => {
    app.removeListener('before-quit', onBeforeQuit)
    ipcMain.removeHandler('pear:worker:writeIPC:' + specifier)
    pipe.removeListener('data', sendWorkerIPC)
    worker.stdout.removeListener('data', sendWorkerStdout)
    worker.stderr.removeListener('data', sendWorkerStderr)
    sendToAll('pear:worker:exit:' + specifier, code)
    workers.delete(specifier)
  })
  app.on('before-quit', onBeforeQuit)
  return pipe
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  const devServerUrl = process.env.PEAR_DEV_SERVER_URL

  if (devServerUrl) {
    await win.loadURL(devServerUrl)
    win.webContents.openDevTools()
    return
  }

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

ipcMain.handle('pear:applyUpdate', () => {
  const pipe = getWorker(mainWorkerSpecifier)

  return new Promise((resolve, reject) => {
    function onData(data) {
      const message = data.toString()

      if (message === 'pear:updateApplied') {
        pipe.removeListener('data', onData)
        resolve()
      }
    }

    pipe.on('data', onData)
    pipe.write('pear:applyUpdate')
  })
})
ipcMain.handle('pear:startWorker', (evt, filename) => {
  getWorker(filename)
  return true
})
ipcMain.handle('identity:keychain:status', async () => {
  const hasIdentity = Boolean(await keytar.getPassword(getKeychainService(), getKeychainAccount()))
  return { available: true, hasIdentity }
})
ipcMain.handle('identity:keychain:load', async () => {
  let mnemonic
  try {
    mnemonic = await loadKeychainMnemonic()
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    mnemonic = await getExistingLocalMnemonic()
    if (!mnemonic) throw new Error('No saved identity found')
    await saveKeychainMnemonic(mnemonic)
  }
  await sendIdentityToWorker(mnemonic)
  return true
})
ipcMain.handle('identity:keychain:create', async () => {
  const mnemonic = Identity.generateMnemonic()
  await saveKeychainMnemonic(mnemonic)
  await sendIdentityToWorker(mnemonic)
  return true
})
ipcMain.handle('identity:keychain:import', async (evt, mnemonic) => {
  if (typeof mnemonic !== 'string' || mnemonic.trim().split(/\s+/).length < 12) {
    throw new Error('Enter a valid recovery phrase')
  }
  const normalized = mnemonic.trim().replace(/\s+/g, ' ')
  await Identity.from({ mnemonic: normalized })
  await saveKeychainMnemonic(normalized)
  await sendIdentityToWorker(normalized)
  return true
})
ipcMain.handle('identity:legacy:unlock', (evt, password) => {
  const pipe = getWorker(mainWorkerSpecifier)
  return pipe.write(JSON.stringify({ type: 'identity:unlock', password }))
})
ipcMain.handle('boards:recent:list', async () => {
  const stored = await keytar.getPassword(getBoardsKeychainService(), getKeychainAccount())
  if (!stored) return []
  try {
    const boards = JSON.parse(stored)
    return Array.isArray(boards) ? boards : []
  } catch {
    return []
  }
})
ipcMain.handle('boards:recent:save', async (evt, board) => {
  if (!board || typeof board.invite !== 'string' || !board.invite) throw new Error('Invalid board')
  const stored = await keytar.getPassword(getBoardsKeychainService(), getKeychainAccount())
  let boards = []
  try {
    const parsed = stored ? JSON.parse(stored) : []
    if (Array.isArray(parsed)) boards = parsed
  } catch {}
  boards = [board, ...boards.filter((entry) => entry.invite !== board.invite)].slice(0, 12)
  await keytar.setPassword(getBoardsKeychainService(), getKeychainAccount(), JSON.stringify(boards))
  return boards
})
ipcMain.handle('boards:recent:remove', async (evt, invite) => {
  if (typeof invite !== 'string' || !invite) throw new Error('Invalid board invite')
  const stored = await keytar.getPassword(getBoardsKeychainService(), getKeychainAccount())
  let boards = []
  try {
    const parsed = stored ? JSON.parse(stored) : []
    if (Array.isArray(parsed)) boards = parsed
  } catch {}
  boards = boards.filter((board) => board.invite !== invite)
  await keytar.setPassword(getBoardsKeychainService(), getKeychainAccount(), JSON.stringify(boards))
  return boards
})
ipcMain.handle('app:afterUpdate', () => {
  if (isLinux && process.env.APPIMAGE) {
    app.relaunch({
      execPath: process.env.APPIMAGE,
      args: [
        '--appimage-extract-and-run',
        ...process.argv.slice(1).filter((arg) => arg !== '--appimage-extract-and-run')
      ]
    })
  } else if (!isWindows) {
    app.relaunch()
  }
  app.quit()
})

function handleDeepLink(url) {
  console.log('deep link:', url)
}

app.setAsDefaultProtocolClient(protocol)

app.on('open-url', (evt, url) => {
  evt.preventDefault()
  handleDeepLink(url)
})

const lock = app.requestSingleInstanceLock()

if (!lock) {
  app.quit()
} else {
  app.on('second-instance', (evt, args) => {
    const url = args.find((arg) => arg.startsWith(protocol + '://'))
    if (url) handleDeepLink(url)
  })

  app.whenReady().then(() => {
    createWindow().catch((err) => {
      console.error('Failed to create window:', err)
      app.quit()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch((err) => {
          console.error('Failed to create window:', err)
        })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
