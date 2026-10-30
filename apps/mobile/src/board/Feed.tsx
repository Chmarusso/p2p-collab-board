// The Feed layout (board-protocol/kinds.js, layout 'feed'): every post newest
// first, full width. A post without a photo gets a cover drawn from its text
// (feedCover: the same colours on every client).
import React, { useState } from 'react'
import { Image, Linking, Pressable, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { REACTIONS, feedCover } from '@opencollab/board-protocol'
import { Avatar, CachedImage, ImageRef, colors, themed } from '../ui'
import { t } from '../i18n'
import { Markdown } from './Markdown'
import { ShortsButton, ShortsPlayer, shortsOf, useWatched } from './Shorts'
import { SlidesButton, SlidesPlayer, deckOf, decksOf } from './Slides'
import { useImageUri } from './Panels'
import { BusyChip } from './Sync'
import { BoardData, Card, avatarOf, imagesOf, sourceSite } from './model'

export function FeedView({
  data,
  cards,
  me,
  cache,
  requestImage,
  nameFor,
  relativeTime,
  onOpen,
  busyOf,
  onCompose,
  boardKey,
  send,
  subscribe
}: {
  data: BoardData
  cards: Card[]
  me: string
  boardKey: string
  send: (message: object) => void
  subscribe: (listener: (message: { type: string; [key: string]: any }) => void) => () => void
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  nameFor: (identity: string) => string
  relativeTime: (iso?: string) => string
  onOpen: (cardId: string) => void
  // A bot working on the post, or changes to it arriving (see Sync.tsx).
  busyOf?: (cardId: string) => string | undefined
  onCompose: () => void
}) {
  // Shorts play in their own player, not in the list of posts.
  const shorts = shortsOf(data, cards)
  const shortIds = new Set(shorts.map((card) => card.id))
  const posts = cards
    .filter((card) => !shortIds.has(card.id))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  const { watched, markWatched } = useWatched(me, boardKey)
  const [playing, setPlaying] = useState(false)
  // Posts with key points open as slides; the button flips through unread ones.
  const decks = decksOf(data, posts)
  const deckIds = new Set(decks.map((card) => card.id))
  const read = useWatched(me, boardKey, 'slides')
  const [flipping, setFlipping] = useState<Card[] | null>(null)
  return (
    <View style={styles.root}>
      {decks.length ? (
        <SlidesButton
          decks={decks}
          read={read.watched}
          onPress={() => setFlipping(decks.filter((card) => !read.watched.includes(card.id)))}
        />
      ) : null}
      {flipping ? (
        <SlidesPlayer
          data={data}
          queue={flipping}
          markRead={read.markWatched}
          cache={cache}
          requestImage={requestImage}
          onOpenCard={(cardId) => {
            setFlipping(null)
            onOpen(cardId)
          }}
          onClose={() => setFlipping(null)}
        />
      ) : null}
      {shorts.length ? (
        <ShortsButton shorts={shorts} watched={watched} onPress={() => setPlaying(true)} />
      ) : null}
      {playing ? (
        <ShortsPlayer
          shorts={shorts}
          watched={watched}
          markWatched={markWatched}
          send={send}
          subscribe={subscribe}
          onClose={() => setPlaying(false)}
        />
      ) : null}
      <Pressable
        onPress={onCompose}
        style={({ pressed }) => [styles.compose, pressed && styles.pressed]}
        accessibilityRole='button'
      >
        <Avatar
          hex={me}
          size={32}
          image={avatarOf(data, me)}
          cache={cache}
          requestImage={requestImage}
        />
        <Text style={styles.composeText}>{t('Share something…')}</Text>
        <Feather name='image' size={18} color={colors.muted} />
      </Pressable>
      {posts.map((card) => (
        <Post
          key={card.id}
          card={card}
          data={data}
          cache={cache}
          requestImage={requestImage}
          nameFor={nameFor}
          relativeTime={relativeTime}
          busy={busyOf?.(card.id)}
          onPress={() => (deckIds.has(card.id) ? setFlipping([card]) : onOpen(card.id))}
        />
      ))}
      {!posts.length ? (
        <Text style={styles.empty}>
          {t('No posts yet. Write one, or share a link from any app and pick this board.')}
        </Text>
      ) : null}
    </View>
  )
}

function Post({
  card,
  data,
  cache,
  requestImage,
  nameFor,
  relativeTime,
  busy,
  onPress
}: {
  card: Card
  data: BoardData
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  nameFor: (identity: string) => string
  relativeTime: (iso?: string) => string
  busy?: string
  onPress: () => void
}) {
  const photo = imagesOf(card)[0]
  const uri = useImageUri(photo, cache, requestImage)
  // A post with key points shows its hook; the slides themselves open on tap.
  const text = (deckOf(data, card)?.summary || card.body || '').trim()
  const comments = card.comments?.length || 0
  const reactions = REACTIONS.filter((emoji) => card.reactions?.[emoji]?.length)
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.post, pressed && styles.pressed]}
      accessibilityRole='button'
      accessibilityLabel={card.title}
    >
      <View style={styles.author}>
        <Avatar
          hex={card.author}
          size={28}
          image={avatarOf(data, card.author)}
          cache={cache}
          requestImage={requestImage}
        />
        <Text style={styles.authorName} numberOfLines={1}>
          {nameFor(card.author)}
        </Text>
        <Text style={styles.time}>{relativeTime(card.createdAt)}</Text>
      </View>
      {busy ? (
        <View style={styles.busy}>
          <BusyChip text={busy} />
        </View>
      ) : null}
      {photo ? (
        uri ? (
          <Image source={{ uri }} style={styles.photo} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.photo, styles.photoLoading]} />
        )
      ) : (
        <Cover card={card} />
      )}
      {photo || text || card.source || comments || reactions.length ? (
        <View style={styles.text}>
          {photo ? <Text style={styles.title}>{card.title}</Text> : null}
          {text ? (
            <Markdown
              text={text}
              mentions={card.mentions?.map((identity) => ({ identity, name: nameFor(identity) }))}
              numberOfLines={4}
            />
          ) : null}
          {card.source ? (
            <Pressable
              onPress={() => void Linking.openURL(card.source!.url)}
              style={styles.source}
              accessibilityRole='link'
              hitSlop={6}
            >
              <Feather name='external-link' size={13} color={colors.accent} />
              <Text style={styles.sourceText} numberOfLines={1}>
                {sourceSite(card.source)}
              </Text>
            </Pressable>
          ) : null}
          {comments || reactions.length ? (
            <View style={styles.footer}>
              {reactions.length ? (
                <Text style={styles.reactions}>
                  {reactions
                    .slice(0, 4)
                    .map(
                      (emoji) =>
                        `${emoji}${card.reactions![emoji].length > 1 ? card.reactions![emoji].length : ''}`
                    )
                    .join(' ')}
                </Text>
              ) : null}
              {comments ? (
                <View style={styles.comments}>
                  <Feather name='message-square' size={13} color={colors.muted} />
                  <Text style={styles.footerText}>{comments}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  )
}

// A text post's cover: its title over a gradient picked from the card id.
function Cover({ card }: { card: Card }) {
  const cover = feedCover(card.id)
  return (
    <View
      style={[
        styles.cover,
        {
          backgroundColor: cover.from,
          experimental_backgroundImage: `linear-gradient(135deg, ${cover.from}, ${cover.to})`
        }
      ]}
    >
      <Feather name='message-circle' size={22} color={cover.ink} style={styles.coverIcon} />
      <Text style={[styles.coverText, { color: cover.ink }]} numberOfLines={5}>
        {card.title}
      </Text>
    </View>
  )
}

const styles = themed(() => ({
  root: { gap: 14, paddingHorizontal: 16 },
  compose: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10
  },
  composeText: { color: colors.muted, flex: 1, fontSize: 15 },
  pressed: { opacity: 0.8 },
  post: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden'
  },
  author: { alignItems: 'center', flexDirection: 'row', gap: 8, padding: 12 },
  busy: { paddingBottom: 8, paddingHorizontal: 12, marginTop: -4 },
  authorName: { color: colors.text, flexShrink: 1, fontSize: 14, fontWeight: '600' },
  time: { color: colors.muted, fontSize: 12 },
  photo: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surface },
  photoLoading: { opacity: 0.6 },
  cover: {
    aspectRatio: 16 / 9,
    justifyContent: 'flex-end',
    padding: 18,
    width: '100%'
  },
  coverIcon: { opacity: 0.7, position: 'absolute', left: 18, top: 16 },
  coverText: { fontSize: 24, fontWeight: '800', lineHeight: 30 },
  text: { gap: 8, padding: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  source: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6 },
  sourceText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  footer: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  reactions: { fontSize: 14 },
  comments: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  footerText: { color: colors.muted, fontSize: 13 },
  empty: { color: colors.muted, lineHeight: 20, textAlign: 'center' }
}))
