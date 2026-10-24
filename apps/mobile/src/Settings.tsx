// App settings that belong to this device, not to a board: where the recovery
// words are kept and the notification sound.
import React from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { Button, colors, mono } from './ui'
import { Sheet } from './board/Panels'
import { Chip } from './board/CardSheet'
import { SOUND_OPTIONS, SoundName } from './sounds'

// 'saved': plain Keychain item; 'protected': needs Face ID / Touch ID to read;
// 'off': the user chose not to keep it; null: never asked.
export type KeychainChoice = 'saved' | 'protected' | 'off' | null

export function SettingsSheet({
  keychain,
  canSave,
  onSavePhrase,
  onForgetPhrase,
  sound,
  onSound,
  onClose
}: {
  keychain: KeychainChoice
  canSave: boolean
  onSavePhrase: () => void
  onForgetPhrase: () => void
  sound: SoundName
  onSound: (sound: SoundName) => void
  onClose: () => void
}) {
  const saved = keychain === 'saved' || keychain === 'protected'
  return (
    <Sheet title='Settings' onClose={onClose}>
      <Text style={styles.sectionLabel}>Recovery words</Text>
      <Text style={styles.muted}>
        {keychain === 'protected'
          ? 'Saved in the iOS Keychain on this device, unlocked with Face ID or Touch ID. If the enrolled faces or fingerprints change, you enter the words once more.'
          : saved
            ? 'Saved in the iOS Keychain on this device.'
            : 'Not saved on this device. You enter them each time you open OpenCollab.'}
      </Text>
      {saved ? (
        <Button
          title='Forget from Keychain'
          icon='trash-2'
          variant='secondary'
          onPress={() =>
            Alert.alert(
              'Forget recovery words?',
              'They are removed from this device. Make sure you have them written down: you will need them to open OpenCollab again.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Forget', style: 'destructive', onPress: onForgetPhrase }
              ]
            )
          }
        />
      ) : canSave ? (
        <Button title='Save in Keychain' icon='lock' variant='secondary' onPress={onSavePhrase} />
      ) : null}

      <Text style={styles.sectionLabel}>Notification sound</Text>
      <Text style={styles.muted}>Plays when new notifications arrive while the app is open.</Text>
      <View style={styles.chips}>
        {SOUND_OPTIONS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={sound === option.id}
            onPress={() => onSound(option.id)}
          />
        ))}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, lineHeight: 20 },
  sectionLabel: {
    color: colors.muted,
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 6
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
})
