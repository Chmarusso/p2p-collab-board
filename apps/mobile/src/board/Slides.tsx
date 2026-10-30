// Slide decks: a post's key points as a short story to watch (see
// apps/cli/examples/feed-slides.mjs, which labels them `slides`). The deck is
// the card's description: a one-line hook, then `## emoji heading` + lines per
// slide, separated by `---`. Read decks are remembered on this device.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { feedCover } from '@opencollab/board-protocol'
import { plural, t } from '../i18n'
import { CachedImage, ImageRef, themed } from '../ui'
import { useImageUri } from './Panels'
import { BoardData, Card, imagesOf, sourceSite } from './model'

export const SLIDES_LABEL = 'slides'

export type Slide = { heading: string; lines: string[] }

// The deck in a card labelled `slides`; null for any other card.
export function deckOf(data: BoardData, card: Card) {
  const label = data.labels.find((entry) => entry.name.toLowerCase() === SLIDES_LABEL)
  if (!label || !card.labelIds?.includes(label.id)) return null
  const [intro, ...sections] = (card.body || '').split(/^\s*---\s*$/m).map((part) => part.trim())
  const slides: Slide[] = sections
    .filter((section) => section.startsWith('## '))
    .map((section) => {
      const [heading, ...lines] = section.split('\n')
      return { heading: heading.replace(/^##\s*/, ''), lines: lines.filter((line) => line.trim()) }
    })
  return slides.length ? { summary: intro.replace(/^##.*$/m, '').trim(), slides } : null
}

// Cards with a deck, newest first.
export function decksOf(data: BoardData, cards: Card[]) {
  return cards
    .filter((card) => !card.archived && deckOf(data, card))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

export function SlidesButton({
  decks,
  read,
  onPress
}: {
  decks: Card[]
  read: string[]
  onPress: () => void
}) {
  const fresh = decks.filter((card) => !read.includes(card.id)).length
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityRole='button'
    >
      <View style={styles.buttonIcon}>
        <Feather name='layers' size={18} color='#ffffff' />
      </View>
      <View style={styles.buttonText}>
        <Text style={styles.buttonTitle}>{t('Key points')}</Text>
        <Text style={styles.buttonMeta}>
          {fresh
            ? plural(
                fresh,
                ['{n} new post to flip through', '{n} new posts to flip through'],
                [
                  '{n} nowy post do przejrzenia',
                  '{n} nowe posty do przejrzenia',
                  '{n} nowych postów do przejrzenia'
                ]
              )
            : t('All read')}
        </Text>
      </View>
      <Feather name='chevron-right' size={18} color='#ffffff' />
    </Pressable>
  )
}

// Plays `queue`'s decks like stories: each slide runs on a timer shown in the
// bars at the top. Tap the right side for the next slide and the left for the
// previous one, hold to pause, swipe sideways for another post and down to
// close. Past a deck's last slide it goes on to the next post.
export function SlidesPlayer({
  data,
  queue,
  markRead,
  cache,
  requestImage,
  onOpenCard,
  onClose
}: {
  data: BoardData
  queue: Card[]
  markRead: (id: string) => void
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  onOpenCard: (cardId: string) => void
  onClose: () => void
}) {
  const { width } = useWindowDimensions()
  const [position, setPosition] = useState({ deck: 0, slide: 0 })
  const [paused, setPaused] = useState(false)
  const card = queue[position.deck]
  const deck = card ? deckOf(data, card) : null
  // Slide 0 is the cover: the hook over the post's picture.
  const total = deck ? deck.slides.length + 1 : 0
  const slide = deck && position.slide > 0 ? deck.slides[position.slide - 1] : null
  const photo = useImageUri(card ? imagesOf(card)[0] : null, cache, requestImage)
  const cover = card ? feedCover(card.id) : null
  const accent = card ? accentOf(card.id) : ACCENTS[0]

  const move = (step: 1 | -1) =>
    setPosition((current) => {
      const currentCard = queue[current.deck]
      const currentDeck = currentCard ? deckOf(data, currentCard) : null
      const count = currentDeck ? currentDeck.slides.length + 1 : 0
      if (step === 1) {
        if (current.slide + 1 < count) return { ...current, slide: current.slide + 1 }
        if (currentCard) markRead(currentCard.id)
        return { deck: current.deck + 1, slide: 0 }
      }
      if (current.slide > 0) return { ...current, slide: current.slide - 1 }
      if (current.deck === 0) return current
      const previous = deckOf(data, queue[current.deck - 1])
      return { deck: current.deck - 1, slide: previous ? previous.slides.length : 0 }
    })
  // Another post: the next one counts this one as read.
  const jump = (step: 1 | -1) =>
    setPosition((current) => {
      if (step === 1 && queue[current.deck]) markRead(queue[current.deck].id)
      const deckIndex = Math.max(0, Math.min(queue.length, current.deck + step))
      return { deck: deckIndex, slide: 0 }
    })

  // The timer: the current bar fills, then the next slide starts.
  const progress = useRef(new Animated.Value(0)).current
  const duration = durationOf(slide ? [slide.heading, ...slide.lines] : [deck?.summary || ''])
  useEffect(() => progress.setValue(0), [position.deck, position.slide])
  useEffect(() => {
    if (!deck || paused) return
    let left = 1
    progress.stopAnimation((value) => (left = 1 - value))
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: duration * left,
      easing: Easing.linear,
      useNativeDriver: false
    })
    run.start(({ finished }) => finished && move(1))
    return () => run.stop()
  }, [position.deck, position.slide, paused, !!deck])

  // The text comes in line by line on every slide. Each slide gets new values
  // and new views: reusing natively driven values across slides left the first
  // slide after the cover blank until it was shown a second time.
  const lineCount = slide ? slide.lines.length + 2 : 4
  const enter = useMemo(
    () => Array.from({ length: 12 }, () => new Animated.Value(0)),
    [position.deck, position.slide]
  )
  useEffect(() => {
    Animated.stagger(
      90,
      enter
        .slice(0, lineCount)
        .map((value) =>
          Animated.spring(value, { toValue: 1, damping: 16, stiffness: 160, useNativeDriver: true })
        )
    ).start()
  }, [enter])
  const rise = (index: number) => ({
    opacity: enter[Math.min(index, enter.length - 1)],
    transform: [
      {
        translateY: enter[Math.min(index, enter.length - 1)].interpolate({
          inputRange: [0, 1],
          outputRange: [28, 0]
        })
      }
    ]
  })

  // The handlers are made once: they read the latest functions from a ref.
  const actions = useRef({ jump, onClose })
  actions.current = { jump, onClose }
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 24 || gesture.dy > 24,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 120 && gesture.dy > Math.abs(gesture.dx)) actions.current.onClose()
        else if (gesture.dx < -60) actions.current.jump(1)
        else if (gesture.dx > 60) actions.current.jump(-1)
      },
      onPanResponderTerminationRequest: () => true
    })
  ).current

  return (
    <Modal visible animationType='fade' onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle='light-content' />
      <View style={styles.root} {...swipe.panHandlers}>
        {!card || !deck ? (
          <View style={styles.end}>
            <Text style={styles.endEmoji}>🎉</Text>
            <Text style={styles.endTitle}>{t('You’re all caught up')}</Text>
            <Text style={styles.endText}>
              {t('Nothing new to read. New posts get their key points automatically.')}
            </Text>
            <Pressable onPress={onClose} style={styles.endButton} accessibilityRole='button'>
              <Text style={styles.endButtonText}>{t('Close')}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* The background: the post's picture, blurred and darkened. */}
            {photo ? (
              <Image
                source={{ uri: photo }}
                style={styles.backdrop}
                blurRadius={28}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View
                style={[
                  styles.backdrop,
                  {
                    backgroundColor: cover!.from,
                    experimental_backgroundImage: `linear-gradient(160deg, ${cover!.from}, ${cover!.to})`
                  }
                ]}
              />
            )}
            <View style={styles.shade} />

            <Pressable
              style={styles.stage}
              onPressIn={() => setPaused(true)}
              onPressOut={() => setPaused(false)}
              onLongPress={() => {}}
              delayLongPress={220}
              onPress={(event) => move(event.nativeEvent.locationX < width / 3 ? -1 : 1)}
              accessibilityRole='button'
              accessibilityLabel={t('Next')}
            >
              {slide ? (
                <View key={`${position.deck}.${position.slide}`} style={styles.slide}>
                  {emojiOf(slide.heading) ? (
                    <Animated.Text style={[styles.emoji, rise(0)]}>
                      {emojiOf(slide.heading)}
                    </Animated.Text>
                  ) : null}
                  <Animated.Text style={[styles.heading, rise(1)]}>
                    {withoutEmoji(slide.heading)}
                  </Animated.Text>
                  {slide.lines.map((line, index) => (
                    <Animated.View key={index} style={rise(index + 2)}>
                      <Rich
                        text={line.replace(/^\s*(?:[-*•]|\d+\.)\s+/, '')}
                        accent={accent}
                        style={styles.line}
                      />
                    </Animated.View>
                  ))}
                </View>
              ) : (
                <View key={`${position.deck}.cover`} style={styles.slide}>
                  {photo ? (
                    <Animated.View style={[styles.photoFrame, rise(0)]}>
                      <Image
                        source={{ uri: photo }}
                        style={styles.photo}
                        accessibilityIgnoresInvertColors
                      />
                    </Animated.View>
                  ) : null}
                  <Animated.View style={rise(1)}>
                    <Text style={[styles.kicker, { color: accent }]} numberOfLines={2}>
                      {card.title}
                    </Text>
                  </Animated.View>
                  <Animated.View style={rise(2)}>
                    <Rich text={deck.summary || card.title} accent={accent} style={styles.hook} />
                  </Animated.View>
                  {position.deck === 0 ? (
                    <Animated.Text style={[styles.hint, rise(3)]}>
                      {t('Tap to continue · hold to pause')}
                    </Animated.Text>
                  ) : null}
                </View>
              )}
            </Pressable>

            <View style={styles.top} pointerEvents='box-none'>
              <View style={styles.bars}>
                {Array.from({ length: total }, (_, index) => (
                  <View key={index} style={styles.bar}>
                    <Animated.View
                      style={[
                        styles.barFill,
                        {
                          width:
                            index < position.slide
                              ? '100%'
                              : index === position.slide
                                ? progress.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: ['0%', '100%']
                                  })
                                : '0%'
                        }
                      ]}
                    />
                  </View>
                ))}
              </View>
              <View style={styles.header}>
                <View style={[styles.badge, { backgroundColor: accent }]}>
                  <Text style={styles.badgeText}>
                    {(card.source ? sourceSite(card.source) : card.title).slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.headerText}>
                  <Text style={styles.site} numberOfLines={1}>
                    {card.source ? sourceSite(card.source) : t('Post')}
                  </Text>
                  {queue.length > 1 ? (
                    <Text style={styles.counter}>
                      {t('Post {n} of {total}', { n: position.deck + 1, total: queue.length })}
                    </Text>
                  ) : null}
                </View>
                {paused ? <Feather name='pause' size={18} color='#ffffff' /> : null}
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  accessibilityRole='button'
                  accessibilityLabel={t('Close')}
                >
                  <Feather name='x' size={26} color='#ffffff' />
                </Pressable>
              </View>
            </View>

            <View style={styles.bottom} pointerEvents='box-none'>
              {card.source ? (
                <Pressable
                  onPress={() => void Linking.openURL(card.source!.url)}
                  style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
                  accessibilityRole='link'
                >
                  <Feather name='external-link' size={15} color='#ffffff' />
                  <Text style={styles.pillText}>{t('View original')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => onOpenCard(card.id)}
                style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
                accessibilityRole='button'
              >
                <Feather name='message-circle' size={15} color='#ffffff' />
                <Text style={styles.pillText}>
                  {card.comments?.length
                    ? t('Comments ({n})', { n: card.comments.length })
                    : t('Comment')}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  )
}

// Bright colours for bold words and the badge, picked from the card id.
const ACCENTS = ['#FDE047', '#5EEAD4', '#F9A8D4', '#93C5FD', '#FDBA74', '#BEF264']
function accentOf(id: string) {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return ACCENTS[hash % ACCENTS.length]
}

// Long enough to read it twice at a relaxed pace.
function durationOf(texts: string[]) {
  const words = texts.join(' ').split(/\s+/).filter(Boolean).length
  return Math.min(11000, Math.max(4000, 2500 + words * 300))
}

const LEADING_EMOJI =
  /^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})[️‍\p{Extended_Pictographic}\p{Emoji_Modifier}]*)\s*/u
const emojiOf = (heading: string) => heading.match(LEADING_EMOJI)?.[1] || ''
const withoutEmoji = (heading: string) => heading.replace(LEADING_EMOJI, '')

// Text with **bold** runs in the accent colour; other Markdown marks are dropped.
function Rich({ text, accent, style }: { text: string; accent: string; style: object }) {
  const parts = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1$2').split(/\*\*(.+?)\*\*/g)
  return (
    <Text style={style}>
      {parts.map((part, index) =>
        index % 2 ? (
          <Text key={index} style={[styles.bold, { color: accent }]}>
            {part}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  )
}

const shadow = {
  textShadowColor: 'rgba(0, 0, 0, 0.45)',
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 8
}

// The player is always dark, whatever the app's theme.
const styles = themed(() => ({
  button: {
    alignItems: 'center',
    backgroundColor: '#0f766e',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 12,
    padding: 12
  },
  pressed: { opacity: 0.75 },
  buttonIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36
  },
  buttonText: { flex: 1, gap: 2 },
  buttonTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  buttonMeta: { color: 'rgba(255, 255, 255, 0.85)', fontSize: 13 },
  root: { backgroundColor: '#000000', flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, transform: [{ scale: 1.15 }] },
  shade: {
    ...StyleSheet.absoluteFillObject,
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.7) 100%)'
  },
  stage: { flex: 1 },
  slide: { flex: 1, gap: 18, justifyContent: 'center', paddingHorizontal: 28, paddingTop: 40 },
  emoji: { fontSize: 64, lineHeight: 76 },
  heading: { color: '#ffffff', fontSize: 36, fontWeight: '900', lineHeight: 42, ...shadow },
  line: { color: '#ffffff', fontSize: 22, fontWeight: '500', lineHeight: 31, ...shadow },
  bold: { fontWeight: '800' },
  photoFrame: {
    borderRadius: 18,
    elevation: 12,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20
  },
  photo: { aspectRatio: 16 / 9, width: '100%' },
  kicker: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    ...shadow
  },
  hook: { color: '#ffffff', fontSize: 34, fontWeight: '900', lineHeight: 41, ...shadow },
  hint: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 14, marginTop: 8 },
  top: { left: 0, paddingTop: 48, position: 'absolute', right: 0, top: 0 },
  bars: { flexDirection: 'row', gap: 4, paddingHorizontal: 10 },
  bar: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
    flex: 1,
    height: 3,
    overflow: 'hidden'
  },
  barFill: { backgroundColor: '#ffffff', height: 3 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12
  },
  badge: {
    alignItems: 'center',
    borderColor: '#ffffff',
    borderRadius: 17,
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    width: 34
  },
  badgeText: { color: '#111827', fontSize: 15, fontWeight: '900' },
  headerText: { flex: 1 },
  site: { color: '#ffffff', fontSize: 14, fontWeight: '700', ...shadow },
  counter: { color: 'rgba(255, 255, 255, 0.75)', fontSize: 12 },
  bottom: {
    bottom: 40,
    flexDirection: 'row',
    gap: 10,
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0
  },
  pill: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  pillText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  end: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', padding: 32 },
  endEmoji: { fontSize: 56 },
  endTitle: { color: '#ffffff', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  endText: { color: 'rgba(255, 255, 255, 0.8)', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  endButton: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 10
  },
  endButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' }
}))
