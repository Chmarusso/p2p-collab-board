// The To-do list layout (board-protocol/kinds.js, layout 'list'): one list with
// checkboxes. Ticking an item moves it to the last section (Done); done items
// fold away under a toggle, and unticking puts them back in the first section.
import React, { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { messageTypes } from '@opencollab/board-protocol'
import { t, tx } from '../i18n'
import { CachedImage, ImageRef, colors, themed } from '../ui'
import { AvatarStack } from './CardExtras'
import { BoardData, Card, Column, dueInfo } from './model'

export function TodoView({
  data,
  columns,
  visible,
  showDue,
  showAssignees,
  send,
  cache,
  requestImage,
  onOpen,
  onLocalMove
}: {
  data: BoardData
  columns: Column[]
  visible: (columnId: string) => Card[]
  showDue: boolean
  showAssignees: boolean
  send: (message: object) => void
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  onOpen: (cardId: string) => void
  onLocalMove: () => void
}) {
  const [draft, setDraft] = useState('')
  const [showDone, setShowDone] = useState(false)
  const first = columns[0]
  const done = columns.length > 1 ? columns[columns.length - 1] : null
  // Sections between the first and Done still count as open.
  const open = columns.filter((column) => column !== done).flatMap((column) => visible(column.id))
  const finished = done ? visible(done.id) : []
  const add = () => {
    const title = draft.trim()
    if (!title || !first) return
    send({ type: messageTypes.boardCreate, title, body: '', columnId: first.id })
    setDraft('')
  }
  const toggle = (card: Card) => {
    const target = card.columnId === done?.id ? first : done
    if (!target) return
    onLocalMove()
    send({ type: messageTypes.cardMove, objectId: card.id, columnId: target.id })
  }
  const row = (card: Card) => {
    const checked = card.columnId === done?.id
    const due = showDue && !checked ? dueInfo(card.dueDate) : null
    const people = showAssignees ? card.assignees || [] : []
    const comments = card.comments?.length || 0
    return (
      <View key={card.id} style={styles.row}>
        <Pressable
          onPress={() => toggle(card)}
          hitSlop={10}
          style={[styles.box, checked && styles.boxOn]}
          accessibilityRole='checkbox'
          accessibilityState={{ checked }}
          accessibilityLabel={card.title}
        >
          {checked ? <Feather name='check' size={14} color={colors.onAccent} /> : null}
        </Pressable>
        <Pressable
          onPress={() => onOpen(card.id)}
          style={styles.rowBody}
          accessibilityRole='button'
          accessibilityLabel={t('Open {title}', { title: card.title })}
        >
          <Text style={[styles.title, checked && styles.titleDone]} numberOfLines={3}>
            {card.title}
          </Text>
          {due || comments || card.body ? (
            <View style={styles.meta}>
              {due ? (
                <Text
                  style={[
                    styles.metaText,
                    due.status === 'overdue' && styles.overdue,
                    due.status === 'soon' && styles.soon
                  ]}
                >
                  {due.text}
                </Text>
              ) : null}
              {card.body?.trim() ? (
                <Feather name='align-left' size={12} color={colors.muted} />
              ) : null}
              {comments ? (
                <Text style={styles.metaText}>
                  <Feather name='message-square' size={12} color={colors.muted} /> {comments}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Pressable>
        {people.length ? (
          <AvatarStack
            identities={people}
            data={data}
            size={22}
            cache={cache}
            requestImage={requestImage}
          />
        ) : null}
      </View>
    )
  }
  return (
    <View style={styles.root}>
      <View style={styles.addRow}>
        <Feather name='plus' size={18} color={colors.muted} />
        <TextInput
          style={styles.addInput}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder={t('Add a to-do')}
          placeholderTextColor={colors.muted}
          returnKeyType='done'
          blurOnSubmit={false}
          maxLength={200}
        />
      </View>
      <View style={styles.list}>
        {open.length ? (
          open.map(row)
        ) : (
          <Text style={styles.empty}>
            {finished.length ? t('All done.') : t('Nothing to do yet.')}
          </Text>
        )}
      </View>
      {finished.length ? (
        <>
          <Pressable
            onPress={() => setShowDone(!showDone)}
            style={styles.doneToggle}
            accessibilityRole='button'
            accessibilityState={{ expanded: showDone }}
          >
            <Feather
              name={showDone ? 'chevron-down' : 'chevron-right'}
              size={16}
              color={colors.muted}
            />
            <Text style={styles.doneText}>
              {done?.name || tx('todo', 'Done')} ({finished.length})
            </Text>
          </Pressable>
          {showDone ? <View style={styles.list}>{finished.map(row)}</View> : null}
        </>
      ) : null}
    </View>
  )
}

const styles = themed(() => ({
  root: { gap: 12, paddingHorizontal: 16 },
  addRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12
  },
  addInput: { color: colors.text, flex: 1, fontSize: 15, paddingVertical: 12 },
  list: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden'
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  box: {
    alignItems: 'center',
    borderColor: colors.muted,
    borderRadius: 6,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22
  },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  rowBody: { flex: 1, gap: 4 },
  title: { color: colors.text, fontSize: 15, lineHeight: 20 },
  titleDone: { color: colors.muted, textDecorationLine: 'line-through' },
  meta: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  metaText: { color: colors.muted, fontSize: 12 },
  overdue: { color: colors.danger },
  soon: { color: colors.warn },
  empty: { color: colors.muted, padding: 16, textAlign: 'center' },
  doneToggle: { alignItems: 'center', flexDirection: 'row', gap: 6, paddingVertical: 4 },
  doneText: { color: colors.muted, fontSize: 14, fontWeight: '600' }
}))
