import React, { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import * as Clipboard from 'expo-clipboard'
import PearRuntime from 'pear-mobile'
import FramedStream from 'framed-stream'
import workerBundle from './worker.bundle.js'
import { messageTypes } from '@opencollab/board-protocol'

const normalizeInvite = (value: string) => {
  const invite = value.trim()
  const match = invite.match(
    /^(?:opencollab:\/\/board\/|opencollab:\/\/|https?:\/\/[^/]+\/board\/)?(.+)$/i
  )
  return decodeURIComponent(match ? match[1] : invite).replace(/\/$/, '')
}

const inviteLink = (invite: string) =>
  `opencollab://board/${encodeURIComponent(normalizeInvite(invite))}`

const version = '1.0.0'
const upgrade = 'pear://nzi3suuxyzwj6oosortonj5pxd9s7ckgd8cr87szddaamxi77kny'

const colors = {
  bg: '#0A0E14',
  surface: '#0F1620',
  surfaceRaised: '#141D29',
  border: '#1C2633',
  text: '#C9D4E3',
  muted: '#6B7A90',
  accent: '#39FF88',
  onAccent: '#04110A',
  info: '#22D3EE',
  magenta: '#FF4FD8',
  error: '#FF5C5C'
}
const mono = Platform.select({ ios: 'Menlo', default: 'monospace' })

type FeatherName = React.ComponentProps<typeof Feather>['name']
type BoardComment = { id: string; author: string; text: string; createdAt?: string }
type BoardObject = {
  id: string
  title: string
  body: string
  author: string
  createdAt?: string
  votes: Record<string, number>
  comments: BoardComment[]
}
type WorkerMessage = { type: string; [key: string]: any }
type RecentBoard = { invite: string; name: string; joinedAt: number }

// Invites are tied to the identity that joined, so remembered boards are kept
// per identity public key. The unscoped key predates that and is migrated once.
const legacyRecentBoardsKey = 'opencollab.recent-boards'
const recentBoardsKey = (identity: string) => `opencollab.recent-boards.${identity}`

const shortKey = (hex: string) => (hex.length > 10 ? `${hex.slice(0, 4)}…${hex.slice(-4)}` : hex)

function relativeTime(iso?: string) {
  if (!iso) return ''
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function describeNetwork(status: string) {
  if (status === 'topic-joining') return 'Searching for peers'
  if (status === 'topic-joined') return 'Announced on the network'
  if (status === 'connection-received') return 'Peer connecting'
  if (status === 'authenticated') return 'Peer verified'
  if (/error|failed/.test(status)) return 'Network problem, retrying'
  return status
}

// Read once at startup and kept current by App; animations check it on mount.
let reduceMotion = false

export default function App() {
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
  const [recentBoards, setRecentBoards] = useState<RecentBoard[]>([])
  const [displayName, setDisplayName] = useState('')
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [invitationLink, setInvitationLink] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [board, setBoard] = useState<BoardObject[]>([])
  const [profiles, setProfiles] = useState<Record<string, string>>({})
  const [roomReady, setRoomReady] = useState(false)
  const [synced, setSynced] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [networkStatus, setNetworkStatus] = useState('Not connected')
  const [peerCount, setPeerCount] = useState(0)
  const identityKeyRef = useRef('')
  const savedPhraseRef = useRef('')

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((value) => (reduceMotion = value))
    const motion = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value) => (reduceMotion = value)
    )
    const ipc = PearRuntime.run('/worker.bundle', workerBundle, [
      String(!__DEV__),
      version,
      upgrade,
      'OpenCollab'
    ])
    const framed = new FramedStream(ipc)
    framed.on('data', (data: Uint8Array) => {
      let message: WorkerMessage
      try {
        message = JSON.parse(new TextDecoder().decode(data))
      } catch {
        return
      }
      if (message.type === messageTypes.identityStatus) {
        if (message.status === 'unlocked') {
          identityKeyRef.current = message.publicKey || ''
          setIdentityKey(message.publicKey || '')
          if (message.publicKey) void loadRecentBoards(message.publicKey)
          setIdentityReady(true)
          if (message.mnemonic) {
            setIdentityPhrase(message.mnemonic)
            setBackupPhrase(message.mnemonic)
            savedPhraseRef.current = message.mnemonic
            SecureStore.setItemAsync('opencollab.identity', message.mnemonic)
          }
        } else if (message.error) Alert.alert('Identity error', message.error)
      }
      if (message.type === messageTypes.roomStatus && message.status === 'ready') {
        setRoomReady(true)
        setSynced(false)
        setEntryError('')
        setBoardName(message.boardName || 'OpenCollab')
        setInvitationLink(message.invite || '')
        if (message.invite) rememberBoard(message.invite, message.boardName || 'Unnamed board')
        if (message.displayName) {
          setDisplayName(message.displayName)
          setDisplayNameDraft(message.displayName)
          setSynced(true)
        }
      }
      if (message.type === messageTypes.roomStatus && message.status === 'none') {
        setRoomReady(false)
        setSynced(false)
        setBoard([])
        setProfiles({})
        setBoardName('')
        setInvitationLink('')
        setDisplayName('')
        setDisplayNameDraft('')
        setExpanded({})
        setEntryMode('choose')
      }
      if (message.type === messageTypes.boardState) {
        setBoard(message.objects || [])
        setProfiles(message.profiles || {})
      }
      if (message.type === 'board-name' && message.name) {
        setBoardName(message.name)
      }
      if (message.type === messageTypes.profileStatus) {
        setDisplayName(message.displayName)
        setDisplayNameDraft(message.displayName)
        setSynced(true)
      }
      if (message.type === messageTypes.boardSynced) setSynced(true)
      if (message.type === 'room-status' && message.status === 'error')
        setEntryError(message.error || 'Something went wrong')
      if (message.type === 'room-debug') setNetworkStatus(describeNetwork(message.status))
      if (message.type === 'peer-count') setPeerCount(message.count || 0)
    })
    setPipe(framed)
    SecureStore.getItemAsync('opencollab.identity').then((saved) => {
      if (!saved) return
      savedPhraseRef.current = saved
      setIdentityPhrase(saved)
    })
    return () => {
      motion.remove()
      framed.destroy()
    }
  }, [])

  const send = (message: object) => pipe?.write(JSON.stringify(message))
  const nameFor = (identity: string) => profiles[identity] || shortKey(identity)
  const score = (item: BoardObject) =>
    Object.values(item.votes || {}).reduce((sum, vote) => sum + vote, 0)

  async function unlock() {
    if (identityPhrase.trim().split(/\s+/).length < 12)
      return Alert.alert('Identity required', 'Enter a recovery phrase with at least 12 words.')
    // Unscoped boards belong to the previously saved identity only.
    if (identityPhrase.trim() !== savedPhraseRef.current)
      await SecureStore.deleteItemAsync(legacyRecentBoardsKey)
    await SecureStore.setItemAsync('opencollab.identity', identityPhrase.trim())
    send({ type: messageTypes.identityLoad, mnemonic: identityPhrase.trim() })
  }

  async function createIdentity() {
    await SecureStore.deleteItemAsync(legacyRecentBoardsKey)
    send({ type: messageTypes.identityCreate })
  }

  async function loadRecentBoards(identity: string) {
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
        { invite: boardInvite, name: name || 'Unnamed board', joinedAt: Date.now() },
        ...current.filter((board) => board.invite !== boardInvite)
      ].slice(0, 12)
    )
  }

  function forgetBoard(boardInvite: string) {
    updateRecentBoards((current) => current.filter((board) => board.invite !== boardInvite))
  }

  async function shareInvitation() {
    if (!invitationLink) return
    await Share.share({ message: inviteLink(invitationLink), url: inviteLink(invitationLink) })
  }

  function logout() {
    setProfileOpen(false)
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
      setEntryError('Clipboard is empty. Copy an invitation link first.')
      return
    }
    setEntryError('')
    setInvite(value.trim())
  }

  function addObject() {
    if (!newTitle.trim()) return
    send({ type: messageTypes.boardCreate, title: newTitle, body: newBody })
    setNewTitle('')
    setNewBody('')
    setComposerOpen(false)
  }

  if (!identityReady)
    return (
      <Screen title='opencollab' cursor>
        <Text style={styles.muted}>
          Peer-to-peer boards. No servers, no accounts — just a key that lives on your device.
        </Text>
        {identityChoice === 'choose' ? (
          <>
            {identityPhrase ? (
              <Button title='Unlock saved identity' icon='unlock' onPress={unlock} />
            ) : null}
            <Button
              title='Create new identity'
              icon='key'
              variant={identityPhrase ? 'secondary' : 'primary'}
              onPress={createIdentity}
            />
            <Button
              title='Use existing identity'
              icon='download'
              variant='secondary'
              onPress={() => setIdentityChoice('existing')}
            />
          </>
        ) : (
          <>
            <Text style={styles.muted}>Enter the recovery phrase for your existing identity.</Text>
            <TextInput
              style={[styles.input, styles.monoInput]}
              multiline
              value={identityPhrase}
              onChangeText={setIdentityPhrase}
              placeholder='Recovery phrase'
              placeholderTextColor={colors.muted}
              autoCapitalize='none'
              autoCorrect={false}
            />
            <View style={styles.row}>
              <Button
                title='Back'
                icon='arrow-left'
                variant='secondary'
                onPress={() => setIdentityChoice('choose')}
              />
              <Button title='Unlock' icon='unlock' onPress={unlock} grow />
            </View>
          </>
        )}
      </Screen>
    )
  if (backupPhrase)
    return (
      <Screen title='Back up your key'>
        <Text style={styles.muted}>
          These words are the only way to recover this identity on another device. Write them down
          and keep them offline.
        </Text>
        <View style={styles.phraseGrid}>
          {backupPhrase.split(/\s+/).map((word, index) => (
            <View style={styles.phraseWord} key={index}>
              <Text style={styles.phraseIndex}>{String(index + 1).padStart(2, '0')}</Text>
              <Text style={styles.phraseText}>{word}</Text>
            </View>
          ))}
        </View>
        <Button title="I've written it down" icon='check' onPress={() => setBackupPhrase('')} />
      </Screen>
    )
  if (!roomReady && entryMode === 'create')
    return (
      <Screen title='New board'>
        <Text style={styles.muted}>
          You will get an invitation link to share once the board is ready.
        </Text>
        <TextInput
          style={styles.input}
          value={boardName}
          onChangeText={(value) => {
            setBoardName(value)
            setEntryError('')
          }}
          placeholder='Board name'
          placeholderTextColor={colors.muted}
          autoFocus
        />
        {entryError ? <Text style={styles.error}>{entryError}</Text> : null}
        <View style={styles.row}>
          <Button
            title='Back'
            icon='arrow-left'
            variant='secondary'
            onPress={() => {
              setEntryError('')
              setEntryMode('choose')
            }}
          />
          <Button
            title='Create board'
            icon='plus'
            grow
            onPress={() => {
              if (!boardName.trim()) return setEntryError('Give your board a name.')
              send({ type: messageTypes.roomStart, invite: null, name: boardName.trim() })
            }}
          />
        </View>
      </Screen>
    )
  if (!roomReady && entryMode === 'join')
    return (
      <Screen title='Join board'>
        <Text style={styles.muted}>
          Paste the invitation link you received from a board member.
        </Text>
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
          title='Paste invitation'
          icon='clipboard'
          variant='secondary'
          onPress={pasteInvitation}
        />
        {entryError ? <Text style={styles.error}>{entryError}</Text> : null}
        <View style={styles.row}>
          <Button
            title='Back'
            icon='arrow-left'
            variant='secondary'
            onPress={() => {
              setEntryError('')
              setEntryMode('choose')
            }}
          />
          <Button
            title='Join board'
            icon='log-in'
            grow
            onPress={() => {
              if (!invite.trim()) return setEntryError('Paste an invitation link first.')
              send({ type: messageTypes.roomStart, invite: normalizeInvite(invite) })
            }}
          />
        </View>
      </Screen>
    )
  if (!roomReady)
    return (
      <Screen
        title='Boards'
        headerRight={<IdentityBadge identity={identityKey} onPress={logout} icon='log-out' />}
      >
        <View style={styles.row}>
          <Button title='New board' icon='plus' grow onPress={() => setEntryMode('create')} />
          <Button
            title='Join'
            icon='log-in'
            variant='secondary'
            grow
            onPress={() => setEntryMode('join')}
          />
        </View>
        {entryError ? <Text style={styles.error}>{entryError}</Text> : null}
        {recentBoards.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Recently joined</Text>
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
                    accessibilityLabel={`Open ${board.name}`}
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
            <Text style={styles.hint}>Swipe left on a board to remove it.</Text>
          </View>
        ) : (
          <Text style={styles.muted}>No boards yet. Create one or join with an invitation.</Text>
        )}
        <Button title='Log out' icon='log-out' variant='ghost' onPress={logout} />
      </Screen>
    )
  if (!displayName)
    return (
      <Screen title={boardName || 'OpenCollab'}>
        <Text style={styles.heading}>Choose your display name</Text>
        <Text style={styles.muted}>
          Other participants will see this beside your objects and comments.
        </Text>
        <TextInput
          style={styles.input}
          value={displayNameDraft}
          onChangeText={setDisplayNameDraft}
          placeholder='Name or nickname'
          placeholderTextColor={colors.muted}
          maxLength={48}
        />
        <Button
          title='Continue'
          icon='arrow-right'
          onPress={() =>
            displayNameDraft.trim() &&
            send({ type: messageTypes.profileSet, displayName: displayNameDraft.trim() })
          }
        />
      </Screen>
    )

  // Newest first; worker order follows storage keys, not creation time.
  const newestFirst = [...board].sort(
    (a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)
  )

  const header = (
    <View style={styles.boardHeader}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {boardName || 'OpenCollab'}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.userPanel, pressed && styles.pressed]}
          onPress={() => setProfileOpen(true)}
          accessibilityRole='button'
          accessibilityLabel='Open profile and connection details'
        >
          <Identicon hex={identityKey} size={22} />
          <Text style={styles.userPanelName} numberOfLines={1}>
            @{displayName}
          </Text>
        </Pressable>
      </View>
      <StatusChip peers={peerCount} synced={synced} />
    </View>
  )

  return (
    <View style={styles.root}>
      <StatusBar barStyle='light-content' />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={synced ? newestFirst : []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps='handled'
          ListHeaderComponent={header}
          ListEmptyComponent={
            synced ? (
              <View style={styles.empty}>
                <Feather name='inbox' size={28} color={colors.muted} />
                <Text style={styles.muted}>Nothing here yet. Tap + to add the first object.</Text>
              </View>
            ) : (
              <SkeletonCards />
            )
          }
          renderItem={({ item }) => {
            const myVote = item.votes?.[identityKey] || 0
            // Persisted order is per writer, not chronological; sort for display.
            const comments = [...(item.comments || [])].sort(
              (a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || '')
            )
            const open = !!expanded[item.id]
            return (
              <FadeIn>
                <View style={styles.card}>
                  <VoteColumn
                    score={score(item)}
                    myVote={myVote}
                    onVote={(value) =>
                      // Step by one: with a vote cast, either arrow first clears it.
                      send({
                        type: messageTypes.boardVote,
                        objectId: item.id,
                        value: myVote ? 0 : value
                      })
                    }
                  />
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    {item.body ? <Text style={styles.cardText}>{item.body}</Text> : null}
                    <View style={styles.meta}>
                      <Identicon hex={item.author} size={14} />
                      <Text style={styles.metaText}>{nameFor(item.author)}</Text>
                      {item.createdAt ? (
                        <Text style={styles.metaMono}>· {relativeTime(item.createdAt)}</Text>
                      ) : null}
                    </View>
                    <Pressable
                      style={({ pressed }) => [styles.commentToggle, pressed && styles.pressed]}
                      onPress={() => setExpanded((current) => ({ ...current, [item.id]: !open }))}
                      accessibilityRole='button'
                      accessibilityState={{ expanded: open }}
                    >
                      <Feather name='message-square' size={14} color={colors.info} />
                      <Text style={styles.commentToggleText}>
                        {comments.length
                          ? `${comments.length} comment${comments.length === 1 ? '' : 's'}`
                          : 'Comment'}
                      </Text>
                      <Feather
                        name={open ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={colors.muted}
                      />
                    </Pressable>
                    {open ? (
                      <View style={styles.comments}>
                        {comments.map((comment) => (
                          <FadeIn key={comment.id}>
                            <View style={styles.comment}>
                              <View style={styles.meta}>
                                <Identicon hex={comment.author} size={12} />
                                <Text style={styles.commentAuthor}>{nameFor(comment.author)}</Text>
                                <Text style={styles.metaMono}>
                                  {relativeTime(comment.createdAt)}
                                </Text>
                              </View>
                              <Text style={styles.cardText}>{comment.text}</Text>
                            </View>
                          </FadeIn>
                        ))}
                        <View style={styles.commentForm}>
                          <TextInput
                            style={[styles.input, styles.flex]}
                            value={commentDrafts[item.id] || ''}
                            onChangeText={(text) =>
                              setCommentDrafts((current) => ({ ...current, [item.id]: text }))
                            }
                            placeholder='Add a comment'
                            placeholderTextColor={colors.muted}
                          />
                          <IconButton
                            icon='send'
                            label='Send comment'
                            onPress={() => {
                              const text = (commentDrafts[item.id] || '').trim()
                              if (!text) return
                              send({ type: messageTypes.boardComment, objectId: item.id, text })
                              setCommentDrafts((current) => ({ ...current, [item.id]: '' }))
                            }}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                </View>
              </FadeIn>
            )
          }}
        />
      </KeyboardAvoidingView>
      {synced ? (
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
          onPress={() => setComposerOpen(true)}
          accessibilityRole='button'
          accessibilityLabel='Add an object'
        >
          <Feather name='plus' size={26} color={colors.onAccent} />
        </Pressable>
      ) : null}

      <Modal
        visible={composerOpen}
        transparent
        animationType='slide'
        onRequestClose={() => setComposerOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.sheetBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.flex} onPress={() => setComposerOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.heading}>New object</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder='Title'
              placeholderTextColor={colors.muted}
              autoFocus
            />
            <TextInput
              style={[styles.input, styles.multiline]}
              value={newBody}
              onChangeText={setNewBody}
              placeholder='Description or proposal'
              placeholderTextColor={colors.muted}
              multiline
            />
            <View style={styles.row}>
              <Button title='Cancel' variant='secondary' onPress={() => setComposerOpen(false)} />
              <Button title='Add to board' icon='plus' grow onPress={addObject} />
            </View>
          </View>
        </KeyboardAvoidingView>
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
              <Identicon hex={identityKey} size={36} />
              <View>
                <Text style={styles.heading}>@{displayName}</Text>
                <Text style={styles.metaMono}>{shortKey(identityKey)}</Text>
              </View>
            </View>
            <StatusChip peers={peerCount} synced={synced} />
            <Text style={styles.metaMono}>{networkStatus}</Text>
            <Button title='Share invitation' icon='share-2' onPress={shareInvitation} />
            <Button
              title='Switch board'
              icon='repeat'
              variant='secondary'
              onPress={() => {
                setProfileOpen(false)
                send({ type: messageTypes.roomLeave })
              }}
            />
            <Button title='Log out' icon='log-out' variant='secondary' onPress={logout} />
            <Button title='Close' variant='ghost' onPress={() => setProfileOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
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
      <StatusBar barStyle='light-content' />
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
        </ScrollView>
      </KeyboardAvoidingView>
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

function FadeIn({ children }: { children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: true }).start()
  }, [progress])
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] })
  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  )
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
        {peers} peer{peers === 1 ? '' : 's'} · {synced ? 'synced' : 'syncing…'}
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
    <View style={styles.skeletons} accessibilityLabel='Syncing board'>
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

function VoteColumn({
  score,
  myVote,
  onVote
}: {
  score: number
  myVote: number
  onVote: (value: number) => void
}) {
  const scale = useRef(new Animated.Value(1)).current
  const previous = useRef(score)
  useEffect(() => {
    if (previous.current === score) return
    previous.current = score
    if (reduceMotion) return
    scale.setValue(1.35)
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4 }).start()
  }, [score, scale])
  return (
    <View style={styles.votes}>
      <Pressable
        onPress={() => onVote(1)}
        hitSlop={8}
        accessibilityRole='button'
        accessibilityLabel='Upvote'
        accessibilityState={{ selected: myVote === 1 }}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Feather name='chevron-up' size={24} color={myVote === 1 ? colors.accent : colors.muted} />
      </Pressable>
      <Animated.Text
        style={[
          styles.score,
          myVote === 1 && { color: colors.accent },
          myVote === -1 && { color: colors.magenta },
          { transform: [{ scale }] }
        ]}
      >
        {score}
      </Animated.Text>
      <Pressable
        onPress={() => onVote(-1)}
        hitSlop={8}
        accessibilityRole='button'
        accessibilityLabel='Downvote'
        accessibilityState={{ selected: myVote === -1 }}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Feather
          name='chevron-down'
          size={24}
          color={myVote === -1 ? colors.magenta : colors.muted}
        />
      </Pressable>
    </View>
  )
}

// Deterministic 5x5 mirrored grid derived from an identity public key.
function Identicon({ hex, size }: { hex: string; size: number }) {
  if (!hex) return <View style={{ width: size, height: size }} />
  const hue = parseInt(hex.slice(0, 4), 16) % 360
  const color = `hsl(${hue}, 85%, 62%)`
  const cell = size / 5
  const cells: React.ReactNode[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const nibble = parseInt(hex[(row * 3 + col + 4) % hex.length] || '0', 16)
      if (nibble % 2 === 0) continue
      for (const x of col === 2 ? [2] : [col, 4 - col]) {
        cells.push(
          <View
            key={`${row}-${x}`}
            style={{
              position: 'absolute',
              left: x * cell,
              top: row * cell,
              width: cell,
              height: cell,
              backgroundColor: color
            }}
          />
        )
      }
    }
  }
  return (
    <View
      style={[styles.identicon, { width: size, height: size, borderRadius: size / 5 }]}
      accessibilityElementsHidden
      importantForAccessibility='no-hide-descendants'
    >
      {cells}
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
      accessibilityLabel='Log out'
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
        accessibilityLabel={`Remove ${label}`}
      >
        <Feather name='trash-2' size={18} color='white' />
        <Text style={styles.swipeActionText}>Remove</Text>
      </Pressable>
      <Animated.View
        style={[styles.swipeContent, { transform: [{ translateX }] }]}
        accessibilityActions={[{ name: 'remove', label: 'Remove' }]}
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

function IconButton({
  icon,
  label,
  onPress
}: {
  icon: FeatherName
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole='button'
      accessibilityLabel={label}
    >
      <Feather name={icon} size={18} color={colors.onAccent} />
    </Pressable>
  )
}

function Button({
  title,
  onPress,
  icon,
  grow,
  variant = 'primary'
}: {
  title: string
  onPress: () => void
  icon?: FeatherName
  grow?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const color =
    variant === 'primary' ? colors.onAccent : variant === 'ghost' ? colors.muted : colors.accent
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        grow && styles.flex,
        pressed && styles.pressed
      ]}
      onPress={onPress}
      accessibilityRole='button'
    >
      {icon ? <Feather name={icon} size={16} color={color} /> : null}
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
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
    gap: 12
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
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    gap: 12
  }
})
