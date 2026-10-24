// A short confetti burst for a card reaching Done. Each piece runs on one
// native-driven value, so the JS thread stays free. Skipped with Reduce Motion;
// the parent announces the move instead.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native'
import { LABEL_COLORS } from './model'

const PIECES = 28
const DURATION = 1200
// The native driver can't take an easing inside interpolate, so each path is
// sampled: enough points that the arc has no visible corners.
const STEPS = Array.from({ length: 13 }, (_, i) => i / 12)
const APEX = 0.35

export function Confetti({
  origin,
  onDone
}: {
  // Window coordinates to burst from; negative means the middle of the screen.
  origin: { x: number; y: number }
  onDone: () => void
}) {
  const progress = useRef(new Animated.Value(0)).current
  const box = useRef<View>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const { width, height } = Dimensions.get('window')
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => {
        const angle = (Math.PI * (i + Math.random() * 0.8)) / PIECES + Math.PI
        const speed = 0.25 + Math.random() * 0.3
        const dx = Math.cos(angle) * width * speed
        // A parabola with its top at APEX: y(t) = a·t² − 2a·APEX·t, peaking at `rise`.
        const rise = Math.sin(angle) * height * speed * 0.6
        const a = -rise / (APEX * APEX)
        return {
          color: LABEL_COLORS[i % LABEL_COLORS.length],
          x: STEPS.map((t) => dx * (1 - (1 - t) * (1 - t))),
          y: STEPS.map((t) => a * t * t - 2 * a * APEX * t),
          spin: `${(Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 360)}deg`,
          wide: i % 3 === 0
        }
      }),
    [width, height]
  )
  // The sheet sits below the top of the window; the origin is in window terms.
  const place = () =>
    box.current?.measureInWindow((left, top, boxWidth, boxHeight) => {
      setStart(
        origin.x < 0
          ? { x: boxWidth / 2, y: boxHeight * 0.45 }
          : { x: origin.x - left, y: origin.y - top }
      )
    })
  useEffect(() => {
    if (!start) return
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      easing: Easing.linear,
      useNativeDriver: true
    })
    animation.start(() => onDone())
    return () => animation.stop()
  }, [progress, !!start])
  return (
    <View
      ref={box}
      onLayout={place}
      pointerEvents='none'
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
    >
      {start
        ? pieces.map((piece, i) => {
            const translateX = progress.interpolate({ inputRange: STEPS, outputRange: piece.x })
            const translateY = progress.interpolate({ inputRange: STEPS, outputRange: piece.y })
            const rotate = progress.interpolate({
              inputRange: [0, 1],
              outputRange: ['0deg', piece.spin]
            })
            const opacity = progress.interpolate({
              inputRange: [0, 0.75, 1],
              outputRange: [1, 1, 0]
            })
            return (
              <Animated.View
                key={i}
                style={[
                  styles.piece,
                  {
                    left: start.x,
                    top: start.y,
                    width: piece.wide ? 10 : 6,
                    height: piece.wide ? 6 : 10,
                    backgroundColor: piece.color,
                    opacity,
                    transform: [{ translateX }, { translateY }, { rotate }]
                  }
                ]}
              />
            )
          })
        : null}
    </View>
  )
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', borderRadius: 2 }
})
