import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Alert,
  Animated,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import * as Clipboard from 'expo-clipboard'
import { Worklet } from 'react-native-bare-kit'
import FramedStream from 'framed-stream'
import workerBundle from './worker.bundle.js'
import { BootSplash } from './BootSplash'
import { THEME_MODES, boardKind, messageTypes, themeTemplate } from '@opencollab/board-protocol'
import type { BoardKindId, ThemeMode } from '@opencollab/board-protocol'
import {
  Avatar,
  BoardImages,
  Button,
  CachedImage,
  FadeIn,
  FeatherName,
  IconButton,
  Identicon,
  ImageRef,
  colors,
  imageKey,
  mono,
  reduceMotion,
  PendingImage,
  pickPreparedImages,
  prepareImage,
  applyPalette,
  scheme,
  setReduceMotion,
  themed
} from './ui'
import { BoardScreen } from './board/BoardScreen'
import { KindOptions } from './board/Kinds'
import { Chip } from './board/CardSheet'
import { QrCode, QrScanner } from './QrInvite'
import { avatarOf, hideBlocked, hideBlockedAlerts, isVideo } from './board/model'
import type { AlertBoard, BoardAlert, BoardData, CardSource } from './board/model'
import { KeychainChoice, SettingsSheet, keychainCopy } from './Settings'
import { DEFAULT_SOUND, SoundName, isSoundName, playSound, soundPrefKey } from './sounds'
import {
  SharePref,
  SharePrefs,
  fetchPreview,
  parseShare,
  readSharePrefs,
  sharePrefsKey,
  withPreview
} from './share'
import { ShareBoard, ShareSheet } from './ShareSheet'
import { SharedItemsSheet } from './SharedItems'
import { SharedRecord, loadShared, newSharedId, removeShared, upsertShared } from './sharedHistory'
import { LanguageChoice, languageKey, plural, setLanguage, t } from './i18n'

const normalizeInvite = (value: string) => {
  const invite = value.trim()
  const match = invite.match(
    /^(?:opencollab:\/\/board\/|opencollab:\/\/|https?:\/\/[^/]+\/board\/)?(.+)$/i
  )
  return decodeURIComponent(match ? match[1] : invite).replace(/\/$/, '')
}

const themeModeKey = 'opencollab.theme-mode'
const themeOverrideKey = 'opencollab.theme-override'

const inviteLink = (invite: string) =>
  `opencollab://board/${encodeURIComponent(normalizeInvite(invite))}`

// package.json is the single source of truth for the OTA version and link;
// keep `version` in sync with app.json / CFBundleShortVersionString for binaries.
const { version, upgrade, productName } = require('../package.json') as {
  version: string
  upgrade: string
  productName: string
}
// The version people see: an OTA's package.json version is always higher than
// the binary's app.json version, so the higher of the two is what's running.
const binaryVersion = (require('../app.json') as { expo: { version: string } }).expo.version
const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  const i = x.findIndex((n, j) => n !== y[j])
  return i >= 0 && x[i] > (y[i] ?? 0)
}
const shownVersion = newer(binaryVersion, version) ? binaryVersion : version

const emptyBoard: BoardData = {
  objects: [],
  columns: [],
  labels: [],
  theme: { background: null, accent: null, template: null },
  info: { description: '' },
  profiles: {},
  owner: null,
  members: [],
  rules: []
}

// OTA status, shared by every screen's banner. The worker sends the plain
// strings 'updating' / 'updated' (pear-mobile updater) and 'pear:updateApplied'.
type UpdateStatus = '' | 'downloading' | 'installed'
let updateStatus: UpdateStatus = ''
const updateListeners = new Set<(status: UpdateStatus) => void>()
function setUpdateStatus(status: UpdateStatus) {
  updateStatus = status
  for (const listener of updateListeners) listener(status)
}

type BoardComment = { id: string; author: string; text: string; createdAt?: string }

// Image attachments: bytes live encrypted in each author's Hyperblobs core; the
// worker fetches them on demand and they are cached here as data URIs.
const MAX_IMAGES = 4

type BoardObject = {
  id: string
  title: string
  body: string
  author: string
  createdAt?: string
  images?: ImageRef[]
  votes: Record<string, number>
  comments: BoardComment[]
}
type WorkerMessage = { type: string; [key: string]: any }
type RecentBoard = { invite: string; name: string; joinedAt: number }

// Invites are tied to the identity that joined, so remembered boards are kept
// per identity public key. The unscoped key predates that and is migrated once.
const legacyRecentBoardsKey = 'opencollab.recent-boards'
const recentBoardsKey = (identity: string) => `opencollab.recent-boards.${identity}`

// The recovery phrase is kept in the Keychain only if the user agreed to it;
// the choice is remembered. A phrase saved before the choice existed counts as
// 'saved'.
const identityPhraseKey = 'opencollab.identity'
const keychainChoiceKey = 'opencollab.identity-keychain'
// Logged in with saved recovery words: the next launch logs in by itself, until
// "Log out".
const sessionKey = 'opencollab.session'
// The board open when the app was left, reopened on the next launch.
const lastBoardKey = (identity: string) => `opencollab.last-board.${identity}`

const shortKey = (hex: string) => (hex.length > 10 ? `${hex.slice(0, 4)}…${hex.slice(-4)}` : hex)

function relativeTime(iso?: string) {
  if (!iso) return ''
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return t('now')
  if (seconds < 3600) return t('{n}m', { n: Math.floor(seconds / 60) })
  if (seconds < 86400) return t('{n}h', { n: Math.floor(seconds / 3600) })
  return t('{n}d', { n: Math.floor(seconds / 86400) })
}

// Which cards show where: ids, columns, order, archived and template flags.
function placementKey(
  objects: Array<{
    id: string
    columnId?: string
    position?: string
    archived?: boolean
    template?: boolean
  }>,
  columns: Array<{ id: string; position?: string }>
) {
  return [
    columns.map((column) => `${column.id}@${column.position}`).join(','),
    objects
      .map(
        (card) =>
          `${card.id}:${card.columnId}:${card.position}:${card.archived ? 1 : 0}${card.template ? 1 : 0}`
      )
      .join(',')
  ].join('|')
}

function describeNetwork(status: string) {
  if (status === 'topic-joining') return t('Searching for peers')
  if (status === 'topic-joined') return t('Announced on the network')
  if (status === 'connection-received') return t('Peer connecting')
  if (status === 'authenticated') return t('Peer verified')
  if (/error|failed/.test(status)) return t('Network problem, retrying')
  return status
}

function AppContent({ onBoot }: { onBoot: () => void }) {
  const [pipe, setPipe] = useState<any>(null)
  const [identityPhrase, setIdentityPhrase] = useState('')
  const [identityReady, setIdentityReady] = useState(false)
  const [identityKey, setIdentityKey] = useState('')
  const [identityChoice, setIdentityChoice] = useState<'choose' | 'existing'>('choose')
  const [backupPhrase, setBackupPhrase] = useState('')
  const [entryMode, setEntryMode] = useState<'choose' | 'create' | 'join'>('choose')
  const [entryError, setEntryError] = useState('')
  const [invite, setInvite] = useState('')
  const [boardName, setBoardName] = useState('')
  const [newBoardKind, setNewBoardKind] = useState<BoardKindId>('kanban')
  // New board: the name first, then the type.
  const [createStep, setCreateStep] = useState<'name' | 'kind'>('name')
  const [recentBoards, setRecentBoards] = useState<RecentBoard[]>([])
  const [displayName, setDisplayName] = useState('')
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [invitationLink, setInvitationLink] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [editProfileOpen, setEditProfileOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [boardSettingsRequest, setBoardSettingsRequest] = useState(0)
  const [scannerOpen, setScannerOpen] = useState(false)
  const { width: windowWidth } = useWindowDimensions()
  const [composerOpen, setComposerOpen] = useState(false)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [imageCache, setImageCache] = useState<Record<string, CachedImage>>({})
  const [viewerUri, setViewerUri] = useState('')
  const imageRequests = useRef(new Set<string>())
  const [boardData, setBoardData] = useState<BoardData>(emptyBoard)
  const profiles = boardData.profiles
  const [boardKey, setBoardKey] = useState('')
  const [allAlertBoards, setAlertBoards] = useState<AlertBoard[]>([])
  // Members blocked on this device, per identity; see hideBlocked.
  const [blocked, setBlocked] = useState<string[]>([])
  const blockedRef = useRef<string[]>([])
  const alertBoards = useMemo(
    () => hideBlockedAlerts(allAlertBoards, blocked),
    [allAlertBoards, blocked]
  )
  const boardView = useMemo(() => hideBlocked(boardData, blocked), [boardData, blocked])
  // Notifications read: everything up to `readUntil` (kept in SecureStore, which
  // only holds small values) plus what was opened this session.
  const [readUntil, setReadUntil] = useState(0)
  const [readNow, setReadNow] = useState<Set<string>>(new Set())
  const [openCardRequest, setOpenCardRequest] = useState<{ cardId: string; nonce: number } | null>(
    null
  )
  const pendingOpen = useRef<{ boardKey: string; cardId: string } | null>(null)
  const [composerColumn, setComposerColumn] = useState<string | null>(null)
  // The page a shared card came from, saved as its "View original" link.
  const [composerSource, setComposerSource] = useState<CardSource | null>(null)
  // Board moves made here land instantly; only other members' changes animate.
  const localMoveAt = useRef(0)
  const lastPlacement = useRef('')
  const workerListeners = useRef(new Set<(message: WorkerMessage) => void>())
  const [roomReady, setRoomReady] = useState(false)
  const [synced, setSynced] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  // The worker's raw status; describeNetwork words it in the current language.
  const [networkStatus, setNetworkStatus] = useState('')
  const [peerCount, setPeerCount] = useState(0)
  const [waitedForMembers, setWaitedForMembers] = useState(false)
  const identityKeyRef = useRef('')
  const currentBoardKey = useRef('')
  // The worker pipe, for code that runs inside its own message handler.
  const pipeRef = useRef<any>(null)
  // Set at launch when the last session didn't log out; each is used once.
  const autoLogin = useRef(false)
  const resumeBoard = useRef(true)
  // A share opened the app: the board picker wins over the last board.
  const shareArrived = useRef(false)
  // The open board's invite, to tell whether a shared link needs a board switch.
  const currentInvite = useRef('')
  // The shared item in the board picker, and every item shared on this device.
  const [shared, setShared] = useState<SharedRecord | null>(null)
  const [sharedRecords, setSharedRecords] = useState<SharedRecord[]>([])
  const sharedRecordsRef = useRef<SharedRecord[]>([])
  const [sharedListOpen, setSharedListOpen] = useState(false)
  // Preview and prepared image per shared item, started as soon as it arrives.
  const previews = useRef(
    new Map<string, Promise<{ record: SharedRecord; image: PendingImage | null }>>()
  )
  const [previewsLoading, setPreviewsLoading] = useState<string[]>([])
  // The shared item the open composer was filled from.
  const composerShare = useRef<string | null>(null)
  const [sharePrefs, setSharePrefs] = useState<SharePrefs>({ boards: {} })
  const sharePrefsRef = useRef<SharePrefs>({ boards: {} })
  // A shared link waiting for its board to open before the composer shows.
  const pendingShare = useRef<{ invite: string; record: SharedRecord } | null>(null)
  // The worker sends a board's state just before its room-status 'ready'.
  const boardColumns = useRef<{ id: string }[]>([])
  const boardKindRef = useRef('kanban')
  const savedPhraseRef = useRef('')
  // The phrase of the identity being loaded, and of the one now unlocked.
  const loadingPhraseRef = useRef('')
  const phraseRef = useRef('')
  const [keychain, setKeychain] = useState<KeychainChoice>(null)
  const keychainRef = useRef<KeychainChoice>(null)
  const [hasSavedPhrase, setHasSavedPhrase] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sound, setSound] = useState<SoundName>(DEFAULT_SOUND)
  const soundRef = useRef<SoundName>(DEFAULT_SOUND)
  const readUntilRef = useRef(0)
  readUntilRef.current = readUntil
  // Alert ids already seen per board; a board's first check only sets this,
  // so opening the app or adding a board doesn't play the sound.
  const seenAlerts = useRef(new Map<string, Set<string>>())
  const exportRequest = useRef('')
  const [exporting, setExporting] = useState(false)
  // Appearance is per device: a light/dark mode and an optional template that
  // replaces the open board's. Applied here, before any child reads `colors`.
  const systemScheme = useColorScheme()
  // Dark until the user picks System or Light, so existing users keep the old look.
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark')
  const [themeOverride, setThemeOverride] = useState('')
  const [languageChoice, setLanguageChoice] = useState<LanguageChoice>('system')
  const template = themeTemplate(themeOverride || (boardKey ? boardData.theme.template : null))
  const activeScheme =
    themeMode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : themeMode
  const paletteKey = useRef('')
  if (paletteKey.current !== `${template.id}:${activeScheme}`) {
    paletteKey.current = `${template.id}:${activeScheme}`
    applyPalette(template[activeScheme], activeScheme)
  }

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    // Started here rather than through pear-mobile's PearRuntime.run (which does
    // the same) so the cleanup can stop it: Android Back destroys the activity
    // while the process lives on, and a second worker can't lock the stores.
    const worklet = new Worklet()
    worklet.start('/worker.bundle', workerBundle, [
      String(!(globalThis as { __DEV__?: boolean }).__DEV__),
      version,
      upgrade,
      productName
    ])
    const framed = new FramedStream(worklet.IPC)
    framed.on('data', (data: Uint8Array) => {
      onBoot()
      const text = new TextDecoder().decode(data)
      if (text === 'updating') return setUpdateStatus('downloading')
      if (text === 'updated') {
        // pear-mobile writes the update's package.json into the downloaded folder
        // right after 'updated'; applying swaps that folder in, so give it a moment.
        setTimeout(() => framed.write('pear:applyUpdate'), 3000)
        return
      }
      if (text === 'pear:updateApplied') return setUpdateStatus('installed')
      let message: WorkerMessage
      try {
        message = JSON.parse(text)
      } catch {
        return
      }
      if (message.type === messageTypes.identityStatus) {
        if (message.status === 'unlocked') {
          identityKeyRef.current = message.publicKey || ''
          if (message.publicKey) {
            SecureStore.getItemAsync(`opencollab.alerts-read-until.${message.publicKey}`).then(
              (value) => setReadUntil(Number(value) || 0)
            )
            SecureStore.getItemAsync(`opencollab.blocked.${message.publicKey}`).then((value) => {
              const list = value ? (JSON.parse(value) as string[]) : []
              blockedRef.current = list
              setBlocked(list)
            })
          }
          setIdentityKey(message.publicKey || '')
          if (message.publicKey) void loadRecentBoards(message.publicKey)
          setIdentityReady(true)
          if (keychainRef.current === 'saved' || keychainRef.current === 'protected') {
            void SecureStore.setItemAsync(sessionKey, '1')
          }
          if (message.mnemonic) {
            // Created: the Keychain question comes once the words are backed up.
            phraseRef.current = message.mnemonic
            setIdentityPhrase(message.mnemonic)
            setBackupPhrase(message.mnemonic)
          } else if (loadingPhraseRef.current) {
            phraseRef.current = loadingPhraseRef.current
            offerKeychain(loadingPhraseRef.current)
          }
          loadingPhraseRef.current = ''
        } else if (message.error) Alert.alert(t('Identity error'), message.error)
      }
      if (message.type === messageTypes.roomStatus && message.status === 'ready') {
        setRoomReady(true)
        // Writers already hold the board; a joiner waits for its first sync
        // (board-synced) before it can post — its earlier writes would be lost.
        setSynced(!!message.writable)
        setEntryError('')
        setBoardName(message.boardName || 'OpenCollab')
        setInvitationLink(message.invite || '')
        setBoardKey(message.boardKey || '')
        currentBoardKey.current = message.boardKey || ''
        currentInvite.current = message.invite ? normalizeInvite(message.invite) : ''
        if (message.invite) rememberBoard(message.invite, message.boardName || t('Unnamed board'))
        if (message.invite && identityKeyRef.current) {
          void SecureStore.setItemAsync(
            lastBoardKey(identityKeyRef.current),
            normalizeInvite(message.invite)
          )
        }
        openPendingShare(boardColumns.current)
        if (message.displayName) {
          setDisplayName(message.displayName)
          setDisplayNameDraft(message.displayName)
        }
      }
      if (message.type === messageTypes.roomStatus && message.status === 'none') {
        currentInvite.current = ''
        setRoomReady(false)
        setSynced(false)
        setBoardData(emptyBoard)
        setBoardKey('')
        setBoardName('')
        setInvitationLink('')
        setDisplayName('')
        setDisplayNameDraft('')
        setImageCache({})
        imageRequests.current.clear()
        setEntryMode('choose')
      }
      if (message.type === 'board-action-error' && message.error) {
        if (message.requestId && message.requestId === exportRequest.current) {
          exportRequest.current = ''
          setExporting(false)
        }
        Alert.alert(t('Not done'), message.error)
      }
      if (message.type === 'board-export' && message.requestId === exportRequest.current) {
        exportRequest.current = ''
        setExporting(false)
        if (message.path) {
          Share.share({ url: `file://${encodeURI(message.path)}` }).catch((err) =>
            Alert.alert(t('Export'), err?.message || t('Could not share the file.'))
          )
        }
      }
      if (message.type === 'board-image') {
        imageRequests.current.delete(message.key)
        setImageCache((current) => ({
          ...current,
          [message.key]: message.data
            ? { uri: `data:${message.mime};base64,${message.data}` }
            : { error: message.error || 'unavailable' }
        }))
      }
      if (message.type === messageTypes.boardState) {
        // Only a change in where cards sit animates; reactions, checklists and
        // the like would otherwise re-lay out an open card sheet while typing.
        const layout = placementKey(message.objects || [], message.columns || [])
        const moved = layout !== lastPlacement.current
        lastPlacement.current = layout
        if (moved && !reduceMotion && Date.now() - localMoveAt.current > 1500) {
          LayoutAnimation.configureNext({
            duration: 220,
            update: { type: LayoutAnimation.Types.easeInEaseOut }
          })
        }
        setBoardData({
          objects: message.objects || [],
          columns: message.columns || [],
          labels: message.labels || [],
          theme: message.theme || { background: null, accent: null, template: null },
          info: message.info || { description: '' },
          profiles: message.profiles || {},
          owner: message.owner || null,
          members: message.members || [],
          rules: message.rules || []
        })
        openPendingCard(message.objects || [])
        boardColumns.current = message.columns || []
        boardKindRef.current = message.info?.kind || 'kanban'
      }
      if (message.type === 'board-name' && message.name) {
        setBoardName(message.name)
      }
      if (message.type === messageTypes.profileStatus) {
        setDisplayName(message.displayName)
        setDisplayNameDraft(message.displayName)
      }
      if (message.type === messageTypes.boardSynced) setSynced(true)
      if (message.type === 'room-status' && message.status === 'error') {
        pendingShare.current = null
        setEntryError(message.error || t('Something went wrong'))
      }
      if (message.type === 'room-debug') setNetworkStatus(message.status || '')
      if (message.type === messageTypes.boardAlerts) {
        setAlertBoards(message.boards || [])
        chimeForNewAlerts(message.boards || [])
      }
      for (const listener of workerListeners.current) listener(message)
      if (message.type === 'peer-count') setPeerCount(message.count || 0)
    })
    pipeRef.current = framed
    setPipe(framed)
    void loadSavedIdentity()
    SecureStore.getItemAsync(soundPrefKey).then((value) => {
      if (!isSoundName(value)) return
      soundRef.current = value
      setSound(value)
    })
    // Read together so the palette switches once at boot, not twice.
    Promise.all([
      SecureStore.getItemAsync(themeModeKey),
      SecureStore.getItemAsync(themeOverrideKey)
    ]).then(([mode, override]) => {
      if (THEME_MODES.includes(mode as ThemeMode)) setThemeMode(mode as ThemeMode)
      if (override) setThemeOverride(override)
    })
    SecureStore.getItemAsync(languageKey).then((value) => {
      if (value !== 'system' && value !== 'en' && value !== 'pl') return
      setLanguage(value)
      setLanguageChoice(value)
    })
    return () => {
      motion.remove()
      framed.destroy()
      worklet.terminate()
    }
  }, [])

  // A joiner whose board has never synced only gets data once another member is
  // online; after a short wait, say so instead of showing placeholders forever.
  useEffect(() => {
    setWaitedForMembers(false)
    if (!roomReady || synced) return
    const timer = setTimeout(() => setWaitedForMembers(true), 6000)
    return () => clearTimeout(timer)
  }, [roomReady, synced])

  const send = (message: object) => pipe?.write(JSON.stringify(message))

  // Links and posts shared from other apps (the Share menu) arrive as
  // opencollab://share links; the board picker shows once an identity is open.
  useEffect(() => {
    const receive = (url: string | null) => {
      const item = parseShare(url)
      if (!item) return
      shareArrived.current = true
      const record: SharedRecord = { id: newSharedId(), at: Date.now(), ...item }
      setEntryMode('choose')
      setShared(record)
      saveSharedRecord(record)
      startPreview(record)
    }
    void Linking.getInitialURL().then(receive)
    const subscription = Linking.addEventListener('url', ({ url }) => receive(url))
    return () => subscription.remove()
  }, [])

  // Android Back steps out of a board or a create/join form before leaving the
  // app. Open sheets and modals handle Back themselves (onRequestClose).
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (roomReady) {
        leaveBoard()
        return true
      }
      if (identityReady && entryMode === 'create' && createStep === 'kind') {
        setEntryError('')
        setCreateStep('name')
        return true
      }
      if (identityReady && entryMode !== 'choose') {
        setEntryError('')
        setEntryMode('choose')
        return true
      }
      return false
    })
    return () => subscription.remove()
  }, [pipe, roomReady, identityReady, entryMode, createStep])

  // The worker checks every joined board in the background for notifications.
  useEffect(() => {
    if (!pipe || !identityReady) return
    send({
      type: messageTypes.boardsWatch,
      boards: recentBoards.map(({ invite, name }) => ({ invite, name }))
    })
  }, [pipe, identityReady, recentBoards])

  // Debug builds only: lets scripted checks (Hermes inspector via Metro) drive
  // the app the way the buttons do. Release builds never set it.
  useEffect(() => {
    if (!(globalThis as { __DEV__?: boolean }).__DEV__) return
    ;(globalThis as Record<string, unknown>).__opencollab = {
      send,
      dismissBackup: () => setBackupPhrase(''),
      openSettings: () => setSettingsOpen(true),
      setThemeMode,
      setThemeOverride,
      subscribe: (listener: (message: WorkerMessage) => void) => {
        workerListeners.current.add(listener)
        return () => workerListeners.current.delete(listener)
      },
      state: () => ({
        identityKey,
        roomReady,
        synced,
        boardKey,
        boardName,
        displayName,
        unreadCount,
        alertBoards: alertBoards.map((board) => [
          board.name,
          board.alerts.length,
          board.checkedAt > 0
        ]),
        data: boardData
      })
    }
  })

  const subscribe = useCallback((listener: (message: WorkerMessage) => void) => {
    workerListeners.current.add(listener)
    return () => {
      workerListeners.current.delete(listener)
    }
  }, [])

  const alertId = (board: AlertBoard, alert: BoardAlert) => `${board.key}:${alert.id}`
  const isRead = useCallback(
    (board: AlertBoard, alert: BoardAlert) =>
      alert.at <= readUntil || readNow.has(alertId(board, alert)),
    [readUntil, readNow]
  )
  const unreadCount = alertBoards.reduce(
    (sum, board) => sum + board.alerts.filter((alert) => !isRead(board, alert)).length,
    0
  )
  const markRead = useCallback(
    (predicate: (board: AlertBoard, alert: BoardAlert) => boolean) => {
      const keys = alertBoards.flatMap((board) =>
        board.alerts
          .filter((alert) => predicate(board, alert) && !isRead(board, alert))
          .map((alert) => alertId(board, alert))
      )
      if (!keys.length) return
      const all = alertBoards.every((board) =>
        board.alerts.every((alert) => predicate(board, alert))
      )
      if (all) {
        // "Mark all read" moves the watermark; nothing else needs remembering.
        const until = Date.now()
        setReadUntil(until)
        void SecureStore.setItemAsync(
          `opencollab.alerts-read-until.${identityKeyRef.current}`,
          String(until)
        )
      }
      setReadNow((current) => new Set([...current, ...keys]))
    },
    [alertBoards, isRead]
  )

  function openAlert(board: AlertBoard, alert: BoardAlert) {
    markRead((b, a) => b.key === board.key && a.id === alert.id)
    openBoardCard(board, alert.cardId)
  }

  // Opens a card on any joined board, switching boards first if needed.
  function openBoardCard(board: AlertBoard, cardId: string) {
    if (board.key === currentBoardKey.current) {
      setOpenCardRequest({ cardId, nonce: Date.now() })
      return
    }
    pendingOpen.current = { boardKey: board.key, cardId }
    send({ type: messageTypes.roomStart, invite: normalizeInvite(board.invite) })
  }

  // Fetches the page preview and prepares its image once per shared item; the
  // picker, the composer and the Shared items list all read the result.
  function startPreview(record: SharedRecord) {
    const started = previews.current.get(record.id)
    if (started) return started
    const run = async () => {
      let next = record
      if (record.link && !record.previewed) {
        const preview = await fetchPreview(record.link)
        next = {
          ...record,
          ...withPreview(record, preview),
          description: preview.description,
          image: preview.image,
          site: preview.site,
          previewed: true
        }
        saveSharedRecord(next)
        setShared((current) => (current?.id === record.id ? next : current))
      }
      let image: PendingImage | null = null
      if (next.image) {
        try {
          const [width, height] = await new Promise<[number, number]>((resolve, reject) =>
            Image.getSize(next.image!, (w, h) => resolve([w, h]), reject)
          )
          image = await prepareImage(next.image, width, height)
        } catch {}
      }
      return { record: next, image }
    }
    setPreviewsLoading((current) => [...current, record.id])
    const promise = run().finally(() =>
      setPreviewsLoading((current) => current.filter((id) => id !== record.id))
    )
    previews.current.set(record.id, promise)
    return promise
  }

  // Kept per identity; items shared before the identity is unlocked are saved
  // once it is (loadRecentBoards).
  function saveSharedRecord(record: SharedRecord) {
    const identity = identityKeyRef.current
    const list = sharedRecordsRef.current
    let next: SharedRecord[]
    if (identity) next = upsertShared(identity, list, record)
    else if (list.some((item) => item.id === record.id)) {
      next = list.map((item) => (item.id === record.id ? record : item))
    } else next = [record, ...list]
    sharedRecordsRef.current = next
    setSharedRecords(next)
  }

  function forgetSharedRecord(record: SharedRecord) {
    const identity = identityKeyRef.current
    if (!identity) return
    const next = removeShared(identity, sharedRecordsRef.current, record.id)
    sharedRecordsRef.current = next
    setSharedRecords(next)
  }

  // A board tapped in the Shared items list: straight to its new-card form.
  function shareAgain(record: SharedRecord, board: ShareBoard) {
    setSharedListOpen(false)
    pickShareBoard(board, record)
  }

  function pickShareBoard(board: ShareBoard, record = shared) {
    setShared(null)
    if (!record) return
    const invite = normalizeInvite(board.invite)
    const used = sharePrefsRef.current.recent || []
    saveSharePrefs({
      ...sharePrefsRef.current,
      last: invite,
      recent: [invite, ...used.filter((entry) => entry !== invite)].slice(0, 30)
    })
    pendingShare.current = { invite, record }
    if (invite === currentInvite.current) openPendingShare(boardData.columns)
    else send({ type: messageTypes.roomStart, invite })
  }

  // Once the chosen board is open, the composer shows the shared link, in the
  // column picked for shared items if it still exists. A preview still loading
  // fills in later, leaving alone whatever the user changed meanwhile.
  function openPendingShare(columns: { id: string }[]) {
    const pending = pendingShare.current
    if (!pending || pending.invite !== currentInvite.current) return
    pendingShare.current = null
    const columnId = sharePrefsRef.current.boards[pending.invite]?.columnId
    const { record } = pending
    // Recipes and feeds show the link as "View original", not in the text.
    const layout = boardKind(boardKindRef.current).layout
    const bodyOf = (item: SharedRecord) =>
      item.link && (layout === 'sections' || layout === 'feed')
        ? item.body.split(item.link).join('').trim()
        : item.body
    const sourceOf = (item: SharedRecord): CardSource | null =>
      item.link
        ? { url: item.link, site: item.site || null, title: item.titleFromLink ? null : item.title }
        : null
    setComposerColumn(columns.some((column) => column.id === columnId) ? columnId! : null)
    setNewTitle(record.title)
    setNewBody(bodyOf(record))
    setComposerSource(sourceOf(record))
    setPendingImages([])
    composerShare.current = record.id
    setComposerOpen(true)
    void startPreview(record).then(({ record: filled, image }) => {
      if (composerShare.current !== record.id) return
      setNewTitle((current) => (current === record.title ? filled.title : current))
      setNewBody((current) => (current === bodyOf(record) ? bodyOf(filled) : current))
      setComposerSource((current) => (current?.url === filled.link ? sourceOf(filled) : current))
      if (image) setPendingImages((current) => (current.length ? current : [image]))
    })
  }

  function saveSharePrefs(next: SharePrefs) {
    sharePrefsRef.current = next
    setSharePrefs(next)
    const identity = identityKeyRef.current
    if (identity) void SecureStore.setItemAsync(sharePrefsKey(identity), JSON.stringify(next))
  }

  function setSharePref(pref: SharePref) {
    const invite = currentInvite.current
    if (!invite) return
    const boards = { ...sharePrefsRef.current.boards, [invite]: pref }
    saveSharePrefs({ ...sharePrefsRef.current, boards })
  }

  // After switching boards for a notification, open its card once it's there.
  function openPendingCard(objects: { id: string }[]) {
    const pending = pendingOpen.current
    if (!pending || pending.boardKey !== currentBoardKey.current) return
    if (!objects.some((object) => object.id === pending.cardId)) return
    pendingOpen.current = null
    setOpenCardRequest({ cardId: pending.cardId, nonce: Date.now() })
  }
  const nameFor = (identity: string) => profiles[identity] || shortKey(identity)

  async function loadSavedIdentity() {
    let choice = (await SecureStore.getItemAsync(keychainChoiceKey)) as KeychainChoice
    const resume = (await SecureStore.getItemAsync(sessionKey)) === '1'
    if (choice === 'protected') {
      // Reading it asks for Face ID: on resume that prompt comes by itself,
      // otherwise it waits for "Log in".
      autoLogin.current = resume
      setKeychainChoice(choice)
      setHasSavedPhrase(true)
      return
    }
    const saved = await SecureStore.getItemAsync(identityPhraseKey)
    if (saved && !choice) {
      choice = 'saved'
      void SecureStore.setItemAsync(keychainChoiceKey, choice)
    }
    setKeychainChoice(choice)
    if (!saved) return
    savedPhraseRef.current = saved
    autoLogin.current = resume
    setHasSavedPhrase(true)
    setIdentityPhrase(saved)
  }

  // Resume the last session once the worker is up.
  useEffect(() => {
    if (!pipe || !hasSavedPhrase || identityReady || !autoLogin.current) return
    autoLogin.current = false
    void unlockSaved()
  }, [pipe, hasSavedPhrase, identityReady])

  function setKeychainChoice(choice: KeychainChoice) {
    keychainRef.current = choice
    setKeychain(choice)
  }

  // A Keychain item readable while the phone is unlocked, never backed up or
  // moved to another device. The phone's own lock guards it: asking for Face ID
  // on every launch as well made logging in a chore.
  async function savePhrase(phrase: string) {
    try {
      await SecureStore.setItemAsync(identityPhraseKey, phrase, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
      })
    } catch (err) {
      Alert.alert(t('Not saved'), (err as Error)?.message || keychainCopy().refused)
      return
    }
    await SecureStore.setItemAsync(keychainChoiceKey, 'saved')
    await SecureStore.setItemAsync(sessionKey, '1')
    savedPhraseRef.current = phrase
    setHasSavedPhrase(true)
    setKeychainChoice('saved')
  }

  async function forgetPhrase() {
    await SecureStore.deleteItemAsync(identityPhraseKey)
    await SecureStore.setItemAsync(keychainChoiceKey, 'off')
    savedPhraseRef.current = ''
    setHasSavedPhrase(false)
    setKeychainChoice('off')
  }

  // Asked once; afterwards a new identity follows the choice already made.
  function offerKeychain(phrase: string) {
    if (phrase === savedPhraseRef.current) return
    const choice = keychainRef.current
    if (choice === 'off') return
    if (choice === 'saved' || choice === 'protected') return void savePhrase(phrase)
    Alert.alert(
      keychainCopy().offer,
      t(
        'OpenCollab then opens without asking for them. If you don’t save them, they stay in memory only and you enter them each time you open the app. You can change this later in Settings.'
      ),
      [
        {
          text: t('Don’t save'),
          style: 'cancel',
          onPress: () => {
            void SecureStore.setItemAsync(keychainChoiceKey, 'off')
            setKeychainChoice('off')
          }
        },
        { text: t('Save'), onPress: () => void savePhrase(phrase) }
      ]
    )
  }

  async function unlock(phrase = identityPhrase.trim()) {
    if (phrase.split(/\s+/).length < 12) {
      return Alert.alert(
        t('Identity required'),
        t('Enter a recovery phrase with at least 12 words.')
      )
    }
    // Unscoped boards belong to the previously saved identity only.
    if (phrase !== savedPhraseRef.current) await SecureStore.deleteItemAsync(legacyRecentBoardsKey)
    loadingPhraseRef.current = phrase
    send({ type: messageTypes.identityLoad, mnemonic: phrase })
  }

  async function unlockSaved() {
    if (keychainRef.current !== 'protected') return unlock(savedPhraseRef.current)
    let saved: string | null = null
    try {
      saved = await SecureStore.getItemAsync(identityPhraseKey, {
        requireAuthentication: true,
        authenticationPrompt: t('Unlock OpenCollab')
      })
    } catch {
      // Cancelled, or the item was invalidated by a Face ID change.
      return Alert.alert(
        t('Not unlocked'),
        t('Tap Log in to try again, or log in with your recovery words.')
      )
    }
    if (!saved) {
      setHasSavedPhrase(false)
      return Alert.alert(t('Nothing saved'), t('Enter your recovery words to continue.'))
    }
    savedPhraseRef.current = saved
    // Words saved behind Face ID by an earlier version: asked this last time,
    // then kept like any saved words.
    void savePhrase(saved)
    void unlock(saved)
  }

  function chimeForNewAlerts(boards: AlertBoard[]) {
    let fresh = false
    for (const board of boards) {
      if (!board.checkedAt) continue
      const seen = seenAlerts.current.get(board.key)
      if (!seen) {
        seenAlerts.current.set(board.key, new Set(board.alerts.map((alert) => alert.id)))
        continue
      }
      for (const alert of board.alerts) {
        if (seen.has(alert.id)) continue
        seen.add(alert.id)
        if (alert.author && blockedRef.current.includes(alert.author)) continue
        if (alert.at > readUntilRef.current) fresh = true
      }
    }
    if (fresh) playSound(soundRef.current)
  }

  function toggleBlocked(identity: string) {
    const next = blockedRef.current.includes(identity)
      ? blockedRef.current.filter((key) => key !== identity)
      : [...blockedRef.current, identity]
    blockedRef.current = next
    setBlocked(next)
    void SecureStore.setItemAsync(
      `opencollab.blocked.${identityKeyRef.current}`,
      JSON.stringify(next)
    )
  }

  function chooseSound(next: SoundName) {
    soundRef.current = next
    setSound(next)
    void SecureStore.setItemAsync(soundPrefKey, next)
    playSound(next)
  }

  function chooseThemeMode(next: ThemeMode) {
    setThemeMode(next)
    void SecureStore.setItemAsync(themeModeKey, next)
  }

  function chooseThemeOverride(next: string) {
    setThemeOverride(next)
    void SecureStore.setItemAsync(themeOverrideKey, next)
  }

  function chooseLanguage(next: LanguageChoice) {
    setLanguage(next)
    setLanguageChoice(next)
    void SecureStore.setItemAsync(languageKey, next)
  }

  function exportBoard() {
    if (exportRequest.current) return
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    exportRequest.current = requestId
    setExporting(true)
    send({ type: messageTypes.boardExport, requestId, toFile: true })
  }

  // Boards a shared link can go to: the last one used first, then the open one.
  // Boards last shared to first, most recent at the top; the rest keep the
  // boards list's order (recently opened first).
  const used = sharePrefs.recent || (sharePrefs.last ? [sharePrefs.last] : [])
  const shareRank = (invite: string) => {
    const index = used.indexOf(invite)
    return index < 0 ? used.length : index
  }
  const shareBoards: ShareBoard[] = recentBoards
    .filter((board) => !sharePrefs.boards[normalizeInvite(board.invite)]?.hidden)
    .map((board) => ({
      invite: board.invite,
      name: board.name,
      open: roomReady && normalizeInvite(board.invite) === currentInvite.current
    }))
    .sort((a, b) => shareRank(normalizeInvite(a.invite)) - shareRank(normalizeInvite(b.invite)))
  const shareSheet = shared ? (
    <ShareSheet
      item={shared}
      loading={previewsLoading.includes(shared.id)}
      boards={shareBoards}
      hiddenCount={recentBoards.length - shareBoards.length}
      onPick={pickShareBoard}
      onClose={() => setShared(null)}
    />
  ) : sharedListOpen ? (
    <SharedItemsSheet
      records={sharedRecords}
      boards={shareBoards}
      hiddenCount={recentBoards.length - shareBoards.length}
      relativeTime={relativeTime}
      onAdd={shareAgain}
      onRemove={forgetSharedRecord}
      onClose={() => setSharedListOpen(false)}
    />
  ) : null

  const settings = settingsOpen ? (
    <SettingsSheet
      keychain={keychain}
      canSave={!!phraseRef.current}
      onSavePhrase={() => void savePhrase(phraseRef.current)}
      onForgetPhrase={() => void forgetPhrase()}
      sound={sound}
      onSound={chooseSound}
      themeMode={themeMode}
      onThemeMode={chooseThemeMode}
      themeOverride={themeOverride}
      onThemeOverride={chooseThemeOverride}
      languageChoice={languageChoice}
      onLanguage={chooseLanguage}
      onClose={() => setSettingsOpen(false)}
    />
  ) : null

  async function createIdentity() {
    await SecureStore.deleteItemAsync(legacyRecentBoardsKey)
    send({ type: messageTypes.identityCreate })
  }

  async function loadRecentBoards(identity: string) {
    const prefs = readSharePrefs(await SecureStore.getItemAsync(sharePrefsKey(identity)))
    sharePrefsRef.current = prefs
    setSharePrefs(prefs)
    const unsaved = sharedRecordsRef.current
    let records = await loadShared(identity)
    for (const record of [...unsaved].reverse()) records = upsertShared(identity, records, record)
    sharedRecordsRef.current = records
    setSharedRecords(records)
    let saved = await SecureStore.getItemAsync(recentBoardsKey(identity))
    if (!saved) {
      saved = await SecureStore.getItemAsync(legacyRecentBoardsKey)
      if (saved) {
        await SecureStore.setItemAsync(recentBoardsKey(identity), saved)
        await SecureStore.deleteItemAsync(legacyRecentBoardsKey)
      }
    }
    try {
      const parsed = saved ? JSON.parse(saved) : []
      setRecentBoards(Array.isArray(parsed) ? parsed : [])
    } catch {
      setRecentBoards([])
    }
    // Reopen the board that was open when the app was left, once per launch.
    if (!resumeBoard.current) return
    resumeBoard.current = false
    const last = await SecureStore.getItemAsync(lastBoardKey(identity))
    if (last && !shareArrived.current && !currentInvite.current) {
      pipeRef.current?.write(JSON.stringify({ type: messageTypes.roomStart, invite: last }))
    }
  }

  // Leaving a board on purpose: the next launch starts on the boards list.
  function leaveBoard() {
    const identity = identityKeyRef.current
    if (identity) void SecureStore.deleteItemAsync(lastBoardKey(identity))
    send({ type: messageTypes.roomLeave })
  }

  function updateRecentBoards(update: (current: RecentBoard[]) => RecentBoard[]) {
    setRecentBoards((current) => {
      const next = update(current)
      const identity = identityKeyRef.current
      if (identity) void SecureStore.setItemAsync(recentBoardsKey(identity), JSON.stringify(next))
      return next
    })
  }

  function rememberBoard(boardInvite: string, name: string) {
    updateRecentBoards((current) =>
      [
        { invite: boardInvite, name: name || t('Unnamed board'), joinedAt: Date.now() },
        ...current.filter((board) => board.invite !== boardInvite)
      ].slice(0, 12)
    )
  }

  function forgetBoard(boardInvite: string) {
    updateRecentBoards((current) => current.filter((board) => board.invite !== boardInvite))
  }

  const myAvatar = avatarOf(boardData, identityKey)

  // The avatar applies as soon as it is picked; the name waits for Save.
  function saveProfile() {
    const name = displayNameDraft.trim()
    if (name && name !== displayName) send({ type: messageTypes.profileSet, displayName: name })
    else setDisplayNameDraft(displayName)
    setEditProfileOpen(false)
  }

  async function pickAvatar() {
    // Avatars show small, so they don't need the full size.
    const [image] = await pickPreparedImages(1, 256)
    if (!image) return
    send({
      type: messageTypes.profileAvatarSet,
      image: { type: image.type, data: image.data, width: image.width, height: image.height }
    })
  }

  async function shareInvitation() {
    if (!invitationLink) return
    await Share.share({ message: inviteLink(invitationLink), url: inviteLink(invitationLink) })
  }

  function logout() {
    setProfileOpen(false)
    void SecureStore.deleteItemAsync(sessionKey)
    send({ type: messageTypes.boardsWatch, boards: [] })
    setAlertBoards([])
    blockedRef.current = []
    setBlocked([])
    setReadNow(new Set())
    seenAlerts.current.clear()
    // A phrase the user chose not to keep doesn't outlive the session.
    if (!hasSavedPhrase) setIdentityPhrase('')
    phraseRef.current = ''
    if (roomReady) send({ type: messageTypes.roomLeave })
    identityKeyRef.current = ''
    setIdentityKey('')
    setRecentBoards([])
    setIdentityReady(false)
    setIdentityChoice('choose')
    setEntryMode('choose')
  }

  async function pasteInvitation() {
    const value = await Clipboard.getStringAsync()
    if (!value.trim()) {
      setEntryError(t('Clipboard is empty. Copy an invitation link first.'))
      return
    }
    setEntryError('')
    setInvite(value.trim())
  }

  function addObject() {
    if (!newTitle.trim()) return
    const fromShare = sharedRecordsRef.current.find((item) => item.id === composerShare.current)
    if (fromShare) saveSharedRecord({ ...fromShare, board: boardName, addedAt: Date.now() })
    composerShare.current = null
    send({
      type: messageTypes.boardCreate,
      title: newTitle,
      body: newBody,
      columnId: composerColumn,
      images: pendingImages.map(({ data, type, width, height }) => ({ data, type, width, height })),
      ...(composerSource && { source: composerSource })
    })
    setComposerSource(null)
    setNewTitle('')
    setNewBody('')
    setPendingImages([])
    setComposerOpen(false)
  }

  function requestImage(ref: ImageRef) {
    if (isVideo(ref)) return
    const key = imageKey(ref)
    if (imageCache[key]?.uri || imageRequests.current.has(key)) return
    imageRequests.current.add(key)
    send({ type: 'board:image', ref })
  }

  function retryImage(ref: ImageRef) {
    setImageCache((current) => {
      const next = { ...current }
      delete next[imageKey(ref)]
      return next
    })
    imageRequests.current.delete(imageKey(ref))
    requestImage(ref)
  }

  async function pickImages() {
    const remaining = MAX_IMAGES - pendingImages.length
    if (remaining <= 0) {
      return Alert.alert(t('Image limit'), t('Up to {max} images per post.', { max: MAX_IMAGES }))
    }
    const prepared = await pickPreparedImages(remaining)
    setPendingImages((current) => [...current, ...prepared].slice(0, MAX_IMAGES))
  }

  if (!identityReady) {
    return (
      <Screen title='opencollab' cursor>
        <Text style={styles.muted}>
          {t(
            "Your private boards and feeds. No servers: everything lives on your and your friends' devices."
          )}
        </Text>
        {identityChoice === 'choose' ? (
          <>
            {hasSavedPhrase ? (
              <Button title={t('Log in')} icon='log-in' onPress={() => void unlockSaved()} />
            ) : null}
            <Button
              title={t('Create new account')}
              icon='user-plus'
              variant={hasSavedPhrase ? 'secondary' : 'primary'}
              onPress={createIdentity}
            />
            <Button
              title={t('Log in with recovery words')}
              icon='key'
              variant='secondary'
              onPress={() => setIdentityChoice('existing')}
            />
          </>
        ) : (
          <>
            <Text style={styles.muted}>
              {t('Enter the 24 recovery words you wrote down when you created your account.')}
            </Text>
            <TextInput
              style={[styles.input, styles.monoInput]}
              multiline
              value={identityPhrase}
              onChangeText={setIdentityPhrase}
              placeholder={t('Recovery words')}
              placeholderTextColor={colors.muted}
              autoCapitalize='none'
              autoCorrect={false}
            />
            <View style={styles.row}>
              <Button
                title={t('Back')}
                icon='arrow-left'
                variant='secondary'
                onPress={() => setIdentityChoice('choose')}
              />
              <Button title={t('Log in')} icon='log-in' onPress={() => void unlock()} grow />
            </View>
          </>
        )}
      </Screen>
    )
  }
  if (backupPhrase) {
    return (
      <Screen title={t('Save your recovery words')}>
        <Text style={styles.muted}>
          {t(
            'These 24 words are the only way to log in to your account on another device or after reinstalling. Write them down and keep them somewhere safe, offline.'
          )}
        </Text>
        <View style={styles.phraseGrid}>
          {backupPhrase.split(/\s+/).map((word, index) => (
            <View style={styles.phraseWord} key={index}>
              <Text style={styles.phraseIndex}>{String(index + 1).padStart(2, '0')}</Text>
              <Text style={styles.phraseText}>{word}</Text>
            </View>
          ))}
        </View>
        <Button
          title={t("I've written it down")}
          icon='check'
          onPress={() => {
            setBackupPhrase('')
            offerKeychain(backupPhrase)
          }}
        />
      </Screen>
    )
  }
  if (!roomReady && entryMode === 'create' && createStep === 'name') {
    const next = () => {
      if (!boardName.trim()) return setEntryError(t('Give your board a name.'))
      setEntryError('')
      setCreateStep('kind')
    }
    return (
      <Screen title={t('New board')}>
        <Text style={styles.muted}>
          {t('You will get an invitation link to share once the board is ready.')}
        </Text>
        <TextInput
          style={styles.input}
          value={boardName}
          onChangeText={(value) => {
            setBoardName(value)
            setEntryError('')
          }}
          onSubmitEditing={next}
          placeholder={t('Board name')}
          placeholderTextColor={colors.muted}
          returnKeyType='next'
          autoFocus
        />
        {entryError ? <Text style={styles.error}>{entryError}</Text> : null}
        <View style={styles.row}>
          <Button
            title={t('Back')}
            icon='arrow-left'
            variant='secondary'
            onPress={() => {
              setEntryError('')
              setEntryMode('choose')
            }}
          />
          <Button title={t('Next')} icon='arrow-right' grow onPress={next} />
        </View>
      </Screen>
    )
  }
  if (!roomReady && entryMode === 'create') {
    return (
      <Screen title={t('Board type')}>
        <Text style={styles.muted}>
          {t('What is “{board}” for? You can change it later in Board settings.', {
            board: boardName.trim()
          })}
        </Text>
        <KindOptions selected={newBoardKind} onPick={setNewBoardKind} />
        {entryError ? <Text style={styles.error}>{entryError}</Text> : null}
        <View style={styles.row}>
          <Button
            title={t('Back')}
            icon='arrow-left'
            variant='secondary'
            onPress={() => {
              setEntryError('')
              setCreateStep('name')
            }}
          />
          <Button
            title={t('Create board')}
            icon='plus'
            grow
            onPress={() =>
              send({
                type: messageTypes.roomStart,
                invite: null,
                name: boardName.trim(),
                kind: newBoardKind
              })
            }
          />
        </View>
      </Screen>
    )
  }
  if (!roomReady && entryMode === 'join') {
    return (
      <Screen title={t('Join board')}>
        <Text style={styles.muted}>
          {t("Scan a board member's invitation QR code, or paste the link they sent you.")}
        </Text>
        <Button title={t('Scan QR code')} icon='camera' onPress={() => setScannerOpen(true)} />
        <TextInput
          style={[styles.input, styles.monoInput]}
          value={invite}
          onChangeText={(value) => {
            setInvite(value)
            setEntryError('')
          }}
          placeholder='opencollab://board/…'
          placeholderTextColor={colors.muted}
          autoCapitalize='none'
          autoCorrect={false}
          testID='board-invite-input'
        />
        <Button
          title={t('Paste invitation')}
          icon='clipboard'
          variant='secondary'
          onPress={pasteInvitation}
        />
        {entryError ? <Text style={styles.error}>{entryError}</Text> : null}
        <QrScanner
          visible={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onScan={(scanned) => {
            setScannerOpen(false)
            setInvite(scanned)
            setEntryError('')
            send({ type: messageTypes.roomStart, invite: normalizeInvite(scanned) })
          }}
        />
        <View style={styles.row}>
          <Button
            title={t('Back')}
            icon='arrow-left'
            variant='secondary'
            onPress={() => {
              setEntryError('')
              setEntryMode('choose')
            }}
          />
          <Button
            title={t('Join board')}
            icon='log-in'
            grow
            onPress={() => {
              if (!invite.trim()) return setEntryError(t('Paste an invitation link first.'))
              send({ type: messageTypes.roomStart, invite: normalizeInvite(invite) })
            }}
          />
        </View>
      </Screen>
    )
  }
  if (!roomReady) {
    return (
      <Screen
        title={t('Boards')}
        headerRight={<IdentityBadge identity={identityKey} onPress={logout} icon='log-out' />}
      >
        <View style={styles.row}>
          <Button
            title={t('New board')}
            icon='plus'
            grow
            onPress={() => {
              setCreateStep('name')
              setEntryMode('create')
            }}
          />
          <Button
            title={t('Join')}
            icon='log-in'
            variant='secondary'
            grow
            onPress={() => setEntryMode('join')}
          />
        </View>
        <Button
          title={t('Try a sample board')}
          icon='book-open'
          variant='ghost'
          // A private board the worker fills with cards that show the features.
          onPress={() => send({ type: messageTypes.roomStart, invite: null, sample: true })}
        />
        {entryError ? <Text style={styles.error}>{entryError}</Text> : null}
        {recentBoards.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('Recently joined')}</Text>
            {recentBoards.map((board) => (
              <FadeIn key={board.invite}>
                <SwipeToRemove label={board.name} onRemove={() => forgetBoard(board.invite)}>
                  <Pressable
                    style={({ pressed }) => [styles.recentBoard, pressed && styles.pressed]}
                    onPress={() => {
                      setInvite(board.invite)
                      send({ type: messageTypes.roomStart, invite: normalizeInvite(board.invite) })
                    }}
                    accessibilityRole='button'
                    accessibilityLabel={t('Open {board}', { board: board.name })}
                  >
                    <Feather name='hash' size={16} color={colors.accent} />
                    <Text style={styles.recentBoardName} numberOfLines={1}>
                      {board.name}
                    </Text>
                    <Feather name='chevron-right' size={18} color={colors.muted} />
                  </Pressable>
                </SwipeToRemove>
              </FadeIn>
            ))}
            <Text style={styles.hint}>{t('Swipe left on a board to remove it.')}</Text>
          </View>
        ) : (
          <Text style={styles.muted}>
            {t('No boards yet. Create one or join with an invitation.')}
          </Text>
        )}
        {sharedRecords.length ? (
          <Button
            title={t('Shared items ({count})', { count: sharedRecords.length })}
            icon='share-2'
            variant='ghost'
            onPress={() => setSharedListOpen(true)}
          />
        ) : null}
        <Button
          title={t('Settings')}
          icon='settings'
          variant='ghost'
          onPress={() => setSettingsOpen(true)}
        />
        <Button title={t('Log out')} icon='log-out' variant='ghost' onPress={logout} />
        {settings}
        {shareSheet}
      </Screen>
    )
  }
  if (!displayName) {
    return (
      <Screen title={boardName || 'OpenCollab'}>
        <Text style={styles.heading}>{t('Choose your display name')}</Text>
        <Text style={styles.muted}>
          {t('Other participants will see this beside your objects and comments.')}
        </Text>
        <TextInput
          style={styles.input}
          value={displayNameDraft}
          onChangeText={setDisplayNameDraft}
          placeholder={t('Name or nickname')}
          placeholderTextColor={colors.muted}
          maxLength={48}
        />
        <Button
          title={t('Continue')}
          icon='arrow-right'
          onPress={() =>
            displayNameDraft.trim() &&
            send({ type: messageTypes.profileSet, displayName: displayNameDraft.trim() })
          }
        />
      </Screen>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} />
      <BoardScreen
        data={boardView}
        me={identityKey}
        displayName={displayName}
        boardName={boardName}
        boardKey={boardKey}
        synced={synced}
        statusChip={<StatusChip peers={peerCount} synced={synced} />}
        loading={
          <View style={styles.boardLoading}>
            {/* Not the peer count: other joiners connect too but hold no data. */}
            {waitedForMembers ? (
              <View style={styles.waiting} accessibilityRole='alert'>
                <View style={styles.meta}>
                  <Feather name='users' size={16} color={colors.info} />
                  <Text style={styles.heading}>{t('Waiting for a board member…')}</Text>
                </View>
                <Text style={styles.muted}>
                  {t(
                    "Boards live only on members' devices. This one fills in automatically as soon as another member opens it — keep OpenCollab open until then."
                  )}
                </Text>
              </View>
            ) : null}
            <SkeletonCards />
          </View>
        }
        send={send}
        cache={imageCache}
        requestImage={requestImage}
        retryImage={retryImage}
        openViewer={setViewerUri}
        openProfile={() => setProfileOpen(true)}
        onNewCard={(columnId) => {
          composerShare.current = null
          setComposerSource(null)
          setComposerColumn(columnId)
          setComposerOpen(true)
        }}
        onLocalMove={() => (localMoveAt.current = Date.now())}
        alertBoards={alertBoards}
        unreadCount={unreadCount}
        isRead={isRead}
        markRead={markRead}
        onOpenAlert={openAlert}
        onOpenMyCard={(board, card) => openBoardCard(board, card.id)}
        sound={sound}
        openCardRequest={openCardRequest}
        settingsRequest={boardSettingsRequest}
        subscribe={subscribe}
        nameFor={nameFor}
        shortKey={shortKey}
        relativeTime={relativeTime}
        blocked={blocked}
        toggleBlocked={toggleBlocked}
        sharePref={sharePrefs.boards[currentInvite.current] || {}}
        onSharePref={setSharePref}
      />
      <UpdateBanner />

      <Modal
        visible={composerOpen}
        transparent
        animationType='slide'
        onRequestClose={() => setComposerOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.sheetBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.flex} onPress={() => setComposerOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            {/* Actions on top: the keyboard can't cover them. */}
            <View style={styles.composerBar}>
              <Button title={t('Cancel')} variant='ghost' onPress={() => setComposerOpen(false)} />
              <Text style={[styles.heading, styles.composerTitle]} numberOfLines={1}>
                {composerColumn
                  ? t('New card in {column}', {
                      column:
                        boardData.columns.find((column) => column.id === composerColumn)?.name ||
                        t('column')
                    })
                  : t('New card')}
              </Text>
              <Button title={t('Add card')} icon='plus' onPress={addObject} />
            </View>
            <ScrollView
              style={styles.composerBody}
              contentContainerStyle={styles.composerFields}
              keyboardShouldPersistTaps='handled'
            >
              <TextInput
                style={styles.input}
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder={t('Title')}
                placeholderTextColor={colors.muted}
                // A shared link arrives filled in: no keyboard over the preview.
                autoFocus={!composerShare.current}
              />
              <TextInput
                style={[styles.input, styles.multiline]}
                value={newBody}
                onChangeText={setNewBody}
                placeholder={t('Description or proposal')}
                placeholderTextColor={colors.muted}
                multiline
              />
              {boardData.columns.length > 1 ? (
                <View style={styles.composerSections}>
                  {boardData.columns.map((column) => (
                    <Chip
                      key={column.id}
                      label={column.name}
                      selected={(composerColumn ?? boardData.columns[0].id) === column.id}
                      onPress={() => setComposerColumn(column.id)}
                    />
                  ))}
                </View>
              ) : null}
              {composerSource ? (
                <View style={styles.composerSource}>
                  <Feather name='external-link' size={14} color={colors.muted} />
                  <Text style={styles.composerSourceText} numberOfLines={1}>
                    {t('Original: {source}', { source: composerSource.site || composerSource.url })}
                  </Text>
                  <Pressable
                    onPress={() => setComposerSource(null)}
                    hitSlop={8}
                    accessibilityRole='button'
                    accessibilityLabel={t('Remove the link to the original')}
                  >
                    <Feather name='x' size={14} color={colors.muted} />
                  </Pressable>
                </View>
              ) : null}
              {pendingImages.length ? (
                <ScrollView horizontal contentContainerStyle={styles.previewRow}>
                  {pendingImages.map((image, index) => (
                    <View key={index} style={styles.preview}>
                      <Image source={{ uri: image.uri }} style={styles.previewImage} />
                      <Pressable
                        style={styles.previewRemove}
                        onPress={() =>
                          setPendingImages((current) => current.filter((_, i) => i !== index))
                        }
                        accessibilityRole='button'
                        accessibilityLabel={t('Remove image')}
                        hitSlop={6}
                      >
                        <Feather name='x' size={14} color={colors.text} />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
              {composerShare.current && previewsLoading.includes(composerShare.current) ? (
                <Text style={styles.hint}>{t('Loading the link preview…')}</Text>
              ) : null}
              <Button
                title={
                  pendingImages.length
                    ? t('Images {count}/{max}', { count: pendingImages.length, max: MAX_IMAGES })
                    : t('Attach images')
                }
                icon='image'
                variant='secondary'
                onPress={pickImages}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!viewerUri}
        transparent
        animationType='fade'
        onRequestClose={() => setViewerUri('')}
      >
        <Pressable
          style={styles.viewer}
          onPress={() => setViewerUri('')}
          accessibilityRole='button'
          accessibilityLabel={t('Close image')}
        >
          {viewerUri ? (
            <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode='contain' />
          ) : null}
        </Pressable>
      </Modal>

      <Modal
        visible={profileOpen}
        transparent
        animationType='fade'
        onRequestClose={() => setProfileOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setProfileOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <View style={styles.meta}>
              <Avatar
                hex={identityKey}
                size={36}
                image={myAvatar}
                cache={imageCache}
                requestImage={requestImage}
              />
              <View>
                <Text style={styles.heading}>@{displayName}</Text>
                <Text style={styles.metaMono}>{shortKey(identityKey)}</Text>
              </View>
            </View>
            <Button
              title={t('Edit name & avatar')}
              icon='user'
              variant='secondary'
              onPress={() => {
                setProfileOpen(false)
                setDisplayNameDraft(displayName)
                setEditProfileOpen(true)
              }}
            />
            <StatusChip peers={peerCount} synced={synced} />
            <Text style={styles.metaMono}>
              {networkStatus ? describeNetwork(networkStatus) : t('Not connected')}
            </Text>
            <Text style={styles.metaMono}>OpenCollab v{shownVersion}</Text>
            <Button title={t('Share invitation')} icon='share-2' onPress={shareInvitation} />
            <Button
              title={t('Show QR code')}
              icon='maximize'
              variant='secondary'
              onPress={() => {
                setProfileOpen(false)
                setQrOpen(true)
              }}
            />
            <Button
              title={exporting ? t('Exporting…') : t('Export board')}
              icon='download'
              variant='secondary'
              onPress={exportBoard}
            />
            <Button
              title={t('Board settings')}
              icon='sliders'
              variant='secondary'
              onPress={() => {
                setProfileOpen(false)
                setBoardSettingsRequest((n) => n + 1)
              }}
            />
            <Button
              title={t('Settings')}
              icon='settings'
              variant='secondary'
              onPress={() => {
                setProfileOpen(false)
                setSettingsOpen(true)
              }}
            />
            <Button
              title={t('Switch board')}
              icon='repeat'
              variant='secondary'
              onPress={() => {
                setProfileOpen(false)
                leaveBoard()
              }}
            />
            <Button title={t('Log out')} icon='log-out' variant='secondary' onPress={logout} />
            <Button title={t('Close')} variant='ghost' onPress={() => setProfileOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={qrOpen && !!invitationLink}
        transparent
        animationType='fade'
        onRequestClose={() => setQrOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setQrOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.heading}>
              {boardName
                ? t('Scan to join {board}', { board: boardName })
                : t('Scan to join this board')}
            </Text>
            <Text style={styles.muted}>
              {t('On the other phone, open OpenCollab, tap Join, then Scan QR code.')}
            </Text>
            <View style={styles.qrWrap}>
              <QrCode value={inviteLink(invitationLink)} size={Math.min(windowWidth - 88, 320)} />
            </View>
            <View style={styles.row}>
              <Button title={t('Close')} variant='secondary' onPress={() => setQrOpen(false)} />
              <Button title={t('Share link')} icon='share-2' grow onPress={shareInvitation} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={editProfileOpen}
        transparent
        animationType='fade'
        onRequestClose={() => setEditProfileOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setEditProfileOpen(false)}>
            <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
              <Text style={styles.heading}>{t('Edit name & avatar')}</Text>
              <View style={styles.avatarEdit}>
                <Pressable
                  onPress={pickAvatar}
                  style={({ pressed }) => pressed && styles.pressed}
                  accessibilityRole='button'
                  accessibilityLabel={t('Change avatar')}
                >
                  <Avatar
                    hex={identityKey}
                    size={96}
                    image={myAvatar}
                    cache={imageCache}
                    requestImage={requestImage}
                  />
                  <View style={styles.avatarBadge}>
                    <Feather name='camera' size={14} color={colors.bg} />
                  </View>
                </Pressable>
                {myAvatar ? (
                  <Pressable
                    onPress={() => send({ type: messageTypes.profileAvatarSet, image: null })}
                    hitSlop={8}
                    accessibilityRole='button'
                  >
                    <Text style={styles.removePhoto}>{t('Remove avatar')}</Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                style={styles.input}
                value={displayNameDraft}
                onChangeText={setDisplayNameDraft}
                onSubmitEditing={saveProfile}
                placeholder={t('Display name')}
                placeholderTextColor={colors.muted}
                maxLength={48}
                returnKeyType='done'
                accessibilityLabel={t('Display name')}
              />
              <Text style={styles.hint}>
                {t('Everyone on this board sees your name and avatar.')}
              </Text>
              <View style={styles.row}>
                <Button
                  title={t('Cancel')}
                  variant='ghost'
                  onPress={() => {
                    setDisplayNameDraft(displayName)
                    setEditProfileOpen(false)
                  }}
                />
                <Button title={t('Save')} grow onPress={saveProfile} />
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      {settings}
      {shareSheet}
    </View>
  )
}

export default function App() {
  // The worker's first message means it's up; the splash hands over then.
  const [booted, setBooted] = useState(false)
  const [splashDone, setSplashDone] = useState(false)
  const boot = useCallback(() => setBooted(true), [])
  const done = useCallback(() => setSplashDone(true), [])
  return (
    <View style={styles.app}>
      <AppContent onBoot={boot} />
      {splashDone ? null : <BootSplash ready={booted} onDone={done} />}
    </View>
  )
}

function Screen({
  title,
  headerRight,
  cursor,
  children
}: {
  title: string
  headerRight?: React.ReactNode
  cursor?: boolean
  children?: React.ReactNode
}) {
  return (
    <View style={styles.root}>
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps='handled'>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {cursor ? <Text style={styles.prompt}>{'> '}</Text> : null}
              {title}
              {cursor ? <BlinkingCursor /> : null}
            </Text>
            {headerRight}
          </View>
          {children}
          <Text style={styles.versionLabel}>v{shownVersion}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Rendered last so it stays above the content. */}
      <UpdateBanner />
    </View>
  )
}

function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>(updateStatus)
  useEffect(() => {
    updateListeners.add(setStatus)
    return () => {
      updateListeners.delete(setStatus)
    }
  }, [])
  if (!status) return null
  return (
    <View style={styles.updateBanner} accessibilityRole='alert'>
      <Feather
        name={status === 'installed' ? 'check-circle' : 'download-cloud'}
        size={16}
        color={colors.accent}
      />
      <Text style={styles.updateText}>
        {status === 'installed'
          ? t('Update installed. Close and reopen OpenCollab to use it.')
          : t('Downloading an update…')}
      </Text>
    </View>
  )
}

function BlinkingCursor() {
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (reduceMotion) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true })
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return <Animated.Text style={[styles.prompt, { opacity }]}>_</Animated.Text>
}

function StatusChip({ peers, synced }: { peers: number; synced: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current
  const online = peers > 0
  useEffect(() => {
    pulse.setValue(1)
    if (online || reduceMotion) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true })
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [online, pulse])
  return (
    <View style={styles.statusChip} accessibilityRole='text'>
      <Animated.View
        style={[
          styles.statusDot,
          { backgroundColor: online ? colors.accent : colors.info, opacity: pulse }
        ]}
      />
      <Text style={styles.statusText}>
        {synced
          ? plural(
              peers,
              ['{n} peer · synced', '{n} peers · synced'],
              [
                '{n} urządzenie · zsynchronizowano',
                '{n} urządzenia · zsynchronizowano',
                '{n} urządzeń · zsynchronizowano'
              ]
            )
          : plural(
              peers,
              ['{n} peer · syncing…', '{n} peers · syncing…'],
              [
                '{n} urządzenie · synchronizuję…',
                '{n} urządzenia · synchronizuję…',
                '{n} urządzeń · synchronizuję…'
              ]
            )}
      </Text>
    </View>
  )
}

function SkeletonCards() {
  const opacity = useRef(new Animated.Value(0.5)).current
  useEffect(() => {
    if (reduceMotion) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 650, useNativeDriver: true })
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return (
    <View style={styles.skeletons} accessibilityLabel={t('Syncing board')}>
      {[0, 1, 2].map((index) => (
        <Animated.View key={index} style={[styles.skeletonCard, { opacity }]}>
          <View style={[styles.skeletonLine, { width: '60%' }]} />
          <View style={[styles.skeletonLine, { width: '90%' }]} />
          <View style={[styles.skeletonLine, { width: '35%' }]} />
        </Animated.View>
      ))}
    </View>
  )
}

function IdentityBadge({
  identity,
  onPress,
  icon
}: {
  identity: string
  onPress: () => void
  icon: FeatherName
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.userPanel, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole='button'
      accessibilityLabel={t('Log out')}
    >
      <Identicon hex={identity} size={20} />
      <Text style={styles.userPanelKey}>{shortKey(identity)}</Text>
      <Feather name={icon} size={14} color={colors.muted} />
    </Pressable>
  )
}

const removeActionWidth = 88

function SwipeToRemove({
  label,
  onRemove,
  children
}: {
  label: string
  onRemove: () => void
  children: React.ReactNode
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const offset = useRef(0)
  const settle = (toValue: number) => {
    offset.current = toValue
    Animated.spring(translateX, { toValue, useNativeDriver: true, bounciness: 0 }).start()
  }
  const remove = () =>
    Animated.timing(translateX, { toValue: -600, duration: 180, useNativeDriver: true }).start(
      onRemove
    )
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gesture) =>
        translateX.setValue(
          Math.min(0, Math.max(-removeActionWidth * 1.3, offset.current + gesture.dx))
        ),
      onPanResponderRelease: (_, gesture) =>
        settle(offset.current + gesture.dx < -removeActionWidth / 2 ? -removeActionWidth : 0),
      onPanResponderTerminate: () => settle(offset.current)
    })
  ).current

  return (
    <View style={styles.swipeContainer}>
      <Pressable
        style={styles.swipeAction}
        onPress={remove}
        accessibilityRole='button'
        accessibilityLabel={t('Remove {name}', { name: label })}
      >
        <Feather name='trash-2' size={18} color='white' />
        <Text style={styles.swipeActionText}>{t('Remove')}</Text>
      </Pressable>
      <Animated.View
        style={[styles.swipeContent, { transform: [{ translateX }] }]}
        accessibilityActions={[{ name: 'remove', label: t('Remove') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'remove') remove()
        }}
        {...responder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  )
}

const styles = themed(() => ({
  app: { flex: 1, backgroundColor: colors.bg },
  root: { flex: 1, backgroundColor: colors.bg },
  boardLoading: { paddingHorizontal: 16, gap: 12 },
  flex: { flex: 1 },
  avatarEdit: { alignItems: 'center', gap: 10, paddingVertical: 6 },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface
  },
  removePhoto: { color: colors.muted, fontSize: 12, textDecorationLine: 'underline' },
  screen: { flexGrow: 1, padding: 20, paddingTop: 64, gap: 14 },
  list: { padding: 16, paddingTop: 64, paddingBottom: 120, gap: 12 },
  boardHeader: { gap: 10, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontSize: 28, fontWeight: '700', color: colors.text },
  prompt: { color: colors.accent, fontFamily: mono },
  userPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: 5,
    paddingRight: 12,
    paddingVertical: 5,
    maxWidth: 170
  },
  userPanelName: { color: colors.accent, fontWeight: '700', fontSize: 14, flexShrink: 1 },
  userPanelKey: { color: colors.text, fontFamily: mono, fontSize: 12 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, lineHeight: 20 },
  hint: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  error: { color: colors.error },
  section: { gap: 8 },
  sectionLabel: {
    color: colors.muted,
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase'
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 46,
    color: colors.text
  },
  monoInput: { fontFamily: mono, fontSize: 13 },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  button: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonText: { fontWeight: '700' },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderColor: colors.accent,
    borderWidth: 1
  },
  buttonGhost: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.text, fontFamily: mono, fontSize: 12 },
  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14
  },
  cardBody: { flex: 1, gap: 8 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  cardText: { color: colors.text, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { color: colors.muted, fontSize: 13 },
  metaMono: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  votes: { alignItems: 'center', width: 32 },
  score: { color: colors.text, fontFamily: mono, fontSize: 15, fontWeight: '700' },
  commentToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  commentToggleText: { color: colors.info, fontSize: 13, fontWeight: '600' },
  comments: {
    gap: 10,
    borderLeftColor: colors.border,
    borderLeftWidth: 2,
    paddingLeft: 10
  },
  comment: { gap: 3 },
  commentAuthor: { color: colors.text, fontWeight: '700', fontSize: 13 },
  commentForm: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  identicon: { backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  recentBoard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  recentBoardName: { color: colors.text, flex: 1, fontWeight: '600', fontSize: 15 },
  swipeContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1
  },
  swipeContent: { backgroundColor: colors.surface },
  swipeAction: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: removeActionWidth,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  swipeActionText: { color: 'white', fontWeight: '700', fontSize: 12 },
  phraseGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  phraseWord: {
    flexDirection: 'row',
    gap: 6,
    width: '31%',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8
  },
  phraseIndex: { color: colors.muted, fontFamily: mono, fontSize: 11 },
  phraseText: { color: colors.accent, fontFamily: mono, fontSize: 13, flexShrink: 1 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 48 },
  skeletons: { gap: 12 },
  skeletonCard: {
    gap: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16
  },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: colors.border },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 36,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 36,
    gap: 12,
    maxHeight: '92%'
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    padding: 24
  },
  qrWrap: { alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: '#ffffff' },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    gap: 12
  },
  previewRow: { gap: 8 },
  composerBar: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  composerTitle: { flex: 1, textAlign: 'center' },
  composerBody: { flexGrow: 0, flexShrink: 1 },
  composerFields: { gap: 12 },
  composerSections: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  composerSource: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  composerSourceText: { color: colors.muted, flex: 1, fontSize: 13 },
  waiting: {
    gap: 8,
    backgroundColor: colors.surface,
    borderColor: colors.info,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16
  },
  versionLabel: {
    color: colors.muted,
    fontFamily: mono,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 24
  },
  updateBanner: {
    position: 'absolute',
    // Above the board's + button, clear of the header.
    bottom: 108,
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  updateText: { color: colors.text, flex: 1, fontSize: 13 },
  preview: { width: 72, height: 72, borderRadius: 8, overflow: 'hidden' },
  previewImage: { width: '100%', height: '100%' },
  previewRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  imageSlot: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1
  },
  slotImage: { width: '100%', height: '100%' },
  slotState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  viewerImage: { width: '100%', height: '100%' }
}))
