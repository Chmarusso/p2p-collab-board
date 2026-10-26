// What happened on a card or the whole board, newest first. The worker builds
// the feed from the board's log on request; it is asked again whenever the
// board changes while the list is on screen.
import React, { useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { messageTypes } from '@opencollab/board-protocol'
import { Avatar, CachedImage, FeatherName, ImageRef, colors, mono, themed } from '../ui'
import { Sheet } from './Panels'
import { ActivityEntry, BoardData, avatarOf, requestId, timeAgo } from './model'

type WorkerMessage = { type: string; [key: string]: any }
type Subscribe = (listener: (message: WorkerMessage) => void) => () => void

// Sends `request` (with a fresh requestId) now and after each change of `key`,
// and keeps the latest reply of type `reply`. Board-state bursts are batched.
export function useWorkerReply<T>(
  send: (message: object) => void,
  subscribe: Subscribe,
  request: object,
  reply: string,
  pick: (message: WorkerMessage) => T,
  key: unknown
) {
  const [value, setValue] = useState<T | null>(null)
  const latest = useRef('')
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === reply && message.requestId === latest.current) setValue(pick(message))
      }),
    [subscribe, reply]
  )
  useEffect(() => {
    const timer = setTimeout(() => {
      latest.current = requestId()
      send({ ...request, requestId: latest.current })
    }, 250)
    return () => clearTimeout(timer)
  }, [key, JSON.stringify(request)])
  return value
}

const KIND_ICONS: Record<string, FeatherName> = {
  created: 'plus-circle',
  moved: 'arrow-right',
  archived: 'archive',
  restored: 'rotate-ccw',
  commented: 'message-square',
  edited: 'edit-2',
  checklist: 'check-square',
  linked: 'link',
  attached: 'paperclip',
  estimated: 'hash'
}

// The worker sends a fragment (`detail`) per kind; the verb is added here, as
// on desktop. On the board feed the card's title follows the verb.
function phrase(entry: ActivityEntry, withCard: boolean): [string, string] {
  const self = withCard ? '' : ' this card'
  const detail = entry.detail
  switch (entry.kind) {
    case 'created':
      return [`created${self}`, detail]
    case 'moved':
      return [`moved${self} to ${detail}`, '']
    case 'archived':
    case 'restored':
      return [`${entry.kind}${self}`, '']
    case 'commented':
      return ['commented', detail]
    case 'edited':
      return [`edited${self}`, detail]
    case 'checklist':
      return ['updated the checklist', detail]
    case 'linked':
      return ['changed links', detail]
    case 'attached':
      return ['added an attachment', '']
    case 'estimated':
      return ['voted on the estimate', '']
    default:
      return [entry.kind, detail]
  }
}

export function ActivityList({
  data,
  send,
  subscribe,
  cardId,
  nameFor,
  cache,
  requestImage,
  onOpenCard,
  virtualized
}: {
  data: BoardData
  send: (message: object) => void
  subscribe: Subscribe
  cardId: string | null
  nameFor: (identity: string) => string
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  onOpenCard?: (cardId: string) => void
  // The board feed can be long: it renders as its own scrolling list.
  virtualized?: boolean
}) {
  const entries = useWorkerReply<ActivityEntry[]>(
    send,
    subscribe,
    { type: messageTypes.activityGet, cardId, limit: cardId ? 100 : 200 },
    messageTypes.boardActivity,
    (message) => message.entries || [],
    data
  )
  if (!entries) return <Text style={styles.empty}>Loading activity…</Text>
  if (!entries.length) return <Text style={styles.empty}>Nothing has happened here yet.</Text>
  const renderEntry = (entry: ActivityEntry) => {
    const [what, more] = phrase(entry, !cardId)
    const body = (
      <>
        <View style={styles.icon}>
          <Avatar
            hex={entry.author}
            size={26}
            image={avatarOf(data, entry.author)}
            cache={cache}
            requestImage={requestImage}
          />
          <View style={styles.kindBadge}>
            <Feather name={KIND_ICONS[entry.kind] || 'activity'} size={10} color={colors.text} />
          </View>
        </View>
        <View style={styles.flex}>
          <Text style={styles.text} numberOfLines={4}>
            <Text style={styles.author}>{entry.authorName || nameFor(entry.author)}</Text> {what}
            {cardId ? null : (
              <Text style={styles.cardTitle}>
                {' · '}
                {entry.cardTitle}
              </Text>
            )}
          </Text>
          {more ? (
            <Text style={styles.more} numberOfLines={2}>
              {more}
            </Text>
          ) : null}
          <Text style={styles.time}>{timeAgo(entry.at)}</Text>
        </View>
      </>
    )
    return onOpenCard ? (
      <Pressable
        key={entry.id}
        onPress={() => onOpenCard(entry.cardId)}
        style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
        accessibilityRole='button'
      >
        {body}
      </Pressable>
    ) : (
      <View key={entry.id} style={styles.entry}>
        {body}
      </View>
    )
  }
  if (virtualized) {
    return (
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item }) => renderEntry(item)}
        contentContainerStyle={styles.feed}
        initialNumToRender={20}
      />
    )
  }
  return <View style={styles.list}>{entries.map(renderEntry)}</View>
}

export function ActivitySheet(props: {
  data: BoardData
  send: (message: object) => void
  subscribe: Subscribe
  nameFor: (identity: string) => string
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  onOpenCard: (cardId: string) => void
  onClose: () => void
}) {
  return (
    <Sheet title='Activity' onClose={props.onClose} scroll={false}>
      <ActivityList {...props} cardId={null} virtualized />
    </Sheet>
  )
}

const styles = themed(() => ({
  flex: { flex: 1 },
  list: { gap: 4 },
  feed: { paddingHorizontal: 20, paddingBottom: 60 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 24 },
  entry: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    minHeight: 44,
    alignItems: 'flex-start'
  },
  pressed: { opacity: 0.7 },
  icon: { width: 30, height: 30 },
  kindBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
    borderWidth: 1.5,
    borderColor: colors.surface
  },
  text: { color: colors.text, lineHeight: 20 },
  author: { fontWeight: '700' },
  cardTitle: { color: colors.muted },
  more: { color: colors.muted, fontSize: 13, marginTop: 2 },
  time: { color: colors.muted, fontFamily: mono, fontSize: 11, marginTop: 2 }
}))
