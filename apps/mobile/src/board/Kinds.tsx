// Picking a board type (board-protocol/kinds.js): when creating a board and in
// Board settings → Board type.
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { BOARD_KIND_IDS, boardKind } from '@opencollab/board-protocol'
import type { BoardKindId } from '@opencollab/board-protocol'
import { t } from '../i18n'
import { FeatherName, colors, themed, tint } from '../ui'

export const KIND_ICONS: Record<BoardKindId, FeatherName> = {
  kanban: 'columns',
  todo: 'check-square',
  feed: 'rss',
  recipes: 'book-open'
}

export function KindOptions({
  selected,
  onPick,
  disabled
}: {
  selected: string
  onPick: (kind: BoardKindId) => void
  disabled?: boolean
}) {
  return (
    <View style={styles.list} accessibilityRole='radiogroup'>
      {BOARD_KIND_IDS.map((id) => {
        const kind = boardKind(id)
        const on = id === selected
        return (
          <Pressable
            key={id}
            onPress={() => onPick(id)}
            disabled={disabled}
            style={({ pressed }) => [
              styles.option,
              on && styles.optionOn,
              pressed && styles.pressed,
              disabled && !on && styles.disabled
            ]}
            accessibilityRole='radio'
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={`${t(kind.name)}. ${t(kind.description)}`}
          >
            <View style={[styles.icon, on && styles.iconOn]}>
              <Feather name={KIND_ICONS[id]} size={18} color={on ? colors.accent : colors.text} />
            </View>
            <View style={styles.text}>
              <Text style={styles.name}>{t(kind.name)}</Text>
              <Text style={styles.description}>{t(kind.description)}</Text>
            </View>
            {on ? <Feather name='check' size={18} color={colors.accent} /> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = themed(() => ({
  list: { gap: 8 },
  option: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12
  },
  optionOn: { borderColor: colors.accent },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  iconOn: { backgroundColor: tint(colors.accent, 0.15) },
  text: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  description: { color: colors.muted, fontSize: 13, lineHeight: 18 }
}))
