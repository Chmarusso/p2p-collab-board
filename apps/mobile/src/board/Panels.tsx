// Board-level screens: labels, theme, members, filters, notifications and the
// column menu. Each is a modal sheet; changes go straight to the worker.
import React, { useEffect, useState } from 'react'
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
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
  ImageRef,
  PressableScale,
  colors,
  imageKey,
  mono,
  pickPreparedImages
} from '../ui'
import { Chip } from './CardSheet'
import {
  ACCENTS,
  AlertBoard,
  BACKGROUNDS,
  BoardAlert,
  BoardData,
  Column,
  Filters,
  KIND_LABELS,
  LABEL_COLORS,
  Member,
  NO_FILTERS,
  alertText,
  assignable,
  memberPowers,
  newLabelId
} from './model'

type WorkerMessage = { type: string; [key: string]: any }

// Fetches an image ref through the shared cache and returns its data URI.
export function useImageUri(
  ref: ImageRef | null | undefined,
  cache: Record<string, CachedImage>,
  requestImage: (ref: ImageRef) => void
) {
  const key = ref ? imageKey(ref) : ''
  const cached = key ? cache[key] : undefined
  useEffect(() => {
    if (ref && !cached) requestImage(ref)
  }, [key, !!cached])
  return cached?.uri || null
}

export function Sheet({
  title,
  onClose,
  children,
  right,
  scroll = true
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  right?: React.ReactNode
  // Off when the content is its own list (FlatList), which must not nest.
  scroll?: boolean
}) {
  return (
    <Modal visible animationType='slide' presentationStyle='pageSheet' onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          {right}
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole='button'
            accessibilityLabel='Close'
          >
            <Feather name='x' size={22} color={colors.muted} />
          </Pressable>
        </View>
        {scroll ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
            {children}
          </ScrollView>
        ) : (
          <View style={styles.flex}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  )
}

function Swatches({
  colors: palette,
  selected,
  onPick,
  none
}: {
  colors: string[]
  selected: string | null | undefined
  onPick: (color: string | null) => void
  none?: boolean
}) {
  return (
    <View style={styles.swatches}>
      {none ? (
        <Pressable
          onPress={() => onPick(null)}
          style={[styles.swatch, styles.swatchNone, !selected && styles.swatchSelected]}
          accessibilityRole='button'
          accessibilityLabel='No color'
          accessibilityState={{ selected: !selected }}
        >
          <Feather name='slash' size={14} color={colors.muted} />
        </Pressable>
      ) : null}
      {palette.map((color) => (
        <Pressable
          key={color}
          onPress={() => onPick(color)}
          style={[
            styles.swatch,
            { backgroundColor: color },
            selected === color && styles.swatchSelected
          ]}
          accessibilityRole='button'
          accessibilityLabel={`Color ${color}`}
          accessibilityState={{ selected: selected === color }}
        />
      ))}
    </View>
  )
}

// Shared by everyone on the board: rename, recolor, delete, create.
export function LabelsSheet({
  data,
  send,
  onClose
}: {
  data: BoardData
  send: (message: object) => void
  onClose: () => void
}) {
  const [names, setNames] = useState<Record<string, string>>({})
  const [recolor, setRecolor] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(
    LABEL_COLORS.find((color) => !data.labels.some((label) => label.color === color)) ||
      LABEL_COLORS[0]
  )
  const [error, setError] = useState('')
  const create = () => {
    const name = newName.trim()
    if (!name) return
    if (data.labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) {
      return setError('A label with this name already exists.')
    }
    send({ type: messageTypes.labelUpsert, labelId: newLabelId(), name, color: newColor })
    setNewName('')
    setError('')
  }
  return (
    <Sheet title='Labels' onClose={onClose}>
      <Text style={styles.muted}>
        Shared by everyone on this board. Changes apply to every card.
      </Text>
      {data.labels.length ? null : (
        <Text style={styles.muted}>No labels yet. Create the first one below.</Text>
      )}
      {data.labels.map((label) => {
        const used = data.objects.filter((card) => card.labelIds?.includes(label.id)).length
        const rename = () => {
          const name = (names[label.id] ?? label.name).trim()
          if (name && name !== label.name) {
            send({ type: messageTypes.labelUpsert, labelId: label.id, name, color: label.color })
          }
          setNames((current) => {
            const next = { ...current }
            delete next[label.id]
            return next
          })
        }
        return (
          <View key={label.id} style={styles.labelRow}>
            <View style={styles.rowCenter}>
              <Pressable
                onPress={() => setRecolor(recolor === label.id ? null : label.id)}
                style={[styles.swatch, { backgroundColor: label.color || '#8590a2' }]}
                accessibilityRole='button'
                accessibilityLabel={`Change color of ${label.name}`}
              />
              <TextInput
                style={[styles.input, styles.flex]}
                value={names[label.id] ?? label.name}
                onChangeText={(value) => setNames((current) => ({ ...current, [label.id]: value }))}
                onEndEditing={rename}
                maxLength={40}
                accessibilityLabel='Label name'
              />
              <Text style={[styles.usage, styles.usageColumn]}>
                {used} {used === 1 ? 'card' : 'cards'}
              </Text>
              <Pressable
                onPress={() => {
                  if (confirm !== label.id) return setConfirm(label.id)
                  send({ type: messageTypes.labelDelete, labelId: label.id })
                  setConfirm(null)
                }}
                style={[styles.delete, confirm === label.id && styles.deleteConfirm]}
                accessibilityRole='button'
                accessibilityLabel={`Delete label ${label.name}`}
              >
                {confirm === label.id ? (
                  <Text style={styles.deleteText}>{used ? `Remove from ${used}?` : 'Delete?'}</Text>
                ) : (
                  <Feather name='trash-2' size={16} color={colors.muted} />
                )}
              </Pressable>
            </View>
            {recolor === label.id ? (
              <Swatches
                colors={LABEL_COLORS}
                selected={label.color}
                onPick={(color) => {
                  send({
                    type: messageTypes.labelUpsert,
                    labelId: label.id,
                    name: label.name,
                    color
                  })
                  setRecolor(null)
                }}
              />
            ) : null}
          </View>
        )
      })}
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>New label</Text>
      <TextInput
        style={styles.input}
        value={newName}
        onChangeText={(value) => {
          setNewName(value)
          setError('')
        }}
        onSubmitEditing={create}
        placeholder='Label name'
        placeholderTextColor={colors.muted}
        maxLength={40}
      />
      <Swatches
        colors={LABEL_COLORS}
        selected={newColor}
        onPick={(color) => color && setNewColor(color)}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title='Create label' icon='plus' onPress={create} />
    </Sheet>
  )
}

export function ThemeSheet({
  data,
  send,
  cache,
  requestImage,
  subscribe,
  onClose
}: {
  data: BoardData
  send: (message: object) => void
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  subscribe: (listener: (message: WorkerMessage) => void) => () => void
  onClose: () => void
}) {
  const [custom, setCustom] = useState(
    data.theme.background?.startsWith('#') ? data.theme.background : ''
  )
  const [uploading, setUploading] = useState<'icon' | 'background' | null>(null)
  const icon = data.info.icon || null
  const backgroundImage = data.theme.backgroundImage || null
  const iconUri = useImageUri(icon, cache, requestImage)
  const backgroundUri = useImageUri(backgroundImage, cache, requestImage)
  // The new ref arriving in board-state ends the upload; App shows refusals.
  const iconKey = icon ? imageKey(icon) : ''
  const backgroundKey = backgroundImage ? imageKey(backgroundImage) : ''
  useEffect(() => setUploading((current) => (current === 'icon' ? null : current)), [iconKey])
  useEffect(
    () => setUploading((current) => (current === 'background' ? null : current)),
    [backgroundKey]
  )
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'board-action-error') setUploading(null)
      }),
    [subscribe]
  )
  const setTheme = (change: object) => send({ type: messageTypes.themeSet, ...change })
  const pick = async (kind: 'icon' | 'background') => {
    // Icons show small, so they don't need the full size.
    const [image] = await pickPreparedImages(1, kind === 'icon' ? 256 : undefined)
    if (!image) return
    setUploading(kind)
    send({
      type: kind === 'icon' ? messageTypes.boardIconSet : messageTypes.backgroundImageSet,
      image: { type: image.type, data: image.data, width: image.width, height: image.height }
    })
  }
  const clear = (kind: 'icon' | 'background') =>
    send({
      type: kind === 'icon' ? messageTypes.boardIconSet : messageTypes.backgroundImageSet,
      image: null
    })
  return (
    <Sheet title='Customize' onClose={onClose}>
      <Text style={styles.muted}>Everyone on this board sees the same theme.</Text>
      <Text style={styles.sectionLabel}>Board icon</Text>
      <View style={styles.rowCenter}>
        <View style={styles.iconPreview}>
          {iconUri ? (
            <Image source={{ uri: iconUri }} style={styles.fill} />
          ) : (
            <Feather name='image' size={18} color={colors.muted} />
          )}
        </View>
        <Button
          title={uploading === 'icon' ? 'Uploading…' : icon ? 'Change' : 'Choose image'}
          icon='image'
          variant='secondary'
          onPress={() => uploading !== 'icon' && void pick('icon')}
        />
        {icon && uploading !== 'icon' ? (
          <Button title='Remove' variant='ghost' onPress={() => clear('icon')} />
        ) : null}
      </View>
      <Text style={styles.sectionLabel}>Background image</Text>
      {backgroundImage ? (
        <View style={styles.backgroundPreview}>
          {backgroundUri ? (
            <Image source={{ uri: backgroundUri }} style={styles.fill} resizeMode='cover' />
          ) : null}
        </View>
      ) : null}
      <View style={styles.rowCenter}>
        <Button
          title={
            uploading === 'background'
              ? 'Uploading…'
              : backgroundImage
                ? 'Change image'
                : 'Choose image'
          }
          icon='image'
          variant='secondary'
          onPress={() => uploading !== 'background' && void pick('background')}
        />
        {backgroundImage && uploading !== 'background' ? (
          <Button title='Remove' variant='ghost' onPress={() => clear('background')} />
        ) : null}
      </View>
      <Text style={styles.sectionLabel}>Background color</Text>
      <View style={styles.swatches}>
        <Pressable
          onPress={() => setTheme({ background: null })}
          style={[
            styles.bgSwatch,
            { backgroundColor: colors.bg },
            !data.theme.background && styles.swatchSelected
          ]}
          accessibilityRole='button'
          accessibilityLabel='Default background'
        />
        {Object.entries(BACKGROUNDS).map(([id, preset]) => (
          <Pressable
            key={id}
            onPress={() => setTheme({ background: id })}
            style={[
              styles.bgSwatch,
              { backgroundColor: preset.color },
              data.theme.background === id && styles.swatchSelected
            ]}
            accessibilityRole='button'
            accessibilityLabel={`${preset.name} background`}
          />
        ))}
      </View>
      <View style={styles.rowCenter}>
        <TextInput
          style={[styles.input, styles.flex]}
          value={custom}
          onChangeText={setCustom}
          placeholder='Custom color, e.g. #1a2a3a'
          placeholderTextColor={colors.muted}
          autoCapitalize='none'
          autoCorrect={false}
        />
        <Button
          title='Use'
          variant='secondary'
          onPress={() => /^#[0-9a-f]{6}$/i.test(custom) && setTheme({ background: custom })}
        />
      </View>
      <Text style={styles.sectionLabel}>Accent</Text>
      <Swatches
        colors={ACCENTS}
        selected={data.theme.accent || ACCENTS[0]}
        onPick={(color) => setTheme({ accent: color === ACCENTS[0] ? null : color })}
      />
    </Sheet>
  )
}

const ROLE_ORDER = { owner: 0, admin: 1, member: 2 }

export function MembersSheet({
  data,
  me,
  send,
  nameFor,
  shortKey,
  status,
  cache,
  requestImage,
  onClose
}: {
  data: BoardData
  me: string
  send: (message: object) => void
  nameFor: (identity: string) => string
  shortKey: (hex: string) => string
  status?: React.ReactNode
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  onClose: () => void
}) {
  const powers = memberPowers(data, me)
  const members = [...data.members].sort(
    (a, b) =>
      Number(a.banned) - Number(b.banned) ||
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      (a.name || nameFor(a.identity)).localeCompare(b.name || nameFor(b.identity))
  )
  const nameOf = (member: Member) => member.name || nameFor(member.identity)
  const ban = (member: Member) =>
    Alert.alert(
      `Remove ${nameOf(member)}?`,
      'They can still see the board, because they already hold its key, but everything they change from now on is ignored by everyone. What they added before stays.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            send({ type: messageTypes.memberBan, identity: member.identity, banned: true })
        }
      ]
    )
  return (
    <Sheet title='Members' onClose={onClose}>
      {status}
      <Text style={styles.muted}>
        The owner and admins can remove members. A removed member can still see the board, but their
        changes are ignored.
      </Text>
      {members.length ? null : (
        <Text style={styles.muted}>Nobody has written to this board yet.</Text>
      )}
      {members.map((member) => {
        const canBan = powers.canBan(member)
        const canRole = powers.canChangeRoles && member.role !== 'owner' && !member.banned
        return (
          <View key={member.identity} style={[styles.member, member.banned && styles.banned]}>
            <View style={styles.rowCenter}>
              <Avatar
                hex={member.identity}
                size={28}
                image={member.avatar}
                cache={cache}
                requestImage={requestImage}
              />
              <View style={styles.flex}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {nameOf(member)}
                  {member.identity === me ? ' (you)' : ''}
                </Text>
                <Text style={styles.usage}>{shortKey(member.identity)}</Text>
              </View>
              {member.banned ? (
                <Text style={[styles.badge, styles.badgeBanned]}>Banned</Text>
              ) : member.role === 'owner' ? (
                <Text style={[styles.badge, styles.badgeOwner]}>Owner</Text>
              ) : member.role === 'admin' ? (
                <Text style={[styles.badge, styles.badgeAdmin]}>Admin</Text>
              ) : null}
            </View>
            {member.banned && member.bannedBy ? (
              <Text style={styles.usage}>Banned by {nameFor(member.bannedBy)}</Text>
            ) : null}
            {canRole || canBan ? (
              <View style={styles.rowCenter}>
                {canRole ? (
                  <Button
                    title={member.role === 'admin' ? 'Remove admin' : 'Make admin'}
                    icon='shield'
                    variant='secondary'
                    onPress={() =>
                      send({
                        type: messageTypes.memberRole,
                        identity: member.identity,
                        role: member.role === 'admin' ? 'member' : 'admin'
                      })
                    }
                  />
                ) : null}
                {canBan && member.banned ? (
                  <Button
                    title='Unban'
                    icon='user-check'
                    variant='secondary'
                    onPress={() =>
                      send({
                        type: messageTypes.memberBan,
                        identity: member.identity,
                        banned: false
                      })
                    }
                  />
                ) : canBan ? (
                  <Button
                    title='Remove from board'
                    icon='user-x'
                    variant='ghost'
                    onPress={() => ban(member)}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        )
      })}
    </Sheet>
  )
}

export function FilterSheet({
  data,
  filters,
  me,
  setFilters,
  onClose
}: {
  data: BoardData
  filters: Filters
  me: string
  setFilters: (filters: Filters) => void
  onClose: () => void
}) {
  const dues: [Filters['due'], string][] = [
    ['', 'Any time'],
    ['overdue', 'Overdue'],
    ['week', 'Next 7 days'],
    ['none', 'No due date']
  ]
  return (
    <Sheet
      title='Filter'
      onClose={onClose}
      right={
        <Pressable onPress={() => setFilters(NO_FILTERS)} hitSlop={8} accessibilityRole='button'>
          <Text style={styles.link}>Clear</Text>
        </Pressable>
      }
    >
      <Text style={styles.sectionLabel}>Labels</Text>
      <View style={styles.swatches}>
        {data.labels.length ? (
          data.labels.map((label) => {
            const on = filters.labels.includes(label.id)
            return (
              <Chip
                key={label.id}
                label={label.name || 'Unnamed'}
                color={label.color || '#8590a2'}
                filled={on}
                selected={on}
                onPress={() =>
                  setFilters({
                    ...filters,
                    labels: on
                      ? filters.labels.filter((id) => id !== label.id)
                      : [...filters.labels, label.id]
                  })
                }
              />
            )
          })
        ) : (
          <Text style={styles.muted}>No labels yet</Text>
        )}
      </View>
      <Text style={styles.sectionLabel}>Mentioned</Text>
      <View style={styles.swatches}>
        <Chip
          label='Anyone'
          selected={!filters.member}
          onPress={() => setFilters({ ...filters, member: '' })}
        />
        {Object.entries(data.profiles).map(([identity, name]) => (
          <Chip
            key={identity}
            label={identity === me ? `${name} (you)` : name}
            selected={filters.member === identity}
            onPress={() => setFilters({ ...filters, member: identity })}
          />
        ))}
      </View>
      <Text style={styles.sectionLabel}>Assigned to</Text>
      <View style={styles.swatches}>
        <Chip
          label='Anyone'
          selected={!filters.assignee}
          onPress={() => setFilters({ ...filters, assignee: '' })}
        />
        {assignable(data, me).map((member) => {
          const name = member.name || data.profiles[member.identity] || 'Member'
          return (
            <Chip
              key={member.identity}
              label={member.identity === me ? `${name} (you)` : name}
              selected={filters.assignee === member.identity}
              onPress={() => setFilters({ ...filters, assignee: member.identity })}
            />
          )
        })}
      </View>
      <Text style={styles.sectionLabel}>Due</Text>
      <View style={styles.swatches}>
        {dues.map(([value, label]) => (
          <Chip
            key={value || 'any'}
            label={label}
            selected={filters.due === value}
            onPress={() => setFilters({ ...filters, due: value })}
          />
        ))}
      </View>
    </Sheet>
  )
}

export function ColumnSheet({
  column,
  index,
  count,
  cards,
  send,
  onLocalMove,
  onClose
}: {
  column: Column
  index: number
  count: number
  // Cards the column shows now, for the WIP limit hint.
  cards: number
  send: (message: object) => void
  onLocalMove: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(column.name)
  const [confirm, setConfirm] = useState(false)
  const [limit, setLimit] = useState(column.wipLimit ? String(column.wipLimit) : '')
  const [limitError, setLimitError] = useState('')
  const saveLimit = (value: string) => {
    const next = value.trim() === '' ? null : Number(value)
    if (next !== null && !(Number.isInteger(next) && next >= 1 && next <= 999)) {
      return setLimitError('Use a whole number from 1 to 999, or leave it empty for no limit.')
    }
    setLimitError('')
    if (next !== (column.wipLimit ?? null)) {
      send({ type: messageTypes.columnUpdate, columnId: column.id, wipLimit: next })
    }
  }
  const moveTo = (to: number) => {
    onLocalMove()
    send({ type: messageTypes.columnUpdate, columnId: column.id, index: to })
    onClose()
  }
  return (
    <Sheet title='Column' onClose={onClose}>
      <Text style={styles.sectionLabel}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        maxLength={60}
        onEndEditing={() =>
          name.trim() &&
          name.trim() !== column.name &&
          send({ type: messageTypes.columnUpdate, columnId: column.id, name: name.trim() })
        }
        accessibilityLabel='Column name'
      />
      <Text style={styles.sectionLabel}>Color</Text>
      <Swatches
        colors={LABEL_COLORS}
        selected={column.color}
        none
        onPick={(color) => send({ type: messageTypes.columnUpdate, columnId: column.id, color })}
      />
      <Text style={styles.sectionLabel}>Work in progress limit</Text>
      <View style={styles.rowCenter}>
        <TextInput
          style={[styles.input, styles.limitInput]}
          value={limit}
          onChangeText={(value) => {
            setLimit(value.replace(/[^0-9]/g, ''))
            setLimitError('')
          }}
          onEndEditing={() => saveLimit(limit)}
          placeholder='None'
          placeholderTextColor={colors.muted}
          keyboardType='number-pad'
          returnKeyType='done'
          maxLength={3}
          accessibilityLabel='Work in progress limit'
        />
        {column.wipLimit ? (
          <Button
            title='No limit'
            variant='ghost'
            onPress={() => {
              setLimit('')
              saveLimit('')
            }}
          />
        ) : null}
      </View>
      <Text style={styles.hint}>
        {cards} {cards === 1 ? 'card' : 'cards'} now. The header turns amber at the limit and red
        above it; moving a card into a full column asks first.
      </Text>
      {limitError ? <Text style={styles.error}>{limitError}</Text> : null}
      <Text style={styles.sectionLabel}>Position</Text>
      <View style={styles.rowCenter}>
        <Button
          title='Move left'
          icon='arrow-left'
          variant='secondary'
          onPress={() => index > 0 && moveTo(index - 1)}
        />
        <Button
          title='Move right'
          icon='arrow-right'
          variant='secondary'
          onPress={() => index < count - 1 && moveTo(index + 1)}
        />
      </View>
      <View style={styles.divider} />
      {count > 1 ? (
        <Button
          title={confirm ? 'Tap again to delete (cards move to the first column)' : 'Delete column'}
          icon='trash-2'
          variant='secondary'
          onPress={() => {
            if (!confirm) return setConfirm(true)
            send({ type: messageTypes.columnDelete, columnId: column.id })
            onClose()
          }}
        />
      ) : (
        <Text style={styles.muted}>A board keeps at least one column.</Text>
      )}
    </Sheet>
  )
}

export function NotificationsSheet({
  boards,
  isRead,
  currentKey,
  onOpen,
  onReadAll,
  onClose,
  shortKey,
  relativeTime
}: {
  boards: AlertBoard[]
  isRead: (board: AlertBoard, alert: BoardAlert) => boolean
  currentKey: string
  onOpen: (board: AlertBoard, alert: BoardAlert) => void
  onReadAll: () => void
  onClose: () => void
  shortKey: (hex: string) => string
  relativeTime: (iso?: string) => string
}) {
  const withAlerts = boards.filter((board) => board.alerts.length)
  return (
    <Sheet
      title='Notifications'
      onClose={onClose}
      right={
        <Pressable onPress={onReadAll} hitSlop={8} accessibilityRole='button'>
          <Text style={styles.link}>Mark all read</Text>
        </Pressable>
      }
    >
      {!withAlerts.length ? (
        <Text style={[styles.muted, styles.center]}>
          {boards.some((board) => !board.checkedAt)
            ? 'Checking your boards…'
            : 'You’re all caught up.'}
        </Text>
      ) : null}
      {withAlerts.map((board) => (
        <View key={board.key} style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupName} numberOfLines={1}>
              {board.name || 'Board'}
              {board.key === currentKey ? ' · open' : ''}
            </Text>
            <Text style={styles.usage}>
              {board.checkedAt
                ? `checked ${relativeTime(new Date(board.checkedAt).toISOString())}`
                : 'checking…'}
            </Text>
          </View>
          {board.alerts.map((alert) => {
            const read = isRead(board, alert)
            return (
              <PressableScale
                key={alert.id}
                onPress={() => onOpen(board, alert)}
                style={[styles.alert, !read && styles.alertUnread]}
                scaleTo={0.98}
                accessibilityRole='button'
              >
                <View style={styles.rowCenter}>
                  <Text
                    style={[
                      styles.kind,
                      styles[`kind_${alert.kind}` as keyof typeof styles] as object
                    ]}
                  >
                    {KIND_LABELS[alert.kind]}
                  </Text>
                  <Text style={styles.usage}>{relativeTime(new Date(alert.at).toISOString())}</Text>
                </View>
                <Text style={styles.alertText}>{alertText(alert, shortKey)}</Text>
                {alert.text ? (
                  <Text style={styles.muted} numberOfLines={2}>
                    {alert.text}
                  </Text>
                ) : null}
              </PressableScale>
            )
          })}
        </View>
      ))}
    </Sheet>
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
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 20,
    paddingBottom: 10
  },
  title: { flex: 1, color: colors.text, fontSize: 21, fontWeight: '700' },
  content: { padding: 20, paddingTop: 6, paddingBottom: 60, gap: 12 },
  muted: { color: colors.muted, lineHeight: 20 },
  center: { textAlign: 'center', paddingVertical: 24 },
  error: { color: colors.error },
  link: { color: colors.info, fontWeight: '600', fontSize: 14 },
  sectionLabel: {
    color: colors.muted,
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 6
  },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    minHeight: 44,
    color: colors.text
  },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  labelRow: { gap: 8 },
  usage: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  usageColumn: { width: 64, textAlign: 'right' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  limitInput: { width: 96, textAlign: 'center' },
  delete: {
    minWidth: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8
  },
  deleteConfirm: { backgroundColor: 'rgba(255, 92, 92, 0.15)', paddingHorizontal: 8 },
  deleteText: { color: colors.error, fontWeight: '700', fontSize: 12 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: {
    width: 34,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center'
  },
  swatchNone: { borderColor: colors.border },
  swatchSelected: { borderColor: colors.text },
  fill: { width: '100%', height: '100%' },
  iconPreview: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg
  },
  backgroundPreview: {
    height: 120,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg
  },
  member: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  banned: { opacity: 0.7, borderStyle: 'dashed' },
  memberName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  badge: {
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden'
  },
  badgeOwner: { color: colors.accent, borderColor: colors.accent },
  badgeAdmin: { color: colors.info, borderColor: colors.info },
  badgeBanned: { color: colors.error, borderColor: colors.error },
  bgSwatch: { width: 54, height: 40, borderRadius: 8, borderWidth: 2, borderColor: colors.border },
  group: { gap: 8 },
  groupHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 6
  },
  groupName: { color: colors.text, fontWeight: '700', flex: 1 },
  alert: {
    gap: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  alertUnread: { borderColor: colors.accent },
  alertText: { color: colors.text, lineHeight: 20 },
  kind: {
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted
  },
  kind_mention: { color: colors.info },
  kind_assigned: { color: colors.accent },
  kind_comment: { color: colors.info },
  kind_overdue: { color: '#f87168' },
  'kind_due-soon': { color: '#f5cd47' }
})
