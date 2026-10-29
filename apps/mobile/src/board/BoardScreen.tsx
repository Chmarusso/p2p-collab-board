// The Kanban board on a phone: columns side by side, one screen wide each,
// swiped horizontally. Cards open a full sheet; board settings live in sheets
// reached from the toolbar.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionSheetIOS,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
  Button,
  CachedImage,
  FadeIn,
  ImageRef,
  PressableScale,
  colors,
  mono,
  themed,
  tint
} from '../ui'
import { SoundName } from '../sounds'
import type { SharePref } from '../share'
import { ActivitySheet } from './Activity'
import { Agenda } from './Agenda'
import { AvatarStack } from './CardExtras'
import { CardFace } from './CardFace'
import { CardSheet, Chip } from './CardSheet'
import { Markdown } from './Markdown'
import { MyWorkSheet } from './MyWork'
import { BoardTemplatesSheet, RulesSheet } from './Rules'
import { StatsSheet } from './Stats'
import {
  ColumnSheet,
  FilterSheet,
  LabelsSheet,
  MembersSheet,
  NotificationsSheet,
  Sheet,
  ThemeSheet,
  useImageUri
} from './Panels'
import {
  AlertBoard,
  BoardAlert,
  BoardData,
  Card,
  avatarOf,
  Column,
  Filters,
  MyCard,
  NO_FILTERS,
  PresencePeer,
  backgroundColor,
  doneColumnOf,
  filterCount,
  inkOn,
  matchesFilters,
  memberPowers,
  pointsOf,
  requestId,
  templatesOf,
  wipState
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
  onOpenMyCard: (board: AlertBoard, card: MyCard) => void
  sound: SoundName
  openCardRequest: { cardId: string; nonce: number } | null
  // Bumped by the profile menu's "Board settings".
  settingsRequest: number
  subscribe: (listener: (message: WorkerMessage) => void) => () => void
  nameFor: (identity: string) => string
  shortKey: (hex: string) => string
  relativeTime: (iso?: string) => string
  blocked: string[]
  toggleBlocked: (identity: string) => void
  // This device's Share menu settings for the board.
  sharePref: SharePref
  onSharePref: (pref: SharePref) => void
}

const screenWidth = Dimensions.get('window').width
const COLUMN_WIDTH = Math.min(340, screenWidth - 48)
const COLUMN_GAP = 12

type SheetName =
  | 'settings'
  | 'labels'
  | 'theme'
  | 'members'
  | 'filter'
  | 'notifications'
  | 'description'
  | 'activity'
  | 'stats'
  | 'rules'
  | 'templates'
  | 'mywork'
  | 'more'
  | 'sharing'
  | null

export function BoardScreen(props: Props) {
  const { data, send, me } = props
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetName>(null)
  const [columnMenu, setColumnMenu] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [view, setView] = useState<'board' | 'agenda'>('board')
  const [peers, setPeers] = useState<PresencePeer[]>([])
  // The column a "From template…" picker adds to.
  const [templateColumn, setTemplateColumn] = useState<string | null>(null)
  const templateRequest = useRef('')
  const [showArchived, setShowArchived] = useState(false)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [columnDraft, setColumnDraft] = useState('')

  // Cards on screen when a board first fills in appear at once; later
  // arrivals fade in.
  const settled = useRef(false)
  useEffect(() => {
    settled.current = false
  }, [props.boardKey])
  useEffect(() => {
    if (props.synced && data.objects.length) settled.current = true
  })
  // A different board starts clean.
  useEffect(() => {
    setOpenCardId(null)
    setSheet(null)
    setFilters(NO_FILTERS)
    setShowArchived(false)
    setDescriptionOpen(false)
    setPeers([])
    setTemplateColumn(null)
  }, [props.boardKey])
  // Who else is here; a card made from a template opens once it exists.
  useEffect(
    () =>
      props.subscribe((message) => {
        if (message.type === messageTypes.boardPresence) setPeers(message.peers || [])
        if (message.type === 'card-created' && message.requestId === templateRequest.current) {
          templateRequest.current = ''
          setOpenCardId(message.objectId)
        }
      }),
    [props.subscribe]
  )
  // A notification asked for a card (possibly after switching boards).
  useEffect(() => {
    if (props.openCardRequest) {
      setSheet(null)
      setOpenCardId(props.openCardRequest.cardId)
    }
  }, [props.openCardRequest?.nonce])
  useEffect(() => {
    if (props.settingsRequest) setSheet('settings')
  }, [props.settingsRequest])
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
        !card.template &&
        (showArchived || !card.archived) &&
        matchesFilters(card, filters)
    )
  const archivedCount = data.objects.filter((card) => card.archived && !card.template).length
  const templates = templatesOf(data)
  const doneId = doneColumnOf(data)
  const viewersOf = (cardId: string) => peers.filter((peer) => peer.cardId === cardId).length
  const mineCount = props.alertBoards.reduce((sum, board) => sum + (board.mine?.length || 0), 0)
  const assignedToMe = !!me && filters.assignee === me
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
  const backgroundUri = useImageUri(data.theme.backgroundImage, props.cache, props.requestImage)
  const iconUri = useImageUri(data.info.icon, props.cache, props.requestImage)
  const accent = data.theme.accent || colors.accent
  // Text over a photo sits on a dark scrim, so it is always light.
  const ink = backgroundUri ? '#ffffff' : background ? inkOn(background) : colors.text
  const powers = memberPowers(data, me)
  const activeMembers = data.members.filter((member) => !member.banned).length
  const openCard = data.objects.find((card) => card.id === openCardId) || null
  const menuColumnIndex = data.columns.findIndex((column) => column.id === columnMenu)

  const addCard = (columnId: string) => {
    const title = (drafts[columnId] || '').trim()
    if (!title) return
    send({ type: messageTypes.boardCreate, title, body: '', columnId })
    setDrafts((current) => ({ ...current, [columnId]: '' }))
  }
  // Everything past the view switch, "Assigned to me" and Filter.
  const moreActions: Array<[string, () => void]> = [
    [mineCount ? `My work (${mineCount})` : 'My work', () => setSheet('mywork')],
    [activeMembers ? `Members (${activeMembers})` : 'Members', () => setSheet('members')],
    ...(archivedCount || showArchived
      ? [
          [
            `${showArchived ? 'Hide' : 'Show'} archived (${archivedCount})`,
            () => setShowArchived(!showArchived)
          ] as [string, () => void]
        ]
      : []),
    ['Activity', () => setSheet('activity')],
    ['Stats', () => setSheet('stats')],
    [data.rules?.length ? `Rules (${data.rules.length})` : 'Rules', () => setSheet('rules')]
  ]
  const openMore = () => {
    if (Platform.OS !== 'ios') return setSheet('more')
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...moreActions.map(([label]) => label), 'Cancel'],
        cancelButtonIndex: moreActions.length
      },
      (index) => moreActions[index]?.[1]()
    )
  }
  const fromTemplate = (templateId: string, columnId: string) => {
    templateRequest.current = requestId()
    send({
      type: messageTypes.cardFromTemplate,
      templateId,
      columnId,
      requestId: templateRequest.current
    })
    setTemplateColumn(null)
  }
  const renderCard = (card: Card, context?: string) => (
    <CardFace
      card={card}
      data={data}
      me={me}
      cache={props.cache}
      requestImage={props.requestImage}
      mentioned={unreadMentionCards.has(card.id)}
      viewers={viewersOf(card.id)}
      done={card.columnId === doneId}
      context={context}
      onPress={() => setOpenCardId(card.id)}
    />
  )
  const addColumn = () => {
    const name = columnDraft.trim()
    if (!name) return
    send({ type: messageTypes.columnCreate, name })
    setColumnDraft('')
  }

  // Header, description and toolbar: above the columns, or atop the agenda list.
  const top = (
    <View style={styles.top}>
      <View style={styles.header}>
        {iconUri ? (
          <Image
            source={{ uri: iconUri }}
            style={styles.boardIcon}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <Text style={[styles.title, { color: ink }]} numberOfLines={2}>
          {props.boardName || 'OpenCollab'}
        </Text>
        <PressableScale
          style={[styles.bell, props.unreadCount > 0 && { borderColor: accent }]}
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
        </PressableScale>
        <PressableScale
          style={[styles.user]}
          onPress={props.openProfile}
          accessibilityRole='button'
          accessibilityLabel='Open profile and connection details'
        >
          <Avatar
            hex={me}
            size={22}
            image={avatarOf(data, me)}
            cache={props.cache}
            requestImage={props.requestImage}
          />
          <Text style={[styles.userName, { color: accent }]} numberOfLines={1}>
            @{props.displayName}
          </Text>
        </PressableScale>
      </View>

      {peers.length ? (
        <FadeIn>
          <View style={styles.online} accessibilityLabel={`${peers.length} online now`}>
            <AvatarStack
              identities={peers.map((peer) => peer.identity)}
              data={data}
              size={22}
              max={5}
              cache={props.cache}
              requestImage={props.requestImage}
            />
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText} numberOfLines={1}>
              {peers.length === 1
                ? `${peers[0].name || props.nameFor(peers[0].identity)} is online`
                : `${peers.length} online now`}
            </Text>
          </View>
        </FadeIn>
      ) : null}

      {powers.banned ? (
        <View style={styles.bannedBanner} accessibilityRole='alert'>
          <Feather name='user-x' size={16} color={colors.error} />
          <Text style={styles.bannedText}>
            You were removed from this board. You can still see it, but your changes are ignored by
            everyone.
          </Text>
        </View>
      ) : null}

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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbar}
      >
        <View style={styles.segment} accessibilityRole='tablist'>
          {(['board', 'agenda'] as const).map((name) => (
            <Pressable
              key={name}
              onPress={() => setView(name)}
              hitSlop={6}
              style={[styles.segmentItem, view === name && { backgroundColor: accent }]}
              accessibilityRole='tab'
              accessibilityState={{ selected: view === name }}
            >
              <Feather
                name={name === 'board' ? 'columns' : 'calendar'}
                size={14}
                color={view === name ? inkOn(accent) : colors.text}
              />
              <Text style={[styles.toolText, view === name && { color: inkOn(accent) }]}>
                {name === 'board' ? 'Board' : 'Agenda'}
              </Text>
            </Pressable>
          ))}
        </View>
        <ToolButton
          icon='user-check'
          label='Assigned to me'
          active={assignedToMe}
          accent={accent}
          onPress={() => setFilters({ ...filters, assignee: assignedToMe ? '' : me })}
        />
        <ToolButton
          icon='filter'
          label={activeFilters ? `Filter (${activeFilters})` : 'Filter'}
          active={activeFilters > 0}
          accent={accent}
          onPress={() => setSheet('filter')}
        />
        <ToolButton
          icon='more-horizontal'
          label={mineCount ? `More · ${mineCount} mine` : 'More'}
          active={showArchived}
          accent={accent}
          onPress={openMore}
        />
      </ScrollView>
    </View>
  )

  return (
    <View style={[styles.root, background ? { backgroundColor: background } : null]}>
      {backgroundUri ? (
        <>
          <Image
            source={{ uri: backgroundUri }}
            style={StyleSheet.absoluteFill}
            resizeMode='cover'
            accessibilityIgnoresInvertColors
          />
          <View style={[StyleSheet.absoluteFill, styles.scrim]} />
        </>
      ) : null}
      {props.synced && view === 'agenda' ? (
        <Agenda
          header={top}
          cards={data.objects.filter(
            (card) =>
              !card.template &&
              !card.archived &&
              card.columnId !== doneId &&
              matchesFilters(card, filters)
          )}
          renderCard={(card) =>
            renderCard(card, data.columns.find((column) => column.id === card.columnId)?.name)
          }
        />
      ) : (
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps='handled'>
          {top}
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
                // WIP counts every open card, whatever the filter hides.
                const open = data.objects.filter(
                  (card) => card.columnId === column.id && !card.archived && !card.template
                )
                const wip = wipState(open.length, column.wipLimit)
                const points = pointsOf(open)
                return (
                  <View
                    key={column.id}
                    style={[
                      styles.column,
                      column.color ? { borderTopColor: column.color } : null,
                      wip === 'over' && styles.columnOver
                    ]}
                    accessibilityLabel={`${column.name}, ${cards.length} cards${column.wipLimit ? `, limit ${column.wipLimit}${wip === 'over' ? ', over the limit' : wip === 'full' ? ', at the limit' : ''}` : ''}`}
                  >
                    <View style={styles.columnHead}>
                      <Text style={styles.columnName} numberOfLines={1}>
                        {column.name}
                      </Text>
                      {points ? <Text style={styles.columnPoints}>{points} pts</Text> : null}
                      <Text
                        style={[
                          styles.columnCount,
                          wip && styles.wipBadge,
                          wip === 'full' && styles.wipFull,
                          wip === 'over' && styles.wipOver
                        ]}
                      >
                        {column.wipLimit ? `${open.length}/${column.wipLimit}` : cards.length}
                      </Text>
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
                      <FadeIn key={card.id} id={card.id} skip={!settled.current}>
                        {renderCard(card)}
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
                      {templates.length ? (
                        <Pressable
                          onPress={() => setTemplateColumn(column.id)}
                          hitSlop={8}
                          style={styles.addMore}
                          accessibilityRole='button'
                          accessibilityLabel='From template…'
                        >
                          <Feather name='copy' size={16} color={colors.muted} />
                        </Pressable>
                      ) : null}
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
      )}

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
          peers={peers}
          sound={props.sound}
          onOpenCard={setOpenCardId}
        />
      ) : null}
      {sheet === 'settings' ? (
        <Sheet title='Board settings' onClose={() => setSheet(null)}>
          <MenuRow
            icon='edit-2'
            label='Edit board'
            onPress={() => {
              setDescriptionDraft(data.info.description)
              setSheet('description')
            }}
          />
          <MenuRow icon='tag' label='Labels' onPress={() => setSheet('labels')} />
          <MenuRow icon='droplet' label='Customize' onPress={() => setSheet('theme')} />
          <MenuRow icon='zap' label='Automation rules' onPress={() => setSheet('rules')} />
          <MenuRow
            icon='layout'
            label='Start from a template'
            onPress={() => setSheet('templates')}
          />
          <MenuRow icon='share' label='Share menu' onPress={() => setSheet('sharing')} />
        </Sheet>
      ) : null}
      {sheet === 'sharing' ? (
        <Sheet title='Share menu' onClose={() => setSheet('settings')}>
          <View style={styles.menuRow}>
            <Text style={styles.menuText}>Show this board</Text>
            <Switch
              value={!props.sharePref.hidden}
              onValueChange={(show) => props.onSharePref({ ...props.sharePref, hidden: !show })}
              trackColor={{ true: colors.accent, false: colors.border }}
              accessibilityLabel='Show this board when sharing from other apps'
            />
          </View>
          <Text style={styles.hint}>
            Share a link or post from any app and pick OpenCollab to add it here as a card. This
            setting is only on this device.
          </Text>
          {props.sharePref.hidden ? null : (
            <>
              <Text style={styles.sharingLabel}>New cards go to</Text>
              <View style={styles.chips}>
                {data.columns.map((column) => (
                  <Chip
                    key={column.id}
                    label={column.name}
                    selected={
                      (props.sharePref.columnId &&
                      data.columns.some((c) => c.id === props.sharePref.columnId)
                        ? props.sharePref.columnId
                        : data.columns[0]?.id) === column.id
                    }
                    onPress={() => props.onSharePref({ ...props.sharePref, columnId: column.id })}
                  />
                ))}
              </View>
            </>
          )}
        </Sheet>
      ) : null}
      {sheet === 'more' ? (
        <Sheet title='More' onClose={() => setSheet(null)}>
          {moreActions.map(([label, run]) => (
            <MenuRow
              key={label}
              icon='chevron-right'
              label={label}
              onPress={() => {
                setSheet(null)
                run()
              }}
            />
          ))}
        </Sheet>
      ) : null}
      {sheet === 'rules' ? (
        <RulesSheet
          data={data}
          me={me}
          send={send}
          nameFor={props.nameFor}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'templates' ? (
        <BoardTemplatesSheet send={send} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'activity' ? (
        <ActivitySheet
          data={data}
          send={send}
          subscribe={props.subscribe}
          nameFor={props.nameFor}
          cache={props.cache}
          requestImage={props.requestImage}
          onOpenCard={(cardId) => {
            setSheet(null)
            setOpenCardId(cardId)
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'stats' ? (
        <StatsSheet
          data={data}
          send={send}
          subscribe={props.subscribe}
          nameFor={props.nameFor}
          accent={accent}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'mywork' ? (
        <MyWorkSheet
          boards={props.alertBoards}
          currentKey={props.boardKey}
          onOpen={(board, card) => {
            setSheet(null)
            props.onOpenMyCard(board, card)
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {templateColumn ? (
        <Sheet title='From template' onClose={() => setTemplateColumn(null)}>
          <Text style={styles.hint}>
            Adds a copy to{' '}
            {data.columns.find((column) => column.id === templateColumn)?.name || 'the column'}:
            title, description, labels, assignees, points and checklist.
          </Text>
          {templates.map((template) => (
            <View key={template.id} style={styles.templateRow}>
              <PressableScale
                onPress={() => fromTemplate(template.id, templateColumn)}
                style={[styles.templateMain]}
                accessibilityRole='button'
                accessibilityLabel={`New card from ${template.title}`}
              >
                <Feather name='copy' size={16} color={colors.muted} />
                <Text style={styles.menuText} numberOfLines={2}>
                  {template.title}
                </Text>
              </PressableScale>
              <Pressable
                onPress={() => {
                  setTemplateColumn(null)
                  setOpenCardId(template.id)
                }}
                style={styles.templateEdit}
                accessibilityRole='button'
                accessibilityLabel={`Edit template ${template.title}`}
              >
                <Text style={styles.link}>Edit</Text>
              </Pressable>
            </View>
          ))}
        </Sheet>
      ) : null}
      {sheet === 'labels' ? (
        <LabelsSheet data={data} send={send} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'theme' ? (
        <ThemeSheet
          data={data}
          send={send}
          cache={props.cache}
          requestImage={props.requestImage}
          subscribe={props.subscribe}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'members' ? (
        <MembersSheet
          data={data}
          me={me}
          send={send}
          nameFor={props.nameFor}
          shortKey={props.shortKey}
          status={props.statusChip}
          cache={props.cache}
          requestImage={props.requestImage}
          blocked={props.blocked}
          toggleBlocked={props.toggleBlocked}
          onClose={() => setSheet(null)}
        />
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
          cards={
            data.objects.filter(
              (card) => card.columnId === columnMenu && !card.archived && !card.template
            ).length
          }
          send={send}
          onLocalMove={props.onLocalMove}
          onClose={() => setColumnMenu(null)}
        />
      ) : null}
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
    <PressableScale
      onPress={onPress}
      style={[styles.tool, active && accent ? { borderColor: accent } : null]}
      accessibilityRole='button'
      accessibilityState={{ selected: !!active }}
    >
      <Feather name={icon} size={14} color={active && accent ? accent : colors.text} />
      <Text style={[styles.toolText, active && accent ? { color: accent } : null]}>{label}</Text>
    </PressableScale>
  )
}

function MenuRow({
  icon,
  label,
  onPress
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  onPress: () => void
}) {
  return (
    <PressableScale onPress={onPress} style={[styles.menuRow]} accessibilityRole='button'>
      <Feather name={icon} size={18} color={colors.text} />
      <Text style={styles.menuText}>{label}</Text>
      <Feather name='chevron-right' size={18} color={colors.muted} />
    </PressableScale>
  )
}

const styles = themed(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { width: '100%', height: '100%' },
  page: { paddingTop: 64, paddingBottom: 120, gap: 12 },
  top: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  scrim: { backgroundColor: 'rgba(5, 8, 12, 0.55)' },
  boardIcon: { width: 34, height: 34, borderRadius: 8 },
  bannedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: tint(colors.error, 0.12)
  },
  bannedText: { color: colors.text, flex: 1, lineHeight: 19 },
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
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  menuText: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '600' },
  sharingLabel: {
    color: colors.muted,
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 8
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  columnPoints: { color: colors.info, fontFamily: mono, fontSize: 11 },
  columnOver: { borderColor: tint(colors.danger, 0.6) },
  wipBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' },
  wipFull: { color: colors.warn, backgroundColor: tint(colors.warn, 0.16) },
  wipOver: { color: colors.danger, backgroundColor: tint(colors.danger, 0.18), fontWeight: '700' },
  online: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  onlineText: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  segment: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  segmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999
  },
  link: { color: colors.info, fontWeight: '600', fontSize: 14 },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  templateMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    minHeight: 52
  },
  templateEdit: { paddingHorizontal: 14, minHeight: 52, justifyContent: 'center' },
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
  dueSoon: { backgroundColor: tint(colors.warn, 0.16) },
  dueOverdue: { backgroundColor: tint(colors.danger, 0.18) },
  soonText: { color: colors.warn },
  overdueText: { color: colors.danger },
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
}))
