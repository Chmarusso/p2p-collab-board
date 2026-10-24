// A card as it sits in a column or the agenda: cover, labels, title and the
// small facts that tell what state it is in without opening it.
import React, { useEffect } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { REACTIONS } from '@opencollab/board-protocol'
import { CachedImage, ImageRef, PressableScale, colors, imageKey, mono } from '../ui'
import { AvatarStack, ProgressBar } from './CardExtras'
import {
  BoardData,
  Card,
  MAX_LABELS_ON_CARD,
  ageOf,
  checklistProgress,
  dueInfo,
  idleDays,
  imagesOf,
  scoreOf,
  videosOf
} from './model'

export function CardFace({
  card,
  data,
  me,
  cache,
  requestImage,
  mentioned,
  viewers,
  done,
  context,
  onPress
}: {
  card: Card
  data: BoardData
  me: string
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  mentioned: boolean
  viewers: number
  // Cards in the last column neither age nor read as blocked.
  done: boolean
  // A line above the title, e.g. the column in the agenda.
  context?: string
  onPress: () => void
}) {
  const images = imagesOf(card)
  const videos = videosOf(card)
  const cover = images[0]
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
  const checklist = checklistProgress(card)
  const blocked = !done && !!card.blockedBy?.length
  const age = done || card.archived ? '' : ageOf(card)
  const assignees = card.assignees || []
  const reactions = REACTIONS.filter((emoji) => card.reactions?.[emoji]?.length)
  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.card,
        card.archived && styles.archived,
        age === 'stale' && styles.stale,
        age === 'old' && styles.old
      ]}
      scaleTo={0.98}
      accessibilityRole='button'
      accessibilityLabel={[
        card.title,
        blocked ? 'blocked' : '',
        assignees.includes(me) ? 'assigned to you' : '',
        age ? `untouched for ${idleDays(card)} days` : '',
        viewers ? `${viewers} viewing now` : ''
      ]
        .filter(Boolean)
        .join(', ')}
    >
      {/* A strip, not a border: the corners stay round and nothing shifts. */}
      {blocked ? <View style={styles.blockedStrip} /> : null}
      {cover ? (
        <View style={styles.cover}>
          {cached?.uri ? <Image source={{ uri: cached.uri }} style={styles.fill} /> : null}
        </View>
      ) : null}
      {viewers ? <View style={styles.viewerDot} /> : null}
      {context ? (
        <Text style={styles.context} numberOfLines={1}>
          {context}
        </Text>
      ) : null}
      {labels.length || blocked ? (
        <View style={styles.labels}>
          {blocked ? (
            <View style={styles.blockedBadge}>
              <Feather name='slash' size={10} color='#f87168' />
              <Text style={styles.blockedText}>Blocked</Text>
            </View>
          ) : null}
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
      {checklist.total ? (
        <View style={styles.checklist}>
          <Feather
            name='check-square'
            size={12}
            color={checklist.done === checklist.total ? '#4bce97' : colors.muted}
          />
          <Text style={styles.metaMono}>
            {checklist.done}/{checklist.total}
          </Text>
          <View style={styles.flex}>
            <ProgressBar done={checklist.done} total={checklist.total} />
          </View>
        </View>
      ) : null}
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
        {typeof card.points === 'number' ? (
          <Text style={styles.points}>{card.points} pts</Text>
        ) : null}
        {votes ? (
          <Meta icon={score < 0 ? 'chevron-down' : 'chevron-up'} text={String(score)} />
        ) : null}
        {card.body?.trim() ? <Meta icon='align-left' /> : null}
        {card.comments?.length ? (
          <Meta icon='message-square' text={String(card.comments.length)} />
        ) : null}
        {images.length ? <Meta icon='image' text={String(images.length)} /> : null}
        {videos.length ? <Meta icon='film' text={String(videos.length)} /> : null}
        {card.links?.length ? <Meta icon='link' text={String(card.links.length)} /> : null}
        {reactions.length ? (
          <Text style={styles.metaMono}>
            {reactions
              .slice(0, 3)
              .map((emoji) => `${emoji}${card.reactions?.[emoji]?.length}`)
              .join(' ')}
            {reactions.length > 3 ? ` +${reactions.length - 3}` : ''}
          </Text>
        ) : null}
        {mentioned ? <Text style={styles.mentioned}>@</Text> : null}
        {age ? <Text style={styles.metaMono}>{idleDays(card)}d idle</Text> : null}
        {card.archived ? <Text style={styles.metaMono}>archived</Text> : null}
        {assignees.length ? (
          <View style={styles.assignees}>
            <AvatarStack
              identities={assignees}
              data={data}
              size={20}
              cache={cache}
              requestImage={requestImage}
            />
          </View>
        ) : null}
      </View>
    </PressableScale>
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fill: { width: '100%', height: '100%' },
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
  // Aging sinks the card toward the column instead of fading its text, so it
  // stays readable. It is static: Reduce Motion has nothing to turn off.
  stale: { backgroundColor: '#121a25' },
  old: { backgroundColor: colors.surface, borderStyle: 'dashed' },
  blockedStrip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    zIndex: 1,
    backgroundColor: '#f87168'
  },
  cover: {
    height: 120,
    marginTop: -12,
    marginHorizontal: -12,
    marginBottom: 2,
    backgroundColor: colors.surface
  },
  viewerDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.surfaceRaised,
    backgroundColor: colors.accent,
    zIndex: 1
  },
  context: { color: colors.muted, fontFamily: mono, fontSize: 11 },
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
  blockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: 'rgba(248, 113, 104, 0.18)'
  },
  blockedText: { color: '#f87168', fontSize: 11, fontWeight: '700' },
  cardTitle: { color: colors.text, fontWeight: '600', fontSize: 15, lineHeight: 20 },
  checklist: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaMono: { color: colors.muted, fontFamily: mono, fontSize: 11 },
  points: {
    color: colors.info,
    fontFamily: mono,
    fontSize: 11,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.4)',
    borderRadius: 4,
    paddingHorizontal: 4,
    overflow: 'hidden'
  },
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
  assignees: { marginLeft: 'auto' }
})
