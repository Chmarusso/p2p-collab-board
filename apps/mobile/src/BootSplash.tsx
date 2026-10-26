// Carries the native splash into the app: the same logo on the same
// background, with a signal hopping between the three peers while the worker
// starts. It fades out once the worker answers and the signal has gone round
// the three peers once.
import React, { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import { colors } from './ui'

SplashScreen.preventAutoHideAsync().catch(() => {})

// imageWidth of the expo-splash-screen plugin in app.json.
const SIZE = 200
// Link midpoints in assets/splash-icon.png (1024 canvas), in hop order:
// top-left link, bottom link, top-right link.
const NODES = [
  [428, 512],
  [512, 654],
  [596, 512]
].map(([x, y]) => [(x / 1024) * SIZE, (y / 1024) * SIZE])
const DOT = (54 / 1024) * SIZE
const CYCLE = 1400
// Each ping takes this share of the cycle; the next one starts a hop later.
const PING = 0.5
const HOP = 0.17
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
// The worker normally answers well before this; never trap the user here.
const MAX_WAIT = 4000

export function BootSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const progress = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(1)).current
  const [loaded, setLoaded] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [shown, setShown] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const timer = setTimeout(() => setTimedOut(true), MAX_WAIT)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!loaded) return
    // One full round, so the pulse is seen even when the worker is quick.
    const timer = setTimeout(() => setShown(true), reduceMotion ? 0 : CYCLE)
    if (reduceMotion) return () => clearTimeout(timer)
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: CYCLE,
        easing: Easing.linear,
        useNativeDriver: true
      })
    )
    loop.start()
    return () => {
      clearTimeout(timer)
      loop.stop()
    }
  }, [loaded, reduceMotion, progress])

  useEffect(() => {
    if (!loaded || !((ready && shown) || timedOut)) return
    Animated.timing(fade, {
      toValue: 0,
      duration: 220,
      easing: EASE_OUT,
      useNativeDriver: true
    }).start(() => onDone())
  }, [loaded, ready, shown, timedOut, fade, onDone])

  return (
    <Animated.View pointerEvents='none' style={[styles.root, { opacity: fade }]}>
      <View style={styles.logo}>
        <Image
          source={require('../assets/splash-icon.png')}
          style={styles.image}
          onLoadEnd={() => {
            // The overlay now looks exactly like the native splash: swap them.
            setLoaded(true)
            SplashScreen.hideAsync().catch(() => {})
          }}
        />
        {reduceMotion
          ? null
          : NODES.map(([x, y], index) => {
              const start = index * HOP
              const window = [start, start + PING * 0.25, start + PING]
              const ring = {
                opacity: progress.interpolate({
                  inputRange: [0, ...window, 1],
                  outputRange: [0, 0, 0.9, 0, 0],
                  extrapolate: 'clamp'
                }),
                transform: [
                  {
                    scale: progress.interpolate({
                      inputRange: [0, start, start + PING, 1],
                      outputRange: [1, 1, 2.8, 2.8],
                      easing: EASE_OUT,
                      extrapolate: 'clamp'
                    })
                  }
                ]
              }
              const core = {
                opacity: progress.interpolate({
                  inputRange: [0, ...window, 1],
                  outputRange: [0, 0, 1, 0, 0],
                  extrapolate: 'clamp'
                })
              }
              const place = { left: x - DOT / 2, top: y - DOT / 2 }
              return (
                <React.Fragment key={index}>
                  <Animated.View style={[styles.ring, place, ring]} />
                  <Animated.View style={[styles.core, place, core]} />
                </React.Fragment>
              )
            })}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg
  },
  logo: { width: SIZE, height: SIZE },
  image: { width: SIZE, height: SIZE },
  ring: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.5,
    borderColor: colors.accent
  },
  core: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: '#C8FFE0'
  }
})
