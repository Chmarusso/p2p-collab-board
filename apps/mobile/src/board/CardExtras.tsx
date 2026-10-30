// The card sheet's newer sections: checklist, assignees, reactions, links and
// planning-poker estimates. CardSheet wraps each in its own titled section;
// changes go straight to the worker and come back in board-state.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Pressable, Text, TextInput, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { REACTIONS, messageTypes } from '@opencollab/board-protocol'
import {
  Avatar,
  Button,
  CachedImage,
  ImageRef,
  PressableScale,
  colors,
  easeOut,
  mono,
  reduceMotion,
  themed,
  tint
} from '../ui'
import { plural, t } from '../i18n'
import { Chip } from './CardSheet'
import {
  BoardData,
  Card,
  POKER_VALUES,
  Reactions,
  assignable,
  avatarOf,
  checklistOf,
  checklistProgress,
  linkText,
  linksOf
} from './model'

type Send = (message: object) => void
type Images = { cache: Record<string, CachedImage>; requestImage: (ref: ImageRef) => void }

// Long checklists and link lists show this many rows until expanded.
const ROWS_SHOWN = 10

function ShowAll({ total, onPress }: { total: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={styles.showAll} accessibilityRole='button'>
      <Text style={styles.link}>{t('Show all {total}', { total })}</Text>
    </Pressable>
  )
}

export function ProgressBar({
  done,
  total,
  color
}: {
  done: number
  total: number
  color?: string
}) {
  const ratio = total ? done / total : 0
  // A full-width bar scaled from the left: transforms run on the native
  // driver, widths don't. It starts at the current ratio, so nothing animates
  // on first show.
  const scale = useRef(new Animated.Value(ratio)).current
  useEffect(() => {
    if (reduceMotion) return scale.setValue(ratio)
    Animated.timing(scale, {
      toValue: ratio,
      duration: 220,
      easing: easeOut,
      useNativeDriver: true
    }).start()
  }, [ratio])
  return (
    <View
      style={styles.track}
      accessibilityRole='progressbar'
      accessibilityValue={{ min: 0, max: total, now: done }}
    >
      <Animated.View
        style={[
          styles.bar,
          { backgroundColor: color || colors.accent },
          ratio === 1 && styles.barDone,
          { transformOrigin: 'left', transform: [{ scaleX: scale }] }
        ]}
      />
    </View>
  )
}

// Overlapping avatars, the rest as "+n".
export function AvatarStack({
  identities,
  data,
  size,
  max = 3,
  cache,
  requestImage
}: { identities: string[]; data: BoardData; size: number; max?: number } & Images) {
  if (!identities.length) return null
  const shown = identities.slice(0, max)
  return (
    <View style={styles.stack}>
      {shown.map((identity, i) => (
        <View
          key={identity}
          style={[styles.stackItem, { marginLeft: i ? -size / 3 : 0, borderRadius: size }]}
        >
          <Avatar
            hex={identity}
            size={size}
            image={avatarOf(data, identity)}
            cache={cache}
            requestImage={requestImage}
          />
        </View>
      ))}
      {identities.length > max ? <Text style={styles.more}>+{identities.length - max}</Text> : null}
    </View>
  )
}

export function ReactionBar({
  reactions,
  me,
  onToggle,
  nameFor,
  compact
}: {
  reactions: Reactions | undefined
  me: string
  onToggle: (emoji: string, on: boolean) => void
  nameFor: (identity: string) => string
  compact?: boolean
}) {
  const [picking, setPicking] = useState(false)
  const used = REACTIONS.filter((emoji) => reactions?.[emoji]?.length)
  return (
    <View style={styles.reactions}>
      {used.map((emoji) => {
        const who = reactions?.[emoji] || []
        const mine = who.includes(me)
        const summary = `${emoji} ${who.length}: ${who.map(nameFor).join(', ')}`
        return (
          <PressableScale
            key={emoji}
            onPress={() => onToggle(emoji, !mine)}
            style={[
              styles.reaction,
              compact && styles.reactionCompact,
              mine && styles.reactionMine
            ]}
            accessibilityRole='button'
            accessibilityState={{ selected: mine }}
            accessibilityLabel={
              mine ? t('{reaction}. Tap to remove yours', { reaction: summary }) : summary
            }
          >
            <Text style={styles.emoji}>{emoji}</Text>
            <Text style={[styles.count, mine && styles.countMine]}>{who.length}</Text>
          </PressableScale>
        )
      })}
      <PressableScale
        onPress={() => setPicking(!picking)}
        style={[styles.reaction, compact && styles.reactionCompact, picking && styles.reactionMine]}
        accessibilityRole='button'
        accessibilityLabel={picking ? t('Close reactions') : t('Add a reaction')}
      >
        <Feather name={picking ? 'x' : 'smile'} size={15} color={colors.muted} />
      </PressableScale>
      {picking ? (
        <PickerIn>
          {REACTIONS.map((emoji) => {
            const mine = !!reactions?.[emoji]?.includes(me)
            return (
              <PressableScale
                key={emoji}
                onPress={() => {
                  onToggle(emoji, !mine)
                  setPicking(false)
                }}
                style={[styles.pick, mine && styles.reactionMine]}
                accessibilityRole='button'
                accessibilityLabel={
                  mine ? t('Remove {emoji}', { emoji }) : t('React with {emoji}', { emoji })
                }
              >
                <Text style={styles.pickEmoji}>{emoji}</Text>
              </PressableScale>
            )
          })}
        </PickerIn>
      ) : null}
    </View>
  )
}

// The reaction picker grows in from its left edge; closing it is instant.
function PickerIn({ children }: { children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 150,
      easing: easeOut,
      useNativeDriver: true
    }).start()
  }, [progress])
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] })
  return (
    <Animated.View
      style={[
        styles.picker,
        { opacity: progress, transformOrigin: 'left', transform: [{ scale }] }
      ]}
    >
      {children}
    </Animated.View>
  )
}

export function ChecklistEditor({ card, send }: { card: Card; send: Send }) {
  const [draft, setDraft] = useState('')
  const [hideDone, setHideDone] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState(false)
  const items = checklistOf(card)
  const { done, total } = checklistProgress(card)
  const filtered = hideDone ? items.filter((item) => !item.done) : items
  const shown = expanded ? filtered : filtered.slice(0, ROWS_SHOWN)
  const set = (fields: object) =>
    send({ type: messageTypes.checklistSet, objectId: card.id, ...fields })
  const add = () => {
    const text = draft.trim()
    if (!text) return
    set({ text })
    setDraft('')
  }
  const rename = (id: string, text: string) => {
    const next = (names[id] ?? text).trim()
    if (next && next !== text) set({ itemId: id, text: next })
    setNames((current) => {
      const rest = { ...current }
      delete rest[id]
      return rest
    })
  }
  return (
    <View style={styles.gap}>
      {total ? (
        <View style={styles.progressRow}>
          <Text style={styles.metaMono}>
            {done}/{total}
          </Text>
          <View style={styles.flex}>
            <ProgressBar done={done} total={total} />
          </View>
          {done ? (
            <Pressable
              onPress={() => setHideDone(!hideDone)}
              hitSlop={10}
              accessibilityRole='button'
            >
              <Text style={styles.link}>
                {hideDone ? t('Show done ({count})', { count: done }) : t('Hide done')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {shown.map((item, i) => (
        <View key={item.id} style={styles.item}>
          <PressableScale
            onPress={() => set({ itemId: item.id, done: !item.done })}
            style={styles.check}
            scaleTo={0.9}
            accessibilityRole='checkbox'
            accessibilityState={{ checked: item.done }}
            accessibilityLabel={item.text}
          >
            <View style={[styles.box, item.done && styles.boxDone]}>
              {item.done ? <Feather name='check' size={14} color={colors.onAccent} /> : null}
            </View>
          </PressableScale>
          <TextInput
            style={[styles.itemText, item.done && styles.itemDone]}
            value={names[item.id] ?? item.text}
            onChangeText={(value) => setNames((current) => ({ ...current, [item.id]: value }))}
            onEndEditing={() => rename(item.id, item.text)}
            multiline
            blurOnSubmit
            returnKeyType='done'
            maxLength={300}
            accessibilityLabel={t('Checklist item')}
          />
          {!hideDone && i > 0 ? (
            <Pressable
              onPress={() => set({ itemId: item.id, index: i - 1 })}
              style={styles.iconHit}
              accessibilityRole='button'
              accessibilityLabel={t('Move “{item}” up', { item: item.text })}
            >
              <Feather name='arrow-up' size={15} color={colors.muted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => set({ itemId: item.id, deleted: true })}
            style={styles.iconHit}
            accessibilityRole='button'
            accessibilityLabel={t('Delete “{item}”', { item: item.text })}
          >
            <Feather name='x' size={16} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      {filtered.length > shown.length ? (
        <ShowAll total={filtered.length} onPress={() => setExpanded(true)} />
      ) : null}
      {hideDone && !shown.length && total ? (
        <Text style={styles.hint}>{t('Everything is done.')}</Text>
      ) : null}
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={add}
        placeholder={t('+ Add an item')}
        placeholderTextColor={colors.muted}
        maxLength={300}
        returnKeyType='done'
        blurOnSubmit={false}
        accessibilityLabel={t('New checklist item')}
      />
    </View>
  )
}

export function AssigneePicker({
  card,
  data,
  me,
  send,
  nameFor,
  cache,
  requestImage
}: {
  card: Card
  data: BoardData
  me: string
  send: Send
  nameFor: (identity: string) => string
} & Images) {
  const assignees = card.assignees || []
  const toggle = (identity: string) =>
    send({
      type: messageTypes.cardUpdate,
      objectId: card.id,
      assignees: assignees.includes(identity)
        ? assignees.filter((id) => id !== identity)
        : [...assignees, identity]
    })
  const [open, setOpen] = useState(false)
  const members = assignable(data, me)
  if (!open) {
    return (
      <View style={styles.wrap}>
        {assignees.map((identity) => (
          <View key={identity} style={[styles.person, styles.personOn]}>
            <Avatar
              hex={identity}
              size={22}
              image={avatarOf(data, identity)}
              cache={cache}
              requestImage={requestImage}
            />
            <Text style={[styles.personName, styles.personNameOn]} numberOfLines={1}>
              {identity === me ? t('You') : nameFor(identity)}
            </Text>
          </View>
        ))}
        <Chip
          label={assignees.length ? t('Change') : t('+ Assign')}
          onPress={() => setOpen(true)}
        />
      </View>
    )
  }
  return (
    <View style={styles.wrap}>
      {members.map((member) => {
        const on = assignees.includes(member.identity)
        const name = member.name || nameFor(member.identity)
        return (
          <PressableScale
            key={member.identity}
            onPress={() => toggle(member.identity)}
            style={[styles.person, on && styles.personOn]}
            accessibilityRole='button'
            accessibilityState={{ selected: on }}
            accessibilityLabel={on ? t('Unassign {name}', { name }) : t('Assign {name}', { name })}
          >
            <Avatar
              hex={member.identity}
              size={22}
              image={member.avatar}
              cache={cache}
              requestImage={requestImage}
            />
            <Text style={[styles.personName, on && styles.personNameOn]} numberOfLines={1}>
              {member.identity === me ? t('{name} (you)', { name }) : name}
            </Text>
            {on ? <Feather name='check' size={14} color={colors.onAccent} /> : null}
          </PressableScale>
        )
      })}
      {/* Someone removed from the board stays listed until unassigned. */}
      {assignees
        .filter((identity) => !members.some((member) => member.identity === identity))
        .map((identity) => (
          <Chip key={identity} label={`✕ ${nameFor(identity)}`} onPress={() => toggle(identity)} />
        ))}
      <Chip label={t('Done')} selected onPress={() => setOpen(false)} />
    </View>
  )
}

export function LinksEditor({
  card,
  data,
  send,
  onOpen
}: {
  card: Card
  data: BoardData
  send: Send
  onOpen: (cardId: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<'blocks' | 'relates'>('blocks')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const links = linksOf(data, card)
  const linked = new Set(links.map((link) => link.card.id))
  const results = useMemo(() => {
    const text = query.trim().toLowerCase()
    return data.objects
      .filter(
        (other) =>
          other.id !== card.id &&
          !other.template &&
          !linked.has(other.id) &&
          (!text || other.title.toLowerCase().includes(text))
      )
      .slice(0, 8)
  }, [query, data.objects, card.id, links.length])
  const setLink = (objectId: string, targetId: string, linkKind: string, on: boolean) =>
    send({ type: messageTypes.linkSet, objectId, targetId, kind: linkKind, linked: on })
  return (
    <View style={styles.gap}>
      {links.length ? null : <Text style={styles.hint}>{t('No linked cards.')}</Text>}
      {(expanded ? links : links.slice(0, ROWS_SHOWN)).map((link) => {
        const open = !link.card.archived
        return (
          <View key={`${link.outgoing}:${link.kind}:${link.card.id}`} style={styles.linkRow}>
            <Pressable
              style={styles.linkMain}
              onPress={() => onOpen(link.card.id)}
              accessibilityRole='button'
              accessibilityLabel={`${linkText(link)} ${link.card.title}`}
            >
              <Text
                style={[
                  styles.linkKind,
                  link.kind === 'blocks' && !link.outgoing && styles.linkBlocked
                ]}
              >
                {linkText(link)}
              </Text>
              <Text style={[styles.linkTitle, !open && styles.itemDone]} numberOfLines={2}>
                {link.card.title}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                link.outgoing
                  ? setLink(card.id, link.card.id, link.kind, false)
                  : setLink(link.card.id, card.id, link.kind, false)
              }
              style={styles.iconHit}
              accessibilityRole='button'
              accessibilityLabel={t('Remove link to {card}', { card: link.card.title })}
            >
              <Feather name='x' size={16} color={colors.muted} />
            </Pressable>
          </View>
        )
      })}
      {!expanded && links.length > ROWS_SHOWN ? (
        <ShowAll total={links.length} onPress={() => setExpanded(true)} />
      ) : null}
      {adding ? (
        <View style={styles.panel}>
          <View style={styles.wrap}>
            <Chip
              label={t('Blocks')}
              selected={kind === 'blocks'}
              onPress={() => setKind('blocks')}
            />
            <Chip
              label={t('Relates to')}
              selected={kind === 'relates'}
              onPress={() => setKind('relates')}
            />
          </View>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t('Search cards by title')}
            placeholderTextColor={colors.muted}
            autoFocus
            accessibilityLabel={t('Search cards to link')}
          />
          {results.length ? null : <Text style={styles.hint}>{t('No matching cards.')}</Text>}
          {results.map((other) => (
            <PressableScale
              key={other.id}
              onPress={() => {
                setLink(card.id, other.id, kind, true)
                setQuery('')
                setAdding(false)
              }}
              style={[styles.result]}
              accessibilityRole='button'
            >
              <Text style={styles.linkTitle} numberOfLines={2}>
                {other.title}
              </Text>
              <Text style={styles.metaMono}>
                {data.columns.find((column) => column.id === other.columnId)?.name || ''}
              </Text>
            </PressableScale>
          ))}
          <Button title={t('Cancel')} variant='ghost' onPress={() => setAdding(false)} />
        </View>
      ) : (
        <Button
          title={t('Add link')}
          icon='link'
          variant='secondary'
          onPress={() => setAdding(true)}
        />
      )}
    </View>
  )
}

export function EstimatePanel({
  card,
  data,
  me,
  send,
  nameFor,
  cache,
  requestImage
}: {
  card: Card
  data: BoardData
  me: string
  send: Send
  nameFor: (identity: string) => string
} & Images) {
  const estimates = card.estimates || {}
  const voters = Object.keys(estimates)
  const mine = estimates[me]
  const revealed = !!card.revealEstimates
  const values = [...new Set(Object.values(estimates))].sort((a, b) => a - b)
  const [open, setOpen] = useState(false)
  // Bumped when votes go from hidden to shown, so the values remount and
  // animate in; showing the panel with votes already revealed doesn't.
  const [reveals, setReveals] = useState(0)
  const wasRevealed = useRef(revealed)
  useEffect(() => {
    if (revealed && !wasRevealed.current) setReveals((count) => count + 1)
    wasRevealed.current = revealed
  }, [revealed])
  const update = (fields: object) =>
    send({ type: messageTypes.cardUpdate, objectId: card.id, ...fields })
  const points =
    typeof card.points === 'number' ? t('{points} pts', { points: card.points }) : t('No estimate')
  if (!open) {
    return (
      <PressableScale
        onPress={() => setOpen(true)}
        style={styles.summary}
        accessibilityRole='button'
        accessibilityLabel={plural(
          voters.length,
          ['{points}, {n} vote. Open planning poker', '{points}, {n} votes. Open planning poker'],
          [
            '{points}, {n} głos. Otwórz planning poker',
            '{points}, {n} głosy. Otwórz planning poker',
            '{points}, {n} głosów. Otwórz planning poker'
          ]
        ).replace('{points}', () => points)}
      >
        <Text style={styles.points}>
          {points}
          <Text style={styles.metaMono}>
            {voters.length
              ? ` · ${plural(voters.length, ['{n} vote', '{n} votes'], ['{n} głos', '{n} głosy', '{n} głosów'])}`
              : ''}
            {mine !== undefined ? ` · ${t('you: {value}', { value: mine })}` : ''}
          </Text>
        </Text>
        <Feather name='chevron-right' size={18} color={colors.muted} />
      </PressableScale>
    )
  }
  return (
    <View style={styles.gap}>
      <View style={styles.progressRow}>
        <Text style={styles.points}>{points}</Text>
        {typeof card.points === 'number' ? (
          <Pressable
            onPress={() => update({ points: null })}
            hitSlop={10}
            accessibilityRole='button'
          >
            <Text style={styles.link}>{t('Clear')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityRole='button'>
          <Text style={styles.link}>{t('Hide')}</Text>
        </Pressable>
      </View>
      <View style={styles.wrap}>
        {POKER_VALUES.map((value) => (
          <PressableScale
            key={value}
            onPress={() =>
              send({
                type: messageTypes.estimateSet,
                objectId: card.id,
                value: mine === value ? null : value
              })
            }
            style={[styles.pokerCard, mine === value && styles.pokerMine]}
            accessibilityRole='button'
            accessibilityState={{ selected: mine === value }}
            accessibilityLabel={
              mine === value
                ? t('Withdraw my vote of {value}', { value })
                : t('Vote {value}', { value })
            }
          >
            <Text style={[styles.pokerText, mine === value && styles.pokerTextMine]}>{value}</Text>
          </PressableScale>
        ))}
        <PressableScale
          onPress={() => send({ type: messageTypes.estimateSet, objectId: card.id, value: null })}
          style={[styles.pokerCard]}
          accessibilityRole='button'
          accessibilityLabel={t('Not sure: withdraw my vote')}
        >
          <Text style={styles.pokerText}>?</Text>
        </PressableScale>
      </View>
      {voters.length ? (
        <View style={styles.votes}>
          {voters.map((identity, i) => (
            <View key={identity} style={styles.vote}>
              <Avatar
                hex={identity}
                size={18}
                image={avatarOf(data, identity)}
                cache={cache}
                requestImage={requestImage}
              />
              <Text style={styles.voteName} numberOfLines={1}>
                {identity === me ? t('You') : nameFor(identity)}
              </Text>
              {revealed && reveals ? (
                <RevealValue key={`${identity}:${reveals}`} index={i}>
                  {estimates[identity]}
                </RevealValue>
              ) : (
                <Text style={styles.voteValue}>
                  {revealed || identity === me ? estimates[identity] : '•'}
                </Text>
              )}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.hint}>{t('Nobody voted yet. Votes stay hidden until revealed.')}</Text>
      )}
      {voters.length && !revealed ? (
        <Button
          title={plural(
            voters.length,
            ['Reveal {n} vote', 'Reveal {n} votes'],
            ['Odkryj {n} głos', 'Odkryj {n} głosy', 'Odkryj {n} głosów']
          )}
          icon='eye'
          variant='secondary'
          onPress={() => update({ revealEstimates: true })}
        />
      ) : null}
      {revealed ? (
        <View style={styles.wrap}>
          {values.map((value) => (
            <Button
              key={value}
              title={t('Use {value}', { value })}
              variant={card.points === value ? 'primary' : 'secondary'}
              onPress={() => update({ points: value })}
            />
          ))}
          <Button
            title={t('Hide votes')}
            variant='ghost'
            onPress={() => update({ revealEstimates: false })}
          />
        </View>
      ) : null}
    </View>
  )
}

// A revealed vote: staggered fade and grow, or a plain fade with Reduce Motion.
function RevealValue({ index, children }: { index: number; children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 150 : 180,
      delay: reduceMotion ? 0 : Math.min(index, 7) * 40,
      easing: easeOut,
      useNativeDriver: true
    }).start()
  }, [progress])
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] })
  return (
    <Animated.Text
      style={[styles.voteValue, { opacity: progress }, !reduceMotion && { transform: [{ scale }] }]}
    >
      {children}
    </Animated.Text>
  )
}

const styles = themed(() => ({
  flex: { flex: 1 },
  gap: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  hint: { color: colors.muted, fontSize: 12 },
  link: { color: colors.info, fontWeight: '600', fontSize: 14 },
  metaMono: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  bar: { width: '100%', height: 4, borderRadius: 2 },
  showAll: { alignSelf: 'flex-start', paddingVertical: 4 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  barDone: { backgroundColor: colors.success },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  stack: { flexDirection: 'row', alignItems: 'center' },
  stackItem: { borderWidth: 1.5, borderColor: colors.surfaceRaised, overflow: 'hidden' },
  more: { color: colors.muted, fontFamily: mono, fontSize: 11, marginLeft: 4 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  reaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 44,
    minHeight: 34,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'center'
  },
  reactionCompact: { minHeight: 30, paddingHorizontal: 7 },
  reactionMine: { borderColor: colors.accent, backgroundColor: tint(colors.accent, 0.12) },
  emoji: { fontSize: 15 },
  count: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  countMine: { color: colors.accent, fontWeight: '700' },
  picker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  pick: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center'
  },
  pickEmoji: { fontSize: 22 },
  // Top-aligned, so the box sits by the first line of a wrapped item.
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  check: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center'
  },
  boxDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  itemText: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 20, paddingVertical: 12 },
  itemDone: { color: colors.muted, textDecorationLine: 'line-through' },
  iconHit: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 44,
    color: colors.text
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    minHeight: 44,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border
  },
  personOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  personName: { color: colors.text, fontWeight: '600', fontSize: 13, flexShrink: 1 },
  personNameOn: { color: colors.onAccent },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingLeft: 12
  },
  linkMain: { flex: 1, paddingVertical: 10, gap: 2 },
  linkKind: {
    color: colors.muted,
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase'
  },
  linkBlocked: { color: colors.danger },
  linkTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  panel: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  result: {
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.bg,
    minHeight: 44
  },
  points: { flex: 1, color: colors.text, fontFamily: mono, fontSize: 15, fontWeight: '700' },
  pokerCard: {
    width: 44,
    height: 52,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  pokerMine: { backgroundColor: colors.accent, borderColor: colors.accent },
  pokerText: { color: colors.text, fontFamily: mono, fontSize: 16, fontWeight: '700' },
  pokerTextMine: { color: colors.onAccent },
  votes: { gap: 6 },
  vote: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voteName: { flex: 1, color: colors.text, fontSize: 13 },
  voteValue: { color: colors.text, fontFamily: mono, fontSize: 14, fontWeight: '700' }
}))
