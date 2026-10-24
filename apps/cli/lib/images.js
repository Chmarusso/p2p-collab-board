// Minimal image helpers for attachments: type from the file extension and
// dimensions from the PNG/GIF/JPEG header (so apps can reserve the right space).
const path = require('path')

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const types = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
const extensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm'
}

function imageType(file) {
  return types[path.extname(file).toLowerCase()] || null
}

function imageSize(buffer, type) {
  if (type === 'image/png' && buffer.length > 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (type === 'image/gif' && buffer.length > 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  if (type === 'image/jpeg') {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break
      const marker = buffer[offset + 1]
      const length = buffer.readUInt16BE(offset + 2)
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      offset += 2 + length
    }
  }
  return { width: null, height: null }
}

const imageKey = (ref) => `${ref.core}:${ref.id.blockOffset}:${ref.id.blockLength}`

module.exports = { MAX_IMAGE_BYTES, imageType, imageSize, imageKey, extensions }
