// Links and posts shared to OpenCollab from other apps: the preview card the
// board picker shows, and the list of everything shared on this device.
import React, { useState } from 'react'
import { Alert, Image, Linking, Pressable, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Sheet } from './board/Panels'
import { Button, colors, mono, themed } from './ui'
import type { SharedRecord } from './sharedHistory'

const host = (link?: string) => link?.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i)?.[1] || ''

// What the page will look like as a card: its image, title, description and
// where the link goes.
export function SharedPreview({ record, loading }: { record: SharedRecord; loading?: boolean }) {
  const [broken, setBroken] = useState(false)
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
        {record.description ? (
          <Text style={styles.body} numberOfLines={3}>
            {record.description}
          </Text>
        ) : null}
        {record.link ? (
          <Text style={styles.host} numberOfLines={1}>
            {host(record.link)}
          </Text>
        ) : !record.description && record.body ? (
          <Text style={styles.body} numberOfLines={3}>
            {record.body}
          </Text>
        ) : null}
        {loading ? <Text style={styles.loading}>Loading the link preview…</Text> : null}
      </View>
    </View>
  )
}

export function SharedItemsSheet({
  records,
  relativeTime,
  onAdd,
  onRemove,
  onClose
}: {
  records: SharedRecord[]
  relativeTime: (iso?: string) => string
  onAdd: (record: SharedRecord) => void
  onRemove: (record: SharedRecord) => void
  onClose: () => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = records.find((record) => record.id === openId)

  if (open) {
    return (
      <Sheet title='Shared item' onClose={() => setOpenId(null)}>
        <SharedPreview record={open} />
        <Text style={styles.status}>{statusOf(open, relativeTime)}</Text>
        {open.body && open.body !== open.link ? <Text style={styles.text}>{open.body}</Text> : null}
        <View style={styles.actions}>
          <Button title='Add to board' icon='plus' onPress={() => onAdd(open)} />
          {open.link ? (
            <Button
              title='Open link'
              icon='external-link'
              variant='secondary'
              onPress={() => void Linking.openURL(open.link!)}
            />
          ) : null}
          <Button
            title='Remove from this list'
            icon='trash-2'
            variant='ghost'
            onPress={() =>
              Alert.alert('Remove this shared item?', 'Cards already made from it stay.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
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
    <Sheet title='Shared items' onClose={onClose}>
      <Text style={styles.hint}>
        Links and posts you shared to OpenCollab from other apps. Kept on this device only.
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
          Nothing shared yet. In any app, tap Share and choose OpenCollab.
        </Text>
      )}
    </Sheet>
  )
}

function statusOf(record: SharedRecord, relativeTime: (iso?: string) => string) {
  if (record.board && record.addedAt) {
    return `Added to ${record.board} ${relativeTime(new Date(record.addedAt).toISOString())} ago`
  }
  return `Shared ${relativeTime(new Date(record.at).toISOString())} ago · not on a board`
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
  text: { color: colors.text, lineHeight: 20, marginTop: 12 },
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
