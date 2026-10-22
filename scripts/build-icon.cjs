#!/usr/bin/env node
/**
 * 生成 build/icon.ico（Windows 多尺寸图标）。
 *
 * 为什么需要它（2026-10 排障结论）：
 * - Windows 任务栏/资源管理器会从 exe 内嵌的 RT_GROUP_ICON 按尺寸挑帧；只有 256 单帧时
 *   只能缩放大图，且打包工具 rcedit 0.2.0 对 ≥64KB 的帧会把 dwBytesInRes 截断成 16 位，
 *   导致任务栏图标显示为“压扁”的残图。
 * - 这里从 1024×1024 的 build/icon-master.png 生成 16/20/24/32/40/48/64/128/256 九帧：
 *   ≤64 用 32bpp BMP（带 AND mask），128/256 用 PNG；每帧都远小于 64KB。
 *
 * 用法：
 *   node scripts/build-icon.cjs              # 生成 build/icon.ico
 *   node scripts/build-icon.cjs --preview .  # 额外输出各尺寸预览 PNG
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ROOT = path.join(__dirname, '..')
const MASTER = path.join(ROOT, 'build', 'icon-master.png')
const OUT = path.join(ROOT, 'build', 'icon.ico')
const SIZES = [256, 128, 64, 48, 40, 32, 24, 20, 16]
/** ICO 里单帧数据建议 < 64KB：rcedit 0.2.0 会把更大的帧尺寸字段截断。 */
const SAFE_FRAME_BYTES = 65536

// ---------------------------------------------------------------- PNG 解码

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** 读取 8bit、非交错、RGB/RGBA 的 PNG，返回 { width, height, rgba }。 */
function readPng(file) {
  const b = fs.readFileSync(file)
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG: ' + file)
  let off = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (off < b.length) {
    const len = b.readUInt32BE(off)
    const type = b.toString('ascii', off + 4, off + 8)
    const data = b.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const depth = data[8]
      colorType = data[9]
      const interlace = data[12]
      if (depth !== 8) throw new Error(`仅支持 8bit PNG（当前 ${depth}bit）`)
      if (interlace !== 0) throw new Error('不支持交错 PNG')
      if (colorType !== 6 && colorType !== 2) {
        throw new Error(`仅支持 RGBA/RGB PNG（当前 colorType=${colorType}），请另存为 8bit RGBA`)
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }

  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(stride * height)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const rowStart = y * stride
    const prevStart = (y - 1) * stride
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++]
      const left = x >= channels ? pixels[rowStart + x - channels] : 0
      const up = y > 0 ? pixels[prevStart + x] : 0
      const ul = y > 0 && x >= channels ? pixels[prevStart + x - channels] : 0
      let value
      switch (filter) {
        case 0: value = v; break
        case 1: value = (v + left) & 0xff; break
        case 2: value = (v + up) & 0xff; break
        case 3: value = (v + ((left + up) >> 1)) & 0xff; break
        case 4: value = (v + paeth(left, up, ul)) & 0xff; break
        default: throw new Error('未知 PNG filter: ' + filter)
      }
      pixels[rowStart + x] = value
    }
  }

  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    rgba[i * 4] = pixels[j]
    rgba[i * 4 + 1] = pixels[j + 1]
    rgba[i * 4 + 2] = pixels[j + 2]
    rgba[i * 4 + 3] = channels === 4 ? pixels[j + 3] : 255
  }
  return { width, height, rgba }
}

// ---------------------------------------------------------------- 缩放到目标尺寸

/** 面积平均缩放（预乘 alpha），像素风缩小不会糊成一团。 */
function resizeArea(src, srcW, srcH, size) {
  const out = Buffer.alloc(size * size * 4)
  for (let dy = 0; dy < size; dy++) {
    const y0 = Math.floor((dy * srcH) / size)
    const y1 = Math.max(y0 + 1, Math.ceil(((dy + 1) * srcH) / size))
    for (let dx = 0; dx < size; dx++) {
      const x0 = Math.floor((dx * srcW) / size)
      const x1 = Math.max(x0 + 1, Math.ceil(((dx + 1) * srcW) / size))
      let sumA = 0
      let sumR = 0
      let sumG = 0
      let sumB = 0
      let count = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcW + sx) * 4
          const a = src[i + 3]
          sumA += a
          sumR += src[i] * a
          sumG += src[i + 1] * a
          sumB += src[i + 2] * a
          count++
        }
      }
      const o = (dy * size + dx) * 4
      if (sumA === 0) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0
      } else {
        out[o] = Math.round(sumR / sumA)
        out[o + 1] = Math.round(sumG / sumA)
        out[o + 2] = Math.round(sumB / sumA)
        out[o + 3] = Math.round(sumA / count)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- PNG 编码（RGBA）

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const src = y * stride
    const dst = y * (stride + 1)
    const prev = (y - 1) * stride
    let bestFilter = 0
    let best = null
    let bestScore = Infinity
    for (let filter = 0; filter <= 4; filter++) {
      const row = Buffer.alloc(stride)
      for (let x = 0; x < stride; x++) {
        const v = rgba[src + x]
        const left = x >= 4 ? rgba[src + x - 4] : 0
        const up = y > 0 ? rgba[prev + x] : 0
        const ul = y > 0 && x >= 4 ? rgba[prev + x - 4] : 0
        let pred = 0
        if (filter === 1) pred = left
        else if (filter === 2) pred = up
        else if (filter === 3) pred = (left + up) >> 1
        else if (filter === 4) pred = paeth(left, up, ul)
        row[x] = (v - pred) & 0xff
      }
      let score = 0
      for (let x = 0; x < stride; x++) {
        const s = row[x] < 128 ? row[x] : 256 - row[x]
        score += s
        if (score >= bestScore) break
      }
      if (score < bestScore) {
        bestScore = score
        bestFilter = filter
        best = row
      }
    }
    raw[dst] = bestFilter
    best.copy(raw, dst + 1)
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const idat = zlib.deflateSync(raw, { level: 9, memLevel: 9 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------------------------------------------------------------- ICO 组装

/** 32bpp BMP 帧：BITMAPINFOHEADER + 自下而上 BGRA + AND mask。 */
function bmpFrame(size, rgba) {
  const maskStride = ((size + 31) >> 5) * 4
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(size * size * 4, 20)

  const pixels = Buffer.alloc(size * size * 4)
  const mask = Buffer.alloc(maskStride * size)
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y // bottom-up
    for (let x = 0; x < size; x++) {
      const si = (srcY * size + x) * 4
      const di = (y * size + x) * 4
      pixels[di] = rgba[si + 2] // B
      pixels[di + 1] = rgba[si + 1] // G
      pixels[di + 2] = rgba[si] // R
      pixels[di + 3] = rgba[si + 3] // A
      if (rgba[si + 3] === 0) mask[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return Buffer.concat([header, pixels, mask])
}

function buildIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)

  const dir = Buffer.alloc(16 * frames.length)
  let offset = 6 + dir.length
  frames.forEach((frame, i) => {
    const e = i * 16
    dir[e] = frame.size === 256 ? 0 : frame.size
    dir[e + 1] = frame.size === 256 ? 0 : frame.size
    dir[e + 2] = 0
    dir[e + 3] = 0
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(frame.data.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += frame.data.length
  })
  return Buffer.concat([header, dir, ...frames.map((f) => f.data)])
}

// ---------------------------------------------------------------- main

function main() {
  const previewIndex = process.argv.indexOf('--preview')
  const previewDir = previewIndex >= 0 ? process.argv[previewIndex + 1] : null

  console.log(`读取母图: ${path.relative(ROOT, MASTER)}`)
  const src = readPng(MASTER)
  console.log(`  ${src.width}x${src.height}`)
  if (previewDir) fs.mkdirSync(previewDir, { recursive: true })

  const frames = SIZES.map((size) => {
    const rgba = resizeArea(src.rgba, src.width, src.height, size)
    const isBmp = size <= 64
    const data = isBmp ? bmpFrame(size, rgba) : encodePng(size, size, rgba)
    const png = isBmp ? null : data
    if (png && png.length >= SAFE_FRAME_BYTES) {
      throw new Error(`${size}×${size} PNG 帧 ${png.length} 字节 ≥ 64KB，rcedit 0.2.0 会截断，请降低该帧复杂度`)
    }
    if (previewDir) {
      fs.writeFileSync(path.join(previewDir, `frame-${size}.png`), encodePng(size, size, rgba))
    }
    return { size, data, kind: isBmp ? 'BMP' : 'PNG' }
  })

  const ico = buildIco(frames)
  fs.writeFileSync(OUT, ico)

  console.log(`\n已生成 ${path.relative(ROOT, OUT)}（${ico.length} 字节）`)
  for (const f of frames) {
    console.log(`  ${String(f.size).padStart(3)}x${String(f.size).padEnd(3)} ${f.kind}  ${String(f.data.length).padStart(6)} 字节`)
  }
  if (previewDir) console.log(`\n预览图已输出到 ${previewDir}`)
}

main()
