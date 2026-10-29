// Shown when a link or post is shared to OpenCollab from another app: pick the
// board it goes to. The card itself is written in the usual composer.
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Sheet } from './board/Panels'
import { colors, mono, themed } from './ui'
import { SharedPreview } from './SharedItems'
import type { SharedRecord } from './sharedHistory'

export type ShareBoard = { invite: string; name: string; open: boolean }

export function ShareSheet({
  item,
  loading,
  boards,
  hiddenCount,
  onPick,
  onClose
}: {
  item: SharedRecord
  loading: boolean
  boards: ShareBoard[]
  hiddenCount: number
  onPick: (board: ShareBoard) => void
  onClose: () => void
}) {
  return (
    <Sheet title='Add to board' onClose={onClose}>
      <SharedPreview record={item} loading={loading} />
      {boards.length ? (
        <View style={styles.list}>
          {boards.map((board) => (
            <Pressable
              key={board.invite}
              style={({ pressed }) => [styles.board, pressed && styles.pressed]}
              onPress={() => onPick(board)}
              accessibilityRole='button'
              accessibilityLabel={`Add to ${board.name}`}
            >
              <Feather name='hash' size={16} color={colors.accent} />
              <Text style={styles.name} numberOfLines={1}>
                {board.name}
              </Text>
              {board.open ? <Text style={styles.badge}>OPEN</Text> : null}
              <Feather name='chevron-right' size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>
          {hiddenCount
            ? 'All your boards are hidden from sharing. Turn one back on in Board settings → Share menu.'
            : 'No boards yet. Create or join a board, then share again.'}
        </Text>
      )}
      {boards.length && hiddenCount ? (
        <Text style={styles.hint}>
          {hiddenCount === 1 ? '1 board is' : `${hiddenCount} boards are`} hidden. Change it in
          Board settings → Share menu.
        </Text>
      ) : null}
    </Sheet>
  )
}

const styles = themed(() => ({
  list: { gap: 8, marginTop: 16 },
  board: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  pressed: { opacity: 0.7 },
  name: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '600' },
  badge: { color: colors.accent, fontFamily: mono, fontSize: 11, letterSpacing: 1 },
  empty: { color: colors.muted, lineHeight: 20, marginTop: 16 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 12, textAlign: 'center' }
}))
