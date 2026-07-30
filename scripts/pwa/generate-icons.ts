import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve('public/icons')

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  typeBytes.copy(result, 4)
  Buffer.from(data).copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length)
  return result
}

function iconPixels(size: number): Uint8Array {
  const bytes = new Uint8Array((size * 3 + 1) * size)
  const unit = size / 16
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1)
    bytes[row] = 0
    for (let x = 0; x < size; x += 1) {
      const gx = x / unit
      const gy = y / unit
      const border = gx < 1 || gx >= 15 || gy < 1 || gy >= 15
      const corridor = (gx >= 3 && gx < 5) || (gx >= 11 && gx < 13) || (gy >= 3 && gy < 5) || (gy >= 11 && gy < 13)
      const atlas = Math.abs(gx - 8) + Math.abs(gy - 8) < 2.2
      const [red, green, blue] = border || corridor ? [37, 68, 59] : atlas ? [187, 139, 67] : [247, 246, 242]
      const pixel = row + 1 + x * 3
      bytes[pixel] = red
      bytes[pixel + 1] = green
      bytes[pixel + 2] = blue
    }
  }
  return bytes
}

function png(size: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(iconPixels(size))),
    chunk('IEND', new Uint8Array()),
  ])
}

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    writeFile(resolve(outputDirectory, 'icon-192.png'), png(192)),
    writeFile(resolve(outputDirectory, 'icon-512.png'), png(512)),
    writeFile(resolve(outputDirectory, 'apple-touch-icon-180.png'), png(180)),
  ])
}

await main()
