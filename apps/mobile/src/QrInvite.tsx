import React, { useMemo, useRef } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { encode } from 'uqr'
import { Button, colors, themed } from './ui'

// An invitation as a QR code, drawn with plain views: one black run per row
// segment, on white whatever the theme, since scanners expect dark on light.
export function QrCode({ value, size }: { value: string; size: number }) {
  const { cell, runs, width } = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 2 })
    // Whole pixels per module, or rounding leaves hairline gaps between runs.
    const cell = Math.max(1, Math.floor(size / data.length))
    const runs: Array<[number, number, number]> = []
    data.forEach((row, y) => {
      let start = -1
      row.forEach((dark, x) => {
        if (dark && start < 0) start = x
        if ((!dark || x === row.length - 1) && start >= 0) {
          runs.push([y, start, (dark ? x + 1 : x) - start])
          start = -1
        }
      })
    })
    return { cell, runs, width: cell * data.length }
  }, [value, size])
  return (
    <View
      style={{ width, height: width, backgroundColor: '#ffffff' }}
      accessibilityRole='image'
      accessibilityLabel='Invitation QR code'
    >
      {runs.map(([y, x, length]) => (
        <View
          key={`${y}:${x}`}
          style={{
            position: 'absolute',
            top: y * cell,
            left: x * cell,
            width: length * cell,
            height: cell,
            backgroundColor: '#000000'
          }}
        />
      ))}
    </View>
  )
}

// Full-screen camera that reports the first OpenCollab invitation it sees.
// Asks for the camera only when opened; other QR codes are ignored.
export function QrScanner({
  visible,
  onScan,
  onClose
}: {
  visible: boolean
  onScan: (invite: string) => void
  onClose: () => void
}) {
  const [permission, requestPermission] = useCameraPermissions()
  const done = useRef(false)
  if (!visible) done.current = false
  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose}>
      <View style={styles.screen}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing='back'
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (done.current || !/^opencollab:\/\//i.test(data.trim())) return
              done.current = true
              onScan(data.trim())
            }}
          />
        ) : (
          <View style={styles.permission}>
            <Feather name='camera' size={32} color={colors.muted} />
            <Text style={styles.text}>
              {permission && !permission.canAskAgain
                ? 'Camera access is off for OpenCollab. Turn it on in your phone settings to scan invitations.'
                : 'Allow the camera to scan an invitation QR code.'}
            </Text>
            {!permission || permission.canAskAgain ? (
              <Button title='Allow camera' icon='camera' onPress={() => void requestPermission()} />
            ) : null}
          </View>
        )}
        {permission?.granted ? (
          <View style={styles.overlay} pointerEvents='none'>
            <View style={styles.frame} />
            <Text style={styles.overlayText}>Point at an invitation QR code</Text>
          </View>
        ) : null}
        <Pressable
          style={styles.close}
          onPress={onClose}
          accessibilityRole='button'
          accessibilityLabel='Close scanner'
        >
          <Feather name='x' size={24} color='#ffffff' />
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = themed(() => ({
  screen: { flex: 1, backgroundColor: '#000000' },
  permission: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 16,
    padding: 32,
    backgroundColor: colors.bg
  },
  text: { color: colors.text, textAlign: 'center' as const, lineHeight: 22 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 24
  },
  frame: {
    width: 240,
    height: 240,
    borderColor: '#ffffff',
    borderWidth: 3,
    borderRadius: 16
  },
  overlayText: { color: '#ffffff', fontWeight: '600' as const },
  close: {
    position: 'absolute' as const,
    top: 48,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(0, 0, 0, 0.5)'
  }
}))
