import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import * as SecureStore from 'expo-secure-store'
import * as Clipboard from 'expo-clipboard'
import PearRuntime from 'pear-mobile'
import FramedStream from 'framed-stream'
import workerBundle from './worker.bundle.js'
import { messageTypes } from '@opencollab/board-protocol'

const normalizeInvite = (value: string) => {
  const invite = value.trim()
  const match = invite.match(/^(?:opencollab:\/\/board\/|opencollab:\/\/|https?:\/\/[^/]+\/board\/)?(.+)$/i)
  return decodeURIComponent(match ? match[1] : invite).replace(/\/$/, '')
}

const inviteLink = (invite: string) => `opencollab://board/${encodeURIComponent(normalizeInvite(invite))}`

const version = '1.0.0'
const upgrade = 'pear://nzi3suuxyzwj6oosortonj5pxd9s7ckgd8cr87szddaamxi77kny'

type BoardComment = { id: string; author: string; text: string }
type BoardObject = {
  id: string
  title: string
  body: string
  author: string
  votes: Record<string, number>
  comments: BoardComment[]
}
type WorkerMessage = { type: string; [key: string]: any }
type RecentBoard = { invite: string; name: string; joinedAt: number }

export default function App() {
  const [pipe, setPipe] = useState<any>(null)
  const [identityPhrase, setIdentityPhrase] = useState('')
  const [identityReady, setIdentityReady] = useState(false)
  const [identityChoice, setIdentityChoice] = useState<'choose' | 'existing'>('choose')
  const [invite, setInvite] = useState('')
  const [boardName, setBoardName] = useState('')
  const [recentBoards, setRecentBoards] = useState<RecentBoard[]>([])
  const [displayName, setDisplayName] = useState('')
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [invitationLink, setInvitationLink] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [board, setBoard] = useState<BoardObject[]>([])
  const [profiles, setProfiles] = useState<Record<string, string>>({})
  const [roomReady, setRoomReady] = useState(false)
  const [synced, setSynced] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [networkStatus, setNetworkStatus] = useState('Not connected')
  const [peerCount, setPeerCount] = useState(0)

  useEffect(() => {
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
          setIdentityReady(true)
          if (message.mnemonic) {
            setIdentityPhrase(message.mnemonic)
            SecureStore.setItemAsync('opencollab.identity', message.mnemonic)
          }
        } else if (message.error) Alert.alert('Identity error', message.error)
      }
      if (message.type === messageTypes.roomStatus && message.status === 'ready') {
        setRoomReady(true)
        setSynced(false)
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
        Alert.alert('Board error', message.error)
      if (message.type === 'room-debug') setNetworkStatus(message.status)
      if (message.type === 'peer-count') setPeerCount(message.count || 0)
    })
    setPipe(framed)
    SecureStore.getItemAsync('opencollab.identity').then((saved) => {
      if (saved) setIdentityPhrase(saved)
    })
    SecureStore.getItemAsync('opencollab.recent-boards').then((saved) => {
      if (!saved) return
      try {
        setRecentBoards(JSON.parse(saved))
      } catch {
        setRecentBoards([])
      }
    })
    return () => framed.destroy()
  }, [])

  const send = (message: object) => pipe?.write(JSON.stringify(message))
  const nameFor = (identity: string) => profiles[identity] || identity.slice(0, 12)
  const score = (item: BoardObject) =>
    Object.values(item.votes || {}).reduce((sum, vote) => sum + vote, 0)

  async function unlock() {
    if (identityPhrase.trim().split(/\s+/).length < 12)
      return Alert.alert('Identity required', 'Enter a recovery phrase with at least 12 words.')
    await SecureStore.setItemAsync('opencollab.identity', identityPhrase.trim())
    send({ type: messageTypes.identityLoad, mnemonic: identityPhrase.trim() })
  }

  function createIdentity() {
    send({ type: messageTypes.identityCreate })
  }

  function rememberBoard(boardInvite: string, name: string) {
    setRecentBoards((current) => {
      const next = [
        { invite: boardInvite, name: name || 'Unnamed board', joinedAt: Date.now() },
        ...current.filter((board) => board.invite !== boardInvite)
      ].slice(0, 12)
      void SecureStore.setItemAsync('opencollab.recent-boards', JSON.stringify(next))
      return next
    })
  }

  async function copyInvitation() {
    if (!invitationLink) return
    await Clipboard.setStringAsync(inviteLink(invitationLink))
    Alert.alert('Invitation copied', 'The invitation link is ready to paste.')
  }

  async function shareInvitation() {
    if (!invitationLink) return
    await Share.share({ message: inviteLink(invitationLink), url: inviteLink(invitationLink) })
  }

  async function pasteInvitation() {
    const value = await Clipboard.getStringAsync()
    if (!value.trim()) {
      Alert.alert('Clipboard is empty', 'Copy an invitation link first, then try again.')
      return
    }
    setInvite(value.trim())
  }

  if (!identityReady)
    return (
      <Screen title='OpenCollab'>
        {identityChoice === 'choose' ? (
          <>
            <Text style={styles.muted}>Create a new identity or use one from another device.</Text>
            <Button title='Create new identity' onPress={createIdentity} />
            <Button title='Use existing identity' onPress={() => setIdentityChoice('existing')} />
            {identityPhrase ? <Button title='Unlock saved identity' onPress={unlock} /> : null}
          </>
        ) : (
          <>
            <Text style={styles.muted}>Enter the recovery phrase for your existing identity.</Text>
            <TextInput
              style={styles.input}
              multiline
              value={identityPhrase}
              onChangeText={setIdentityPhrase}
              placeholder='Recovery phrase'
            />
            <View style={styles.row}>
              <Button title='Back' onPress={() => setIdentityChoice('choose')} />
              <Button title='Unlock existing' onPress={unlock} />
            </View>
          </>
        )}
      </Screen>
    )
  if (!roomReady)
    return (
      <Screen title='OpenCollab'>
        <Text style={styles.heading}>Private board</Text>
        {recentBoards.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Recently joined</Text>
            {recentBoards.map((board) => (
              <View style={styles.recentBoard} key={board.invite}>
                <Text style={styles.recentBoardName}>{board.name}</Text>
                <Button
                  title='Join'
                  onPress={() => {
                    setInvite(board.invite)
                    send({ type: messageTypes.roomStart, invite: normalizeInvite(board.invite) })
                  }}
                />
              </View>
            ))}
          </View>
        ) : null}
        <TextInput
          style={styles.input}
          value={invite}
          onChangeText={setInvite}
          placeholder='Paste invitation link'
          autoCapitalize='none'
          testID='board-invite-input'
        />
        <Button title='Paste invitation' onPress={pasteInvitation} />
        <TextInput
          style={styles.input}
          value={boardName}
          onChangeText={setBoardName}
          placeholder='Board name (only when creating)'
        />
        <View style={styles.row}>
          <Button
            title='Create'
            onPress={() => send({ type: messageTypes.roomStart, invite: null, name: boardName })}
          />
          <Button
            title='Join'
            onPress={() => send({ type: messageTypes.roomStart, invite: normalizeInvite(invite) })}
          />
        </View>
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
        />
        <Button
          title='Continue'
          onPress={() =>
            send({ type: messageTypes.profileSet, displayName: displayNameDraft.trim() })
          }
        />
      </Screen>
    )
  if (!synced)
    return (
      <Screen title={boardName || 'OpenCollab'}>
        <ActivityIndicator size='large' color='#2563eb' />
        <Text style={styles.muted}>Syncing board…</Text>
      </Screen>
    )

  return (
    <Screen title={boardName || 'OpenCollab'}>
      <Pressable onPress={() => setProfileOpen(true)}>
        <Text style={styles.profileLink}>@{displayName}</Text>
      </Pressable>
      <Modal
        visible={profileOpen}
        transparent
        animationType='fade'
        onRequestClose={() => setProfileOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setProfileOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.heading}>Connection details</Text>
            <Text style={styles.muted}>Signed in as @{displayName}</Text>
            <Text style={styles.muted}>Network: {networkStatus} · Peers: {peerCount}</Text>
            <Text style={styles.modalLabel}>Invitation link</Text>
            <Text selectable style={styles.inviteText}>
              {invitationLink || 'Unavailable'}
            </Text>
            <Button title='Copy invitation link' onPress={copyInvitation} />
            <Button title='Share invitation link' onPress={shareInvitation} />
            <Button
              title='Switch board'
              onPress={() => {
                setProfileOpen(false)
                send({ type: messageTypes.roomLeave })
              }}
            />
            <Button title='Close' onPress={() => setProfileOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
      <View style={styles.card}>
        <Text style={styles.heading}>Add an object</Text>
        <TextInput
          style={styles.input}
          value={newTitle}
          onChangeText={setNewTitle}
          placeholder='Title'
        />
        <TextInput
          style={styles.input}
          value={newBody}
          onChangeText={setNewBody}
          placeholder='Description'
          multiline
        />
        <Button
          title='Add'
          onPress={() => {
            if (newTitle.trim()) {
              send({ type: messageTypes.boardCreate, title: newTitle, body: newBody })
              setNewTitle('')
              setNewBody('')
            }
          }}
        />
      </View>
      {board.map((item: BoardObject) => (
        <View style={styles.card} key={item.id}>
          <Text style={styles.heading}>{item.title}</Text>
          <Text>{item.body}</Text>
          <Text style={styles.muted}>
            by {nameFor(item.author)} · score {score(item)}
          </Text>
          <View style={styles.row}>
            <Button
              title='▲'
              onPress={() => send({ type: messageTypes.boardVote, objectId: item.id, value: 1 })}
            />
            <Button
              title='▼'
              onPress={() => send({ type: messageTypes.boardVote, objectId: item.id, value: -1 })}
            />
          </View>
          {item.comments?.map((comment: BoardComment) => (
            <Text key={comment.id} style={styles.comment}>
              <Text style={styles.bold}>{nameFor(comment.author)}: </Text>
              {comment.text}
            </Text>
          ))}
          <TextInput
            style={styles.input}
            value={commentDrafts[item.id] || ''}
            onChangeText={(text) =>
              setCommentDrafts((current) => ({ ...current, [item.id]: text }))
            }
            placeholder='Add a comment'
          />
          <Button
            title='Comment'
            onPress={() => {
              const text = (commentDrafts[item.id] || '').trim()
              if (!text) return
              send({ type: messageTypes.boardComment, objectId: item.id, text })
              setCommentDrafts((current) => ({ ...current, [item.id]: '' }))
            }}
          />
        </View>
      ))}
    </Screen>
  )
}

function Screen({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </ScrollView>
  )
}
function Button({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  )
}
const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 24, gap: 14, backgroundColor: '#f4f7fb' },
  title: { fontSize: 30, fontWeight: '700', color: '#172033', marginTop: 30 },
  heading: { fontSize: 19, fontWeight: '700', color: '#172033' },
  muted: { color: '#63708a' },
  profileLink: { color: '#2563eb', fontWeight: '700', fontSize: 16 },
  input: {
    backgroundColor: 'white',
    borderColor: '#d5ddea',
    borderWidth: 1,
    borderRadius: 9,
    padding: 12,
    minHeight: 46
  },
  row: { flexDirection: 'row', gap: 10 },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 9,
    padding: 12,
    alignItems: 'center'
  },
  buttonText: { color: 'white', fontWeight: '700' },
  card: { backgroundColor: 'white', borderRadius: 14, padding: 16, gap: 10 },
  recentBoard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between'
  },
  recentBoardName: { color: '#172033', flex: 1, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    padding: 24
  },
  modalCard: { backgroundColor: 'white', borderRadius: 16, padding: 20, gap: 12 },
  modalLabel: { fontWeight: '700', color: '#172033' },
  inviteText: { color: '#334155', lineHeight: 20 },
  comment: { marginTop: 6 },
  bold: { fontWeight: '700' }
})
