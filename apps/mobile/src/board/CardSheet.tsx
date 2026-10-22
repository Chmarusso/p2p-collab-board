// Card details: everything the desktop dialog has, laid out for a phone.
// Built from the live card on every board-state, so other members' edits show
// up while it's open; drafts being typed are kept.
import React, { useEffect, useRef, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { messageTypes } from '@opencollab/board-protocol'
import {
  BoardImages,
  Button,
  CachedImage,
  Identicon,
  ImageRef,
  colors,
  mono,
  pickPreparedImages
} from '../ui'
import { Markdown, Mention } from './Markdown'
import { MentionInput } from './MentionInput'
import {
  BoardData,
  COMMENTS_SHOWN,
  Card,
  LABEL_COLORS,
  dayString,
  dueInfo,
  findMentions,
  newLabelId,
  pad,
  scoreOf,
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
}

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

  if (!card) return null
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

  const move = (columnId: string, visibleIndex: number) => {
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
  }

  return (
    <Modal
      visible
      animationType='slide'
      presentationStyle='pageSheet'
      onRequestClose={props.onClose}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
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
            <Identicon hex={card.author} size={14} />
            <Text style={styles.metaText}>{props.nameFor(card.author)}</Text>
            <Text style={styles.metaMono}>{props.relativeTime(card.createdAt)}</Text>
            {card.archived ? <Text style={styles.badge}>Archived</Text> : null}
          </View>

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
                  onPress={() => entry.id !== card.columnId && move(entry.id, Infinity)}
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
              <Pressable
                style={({ pressed }) => [
                  styles.dueButton,
                  due && styles.dueSet,
                  due?.status && styles[due.status],
                  pressed && styles.pressed
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
              </Pressable>
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
                        send({ type: messageTypes.cardUpdate, objectId: card.id, dueDate: null })
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
                  <Button title='Cancel' variant='ghost' onPress={() => setEditingBody(false)} />
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

          {card.images?.length ? (
            <Section title={`Images (${card.images.length})`}>
              <BoardImages
                images={card.images}
                cache={props.cache}
                onRequest={props.requestImage}
                onRetry={props.retryImage}
                onOpen={props.openViewer}
              />
            </Section>
          ) : null}

          <Section title='Comments'>
            <View style={styles.voteRow}>
              <VoteButton
                icon='chevron-up'
                active={ownVote === 1}
                color={colors.accent}
                label='Upvote'
                onPress={() =>
                  send({ type: messageTypes.boardVote, objectId: card.id, value: ownVote ? 0 : 1 })
                }
              />
              <Text style={styles.score}>{scoreOf(card)}</Text>
              <VoteButton
                icon='chevron-down'
                active={ownVote === -1}
                color={colors.magenta}
                label='Downvote'
                onPress={() =>
                  send({ type: messageTypes.boardVote, objectId: card.id, value: ownVote ? 0 : -1 })
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
                  <Identicon hex={entry.author} size={12} />
                  <Text style={styles.commentAuthor}>{props.nameFor(entry.author)}</Text>
                  <Text style={styles.metaMono}>{props.relativeTime(entry.createdAt)}</Text>
                </View>
                <Markdown
                  text={entry.text}
                  mentions={mentions.filter((m) => entry.mentions?.includes(m.identity))}
                  self={me}
                />
              </View>
            ))}
            <MentionInput
              style={styles.input}
              value={comment}
              onChangeText={setComment}
              profiles={data.profiles}
              me={me}
              placeholder='Add a comment'
              onSubmitEditing={sendComment}
              returnKeyType='send'
            />
            <Button title='Comment' icon='send' onPress={sendComment} />
          </Section>

          <Button
            title={card.archived ? 'Restore card' : 'Archive card'}
            icon={card.archived ? 'rotate-ccw' : 'archive'}
            variant='secondary'
            onPress={() => {
              send({ type: messageTypes.cardArchive, objectId: card.id, archived: !card.archived })
              if (!card.archived) props.onClose()
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
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
  onPress?: () => void
  selected?: boolean
  color?: string | null
  filled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        color && { borderColor: color },
        selected && !color && styles.chipSelected,
        filled && color && { backgroundColor: color },
        pressed && styles.pressed
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
    </Pressable>
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
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.smallButton,
        disabled && styles.disabled,
        pressed && styles.pressed
      ]}
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Feather name={icon} size={16} color={colors.text} />
    </Pressable>
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
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.smallButton,
        active && { backgroundColor: color, borderColor: color },
        pressed && styles.pressed
      ]}
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Feather name={icon} size={18} color={active ? colors.onAccent : colors.muted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
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
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
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
  comment: { gap: 4, borderLeftColor: colors.border, borderLeftWidth: 2, paddingLeft: 10 },
  commentAuthor: { color: colors.text, fontWeight: '700', fontSize: 13 }
})
