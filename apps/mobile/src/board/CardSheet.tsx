// Card details: everything the desktop dialog has, laid out for a phone.
// Built from the live card on every board-state, so other members' edits show
// up while it's open; drafts being typed are kept.
import React, { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Alert,
  Animated,
  GestureResponderEvent,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { messageTypes } from '@opencollab/board-protocol'
import {
  Avatar,
  BoardImages,
  Button,
  CachedImage,
  ImageRef,
  MAX_VIDEO_BYTES,
  PressableScale,
  colors,
  easeOut,
  mono,
  pickPreparedImages,
  pickVideos,
  reduceMotion
} from '../ui'
import { SoundName, playSound } from '../sounds'
import { ActivityList } from './Activity'
import {
  AssigneePicker,
  AvatarStack,
  ChecklistEditor,
  EstimatePanel,
  LinksEditor,
  ReactionBar
} from './CardExtras'
import { Confetti } from './Confetti'
import { Markdown, Mention } from './Markdown'
import { VideoTiles } from './Media'
import { MentionInput } from './MentionInput'
import {
  BoardData,
  COMMENTS_SHOWN,
  Card,
  LABEL_COLORS,
  PresencePeer,
  avatarOf,
  checklistProgress,
  columnCards as shownIn,
  dayString,
  doneColumnOf,
  dueInfo,
  findMentions,
  imagesOf,
  newLabelId,
  pad,
  scoreOf,
  videosOf,
  wipState,
  workerIndex
} from './model'

type WorkerMessage = { type: string; [key: string]: any }

type Props = {
  card: Card | null
  data: BoardData
  me: string
  send: (message: object) => void
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  retryImage: (ref: ImageRef) => void
  openViewer: (uri: string) => void
  onClose: () => void
  onManageLabels: () => void
  onLocalMove: () => void
  subscribe: (listener: (message: WorkerMessage) => void) => () => void
  nameFor: (identity: string) => string
  relativeTime: (iso?: string) => string
  // Other members connected to the board, with the card each has open.
  peers: PresencePeer[]
  sound: SoundName
  onOpenCard: (cardId: string) => void
}

// Typing goes out at most this often, and stops after this long without keys.
const TYPING_EVERY = 3000
const TYPING_IDLE = 4000

export function CardSheet(props: Props) {
  const { card, data, me, send } = props
  const [title, setTitle] = useState('')
  const [editingBody, setEditingBody] = useState(false)
  const [body, setBody] = useState('')
  const [comment, setComment] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [dueOpen, setDueOpen] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [labelDraft, setLabelDraft] = useState<string[] | null>(null)
  const [tab, setTab] = useState<'details' | 'activity'>('details')
  // Where the confetti starts, in window coordinates: the tapped column chip.
  const [celebrating, setCelebrating] = useState<{ x: number; y: number } | null>(null)
  const lastTap = useRef<{ x: number; y: number } | null>(null)
  const typingSent = useRef(0)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [videoUpload, setVideoUpload] = useState<{
    requestId: string
    bytes: number
    total: number
  } | null>(null)
  const videoRequest = useRef<string | null>(null)
  const pending = useRef(new Map<string, string[]>())
  const editingBodyRef = useRef(false)
  editingBodyRef.current = editingBody

  // Reset everything when a different card opens.
  useEffect(() => {
    setTitle(card?.title || '')
    setEditingBody(false)
    setBody(card?.body || '')
    setComment('')
    setNewLabel('')
    setDueOpen(false)
    setShowAll(false)
    setLabelDraft(null)
    setTab('details')
  }, [card?.id])

  // Tell the others which card is open; closing it (or opening another) clears it.
  useEffect(() => {
    if (!card?.id) return
    send({ type: messageTypes.presenceSet, cardId: card.id, typing: false })
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = null
      typingSent.current = 0
      send({ type: messageTypes.presenceSet, cardId: null, typing: false })
    }
  }, [card?.id])
  // The worker echoes label changes back; until then quick taps stack.
  useEffect(() => setLabelDraft(null), [card?.labelIds?.join('|')])

  // Image uploads come back with the keys to reference in Markdown.
  useEffect(
    () =>
      props.subscribe((message) => {
        if (message.type !== 'card-images-added' || !pending.current.has(message.requestId)) return
        const names = pending.current.get(message.requestId) || []
        pending.current.delete(message.requestId)
        setUploading(pending.current.size > 0)
        if (!message.keys?.length) {
          Alert.alert('Image not added', message.error || 'The image could not be added.')
          return
        }
        const markdown = message.keys
          .map((key: string, i: number) => `![${names[i] || 'image'}](image:${key})`)
          .join('\n')
        if (editingBodyRef.current) {
          setBody(
            (current) =>
              (current && !current.endsWith('\n') ? `${current}\n` : current) + `${markdown}\n`
          )
        } else if (card) {
          const next = card.body ? `${card.body}\n\n${markdown}` : markdown
          send({ type: messageTypes.cardUpdate, objectId: card.id, body: next })
        }
      }),
    [card?.id, card?.body]
  )

  // Video uploads stream from a file; the worker reports progress every 4 MB.
  useEffect(
    () =>
      props.subscribe((message) => {
        if (message.requestId !== videoRequest.current) return
        if (message.type === 'card-media-progress') {
          setVideoUpload(
            (current) => current && { ...current, bytes: message.bytes, total: message.total }
          )
        } else if (message.type === 'card-media-added') {
          videoRequest.current = null
          setVideoUpload(null)
          if (message.error) Alert.alert('Video not added', message.error)
        }
      }),
    [props.subscribe]
  )

  if (!card) return null
  const images = imagesOf(card)
  const videos = videosOf(card)
  const column = data.columns.find((entry) => entry.id === card.columnId)
  const columnCards = data.objects.filter(
    (entry) => entry.columnId === card.columnId && !entry.archived
  )
  const index = columnCards.findIndex((entry) => entry.id === card.id)
  const mentions: Mention[] = Object.entries(data.profiles).map(([identity, name]) => ({
    identity,
    name
  }))
  const ownVote = card.votes?.[me] || 0
  const labelIds = labelDraft || card.labelIds || []
  const comments = [...(card.comments || [])].sort(
    (a, b) =>
      Date.parse(a.createdAt || '') - Date.parse(b.createdAt || '') || (a.id < b.id ? -1 : 1)
  )
  const hidden = showAll ? 0 : Math.max(0, comments.length - COMMENTS_SHOWN)
  const due = dueInfo(card.dueDate)
  const doneId = doneColumnOf(data)
  const viewers = props.peers.filter((peer) => peer.cardId === card.id)
  const typing = viewers.filter((peer) => peer.typing)
  const checklist = checklistProgress(card)

  const stopTyping = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = null
    if (!typingSent.current) return
    typingSent.current = 0
    send({ type: messageTypes.presenceSet, cardId: card.id, typing: false })
  }
  const onCommentChange = (value: string) => {
    setComment(value)
    if (!value.trim()) return stopTyping()
    if (Date.now() - typingSent.current > TYPING_EVERY) {
      typingSent.current = Date.now()
      send({ type: messageTypes.presenceSet, cardId: card.id, typing: true })
    }
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(stopTyping, TYPING_IDLE)
  }

  const celebrate = () => {
    playSound(props.sound)
    if (reduceMotion) AccessibilityInfo.announceForAccessibility('Card moved to Done')
    else setCelebrating(lastTap.current || { x: -1, y: -1 })
  }
  const place = (columnId: string, visibleIndex: number) => {
    const all = data.objects.filter((entry) => entry.columnId === columnId)
    const visible = all.filter((entry) => !entry.archived)
    props.onLocalMove()
    send({
      type: messageTypes.cardMove,
      objectId: card.id,
      columnId,
      index: workerIndex(all, visible, card.id, visibleIndex)
    })
  }
  // Moving into a full column or a blocked card into Done still works, after
  // a confirmation.
  const move = (columnId: string, visibleIndex: number) => {
    if (columnId === card.columnId) return place(columnId, visibleIndex)
    const target = data.columns.find((entry) => entry.id === columnId)
    const toDone = columnId === doneId
    const warnings: string[] = []
    if (toDone && card.blockedBy?.length) {
      const names = card.blockedBy
        .map((id) => data.objects.find((entry) => entry.id === id)?.title)
        .filter(Boolean)
      warnings.push(`It is still blocked by ${names.map((name) => `“${name}”`).join(', ')}.`)
    }
    const count = target ? shownIn(data, target.id).length : 0
    if (target && wipState(count + 1, target.wipLimit) === 'over') {
      warnings.push(`${target.name} already holds ${count} of its limit of ${target.wipLimit}.`)
    }
    const go = () => {
      place(columnId, visibleIndex)
      if (toDone) celebrate()
    }
    if (!warnings.length) return go()
    Alert.alert(`Move to ${target?.name || 'column'}?`, warnings.join('\n\n'), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move anyway', onPress: go }
    ])
  }
  const saveTitle = () => {
    const next = title.trim()
    if (next && next !== card.title) {
      send({ type: messageTypes.cardUpdate, objectId: card.id, title: next })
    } else setTitle(card.title)
  }
  const setLabels = (next: string[]) => {
    setLabelDraft(next)
    send({ type: messageTypes.cardUpdate, objectId: card.id, labelIds: next })
  }
  const addLabel = () => {
    const name = newLabel.trim()
    if (!name) return
    const existing = data.labels.find((label) => label.name.toLowerCase() === name.toLowerCase())
    const labelId = existing?.id || newLabelId()
    if (!existing) {
      const color =
        LABEL_COLORS.find((value) => !data.labels.some((label) => label.color === value)) ||
        LABEL_COLORS[data.labels.length % LABEL_COLORS.length]
      send({ type: messageTypes.labelUpsert, labelId, name, color })
    }
    if (!labelIds.includes(labelId)) setLabels([...labelIds, labelId])
    setNewLabel('')
  }
  const openDue = () => {
    const today = dayString(new Date())
    setDueDate(!due ? today : due.dateOnly ? card.dueDate || today : dayString(due.deadline))
    setDueTime(
      due && !due.dateOnly
        ? `${pad(due.deadline.getHours())}:${pad(due.deadline.getMinutes())}`
        : ''
    )
    setDueOpen(true)
  }
  const saveDue = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate))) {
      return Alert.alert('Due date', 'Use a date like 2026-12-31.')
    }
    if (dueTime && !/^\d{1,2}:\d{2}$/.test(dueTime)) {
      return Alert.alert('Due date', 'Use a time like 17:30, or leave it empty.')
    }
    const value = dueTime
      ? new Date(`${dueDate}T${dueTime.padStart(5, '0')}`).toISOString()
      : dueDate
    send({ type: messageTypes.cardUpdate, objectId: card.id, dueDate: value })
    setDueOpen(false)
  }
  const quickDue = (days: number) => {
    const date = new Date()
    date.setDate(date.getDate() + days)
    setDueDate(dayString(date))
  }
  const saveBody = () => {
    if (body !== (card.body || '')) {
      send({
        type: messageTypes.cardUpdate,
        objectId: card.id,
        body,
        mentions: findMentions(body, data.profiles)
      })
    }
    setEditingBody(false)
  }
  const addImages = async () => {
    const room = 12 - (card.images?.length || 0)
    if (room <= 0) return Alert.alert('Image limit', 'A card holds up to 12 images.')
    const images = await pickPreparedImages(Math.min(4, room))
    if (!images.length) return
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    pending.current.set(
      requestId,
      images.map((_, i) => `image ${(card.images?.length || 0) + i + 1}`)
    )
    setUploading(true)
    send({
      type: messageTypes.cardImagesAdd,
      objectId: card.id,
      requestId,
      images: images.map(({ data, type, width, height }) => ({ data, type, width, height }))
    })
  }
  const addVideos = async () => {
    if (videoUpload) return
    const room = 12 - (card.images?.length || 0)
    if (room <= 0) {
      return Alert.alert('Attachment limit', 'A card holds up to 12 images and videos.')
    }
    const picked = await pickVideos(Math.min(4, room))
    const files = picked.filter((video) => !video.size || video.size <= MAX_VIDEO_BYTES)
    if (files.length < picked.length) {
      Alert.alert('Video too large', 'Videos can be up to 200 MB.')
    }
    if (!files.length) return
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    videoRequest.current = requestId
    setVideoUpload({ requestId, bytes: 0, total: files[0].size || 0 })
    send({
      type: messageTypes.cardMediaAdd,
      objectId: card.id,
      requestId,
      files: files.map(({ path, name, width, height }) => ({ path, name, width, height }))
    })
  }
  const sendComment = () => {
    const text = comment.trim()
    if (!text) return
    send({
      type: messageTypes.boardComment,
      objectId: card.id,
      text,
      mentions: findMentions(text, data.profiles)
    })
    setComment('')
    stopTyping()
  }
  const react = (emoji: string, on: boolean, commentId?: string) =>
    send({ type: messageTypes.reactionSet, objectId: card.id, emoji, on, commentId })

  return (
    <Modal
      visible
      animationType='slide'
      presentationStyle='pageSheet'
      onRequestClose={props.onClose}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          key={card.id}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps='handled'
        >
          <View style={styles.head}>
            <TextInput
              style={styles.title}
              value={title}
              onChangeText={setTitle}
              onEndEditing={saveTitle}
              multiline
              blurOnSubmit
              returnKeyType='done'
              maxLength={200}
              accessibilityLabel='Card title'
            />
            <Pressable
              onPress={props.onClose}
              hitSlop={10}
              accessibilityRole='button'
              accessibilityLabel='Close'
            >
              <Feather name='x' size={22} color={colors.muted} />
            </Pressable>
          </View>
          <View style={styles.meta}>
            <Avatar
              hex={card.author}
              size={14}
              image={avatarOf(data, card.author)}
              cache={props.cache}
              requestImage={props.requestImage}
            />
            <Text style={styles.metaText}>{props.nameFor(card.author)}</Text>
            <Text style={styles.metaMono}>{props.relativeTime(card.createdAt)}</Text>
            {card.archived ? <Text style={styles.badge}>Archived</Text> : null}
            {card.template ? <Text style={styles.badge}>Template</Text> : null}
            {card.blockedBy?.length && card.columnId !== doneId ? (
              <Text style={[styles.badge, styles.blockedBadge]}>Blocked</Text>
            ) : null}
          </View>
          {viewers.length ? (
            <View style={styles.meta} accessibilityLiveRegion='polite'>
              <AvatarStack
                identities={viewers.map((peer) => peer.identity)}
                data={data}
                size={18}
                max={4}
                cache={props.cache}
                requestImage={props.requestImage}
              />
              <Text style={styles.metaText}>
                {typing.length
                  ? `${typing.map((peer) => peer.name || props.nameFor(peer.identity)).join(', ')} ${typing.length === 1 ? 'is' : 'are'} typing…`
                  : `${viewers.map((peer) => peer.name || props.nameFor(peer.identity)).join(', ')} also viewing`}
              </Text>
            </View>
          ) : null}
          <ReactionBar
            reactions={card.reactions}
            me={me}
            nameFor={props.nameFor}
            onToggle={(emoji, on) => react(emoji, on)}
          />
          {card.template ? (
            <View style={styles.templateNote}>
              <Feather name='copy' size={14} color={colors.info} />
              <Text style={styles.templateText}>
                This card is a template. It stays out of the columns; use “From template…” under a
                column to add a copy.
              </Text>
            </View>
          ) : null}

          <View style={styles.tabs} accessibilityRole='tablist'>
            {(['details', 'activity'] as const).map((name) => (
              <Pressable
                key={name}
                onPress={() => setTab(name)}
                style={[styles.tab, tab === name && styles.tabOn]}
                accessibilityRole='tab'
                accessibilityState={{ selected: tab === name }}
              >
                <Text style={[styles.tabText, tab === name && styles.tabTextOn]}>
                  {name === 'details' ? 'Details' : 'Activity'}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === 'activity' ? (
            <ActivityList
              data={data}
              send={send}
              subscribe={props.subscribe}
              cardId={card.id}
              nameFor={props.nameFor}
              cache={props.cache}
              requestImage={props.requestImage}
            />
          ) : (
            <>
              <Section
                title='Description'
                action={
                  editingBody
                    ? undefined
                    : {
                        label: 'Edit',
                        onPress: () => {
                          setBody(card.body || '')
                          setEditingBody(true)
                        }
                      }
                }
              >
                {editingBody ? (
                  <View style={styles.gap}>
                    <MentionInput
                      style={[styles.input, styles.bodyInput]}
                      value={body}
                      onChangeText={setBody}
                      profiles={data.profiles}
                      me={me}
                      multiline
                      autoFocus
                      placeholder='Add a more detailed description… Markdown and @mentions work.'
                    />
                    <View style={styles.row}>
                      <Button title='Save' onPress={saveBody} grow />
                      <Button
                        title={uploading ? 'Uploading…' : 'Add image'}
                        icon='image'
                        variant='secondary'
                        onPress={addImages}
                      />
                      <Button
                        title='Cancel'
                        variant='ghost'
                        onPress={() => setEditingBody(false)}
                      />
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      setBody(card.body || '')
                      setEditingBody(true)
                    }}
                    style={styles.bodyView}
                  >
                    {card.body?.trim() ? (
                      <Markdown
                        text={card.body}
                        mentions={mentions.filter((m) => card.mentions?.includes(m.identity))}
                        self={me}
                        images={card.images}
                        cache={props.cache}
                        onRequestImage={props.requestImage}
                        onOpenImage={props.openViewer}
                      />
                    ) : (
                      <Text style={styles.placeholder}>Add a more detailed description…</Text>
                    )}
                  </Pressable>
                )}
              </Section>

              <Section title='Column'>
                <ScrollView
                  horizontal
                  contentContainerStyle={styles.chips}
                  showsHorizontalScrollIndicator={false}
                >
                  {data.columns.map((entry) => (
                    <Chip
                      key={entry.id}
                      label={entry.name}
                      selected={entry.id === card.columnId}
                      color={entry.color}
                      onPress={(event) => {
                        if (entry.id === card.columnId) return
                        lastTap.current = event
                          ? { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }
                          : null
                        move(entry.id, Infinity)
                      }}
                    />
                  ))}
                </ScrollView>
                <View style={styles.row}>
                  <SmallButton
                    icon='arrow-up'
                    label='Move up'
                    disabled={index <= 0}
                    onPress={() => move(card.columnId, index - 1)}
                  />
                  <SmallButton
                    icon='arrow-down'
                    label='Move down'
                    disabled={index < 0 || index >= columnCards.length - 1}
                    onPress={() => move(card.columnId, index + 1)}
                  />
                  <Text style={styles.metaMono}>
                    {index + 1} of {columnCards.length} in {column?.name || 'column'}
                  </Text>
                </View>
              </Section>

              <Section
                title={
                  card.assignees?.length ? `Assignees (${card.assignees.length})` : 'Assignees'
                }
              >
                <AssigneePicker
                  card={card}
                  data={data}
                  me={me}
                  send={send}
                  nameFor={props.nameFor}
                  cache={props.cache}
                  requestImage={props.requestImage}
                />
              </Section>

              <Section title='Labels' action={{ label: 'Manage', onPress: props.onManageLabels }}>
                <View style={styles.chipsWrap}>
                  {data.labels.map((label) => {
                    const on = labelIds.includes(label.id)
                    return (
                      <Chip
                        key={label.id}
                        label={`${on ? '✓ ' : ''}${label.name || 'Unnamed'}`}
                        color={label.color || '#8590a2'}
                        filled={on}
                        selected={on}
                        onPress={() =>
                          setLabels(
                            on ? labelIds.filter((id) => id !== label.id) : [...labelIds, label.id]
                          )
                        }
                      />
                    )
                  })}
                  <TextInput
                    style={styles.newLabel}
                    value={newLabel}
                    onChangeText={setNewLabel}
                    onSubmitEditing={addLabel}
                    placeholder='+ New label'
                    placeholderTextColor={colors.muted}
                    maxLength={40}
                    returnKeyType='done'
                    accessibilityLabel='New label: type a name and press done'
                  />
                </View>
              </Section>

              <Section title='Due date'>
                {!dueOpen ? (
                  <PressableScale
                    style={[
                      styles.dueButton,
                      due && styles.dueSet,
                      due?.status && styles[due.status]
                    ]}
                    onPress={openDue}
                    accessibilityRole='button'
                  >
                    <Feather
                      name={due ? 'clock' : 'plus'}
                      size={14}
                      color={
                        due?.status === 'overdue'
                          ? '#f87168'
                          : due?.status === 'soon'
                            ? '#f5cd47'
                            : colors.muted
                      }
                    />
                    <Text
                      style={[
                        styles.dueText,
                        due?.status === 'overdue' && styles.overdueText,
                        due?.status === 'soon' && styles.soonText
                      ]}
                    >
                      {due
                        ? `${due.text}${due.status === 'overdue' ? ' · overdue' : due.status === 'soon' ? ' · due soon' : ''}`
                        : 'Add due date'}
                    </Text>
                  </PressableScale>
                ) : (
                  <View style={styles.duePanel}>
                    <View style={styles.chipsWrap}>
                      <Chip label='Today' onPress={() => quickDue(0)} />
                      <Chip label='Tomorrow' onPress={() => quickDue(1)} />
                      <Chip label='In 3 days' onPress={() => quickDue(3)} />
                      <Chip label='Next week' onPress={() => quickDue(7)} />
                    </View>
                    <View style={styles.row}>
                      <TextInput
                        style={[styles.input, styles.flex]}
                        value={dueDate}
                        onChangeText={setDueDate}
                        placeholder='YYYY-MM-DD'
                        placeholderTextColor={colors.muted}
                        autoCapitalize='none'
                        accessibilityLabel='Due date'
                      />
                      <TextInput
                        style={[styles.input, styles.timeInput]}
                        value={dueTime}
                        onChangeText={setDueTime}
                        placeholder='HH:MM'
                        placeholderTextColor={colors.muted}
                        keyboardType='numbers-and-punctuation'
                        accessibilityLabel='Due time (optional)'
                      />
                    </View>
                    <Text style={styles.hint}>
                      The time is optional; without one the card is due at the end of the day.
                    </Text>
                    <View style={styles.row}>
                      <Button title='Save' onPress={saveDue} grow />
                      {due ? (
                        <Button
                          title='Remove'
                          variant='secondary'
                          onPress={() => {
                            send({
                              type: messageTypes.cardUpdate,
                              objectId: card.id,
                              dueDate: null
                            })
                            setDueOpen(false)
                          }}
                        />
                      ) : null}
                      <Button title='Cancel' variant='ghost' onPress={() => setDueOpen(false)} />
                    </View>
                  </View>
                )}
              </Section>

              <Section
                title={
                  checklist.total ? `Checklist ${checklist.done}/${checklist.total}` : 'Checklist'
                }
              >
                <ChecklistEditor card={card} send={send} />
              </Section>

              <Section title='Estimate'>
                <EstimatePanel
                  card={card}
                  data={data}
                  me={me}
                  send={send}
                  nameFor={props.nameFor}
                  cache={props.cache}
                  requestImage={props.requestImage}
                />
              </Section>

              <Section title='Links'>
                <LinksEditor card={card} data={data} send={send} onOpen={props.onOpenCard} />
              </Section>

              {images.length ? (
                <Section title={`Images (${images.length})`}>
                  <BoardImages
                    images={images}
                    cache={props.cache}
                    onRequest={props.requestImage}
                    onRetry={props.retryImage}
                    onOpen={props.openViewer}
                  />
                </Section>
              ) : null}

              <Section title={videos.length ? `Videos (${videos.length})` : 'Videos'}>
                {videos.length ? (
                  <VideoTiles videos={videos} send={send} subscribe={props.subscribe} />
                ) : null}
                {videoUpload ? (
                  <View style={styles.uploading} accessibilityRole='progressbar'>
                    <Text style={styles.metaMono}>
                      Uploading video
                      {videoUpload.total
                        ? ` · ${Math.min(100, Math.round((videoUpload.bytes / videoUpload.total) * 100))}%`
                        : '…'}
                    </Text>
                    <View style={styles.track}>
                      <View
                        style={[
                          styles.bar,
                          {
                            width: `${videoUpload.total ? Math.min(100, (videoUpload.bytes / videoUpload.total) * 100) : 0}%`
                          }
                        ]}
                      />
                    </View>
                  </View>
                ) : (
                  <Button
                    title='Add video'
                    icon='film'
                    variant='secondary'
                    onPress={() => void addVideos()}
                  />
                )}
                <Text style={styles.hint}>MP4, MOV or WebM, up to 200 MB.</Text>
              </Section>

              <Section title='Comments'>
                <View style={styles.voteRow}>
                  <VoteButton
                    icon='chevron-up'
                    active={ownVote === 1}
                    color={colors.accent}
                    label='Upvote'
                    onPress={() =>
                      send({
                        type: messageTypes.boardVote,
                        objectId: card.id,
                        value: ownVote ? 0 : 1
                      })
                    }
                  />
                  <Text style={styles.score}>{scoreOf(card)}</Text>
                  <VoteButton
                    icon='chevron-down'
                    active={ownVote === -1}
                    color={colors.magenta}
                    label='Downvote'
                    onPress={() =>
                      send({
                        type: messageTypes.boardVote,
                        objectId: card.id,
                        value: ownVote ? 0 : -1
                      })
                    }
                  />
                </View>
                {hidden ? (
                  <Pressable onPress={() => setShowAll(true)} accessibilityRole='button'>
                    <Text style={styles.link}>
                      Show {hidden} earlier {hidden === 1 ? 'comment' : 'comments'}
                    </Text>
                  </Pressable>
                ) : null}
                {comments.slice(hidden).map((entry) => (
                  <View key={entry.id} style={styles.comment}>
                    <View style={styles.meta}>
                      <Avatar
                        hex={entry.author}
                        size={12}
                        image={avatarOf(data, entry.author)}
                        cache={props.cache}
                        requestImage={props.requestImage}
                      />
                      <Text style={styles.commentAuthor}>{props.nameFor(entry.author)}</Text>
                      <Text style={styles.metaMono}>{props.relativeTime(entry.createdAt)}</Text>
                    </View>
                    <Markdown
                      text={entry.text}
                      mentions={mentions.filter((m) => entry.mentions?.includes(m.identity))}
                      self={me}
                    />
                    <ReactionBar
                      reactions={entry.reactions}
                      me={me}
                      nameFor={props.nameFor}
                      compact
                      onToggle={(emoji, on) => react(emoji, on, entry.id)}
                    />
                  </View>
                ))}
                <TypingLine
                  names={typing.map((peer) => peer.name || props.nameFor(peer.identity))}
                />
                <MentionInput
                  style={styles.input}
                  value={comment}
                  onChangeText={onCommentChange}
                  profiles={data.profiles}
                  me={me}
                  placeholder='Add a comment'
                  onSubmitEditing={sendComment}
                  returnKeyType='send'
                />
                <Button title='Comment' icon='send' onPress={sendComment} />
              </Section>

              <View style={styles.toggleRow}>
                <View style={styles.flex}>
                  <Text style={styles.toggleText}>Save as template</Text>
                  <Text style={styles.hint}>
                    Templates are hidden from the columns and offered under “From template…”.
                  </Text>
                </View>
                <Switch
                  value={!!card.template}
                  onValueChange={(template) =>
                    send({ type: messageTypes.cardUpdate, objectId: card.id, template })
                  }
                  trackColor={{ true: colors.accent, false: colors.border }}
                  accessibilityLabel='Save as template'
                />
              </View>

              <Button
                title={card.archived ? 'Restore card' : 'Archive card'}
                icon={card.archived ? 'rotate-ccw' : 'archive'}
                variant='secondary'
                onPress={() => {
                  send({
                    type: messageTypes.cardArchive,
                    objectId: card.id,
                    archived: !card.archived
                  })
                  if (!card.archived) props.onClose()
                }}
              />
            </>
          )}
        </ScrollView>
        {celebrating ? <Confetti origin={celebrating} onDone={() => setCelebrating(null)} /> : null}
      </KeyboardAvoidingView>
    </Modal>
  )
}

// Who is typing a comment. The line always holds its height, so the input
// below never jumps, and fades rather than pops; the names stay while fading out.
function TypingLine({ names }: { names: string[] }) {
  const opacity = useRef(new Animated.Value(names.length ? 1 : 0)).current
  const shown = useRef(names)
  if (names.length) shown.current = names
  useEffect(() => {
    const target = names.length ? 1 : 0
    if (reduceMotion) return opacity.setValue(target)
    Animated.timing(opacity, {
      toValue: target,
      duration: 150,
      easing: easeOut,
      useNativeDriver: true
    }).start()
  }, [names.length > 0])
  const list = shown.current
  return (
    <Animated.Text
      style={[styles.hint, styles.typing, { opacity }]}
      numberOfLines={1}
      accessibilityLiveRegion='polite'
      accessibilityElementsHidden={!names.length}
    >
      {list.length ? `${list.join(', ')} ${list.length === 1 ? 'is' : 'are'} typing…` : ''}
    </Animated.Text>
  )
}

function Section({
  title,
  action,
  children
}: {
  title: string
  action?: { label: string; onPress: () => void }
  children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>{title}</Text>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole='button'>
            <Text style={styles.link}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  )
}

export function Chip({
  label,
  onPress,
  selected,
  color,
  filled
}: {
  label: string
  onPress?: (event?: GestureResponderEvent) => void
  selected?: boolean
  color?: string | null
  filled?: boolean
}) {
  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.chip,
        color && { borderColor: color },
        selected && !color && styles.chipSelected,
        filled && color && { backgroundColor: color }
      ]}
      accessibilityRole='button'
      accessibilityState={{ selected: !!selected }}
    >
      <Text
        style={[
          styles.chipText,
          filled && styles.chipTextFilled,
          selected && !color && styles.chipTextSelected
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </PressableScale>
  )
}

function SmallButton({
  icon,
  label,
  onPress,
  disabled
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={[styles.smallButton, disabled && styles.disabled]}
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Feather name={icon} size={16} color={colors.text} />
    </PressableScale>
  )
}

function VoteButton({
  icon,
  active,
  color,
  label,
  onPress
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  active: boolean
  color: string
  label: string
  onPress: () => void
}) {
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={8}
      style={[styles.smallButton, active && { backgroundColor: color, borderColor: color }]}
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Feather name={icon} size={18} color={active ? colors.onAccent : colors.muted} />
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
    // Android modals are full screen and draw under the status bar.
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0
  },
  flex: { flex: 1 },
  gap: { gap: 8 },
  content: { padding: 20, paddingBottom: 60, gap: 18 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { flex: 1, color: colors.text, fontSize: 21, fontWeight: '700', padding: 0 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaText: { color: colors.muted, fontSize: 13 },
  metaMono: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  badge: {
    color: colors.muted,
    fontFamily: mono,
    fontSize: 11,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 1
  },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: {
    color: colors.muted,
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase'
  },
  link: { color: colors.info, fontWeight: '600', fontSize: 14 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  chips: { gap: 6 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: {
    maxWidth: 220,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'transparent'
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  chipTextFilled: { color: '#0b0f14' },
  chipTextSelected: { color: colors.onAccent },
  newLabel: {
    minWidth: 120,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    color: colors.text,
    fontSize: 13
  },
  smallButton: {
    width: 38,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  disabled: { opacity: 0.35 },
  dueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border
  },
  dueSet: { borderStyle: 'solid' },
  soon: { borderColor: 'rgba(245, 205, 71, 0.5)' },
  overdue: { borderColor: 'rgba(248, 113, 104, 0.5)' },
  dueText: { color: colors.text, fontFamily: mono, fontSize: 13 },
  soonText: { color: '#f5cd47' },
  overdueText: { color: '#f87168' },
  duePanel: {
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 44,
    color: colors.text
  },
  timeInput: { width: 96 },
  hint: { color: colors.muted, fontSize: 12 },
  bodyInput: { minHeight: 140, textAlignVertical: 'top' },
  bodyView: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
    minHeight: 44
  },
  placeholder: { color: colors.muted },
  voteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  score: {
    color: colors.text,
    fontFamily: mono,
    fontSize: 16,
    fontWeight: '700',
    minWidth: 24,
    textAlign: 'center'
  },
  uploading: { gap: 6 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  bar: { height: 6, backgroundColor: colors.accent },
  comment: { gap: 6, borderLeftColor: colors.border, borderLeftWidth: 2, paddingLeft: 10 },
  blockedBadge: { color: '#f87168', borderColor: 'rgba(248, 113, 104, 0.5)' },
  templateNote: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.4)',
    backgroundColor: 'rgba(34, 211, 238, 0.08)'
  },
  templateText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  tabs: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border
  },
  tab: { flex: 1, minHeight: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.surfaceRaised },
  tabText: { color: colors.muted, fontWeight: '600' },
  tabTextOn: { color: colors.text },
  typing: { minHeight: 18 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  toggleText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  commentAuthor: { color: colors.text, fontWeight: '700', fontSize: 13 }
})
