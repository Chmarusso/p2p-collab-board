// The background board check behind phone notifications (Android). Every ~15
// minutes Android's WorkManager wakes the app (expo-background-task), the
// worker syncs each joined board for a few seconds with whoever is online,
// the blind peers included, and new alerts are posted (notify.ts).
//
// With the app running, its worker does the syncing; with the app closed, the
// check starts a worker of its own, logs in with the saved recovery words and
// stops it again. Without saved words there is nothing to log in with, so no check.
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { Worklet } from 'react-native-bare-kit'
import FramedStream from 'framed-stream'
import { messageTypes } from '@opencollab/board-protocol'
import workerBundle from './worker.bundle.js'
import { languageKey, setLanguage } from './i18n'
import { notifyAlerts, notifyChoice } from './notify'
import {
  blockedKey,
  identityPhraseKey,
  keychainChoiceKey,
  recentBoardsKey,
  sessionKey
} from './storageKeys'
import type { AlertBoard } from './board/model'

const { version, upgrade, productName } = require('../package.json') as {
  version: string
  upgrade: string
  productName: string
}

export const BOARD_CHECK = 'opencollab-board-check'
// Android allows a background run about 10 minutes; a check of 50 boards at
// 15 s each fits well inside this.
const CHECK_TIMEOUT = 4 * 60 * 1000
// With the app's own worker, the check ends once its reports stop coming.
const QUIET = 25 * 1000

type Message = { type: string; [key: string]: any }
type Listener = (message: Message) => void

// The app's worker while the app runs: the check asks it to look at every board
// now, and the app posts what it finds.
type LiveWorker = { refresh(): void; subscribe(listener: Listener): () => void }
let live: LiveWorker | null = null
export const setLiveWorker = (worker: LiveWorker | null) => {
  live = worker
}

// A worker the check started with the app closed. Two workers can't share the
// stores, so the app stops this one before starting its own.
let headless: { stop(): void; done: Promise<void> } | null = null

export async function stopHeadlessCheck() {
  const running = headless
  if (!running) return
  running.stop()
  await running.done
  // Give the worker's storage locks a moment to go.
  await new Promise((resolve) => setTimeout(resolve, 1000))
}

// Resolves with the last message `until` accepted, or null after `ms`.
function waitFor(
  subscribe: (listener: Listener) => () => void,
  until: (message: Message) => boolean,
  ms: number
) {
  return new Promise<Message | null>((resolve) => {
    const timer = setTimeout(() => finish(null), ms)
    const unsubscribe = subscribe((message) => {
      if (until(message)) finish(message)
    })
    function finish(message: Message | null) {
      clearTimeout(timer)
      unsubscribe()
      resolve(message)
    }
  })
}

async function checkWithApp(worker: LiveWorker) {
  let quiet: ReturnType<typeof setTimeout> | undefined
  await new Promise<void>((resolve) => {
    const stop = () => {
      clearTimeout(quiet)
      unsubscribe()
      resolve()
    }
    const unsubscribe = worker.subscribe((message) => {
      if (message.type !== messageTypes.boardAlerts) return
      clearTimeout(quiet)
      quiet = setTimeout(stop, QUIET)
    })
    quiet = setTimeout(stop, CHECK_TIMEOUT)
    worker.refresh()
  })
}

async function checkWithoutApp() {
  if ((await SecureStore.getItemAsync(keychainChoiceKey)) !== 'saved') return
  if ((await SecureStore.getItemAsync(sessionKey)) !== '1') return
  const phrase = await SecureStore.getItemAsync(identityPhraseKey)
  if (!phrase) return
  const language = await SecureStore.getItemAsync(languageKey)
  if (language === 'system' || language === 'en' || language === 'pl') setLanguage(language)

  const worklet = new Worklet()
  // No OTA updates from a background check: 'false' turns the updater off.
  worklet.start('/worker.bundle', workerBundle, ['false', version, upgrade, productName])
  const framed = new FramedStream(worklet.IPC)
  const listeners = new Set<Listener>()
  framed.on('data', (data: Uint8Array) => {
    let message: Message
    try {
      message = JSON.parse(new TextDecoder().decode(data))
    } catch {
      return
    }
    for (const listener of listeners) listener(message)
  })
  const subscribe = (listener: Listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const send = (message: object) => framed.write(JSON.stringify(message))

  let stopped = false
  let finished = () => {}
  const done = new Promise<void>((resolve) => (finished = resolve))
  const stop = () => {
    if (stopped) return
    stopped = true
    framed.destroy()
    worklet.terminate()
    finished()
  }
  headless = { stop, done }
  try {
    send({ type: messageTypes.identityLoad, mnemonic: phrase })
    const status = await waitFor(
      subscribe,
      (message) =>
        message.type === messageTypes.identityStatus &&
        (message.status === 'unlocked' || Boolean(message.error)),
      60 * 1000
    )
    const identity: string = status?.publicKey || ''
    if (!identity || stopped) return
    const boards = JSON.parse((await SecureStore.getItemAsync(recentBoardsKey(identity))) || '[]')
    if (!Array.isArray(boards) || !boards.length) return
    const blocked = JSON.parse((await SecureStore.getItemAsync(blockedKey(identity))) || '[]')

    // Reports come after each board is checked; the last one has them all.
    let latest: AlertBoard[] = []
    const unsubscribe = subscribe((message) => {
      if (message.type === messageTypes.boardAlerts) latest = message.boards || []
    })
    send({
      type: messageTypes.boardsWatch,
      boards: boards.map(({ invite, name }: { invite: string; name: string }) => ({ invite, name }))
    })
    await waitFor(
      subscribe,
      (message) =>
        message.type === messageTypes.boardAlerts &&
        message.boards?.length > 0 &&
        message.boards.every((board: AlertBoard) => board.checkedAt > 0),
      CHECK_TIMEOUT
    )
    unsubscribe()
    if (!stopped) await notifyAlerts(identity, latest, { post: true, blocked })
  } finally {
    stop()
    headless = null
  }
}

async function checkBoards() {
  if ((await notifyChoice()) !== 'on') return
  if (live) return checkWithApp(live)
  if (!headless) await checkWithoutApp()
}

// expo-background-task and expo-task-manager are linked in the Android build only.
const tasks =
  Platform.OS === 'android'
    ? {
        BackgroundTask: require('expo-background-task') as typeof import('expo-background-task'),
        TaskManager: require('expo-task-manager') as typeof import('expo-task-manager')
      }
    : null

// Must run when the JS bundle loads (index.js), also when Android starts the
// app only for the check.
if (tasks) {
  tasks.TaskManager.defineTask(BOARD_CHECK, async () => {
    try {
      await checkBoards()
    } catch (err) {
      console.warn('Board check failed', err)
    }
    return tasks.BackgroundTask.BackgroundTaskResult.Success
  })
}

export async function scheduleBoardCheck(on: boolean) {
  if (!tasks) return
  const registered = await tasks.TaskManager.isTaskRegisteredAsync(BOARD_CHECK)
  if (on && !registered) {
    await tasks.BackgroundTask.registerTaskAsync(BOARD_CHECK, { minimumInterval: 15 })
  } else if (!on && registered) {
    await tasks.BackgroundTask.unregisterTaskAsync(BOARD_CHECK)
  }
}
