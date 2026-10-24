// Generates the notification sounds (small mono WAVs) shared by the desktop
// and mobile apps, so both play the same tones without a sound library or
// third-party assets. Run after changing a tone: node scripts/make-sounds.mjs
import fs from 'node:fs/promises'
import path from 'node:path'

const RATE = 22050
const root = path.join(import.meta.dirname, '..')
const targets = ['renderer/sounds', 'apps/mobile/assets/sounds']

// Each tone is a list of notes: [start s, length s, frequency Hz, end frequency Hz].
const tones = {
  chime: [
    [0, 0.35, 880, 880],
    [0.12, 0.45, 1318.5, 1318.5]
  ],
  pop: [[0, 0.09, 620, 260]],
  ding: [
    [0, 0.8, 1046.5, 1046.5],
    [0, 0.5, 2093, 2093]
  ]
}

function render(notes) {
  const length = Math.ceil(Math.max(...notes.map(([start, len]) => start + len)) * RATE)
  const samples = new Float32Array(length)
  for (const [start, len, from, to] of notes) {
    let phase = 0
    const first = Math.floor(start * RATE)
    const count = Math.floor(len * RATE)
    for (let i = 0; i < count; i++) {
      const t = i / count
      phase += (2 * Math.PI * (from + (to - from) * t)) / RATE
      // 5 ms attack, exponential decay: no clicks at either end.
      const envelope = Math.min(1, i / (0.005 * RATE)) * Math.exp(-5 * t) * (1 - t)
      samples[first + i] += Math.sin(phase) * envelope * 0.35
    }
  }
  const data = Buffer.alloc(length * 2)
  for (let i = 0; i < length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

for (const [name, notes] of Object.entries(tones)) {
  const wav = render(notes)
  for (const target of targets) await fs.writeFile(path.join(root, target, `${name}.wav`), wav)
  console.log(`${name}.wav  ${wav.length} bytes`)
}
