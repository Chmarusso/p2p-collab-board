// Links and posts shared to OpenCollab from other apps: the preview card the
// board picker shows, and the list of everything shared on this device.
import React, { useState } from 'react'
import { Alert, Image, Linking, Pressable, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Sheet } from './board/Panels'
import { Button, colors, mono, themed } from './ui'
import type { SharedRecord } from './sharedHistory'
import { plural, t } from './i18n'

export type ShareBoard = { invite: string; name: string; open: boolean }

// The boards a shared item can go to; tapping one adds it there.
export function BoardList({
  boards,
  hiddenCount,
  onPick
}: {
  boards: ShareBoard[]
  hiddenCount: number
  onPick: (board: ShareBoard) => void
}) {
  return (
    <>
      {boards.length ? (
        <View style={styles.boards}>
          {boards.map((board) => (
            <Pressable
              key={board.invite}
              style={({ pressed }) => [styles.board, pressed && styles.pressed]}
              onPress={() => onPick(board)}
              accessibilityRole='button'
              accessibilityLabel={t('Add to {board}', { board: board.name })}
            >
              <Feather name='hash' size={16} color={colors.accent} />
              <Text style={styles.boardName} numberOfLines={1}>
                {board.name}
              </Text>
              {board.open ? <Text style={styles.badge}>{t('OPEN')}</Text> : null}
              <Feather name='plus' size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>
          {hiddenCount
            ? t(
                'All your boards are hidden from sharing. Turn one back on in Board settings → Share menu.'
              )
            : t('No boards yet. Create or join a board, then share again.')}
        </Text>
      )}
      {boards.length && hiddenCount ? (
        <Text style={styles.boardsHint}>
          {plural(
            hiddenCount,
            [
              '{n} board is hidden. Change it in Board settings → Share menu.',
              '{n} boards are hidden. Change it in Board settings → Share menu.'
            ],
            [
              '{n} tablica jest ukryta. Zmienisz to w Ustawieniach tablicy → Menu udostępniania.',
              '{n} tablice są ukryte. Zmienisz to w Ustawieniach tablicy → Menu udostępniania.',
              '{n} tablic jest ukrytych. Zmienisz to w Ustawieniach tablicy → Menu udostępniania.'
            ]
          )}
        </Text>
      ) : null}
    </>
  )
}

const host = (link?: string) => link?.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i)?.[1] || ''

// What the page will look like as a card: its image, title, description and
// where the link goes.
export function SharedPreview({ record, loading }: { record: SharedRecord; loading?: boolean }) {
  const [broken, setBroken] = useState(false)
  // Folded by default, so the image and the boards fit on one screen.
  const [expanded, setExpanded] = useState(false)
  // The page's description and the text shared with it, minus the bare link.
  const shared = (record.link ? record.body.split(record.link).join('') : record.body).trim()
  const text = [record.description, shared !== record.description ? shared : '']
    .filter(Boolean)
    .join('\n\n')
  return (
    <View style={styles.preview}>
      {record.image && !broken ? (
        <Image
          source={{ uri: record.image }}
          style={styles.previewImage}
          resizeMode='cover'
          onError={() => setBroken(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View style={styles.previewText}>
        <Text style={styles.title} numberOfLines={2}>
          {record.title}
        </Text>
        {record.link ? (
          <Text style={styles.host} numberOfLines={1}>
            {host(record.link)}
          </Text>
        ) : null}
        {text && expanded ? <Text style={styles.body}>{text}</Text> : null}
        {text ? (
          <Pressable
            onPress={() => setExpanded(!expanded)}
            style={styles.toggle}
            hitSlop={8}
            accessibilityRole='button'
            accessibilityState={{ expanded }}
          >
            <Feather
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.muted}
            />
            <Text style={styles.toggleText}>
              {expanded ? t('Hide description') : t('Show description')}
            </Text>
          </Pressable>
        ) : null}
        {loading ? <Text style={styles.loading}>{t('Loading the link preview…')}</Text> : null}
      </View>
    </View>
  )
}

export function SharedItemsSheet({
  records,
  boards,
  hiddenCount,
  relativeTime,
  onAdd,
  onRemove,
  onClose
}: {
  records: SharedRecord[]
  boards: ShareBoard[]
  hiddenCount: number
  relativeTime: (iso?: string) => string
  onAdd: (record: SharedRecord, board: ShareBoard) => void
  onRemove: (record: SharedRecord) => void
  onClose: () => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = records.find((record) => record.id === openId)

  if (open) {
    return (
      <Sheet title={t('Shared item')} onClose={() => setOpenId(null)}>
        <SharedPreview record={open} />
        <Text style={styles.status}>{statusOf(open, relativeTime)}</Text>
        <Text style={styles.label}>{t('ADD TO BOARD')}</Text>
        <BoardList
          boards={boards}
          hiddenCount={hiddenCount}
          onPick={(board) => onAdd(open, board)}
        />
        <View style={styles.actions}>
          {open.link ? (
            <Button
              title={t('Open link')}
              icon='external-link'
              variant='secondary'
              onPress={() => void Linking.openURL(open.link!)}
            />
          ) : null}
          <Button
            title={t('Remove from this list')}
            icon='trash-2'
            variant='ghost'
            onPress={() =>
              Alert.alert(t('Remove this shared item?'), t('Cards already made from it stay.'), [
                { text: t('Cancel'), style: 'cancel' },
                {
                  text: t('Remove'),
                  style: 'destructive',
                  onPress: () => {
                    setOpenId(null)
                    onRemove(open)
                  }
                }
              ])
            }
          />
        </View>
      </Sheet>
    )
  }

  return (
    <Sheet title={t('Shared items')} onClose={onClose}>
      <Text style={styles.hint}>
        {t('Links and posts you shared to OpenCollab from other apps. Kept on this device only.')}
      </Text>
      {records.length ? (
        <View style={styles.list}>
          {records.map((record) => (
            <Pressable
              key={record.id}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => setOpenId(record.id)}
              accessibilityRole='button'
              accessibilityLabel={record.title}
            >
              <Thumbnail uri={record.image} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {record.title}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {[host(record.link), statusOf(record, relativeTime)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Feather name='chevron-right' size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>
          {t('Nothing shared yet. In any app, tap Share and choose OpenCollab.')}
        </Text>
      )}
    </Sheet>
  )
}

function statusOf(record: SharedRecord, relativeTime: (iso?: string) => string) {
  // relativeTime says 'now' for the last minute, which doesn't take 'ago'.
  const recent = (at: number) => Date.now() - at < 60_000
  const ago = (at: number) => relativeTime(new Date(at).toISOString())
  if (record.board && record.addedAt) {
    return recent(record.addedAt)
      ? t('Added to {board} just now', { board: record.board })
      : t('Added to {board} {time} ago', { board: record.board, time: ago(record.addedAt) })
  }
  return recent(record.at)
    ? t('Shared just now · not on a board')
    : t('Shared {time} ago · not on a board', { time: ago(record.at) })
}

function Thumbnail({ uri }: { uri?: string }) {
  const [broken, setBroken] = useState(false)
  if (!uri || broken) {
    return (
      <View style={[styles.thumb, styles.thumbEmpty]}>
        <Feather name='link' size={18} color={colors.muted} />
      </View>
    )
  }
  return (
    <Image
      source={{ uri }}
      style={styles.thumb}
      resizeMode='cover'
      onError={() => setBroken(true)}
      accessibilityIgnoresInvertColors
    />
  )
}

const styles = themed(() => ({
  toggle: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 4 },
  toggleText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  boards: { gap: 8, marginTop: 12 },
  board: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  boardName: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '600' },
  badge: { color: colors.accent, fontFamily: mono, fontSize: 11, letterSpacing: 1 },
  boardsHint: { color: colors.muted, fontSize: 12, marginTop: 4, textAlign: 'center' },
  label: { color: colors.muted, fontFamily: mono, fontSize: 11, letterSpacing: 1, marginTop: 16 },
  preview: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden'
  },
  previewImage: { width: '100%', aspectRatio: 1.91, backgroundColor: colors.border },
  previewText: { gap: 6, padding: 14 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  body: { color: colors.muted, lineHeight: 20 },
  host: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  loading: { color: colors.accent, fontSize: 12 },
  status: { color: colors.muted, fontSize: 13, marginTop: 12 },
  actions: { gap: 10, marginTop: 20 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  list: { gap: 8, marginTop: 16 },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    padding: 10
  },
  pressed: { opacity: 0.7 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.border },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowMeta: { color: colors.muted, fontSize: 12 },
  empty: { color: colors.muted, lineHeight: 20, marginTop: 16 }
}))
