const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { deflateSync } = require('node:zlib')

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const OUTPUT_DIR = join(__dirname, '..', 'build')
const SUPERSAMPLE = 4

const BACKGROUND = [0x0d, 0x0f, 0x12]
const BORDER = [0x2f, 0x36, 0x41]
const ACCENT = [0x2d, 0xd4, 0xbf]
const NEUTRAL = [0x5b, 0x66, 0x76]

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const dx = Math.max(Math.abs(x - (left + width / 2)) - (width / 2 - radius), 0)
  const dy = Math.max(Math.abs(y - (top + height / 2)) - (height / 2 - radius), 0)
  return dx * dx + dy * dy <= radius * radius
}

function shapes(size) {
  const outerRadius = size * 0.22
  const border = Math.max(1, size * 0.03)
  const margin = size * 0.19
  const gap = size * 0.08
  const cell = (size - margin * 2 - gap) / 2
  const cellRadius = Math.max(1, size * 0.07)
  const step = cell + gap
  const layers = [
    { rect: [0, 0, size, size, outerRadius], color: BORDER },
    {
      rect: [border, border, size - border * 2, size - border * 2, outerRadius - border],
      color: BACKGROUND
    }
  ]
  const cells = [
    [margin, margin, ACCENT],
    [margin + step, margin, NEUTRAL],
    [margin, margin + step, NEUTRAL],
    [margin + step, margin + step, NEUTRAL]
  ]
  for (const [x, y, color] of cells) layers.push({ rect: [x, y, cell, cell, cellRadius], color })
  return layers
}

function render(size) {
  const layers = shapes(size)
  const pixels = Buffer.alloc(size * size * 4)
  const samples = SUPERSAMPLE * SUPERSAMPLE
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let red = 0
      let green = 0
      let blue = 0
      let covered = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = px + (sx + 0.5) / SUPERSAMPLE
          const y = py + (sy + 0.5) / SUPERSAMPLE
          let color = null
          for (const layer of layers) {
            if (insideRoundedRect(x, y, ...layer.rect)) color = layer.color
          }
          if (color) {
            red += color[0]
            green += color[1]
            blue += color[2]
            covered++
          }
        }
      }
      const offset = (py * size + px) * 4
      if (covered > 0) {
        pixels[offset] = Math.round(red / covered)
        pixels[offset + 1] = Math.round(green / covered)
        pixels[offset + 2] = Math.round(blue / covered)
      }
      pixels[offset + 3] = Math.round((covered / samples) * 255)
    }
  }
  return pixels
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  const rowLength = size * 4
  const raw = Buffer.alloc((rowLength + 1) * size)
  for (let row = 0; row < size; row++) {
    raw[row * (rowLength + 1)] = 0
    pixels.copy(raw, row * (rowLength + 1) + 1, row * rowLength, (row + 1) * rowLength)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function buildIco(images) {
  const headerSize = 6 + images.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = headerSize
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map((image) => image.png)])
}

mkdirSync(OUTPUT_DIR, { recursive: true })
const images = SIZES.map((size) => ({ size, png: encodePng(size, render(size)) }))
writeFileSync(join(OUTPUT_DIR, 'icon.ico'), buildIco(images))
const largest = images[images.length - 1]
writeFileSync(join(OUTPUT_DIR, 'icon.png'), largest.png)
console.log(`icon.ico with sizes ${SIZES.join(', ')}`)
