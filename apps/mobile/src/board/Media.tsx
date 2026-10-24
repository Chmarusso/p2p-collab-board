// Video attachments. The worker decrypts a video to a file on request; it then
// plays here with the system controls. Videos have no thumbnail, so each shows
// as a tile with its name and size.
import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { VideoView, useVideoPlayer } from 'expo-video'
import { messageTypes } from '@opencollab/board-protocol'
import { ImageRef, colors, imageKey, mono } from '../ui'

type WorkerMessage = { type: string; [key: string]: any }

// Decrypted copies stay valid for the session, so a video opens once per run.
const files = new Map<string, string>()

const megabytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`

export function VideoTiles({
  videos,
  send,
  subscribe
}: {
  videos: ImageRef[]
  send: (message: object) => void
  subscribe: (listener: (message: WorkerMessage) => void) => () => void
}) {
  const [loading, setLoading] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const loadingRef = useRef<string | null>(null)

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'board-media') return
        if (message.path) files.set(message.key, message.path)
        if (message.key !== loadingRef.current) return
        loadingRef.current = null
        setLoading(null)
        if (message.path) setPlaying(message.path)
        else {
          Alert.alert(
            'Video unavailable',
            `It may still be syncing from the member who added it. (${message.error || 'unknown error'})`
          )
        }
      }),
    [subscribe]
  )

  const open = (ref: ImageRef) => {
    const key = imageKey(ref)
    const file = files.get(key)
    if (file) return setPlaying(file)
    loadingRef.current = key
    setLoading(key)
    send({ type: messageTypes.boardMedia, ref })
  }

  return (
    <View style={styles.tiles}>
      {videos.map((ref) => {
        const key = imageKey(ref)
        return (
          <Pressable
            key={key}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            onPress={() => open(ref)}
            disabled={!!loading}
            accessibilityRole='button'
            accessibilityLabel={`Play video ${ref.name || ''}`.trim()}
          >
            {loading === key ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Feather name='play-circle' size={30} color={colors.text} />
            )}
            <Text style={styles.name} numberOfLines={1}>
              {ref.name || 'Video'}
            </Text>
            <Text style={styles.size}>{megabytes(ref.id.byteLength)}</Text>
          </Pressable>
        )
      })}
      {playing ? <VideoModal path={playing} onClose={() => setPlaying(null)} /> : null}
    </View>
  )
}

function VideoModal({ path, onClose }: { path: string; onClose: () => void }) {
  const player = useVideoPlayer(`file://${encodeURI(path)}`, (instance) => instance.play())
  return (
    <Modal
      visible
      animationType='fade'
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.viewer}>
        <VideoView
          player={player}
          style={styles.video}
          nativeControls
          contentFit='contain'
          fullscreenOptions={{ enable: true }}
        />
        <Pressable
          style={styles.close}
          onPress={onClose}
          hitSlop={10}
          accessibilityRole='button'
          accessibilityLabel='Close video'
        >
          <Feather name='x' size={22} color='white' />
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#05080c'
  },
  name: { color: colors.text, fontSize: 12, fontWeight: '600', maxWidth: '100%' },
  size: { color: colors.muted, fontFamily: mono, fontSize: 11 },
  pressed: { opacity: 0.8 },
  viewer: { flex: 1, backgroundColor: 'black', justifyContent: 'center' },
  video: { width: '100%', height: '100%' },
  close: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center'
  }
})
