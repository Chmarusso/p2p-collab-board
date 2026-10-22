// Board-level screens: labels, theme, filters, notifications and the column
// menu. Each is a modal sheet; changes go straight to the worker.
import React, { useState } from 'react'
import {
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
import { Button, colors, mono } from '../ui'
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
  alertText,
  newLabelId
} from './model'

export function Sheet({
  title,
  onClose,
  children,
  right
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <Modal visible animationType='slide' presentationStyle='pageSheet' onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
          {children}
        </ScrollView>
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
  onClose
}: {
  data: BoardData
  send: (message: object) => void
  onClose: () => void
}) {
  const [custom, setCustom] = useState(
    data.theme.background?.startsWith('#') ? data.theme.background : ''
  )
  const setTheme = (change: object) => send({ type: messageTypes.themeSet, ...change })
  return (
    <Sheet title='Customize' onClose={onClose}>
      <Text style={styles.muted}>Everyone on this board sees the same theme.</Text>
      <Text style={styles.sectionLabel}>Background</Text>
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
        <Pressable
          onPress={() => setFilters({ labels: [], member: '', due: '' })}
          hitSlop={8}
          accessibilityRole='button'
        >
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
  send,
  onLocalMove,
  onClose
}: {
  column: Column
  index: number
  count: number
  send: (message: object) => void
  onLocalMove: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(column.name)
  const [confirm, setConfirm] = useState(false)
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
              <Pressable
                key={alert.id}
                onPress={() => onOpen(board, alert)}
                style={({ pressed }) => [
                  styles.alert,
                  !read && styles.alertUnread,
                  pressed && styles.pressed
                ]}
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
              </Pressable>
            )
          })}
        </View>
      ))}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
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
  kind_comment: { color: colors.info },
  kind_overdue: { color: '#f87168' },
  'kind_due-soon': { color: '#f5cd47' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] }
})
