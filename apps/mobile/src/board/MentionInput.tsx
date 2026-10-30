// A text field that suggests board members after "@", like the desktop picker.
// Tapping a suggestion inserts "@Name " at the caret.
import React, { useState } from 'react'
import { Pressable, Text, TextInput, TextInputProps, View } from 'react-native'
import { t } from '../i18n'
import { Identicon, colors, themed } from '../ui'

type Props = Omit<TextInputProps, 'onChangeText' | 'value'> & {
  value: string
  onChangeText: (value: string) => void
  profiles: Record<string, string>
  me: string
}

export function MentionInput({ value, onChangeText, profiles, me, style, ...rest }: Props) {
  const [caret, setCaret] = useState(value.length)
  const match = value.slice(0, caret).match(/(^|\s)@([^\s@]{0,32})$/)
  const query = match ? match[2].toLowerCase() : null
  const suggestions =
    query === null
      ? []
      : Object.entries(profiles)
          .filter(([identity, name]) => identity !== me && name.toLowerCase().startsWith(query))
          .slice(0, 5)

  const pick = (name: string) => {
    const start = caret - (query?.length || 0) - 1
    const next = `${value.slice(0, start)}@${name} ${value.slice(caret)}`
    onChangeText(next)
    setCaret(start + name.length + 2)
  }

  return (
    <View style={styles.wrap}>
      <TextInput
        {...rest}
        style={style}
        value={value}
        onChangeText={onChangeText}
        onSelectionChange={(event) => setCaret(event.nativeEvent.selection.end)}
        placeholderTextColor={colors.muted}
      />
      {suggestions.length ? (
        <View style={styles.suggestions} accessibilityRole='menu'>
          {suggestions.map(([identity, name]) => (
            <Pressable
              key={identity}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
              onPress={() => pick(name)}
              accessibilityRole='menuitem'
              accessibilityLabel={t('Mention {name}', { name })}
            >
              <Identicon hex={identity} size={16} />
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = themed(() => ({
  wrap: { gap: 6 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 180,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1
  },
  name: { color: colors.text, fontWeight: '600', flexShrink: 1 },
  pressed: { opacity: 0.8 }
}))
