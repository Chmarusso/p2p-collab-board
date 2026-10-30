// Live sync feedback: what other members' devices and bots are doing right now.
// Bots announce their work through presence ("Making key points" on a card,
// see `opencollab status`); changes from anyone show while they arrive.
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { messageTypes } from '@opencollab/board-protocol'
import { t } from '../i18n'
import { colors, themed } from '../ui'
import { PresencePeer } from './model'

type WorkerMessage = { type: string; [key: string]: any }

export type PeerActivity = { authors: string[]; cardIds: string[] }

// How long "Syncing changes…" stays after the last change arrived.
const ACTIVITY_SHOWN = 4000

// The latest batch of changes from others, cleared a moment after it stops.
export function usePeerActivity(
  subscribe: (listener: (message: WorkerMessage) => void) => () => void,
  boardKey: string
) {
  const [activity, setActivity] = useState<PeerActivity | null>(null)
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== messageTypes.peerActivity) return
        setActivity({ authors: message.authors || [], cardIds: message.cardIds || [] })
      }),
    [subscribe]
  )
  useEffect(() => {
    if (!activity) return
    const timer = setTimeout(() => setActivity(null), ACTIVITY_SHOWN)
    return () => clearTimeout(timer)
  }, [activity])
  useEffect(() => setActivity(null), [boardKey])
  return activity
}

// Bot statuses are English phrases; known ones are translated.
const statusText = (peer: PresencePeer) => t(peer.status || '')

// What is happening to one card: a member's bot working on it, or changes to it
// arriving. Null when nothing is.
export function busyText(cardId: string, peers: PresencePeer[], activity: PeerActivity | null) {
  const worker = peers.find((peer) => peer.status && peer.cardId === cardId)
  if (worker) return statusText(worker)
  return activity?.cardIds.includes(cardId) ? t('Syncing…') : null
}

// The board-wide line: who is working on what, else whose changes are arriving.
export function syncLine(
  peers: PresencePeer[],
  activity: PeerActivity | null,
  nameFor: (identity: string) => string,
  cardTitle: (cardId: string) => string | undefined
) {
  const worker = peers.find((peer) => peer.status)
  if (worker) {
    const name = worker.name || nameFor(worker.identity)
    const title = worker.cardId ? cardTitle(worker.cardId) : undefined
    return title
      ? t('{name}: {status} · “{title}”', { name, status: statusText(worker), title })
      : t('{name}: {status}', { name, status: statusText(worker) })
  }
  if (activity?.authors.length) {
    return t('Syncing changes from {name}…', { name: nameFor(activity.authors[0]) })
  }
  return null
}

export function Spinner() {
  return <ActivityIndicator size='small' color={colors.accent} style={styles.spinner} />
}

export function BusyChip({ text }: { text: string }) {
  return (
    <View style={styles.chip} accessibilityLiveRegion='polite' accessibilityLabel={text}>
      <Spinner />
      <Text style={styles.chipText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  )
}

const styles = themed(() => ({
  spinner: { transform: [{ scale: 0.7 }], width: 16, height: 16 },
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 2
  },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '600', flexShrink: 1 }
}))
