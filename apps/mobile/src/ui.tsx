// Shared look and small building blocks used by every screen.
import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

export const colors = {
  bg: '#0A0E14',
  surface: '#0F1620',
  surfaceRaised: '#141D29',
  border: '#1C2633',
  text: '#C9D4E3',
  muted: '#6B7A90',
  accent: '#39FF88',
  onAccent: '#04110A',
  info: '#22D3EE',
  magenta: '#FF4FD8',
  error: '#FF5C5C'
}
export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' })

export type FeatherName = React.ComponentProps<typeof Feather>['name']
export type ImageRef = {
  core: string
  id: { byteOffset: number; blockOffset: number; blockLength: number; byteLength: number }
  type: string
  width: number | null
  height: number | null
  name?: string | null
}
export type CachedImage = { uri?: string; error?: string }
export const imageKey = (ref: ImageRef) => `${ref.core}:${ref.id.blockOffset}:${ref.id.blockLength}`

export type PendingImage = {
  uri: string
  data: string
  type: string
  width: number
  height: number
}
export const MAX_IMAGE_SIDE = 1600
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Picks up to `limit` photos, downscaled to `maxSide` and re-encoded as JPEG to
// keep transfers small. Anything still over 5 MB is skipped.
export async function pickPreparedImages(
  limit: number,
  maxSide = MAX_IMAGE_SIDE
): Promise<PendingImage[]> {
  if (limit <= 0) return []
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 1
  })
  if (result.canceled) return []
  const prepared: PendingImage[] = []
  for (const asset of result.assets.slice(0, limit)) {
    const scale = Math.min(1, maxSide / Math.max(asset.width, asset.height))
    const context = ImageManipulator.manipulate(asset.uri)
    context.resize({
      width: Math.round(asset.width * scale),
      height: Math.round(asset.height * scale)
    })
    const rendered = await context.renderAsync()
    const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG, base64: true })
    if (!saved.base64 || saved.base64.length * 0.75 > MAX_IMAGE_BYTES) continue
    prepared.push({
      uri: `data:image/jpeg;base64,${saved.base64}`,
      data: saved.base64,
      type: 'image/jpeg',
      width: saved.width,
      height: saved.height
    })
  }
  return prepared
}

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024
export type PickedVideo = {
  path: string
  name?: string
  width?: number
  height?: number
  size?: number
}

// Videos go to the worker as file paths: it streams them into the blob core,
// so they never pass through JS as base64.
export async function pickVideos(limit: number): Promise<PickedVideo[]> {
  if (limit <= 0) return []
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: true,
    selectionLimit: limit
  })
  if (result.canceled) return []
  return result.assets.slice(0, limit).map((asset) => ({
    path: asset.uri,
    name: asset.fileName || undefined,
    width: asset.width || undefined,
    height: asset.height || undefined,
    size: asset.fileSize
  }))
}

// Read once at startup and kept current by App; animations check it on mount.
export let reduceMotion = false
export function setReduceMotion(value: boolean) {
  reduceMotion = value
}

// Strong ease-out: quick to respond, gentle to settle.
export const easeOut = Easing.bezier(0.23, 1, 0.32, 1)

// Ids that already showed once. A list mounting again (Board <-> Agenda,
// reopening a board) shows them at once; only new arrivals fade. `skip` is
// for a list's first render, which appears whole instead of cascading.
const seenFades = new Set<string>()

export function FadeIn({
  children,
  id,
  skip
}: {
  children: React.ReactNode
  id?: string
  skip?: boolean
}) {
  const known = skip || (!!id && seenFades.has(id))
  if (id) seenFades.add(id)
  const progress = useRef(new Animated.Value(reduceMotion || known ? 1 : 0)).current
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: easeOut,
      useNativeDriver: true
    }).start()
  }, [progress])
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] })
  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  )
}

// Deterministic 5x5 mirrored grid derived from an identity public key.
export function Identicon({ hex, size }: { hex: string; size: number }) {
  if (!hex) return <View style={{ width: size, height: size }} />
  const hue = parseInt(hex.slice(0, 4), 16) % 360
  const color = `hsl(${hue}, 85%, 62%)`
  const cell = size / 5
  const cells: React.ReactNode[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const nibble = parseInt(hex[(row * 3 + col + 4) % hex.length] || '0', 16)
      if (nibble % 2 === 0) continue
      for (const x of col === 2 ? [2] : [col, 4 - col]) {
        cells.push(
          <View
            key={`${row}-${x}`}
            style={{
              position: 'absolute',
              left: x * cell,
              top: row * cell,
              width: cell,
              height: cell,
              backgroundColor: color
            }}
          />
        )
      }
    }
  }
  return (
    <View
      style={[styles.identicon, { width: size, height: size, borderRadius: size / 5 }]}
      accessibilityElementsHidden
      importantForAccessibility='no-hide-descendants'
    >
      {cells}
    </View>
  )
}

// A member's uploaded picture, or their identicon until one loads.
export function Avatar({
  hex,
  size,
  image,
  cache,
  requestImage
}: {
  hex: string
  size: number
  image: ImageRef | null | undefined
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
}) {
  const key = image ? imageKey(image) : ''
  const uri = key ? cache[key]?.uri : undefined
  useEffect(() => {
    if (image && !uri) requestImage(image)
  }, [key, !!uri])
  if (!uri) return <Identicon hex={hex} size={size} />
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      accessibilityIgnoresInvertColors
    />
  )
}

export function BoardImages({
  images,
  cache,
  onRequest,
  onRetry,
  onOpen
}: {
  images: ImageRef[]
  cache: Record<string, CachedImage>
  onRequest: (ref: ImageRef) => void
  onRetry: (ref: ImageRef) => void
  onOpen: (uri: string) => void
}) {
  useEffect(() => {
    for (const ref of images) onRequest(ref)
    // Requests are deduplicated in the parent; only re-run for new images.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.map(imageKey).join('|')])
  return (
    <View style={styles.imageGrid}>
      {images.map((ref) => {
        const cached = cache[imageKey(ref)]
        const ratio = ref.width && ref.height ? ref.width / ref.height : 4 / 3
        return (
          <Pressable
            key={imageKey(ref)}
            style={[styles.imageSlot, { aspectRatio: images.length === 1 ? ratio : 1 }]}
            onPress={() => (cached?.uri ? onOpen(cached.uri) : cached?.error ? onRetry(ref) : null)}
            accessibilityRole='imagebutton'
            accessibilityLabel={
              cached?.error ? 'Image unavailable, tap to retry' : 'Attached image'
            }
          >
            {cached?.uri ? (
              <Image source={{ uri: cached.uri }} style={styles.slotImage} />
            ) : cached?.error ? (
              <View style={styles.slotState}>
                <Feather name='refresh-cw' size={16} color={colors.muted} />
                <Text style={styles.metaMono}>unavailable · retry</Text>
              </View>
            ) : (
              <View style={styles.slotState}>
                <Feather name='image' size={18} color={colors.border} />
              </View>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

// A Pressable that shrinks a little while held and springs back on release.
// Pressable already waits before press-in, so a scroll that starts on it
// doesn't flash. With Reduce Motion it dims instead of scaling.
export function PressableScale({
  style,
  scaleTo = 0.97,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const value = useRef(new Animated.Value(1)).current
  const to = (target: number, duration: number) =>
    Animated.timing(value, { toValue: target, duration, easing: easeOut, useNativeDriver: true })
  const pressedTo = reduceMotion ? 0.7 : scaleTo
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        to(pressedTo, 100).start()
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        to(1, 160).start()
        onPressOut?.(event)
      }}
      style={[style, reduceMotion ? { opacity: value } : { transform: [{ scale: value }] }]}
    />
  )
}

export function IconButton({
  icon,
  label,
  onPress
}: {
  icon: FeatherName
  label: string
  onPress: () => void
}) {
  return (
    <PressableScale
      style={styles.iconButton}
      onPress={onPress}
      accessibilityRole='button'
      accessibilityLabel={label}
    >
      <Feather name={icon} size={18} color={colors.onAccent} />
    </PressableScale>
  )
}

export function Button({
  title,
  onPress,
  icon,
  grow,
  variant = 'primary'
}: {
  title: string
  onPress: () => void
  icon?: FeatherName
  grow?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const color =
    variant === 'primary' ? colors.onAccent : variant === 'ghost' ? colors.muted : colors.accent
  return (
    <PressableScale
      style={[
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        grow && styles.flex
      ]}
      onPress={onPress}
      accessibilityRole='button'
    >
      {icon ? <Feather name={icon} size={16} color={color} /> : null}
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonText: { fontWeight: '700' },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderColor: colors.accent,
    borderWidth: 1
  },
  buttonGhost: { backgroundColor: 'transparent' },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  identicon: { backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  imageSlot: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1
  },
  slotImage: { width: '100%', height: '100%' },
  slotState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  metaMono: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  flex: { flex: 1 }
})
