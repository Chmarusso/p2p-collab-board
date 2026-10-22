// The Kanban board on a phone: columns side by side, one screen wide each,
// swiped horizontally. Cards open a full sheet; board settings live in sheets
// reached from the toolbar.
import React, { useEffect, useMemo, useState } from 'react'
import {
  Dimensions,
  Image,
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
import { Button, CachedImage, FadeIn, Identicon, ImageRef, colors, imageKey, mono } from '../ui'
import { CardSheet } from './CardSheet'
import { Markdown } from './Markdown'
import {
  ColumnSheet,
  FilterSheet,
  LabelsSheet,
  NotificationsSheet,
  Sheet,
  ThemeSheet
} from './Panels'
import {
  AlertBoard,
  BoardAlert,
  BoardData,
  Card,
  Column,
  Filters,
  MAX_LABELS_ON_CARD,
  backgroundColor,
  dueInfo,
  filterCount,
  inkOn,
  matchesFilters,
  scoreOf
} from './model'

type WorkerMessage = { type: string; [key: string]: any }

type Props = {
  data: BoardData
  me: string
  displayName: string
  boardName: string
  boardKey: string
  synced: boolean
  statusChip: React.ReactNode
  loading: React.ReactNode
  send: (message: object) => void
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  retryImage: (ref: ImageRef) => void
  openViewer: (uri: string) => void
  openProfile: () => void
  onNewCard: (columnId: string) => void
  onLocalMove: () => void
  alertBoards: AlertBoard[]
  unreadCount: number
  isRead: (board: AlertBoard, alert: BoardAlert) => boolean
  markRead: (predicate: (board: AlertBoard, alert: BoardAlert) => boolean) => void
  onOpenAlert: (board: AlertBoard, alert: BoardAlert) => void
  openCardRequest: { cardId: string; nonce: number } | null
  subscribe: (listener: (message: WorkerMessage) => void) => () => void
  nameFor: (identity: string) => string
  shortKey: (hex: string) => string
  relativeTime: (iso?: string) => string
}

const screenWidth = Dimensions.get('window').width
const COLUMN_WIDTH = Math.min(340, screenWidth - 48)
const COLUMN_GAP = 12

type SheetName = 'labels' | 'theme' | 'filter' | 'notifications' | 'description' | null

export function BoardScreen(props: Props) {
  const { data, send, me } = props
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetName>(null)
  const [columnMenu, setColumnMenu] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>({ labels: [], member: '', due: '' })
  const [showArchived, setShowArchived] = useState(false)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [columnDraft, setColumnDraft] = useState('')

  // A different board starts clean.
  useEffect(() => {
    setOpenCardId(null)
    setSheet(null)
    setFilters({ labels: [], member: '', due: '' })
    setShowArchived(false)
    setDescriptionOpen(false)
  }, [props.boardKey])
  // A notification asked for a card (possibly after switching boards).
  useEffect(() => {
    if (props.openCardRequest) {
      setSheet(null)
      setOpenCardId(props.openCardRequest.cardId)
    }
  }, [props.openCardRequest?.nonce])
  // Opening a card reads its alerts on this board.
  useEffect(() => {
    if (openCardId) {
      props.markRead((board, alert) => board.key === props.boardKey && alert.cardId === openCardId)
    }
  }, [openCardId, props.alertBoards])

  // Debug builds only, for scripted checks; see App.tsx.
  useEffect(() => {
    if (!(globalThis as { __DEV__?: boolean }).__DEV__) return
    ;(globalThis as Record<string, unknown>).__board = {
      openCard: setOpenCardId,
      setSheet,
      setFilters,
      setShowArchived,
      openColumn: setColumnMenu,
      openDescription: () => setDescriptionOpen(true)
    }
  })

  const visible = (columnId: string) =>
    data.objects.filter(
      (card) =>
        card.columnId === columnId &&
        (showArchived || !card.archived) &&
        matchesFilters(card, filters)
    )
  const archivedCount = data.objects.filter((card) => card.archived).length
  const activeFilters = filterCount(filters)
  const unreadMentionCards = useMemo(
    () =>
      new Set(
        props.alertBoards
          .filter((board) => board.key === props.boardKey)
          .flatMap((board) =>
            board.alerts.filter((alert) => alert.kind === 'mention' && !props.isRead(board, alert))
          )
          .map((alert) => alert.cardId)
      ),
    [props.alertBoards, props.boardKey, props.isRead]
  )
  const background = backgroundColor(data.theme)
  const accent = data.theme.accent || colors.accent
  const ink = background ? inkOn(background) : colors.text
  const openCard = data.objects.find((card) => card.id === openCardId) || null
  const menuColumnIndex = data.columns.findIndex((column) => column.id === columnMenu)

  const addCard = (columnId: string) => {
    const title = (drafts[columnId] || '').trim()
    if (!title) return
    send({ type: messageTypes.boardCreate, title, body: '', columnId })
    setDrafts((current) => ({ ...current, [columnId]: '' }))
  }
  const addColumn = () => {
    const name = columnDraft.trim()
    if (!name) return
    send({ type: messageTypes.columnCreate, name })
    setColumnDraft('')
  }

  return (
    <View style={[styles.root, background ? { backgroundColor: background } : null]}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps='handled'>
        <View style={styles.header}>
          <Text style={[styles.title, { color: ink }]} numberOfLines={2}>
            {props.boardName || 'OpenCollab'}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.bell,
              props.unreadCount > 0 && { borderColor: accent },
              pressed && styles.pressed
            ]}
            onPress={() => setSheet('notifications')}
            accessibilityRole='button'
            accessibilityLabel={`Notifications, ${props.unreadCount} unread`}
          >
            <Feather name='bell' size={18} color={props.unreadCount ? accent : colors.muted} />
            {props.unreadCount ? (
              <Text style={[styles.bellCount, { color: accent }]}>
                {props.unreadCount > 99 ? '99+' : props.unreadCount}
              </Text>
            ) : null}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.user, pressed && styles.pressed]}
            onPress={props.openProfile}
            accessibilityRole='button'
            accessibilityLabel='Open profile and connection details'
          >
            <Identicon hex={me} size={22} />
            <Text style={[styles.userName, { color: accent }]} numberOfLines={1}>
              @{props.displayName}
            </Text>
          </Pressable>
        </View>

        {data.info.description ? (
          <Pressable
            style={styles.description}
            onPress={() => setDescriptionOpen(true)}
            accessibilityRole='button'
            accessibilityLabel='Board description'
          >
            <Markdown text={data.info.description} numberOfLines={2} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              setDescriptionDraft('')
              setSheet('description')
            }}
            accessibilityRole='button'
          >
            <Text style={styles.addDescription}>+ Add a board description</Text>
          </Pressable>
        )}
        {props.statusChip}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.toolbar}
        >
          <ToolButton icon='tag' label='Labels' onPress={() => setSheet('labels')} />
          <ToolButton icon='droplet' label='Customize' onPress={() => setSheet('theme')} />
          <ToolButton
            icon='filter'
            label={activeFilters ? `Filter (${activeFilters})` : 'Filter'}
            active={activeFilters > 0}
            accent={accent}
            onPress={() => setSheet('filter')}
          />
          {archivedCount || showArchived ? (
            <ToolButton
              icon='archive'
              label={`${showArchived ? 'Hide' : 'Show'} archived (${archivedCount})`}
              active={showArchived}
              accent={accent}
              onPress={() => setShowArchived(!showArchived)}
            />
          ) : null}
        </ScrollView>

        {!props.synced ? (
          props.loading
        ) : (
          <ScrollView
            horizontal
            snapToInterval={COLUMN_WIDTH + COLUMN_GAP}
            decelerationRate='fast'
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.columns}
            keyboardShouldPersistTaps='handled'
          >
            {data.columns.map((column) => {
              const cards = visible(column.id)
              return (
                <View
                  key={column.id}
                  style={[styles.column, column.color ? { borderTopColor: column.color } : null]}
                  accessibilityLabel={`${column.name}, ${cards.length} cards`}
                >
                  <View style={styles.columnHead}>
                    <Text style={styles.columnName} numberOfLines={1}>
                      {column.name}
                    </Text>
                    <Text style={styles.columnCount}>{cards.length}</Text>
                    <Pressable
                      onPress={() => setColumnMenu(column.id)}
                      hitSlop={10}
                      accessibilityRole='button'
                      accessibilityLabel={`Column options for ${column.name}`}
                    >
                      <Feather name='more-horizontal' size={18} color={colors.muted} />
                    </Pressable>
                  </View>
                  {cards.length ? null : <Text style={styles.noCards}>No cards</Text>}
                  {cards.map((card) => (
                    <FadeIn key={card.id}>
                      <CardFace
                        card={card}
                        data={data}
                        cache={props.cache}
                        requestImage={props.requestImage}
                        mentioned={unreadMentionCards.has(card.id)}
                        onPress={() => setOpenCardId(card.id)}
                      />
                    </FadeIn>
                  ))}
                  <View style={styles.addRow}>
                    <TextInput
                      style={styles.addInput}
                      value={drafts[column.id] || ''}
                      onChangeText={(value) =>
                        setDrafts((current) => ({ ...current, [column.id]: value }))
                      }
                      onSubmitEditing={() => addCard(column.id)}
                      placeholder='+ Add a card'
                      placeholderTextColor={colors.muted}
                      returnKeyType='done'
                      blurOnSubmit={false}
                      accessibilityLabel={`Add a card to ${column.name}`}
                    />
                    <Pressable
                      onPress={() => props.onNewCard(column.id)}
                      hitSlop={8}
                      style={styles.addMore}
                      accessibilityRole='button'
                      accessibilityLabel='New card with description and images'
                    >
                      <Feather name='image' size={16} color={colors.muted} />
                    </Pressable>
                  </View>
                </View>
              )
            })}
            <View style={[styles.column, styles.addColumn]}>
              <Text style={styles.columnName}>Add a column</Text>
              <TextInput
                style={styles.addInput}
                value={columnDraft}
                onChangeText={setColumnDraft}
                onSubmitEditing={addColumn}
                placeholder='Column name'
                placeholderTextColor={colors.muted}
                maxLength={60}
                returnKeyType='done'
              />
              <Button title='Add column' icon='plus' variant='secondary' onPress={addColumn} />
            </View>
          </ScrollView>
        )}
      </ScrollView>

      {openCard ? (
        <CardSheet
          card={openCard}
          data={data}
          me={me}
          send={send}
          cache={props.cache}
          requestImage={props.requestImage}
          retryImage={props.retryImage}
          openViewer={props.openViewer}
          onClose={() => setOpenCardId(null)}
          onManageLabels={() => {
            setOpenCardId(null)
            setSheet('labels')
          }}
          onLocalMove={props.onLocalMove}
          subscribe={props.subscribe}
          nameFor={props.nameFor}
          relativeTime={props.relativeTime}
        />
      ) : null}
      {sheet === 'labels' ? (
        <LabelsSheet data={data} send={send} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'theme' ? (
        <ThemeSheet data={data} send={send} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'filter' ? (
        <FilterSheet
          data={data}
          filters={filters}
          me={me}
          setFilters={setFilters}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'notifications' ? (
        <NotificationsSheet
          boards={props.alertBoards}
          isRead={props.isRead}
          currentKey={props.boardKey}
          onOpen={(board, alert) => {
            setSheet(null)
            props.onOpenAlert(board, alert)
          }}
          onReadAll={() => props.markRead(() => true)}
          onClose={() => setSheet(null)}
          shortKey={props.shortKey}
          relativeTime={props.relativeTime}
        />
      ) : null}
      {sheet === 'description' ? (
        <Sheet title='Board description' onClose={() => setSheet(null)}>
          <TextInput
            style={styles.descriptionInput}
            value={descriptionDraft}
            onChangeText={setDescriptionDraft}
            multiline
            autoFocus
            maxLength={2000}
            placeholder='What is this board for? Markdown works.'
            placeholderTextColor={colors.muted}
          />
          <Text style={styles.hint}>Everyone on the board sees it.</Text>
          <Button
            title='Save'
            onPress={() => {
              send({ type: messageTypes.boardDescribe, description: descriptionDraft })
              setSheet(null)
            }}
          />
        </Sheet>
      ) : null}
      {descriptionOpen ? (
        <Modal
          visible
          transparent
          animationType='fade'
          onRequestClose={() => setDescriptionOpen(false)}
        >
          <Pressable style={styles.backdrop} onPress={() => setDescriptionOpen(false)}>
            <Pressable style={styles.descriptionCard} onPress={(event) => event.stopPropagation()}>
              <ScrollView style={styles.descriptionScroll}>
                <Markdown text={data.info.description} />
              </ScrollView>
              <View style={styles.row}>
                <Button
                  title='Edit'
                  icon='edit-2'
                  variant='secondary'
                  onPress={() => {
                    setDescriptionOpen(false)
                    setDescriptionDraft(data.info.description)
                    setSheet('description')
                  }}
                />
                <Button title='Close' grow onPress={() => setDescriptionOpen(false)} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
      {columnMenu && menuColumnIndex >= 0 ? (
        <ColumnSheet
          column={data.columns[menuColumnIndex] as Column}
          index={menuColumnIndex}
          count={data.columns.length}
          send={send}
          onLocalMove={props.onLocalMove}
          onClose={() => setColumnMenu(null)}
        />
      ) : null}
    </View>
  )
}

function CardFace({
  card,
  data,
  cache,
  requestImage,
  mentioned,
  onPress
}: {
  card: Card
  data: BoardData
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  mentioned: boolean
  onPress: () => void
}) {
  const cover = card.images?.[0]
  const cached = cover ? cache[imageKey(cover)] : undefined
  useEffect(() => {
    if (cover && !cached) requestImage(cover)
  }, [cover && imageKey(cover), !!cached])
  const labels = (card.labelIds || [])
    .map((id) => data.labels.find((label) => label.id === id))
    .filter((label): label is NonNullable<typeof label> => !!label)
  const due = dueInfo(card.dueDate)
  const score = scoreOf(card)
  const votes = Object.keys(card.votes || {}).length
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        card.archived && styles.archived,
        pressed && styles.cardPressed
      ]}
      accessibilityRole='button'
      accessibilityLabel={card.title}
    >
      {cover ? (
        <View style={styles.cover}>
          {cached?.uri ? <Image source={{ uri: cached.uri }} style={styles.fill} /> : null}
        </View>
      ) : null}
      {labels.length ? (
        <View style={styles.labels}>
          {labels.slice(0, MAX_LABELS_ON_CARD).map((label) => (
            <Text
              key={label.id}
              style={[styles.label, { backgroundColor: label.color || '#8590a2' }]}
              numberOfLines={1}
            >
              {label.name}
            </Text>
          ))}
          {labels.length > MAX_LABELS_ON_CARD ? (
            <Text style={[styles.label, styles.labelMore]}>
              +{labels.length - MAX_LABELS_ON_CARD}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text style={styles.cardTitle} numberOfLines={4}>
        {card.title}
      </Text>
      <View style={styles.cardMeta}>
        {due ? (
          <View
            style={[
              styles.due,
              due.status === 'overdue' && styles.dueOverdue,
              due.status === 'soon' && styles.dueSoon
            ]}
          >
            <Feather
              name='clock'
              size={11}
              color={
                due.status === 'overdue'
                  ? '#f87168'
                  : due.status === 'soon'
                    ? '#f5cd47'
                    : colors.muted
              }
            />
            <Text
              style={[
                styles.metaMono,
                due.status === 'overdue' && styles.overdueText,
                due.status === 'soon' && styles.soonText
              ]}
            >
              {due.text}
            </Text>
          </View>
        ) : null}
        {votes ? (
          <Meta icon={score < 0 ? 'chevron-down' : 'chevron-up'} text={String(score)} />
        ) : null}
        {card.body?.trim() ? <Meta icon='align-left' /> : null}
        {card.comments?.length ? (
          <Meta icon='message-square' text={String(card.comments.length)} />
        ) : null}
        {card.images?.length ? <Meta icon='image' text={String(card.images.length)} /> : null}
        {mentioned ? <Text style={styles.mentioned}>@</Text> : null}
        {card.archived ? <Text style={styles.metaMono}>archived</Text> : null}
      </View>
    </Pressable>
  )
}

function Meta({
  icon,
  text
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  text?: string
}) {
  return (
    <View style={styles.metaItem}>
      <Feather name={icon} size={12} color={colors.muted} />
      {text ? <Text style={styles.metaMono}>{text}</Text> : null}
    </View>
  )
}

function ToolButton({
  icon,
  label,
  onPress,
  active,
  accent
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  onPress: () => void
  active?: boolean
  accent?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        active && accent ? { borderColor: accent } : null,
        pressed && styles.pressed
      ]}
      accessibilityRole='button'
      accessibilityState={{ selected: !!active }}
    >
      <Feather name={icon} size={14} color={active && accent ? accent : colors.text} />
      <Text style={[styles.toolText, active && accent ? { color: accent } : null]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { width: '100%', height: '100%' },
  page: { paddingTop: 64, paddingBottom: 120, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  title: { flex: 1, fontSize: 26, fontWeight: '700', color: colors.text },
  bell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  bellCount: { fontFamily: mono, fontSize: 12, fontWeight: '700' },
  user: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 130,
    paddingLeft: 5,
    paddingRight: 10,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  userName: { fontWeight: '700', fontSize: 13, flexShrink: 1 },
  addDescription: { color: colors.muted, paddingHorizontal: 16 },
  description: { paddingHorizontal: 16 },
  toolbar: { gap: 8, paddingHorizontal: 16 },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  toolText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  columns: { paddingHorizontal: 16, gap: COLUMN_GAP, alignItems: 'flex-start' },
  column: {
    width: COLUMN_WIDTH,
    gap: 8,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  addColumn: { borderStyle: 'dashed' },
  columnHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
    paddingVertical: 2
  },
  columnName: { flex: 1, color: colors.text, fontWeight: '700', fontSize: 15 },
  columnCount: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  noCards: {
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    fontSize: 13
  },
  card: {
    gap: 6,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden'
  },
  cardPressed: { transform: [{ scale: 0.98 }] },
  archived: { opacity: 0.55, borderStyle: 'dashed' },
  cover: {
    height: 120,
    marginTop: -12,
    marginHorizontal: -12,
    marginBottom: 2,
    backgroundColor: colors.surface
  },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  label: {
    maxWidth: '100%',
    overflow: 'hidden',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontSize: 11,
    fontWeight: '700',
    color: '#0b0f14'
  },
  labelMore: { backgroundColor: '#8590a2' },
  cardTitle: { color: colors.text, fontWeight: '600', fontSize: 15, lineHeight: 20 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaMono: { color: colors.muted, fontFamily: mono, fontSize: 11 },
  due: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4
  },
  dueSoon: { backgroundColor: 'rgba(245, 205, 71, 0.16)' },
  dueOverdue: { backgroundColor: 'rgba(248, 113, 104, 0.18)' },
  soonText: { color: '#f5cd47' },
  overdueText: { color: '#f87168' },
  mentioned: { color: colors.accent, fontWeight: '800', fontSize: 12 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addInput: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text
  },
  addMore: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  hint: { color: colors.muted, fontSize: 12 },
  descriptionInput: {
    minHeight: 160,
    textAlignVertical: 'top',
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: colors.text
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    padding: 20
  },
  descriptionCard: {
    maxHeight: '80%',
    gap: 14,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  descriptionScroll: { flexGrow: 0 },
  row: { flexDirection: 'row', gap: 10 }
})
