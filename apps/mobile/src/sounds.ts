// The notification sound. Players are created on first use and reused; the
// audio session mixes with other apps and respects the silent switch.
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio'

export type SoundName = 'off' | 'chime' | 'pop' | 'ding'
export const SOUND_OPTIONS: { id: SoundName; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'chime', label: 'Chime' },
  { id: 'pop', label: 'Pop' },
  { id: 'ding', label: 'Ding' }
]
export const DEFAULT_SOUND: SoundName = 'chime'
export const soundPrefKey = 'opencollab.notification-sound'
export const isSoundName = (value: unknown): value is SoundName =>
  SOUND_OPTIONS.some((option) => option.id === value)

const sources = {
  chime: require('../assets/sounds/chime.wav'),
  pop: require('../assets/sounds/pop.wav'),
  ding: require('../assets/sounds/ding.wav')
}
const players: Partial<Record<Exclude<SoundName, 'off'>, AudioPlayer>> = {}
let audioMode: Promise<void> | null = null

export function playSound(name: SoundName) {
  if (name === 'off') return
  audioMode ||= setAudioModeAsync({
    playsInSilentMode: false,
    interruptionMode: 'mixWithOthers'
  }).catch(() => {})
  void audioMode.then(() => {
    const player = (players[name] ||= createAudioPlayer(sources[name]))
    void player.seekTo(0).catch(() => {})
    player.play()
  })
}
