// Shorts on a Feed board: vertical videos made from the board's posts (see
// apps/cli/examples/feed-shorts.mjs, which labels them `short`). The player shows
// the ones not watched yet, newest first, one after another; once they're all
// watched it says so. What was watched is remembered on this device.
import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  StatusBar,
  Text,
  View
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import { VideoView, useVideoPlayer } from 'expo-video'
import { plural, t } from '../i18n'
import { themed } from '../ui'
import { videoFile } from './Media'
import { BoardData, Card, sourceSite, videosOf } from './model'

type WorkerMessage = { type: string; [key: string]: any }
type Subscribe = (listener: (message: WorkerMessage) => void) => () => void

export const SHORT_LABEL = 'short'
const WATCHED_KEEP = 300

// Cards that are shorts: labelled `short`, with a video.
export function shortsOf(data: BoardData, cards: Card[]) {
  const label = data.labels.find((entry) => entry.name.toLowerCase() === SHORT_LABEL)
  if (!label) return []
  return cards
    .filter((card) => card.labelIds?.includes(label.id) && videosOf(card).length)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

// Watched short ids (or read decks, kind 'slides') for this identity and
// board, kept on the device.
export function useWatched(me: string, boardKey: string, kind = 'shorts') {
  const key = `opencollab.${kind}-watched.${me}.${boardKey}`.replace(/[^\w.-]/g, '')
  const [watched, setWatched] = useState<string[]>([])
  useEffect(() => {
    if (!me || !boardKey) return
    void SecureStore.getItemAsync(key).then((value) => {
      try {
        setWatched(value ? JSON.parse(value) : [])
      } catch {
        setWatched([])
      }
    })
  }, [key])
  const markWatched = (id: string) =>
    setWatched((current) => {
      if (current.includes(id)) return current
      const next = [id, ...current].slice(0, WATCHED_KEEP)
      void SecureStore.setItemAsync(key, JSON.stringify(next))
      return next
    })
  return { watched, markWatched }
}

export function ShortsButton({
  shorts,
  watched,
  onPress
}: {
  shorts: Card[]
  watched: string[]
  onPress: () => void
}) {
  const fresh = shorts.filter((card) => !watched.includes(card.id)).length
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityRole='button'
    >
      <View style={styles.buttonIcon}>
        <Feather name='play' size={18} color='#ffffff' />
      </View>
      <View style={styles.buttonText}>
        <Text style={styles.buttonTitle}>{t('Shorts')}</Text>
        <Text style={styles.buttonMeta}>
          {fresh
            ? plural(
                fresh,
                ['{n} new short', '{n} new shorts'],
                ['{n} nowy film', '{n} nowe filmy', '{n} nowych filmów']
              )
            : t('All watched')}
        </Text>
      </View>
      <Feather name='chevron-right' size={18} color='#ffffff' />
    </Pressable>
  )
}

export function ShortsPlayer({
  shorts,
  watched,
  markWatched,
  send,
  subscribe,
  onClose
}: {
  shorts: Card[]
  watched: string[]
  markWatched: (id: string) => void
  send: (message: object) => void
  subscribe: Subscribe
  onClose: () => void
}) {
  // The queue is fixed when the player opens: unwatched shorts, newest first.
  const [queue, setQueue] = useState(() => shorts.filter((card) => !watched.includes(card.id)))
  const [index, setIndex] = useState(0)
  const [path, setPath] = useState<string | null>(null)
  const [error, setError] = useState('')
  const card = queue[index]

  useEffect(() => {
    setPath(null)
    setError('')
    if (!card) return
    let live = true
    videoFile(videosOf(card)[0], send, subscribe)
      .then((file) => live && setPath(file))
      .catch(() => live && setError(t('This short is still syncing. Try again in a moment.')))
    // Fetch the next one while this one plays.
    const upcoming = queue[index + 1]
    if (upcoming) videoFile(videosOf(upcoming)[0], send, subscribe).catch(() => {})
    return () => {
      live = false
    }
  }, [card?.id])

  // The swipe handler is made once: it reads the short on screen from a ref.
  const cardRef = useRef(card)
  cardRef.current = card
  const next = () => {
    if (cardRef.current) markWatched(cardRef.current.id)
    setIndex((current) => current + 1)
  }
  const previous = () => setIndex((current) => Math.max(0, current - 1))
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 24,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy < -60) next()
        else if (gesture.dy > 60) previous()
      }
    })
  ).current

  return (
    <Modal visible animationType='slide' onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle='light-content' />
      <View style={styles.root} {...swipe.panHandlers}>
        {!card ? (
          <View style={styles.end}>
            <Feather name='check-circle' size={44} color='#ffffff' />
            <Text style={styles.endTitle}>{t('You’re all caught up')}</Text>
            <Text style={styles.endText}>
              {t('No new shorts. New posts on this board become shorts automatically.')}
            </Text>
            {shorts.length ? (
              <Pressable
                onPress={() => {
                  setQueue(shorts)
                  setIndex(0)
                }}
                style={styles.endButton}
                accessibilityRole='button'
              >
                <Feather name='rotate-ccw' size={16} color='#ffffff' />
                <Text style={styles.endButtonText}>{t('Watch all again')}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} style={styles.endButton} accessibilityRole='button'>
              <Text style={styles.endButtonText}>{t('Close')}</Text>
            </Pressable>
          </View>
        ) : path ? (
          <ShortVideo key={card.id} path={path} onEnd={next} />
        ) : (
          <View style={styles.center}>
            {error ? (
              <Text style={styles.endText}>{error}</Text>
            ) : (
              <ActivityIndicator color='#ffffff' size='large' />
            )}
          </View>
        )}

        {card ? (
          <View style={styles.overlay} pointerEvents='box-none'>
            <Text style={styles.counter}>
              {index + 1} / {queue.length}
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {card.title}
            </Text>
            {card.source ? (
              <Pressable
                onPress={() => void Linking.openURL(card.source!.url)}
                style={styles.source}
                accessibilityRole='link'
                hitSlop={8}
              >
                <Feather name='external-link' size={14} color='#ffffff' />
                <Text style={styles.sourceText}>{sourceSite(card.source)}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={next}
              style={styles.next}
              accessibilityRole='button'
              accessibilityLabel={t('Next short')}
            >
              <Feather name='chevron-down' size={22} color='#ffffff' />
              <Text style={styles.nextText}>{t('Next')}</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          onPress={onClose}
          style={styles.close}
          hitSlop={10}
          accessibilityRole='button'
          accessibilityLabel={t('Close')}
        >
          <Feather name='x' size={24} color='#ffffff' />
        </Pressable>
      </View>
    </Modal>
  )
}

// One short, playing as soon as it's open; a tap pauses or resumes it.
function ShortVideo({ path, onEnd }: { path: string; onEnd: () => void }) {
  const player = useVideoPlayer(`file://${encodeURI(path)}`, (instance) => instance.play())
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const subscription = player.addListener('playToEnd', onEnd)
    return () => subscription.remove()
  }, [player, onEnd])
  return (
    <Pressable
      style={styles.video}
      onPress={() => {
        if (paused) player.play()
        else player.pause()
        setPaused(!paused)
      }}
      accessibilityRole='button'
      accessibilityLabel={paused ? t('Play') : t('Pause')}
    >
      <VideoView player={player} style={styles.video} contentFit='cover' nativeControls={false} />
      {paused ? (
        <View style={styles.paused}>
          <Feather name='play' size={56} color='#ffffff' />
        </View>
      ) : null}
    </Pressable>
  )
}

// The player is always dark, whatever the app's theme.
const styles = themed(() => ({
  button: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 12,
    padding: 12
  },
  pressed: { opacity: 0.85 },
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
  video: { flex: 1 },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 32 },
  paused: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  overlay: { bottom: 48, gap: 8, left: 20, position: 'absolute', right: 20 },
  counter: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 12, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 17, fontWeight: '700', lineHeight: 22 },
  source: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6 },
  sourceText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  next: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10
  },
  nextText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  close: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    position: 'absolute',
    right: 16,
    top: 52,
    width: 40
  },
  end: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', padding: 32 },
  endTitle: { color: '#ffffff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  endText: { color: 'rgba(255, 255, 255, 0.8)', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  endButton: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10
  },
  endButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' }
}))
