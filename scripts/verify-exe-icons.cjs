#!/usr/bin/env node
/**
 * 校验（并可自动修复）Windows exe 内嵌图标资源。
 *
 * 背景：electron-builder 25 使用的 winCodeSign 2.6.0 自带 rcedit 0.2.0，
 * 当图标帧数据 ≥ 64KB 时会把 RT_GROUP_ICON 里的 dwBytesInRes 截断成低 16 位
 * （例：106708 字节 → 41172），Windows 任务栏按截断后的长度读 PNG → 图标显示为压扁的残图。
 *
 * 本脚本解析 PE 的 RT_GROUP_ICON / RT_ICON：
 * - 默认只校验，报告每帧「声明大小 vs 实际大小」；
 * - 加 --fix 时把不一致的 dwBytesInRes 写回实际大小（不改动其它字节）；
 * - 退出码：0 = 一致或已修复；1 = 仍有问题/解析失败。
 *
 * 用法：
 *   node scripts/verify-exe-icons.cjs [exe路径] [--fix]
 * 默认 exe 路径：release/win-unpacked/RPGMakerDecrypter.exe
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

function parsePeResources(file) {
  const b = fs.readFileSync(file)
  if (b.readUInt16LE(0) !== 0x5a4d) throw new Error('不是 MZ/PE 文件: ' + file) // 'MZ'
  const peOff = b.readUInt32LE(0x3c)
  if (b.readUInt32LE(peOff) !== 0x00004550) throw new Error('缺少 PE 签名')
  const coff = peOff + 4
  const sectionCount = b.readUInt16LE(coff + 2)
  const optSize = b.readUInt16LE(coff + 16)
  const optOff = coff + 20
  const magic = b.readUInt16LE(optOff)
  const ddOff = optOff + (magic === 0x20b ? 112 : 96)
  const resRva = b.readUInt32LE(ddOff + 2 * 8)

  const sections = []
  const secOff = optOff + optSize
  for (let i = 0; i < sectionCount; i++) {
    const o = secOff + i * 40
    sections.push({
      va: b.readUInt32LE(o + 12),
      rawSize: b.readUInt32LE(o + 16),
      rawPtr: b.readUInt32LE(o + 20)
    })
  }
  const rvaToOff = (rva) => {
    for (const s of sections) {
      if (rva >= s.va && rva < s.va + s.rawSize) return s.rawPtr + (rva - s.va)
    }
    throw new Error('RVA 映射失败: ' + rva.toString(16))
  }
  const resBase = rvaToOff(resRva)

  const readDir = (off) => {
    const count = b.readUInt16LE(off + 12) + b.readUInt16LE(off + 14)
    const out = []
    for (let i = 0; i < count; i++) {
      const e = off + 16 + i * 8
      const name = b.readUInt32LE(e)
      const data = b.readUInt32LE(e + 4)
      out.push({
        name: name & 0x80000000 ? 'named' : name,
        isDir: !!(data & 0x80000000),
        value: data & 0x7fffffff
      })
    }
    return out
  }

  const typeDir = readDir(resBase)
  const groupType = typeDir.find((t) => t.name === 14)
  const iconType = typeDir.find((t) => t.name === 3)
  if (!groupType || !iconType) throw new Error('exe 中没有 RT_GROUP_ICON / RT_ICON 资源')

  // RT_ICON: id -> { size, dataOff }
  const icons = new Map()
  for (const nameEntry of readDir(resBase + iconType.value)) {
    if (!nameEntry.isDir) continue
    const lang = readDir(resBase + nameEntry.value)[0]
    const dataEntry = resBase + lang.value
    icons.set(nameEntry.name, {
      size: b.readUInt32LE(dataEntry + 4),
      dataOff: rvaToOff(b.readUInt32LE(dataEntry))
    })
  }

  // RT_GROUP_ICON: 每个 group 的每帧
  const entries = []
  for (const nameEntry of readDir(resBase + groupType.value)) {
    if (!nameEntry.isDir) continue
    const lang = readDir(resBase + nameEntry.value)[0]
    const dataEntry = resBase + lang.value
    const dataOff = rvaToOff(b.readUInt32LE(dataEntry))
    const count = b.readUInt16LE(dataOff + 4)
    for (let k = 0; k < count; k++) {
      const e = dataOff + 6 + k * 14
      entries.push({
        groupId: nameEntry.name,
        index: k,
        width: b[e] === 0 ? 256 : b[e],
        height: b[e + 1] === 0 ? 256 : b[e + 1],
        bpp: b.readUInt16LE(e + 6),
        declaredBytes: b.readUInt32LE(e + 8),
        iconId: b.readUInt16LE(e + 12),
        /** 该帧 dwBytesInRes 字段在文件中的绝对偏移 */
        bytesFieldOff: e + 8
      })
    }
  }

  return { buffer: b, icons, entries }
}

function main() {
  const args = process.argv.slice(2)
  const fix = args.includes('--fix')
  const exeArg = args.find((a) => !a.startsWith('--'))
  const exe = path.resolve(exeArg || path.join(ROOT, 'release', 'win-unpacked', 'RPGMakerDecrypter.exe'))

  if (!fs.existsSync(exe)) {
    console.error(`[icons] 找不到 exe: ${exe}`)
    process.exit(1)
  }

  let parsed
  try {
    parsed = parsePeResources(exe)
  } catch (err) {
    console.error(`[icons] 解析失败: ${err.message}`)
    process.exit(1)
  }

  const { buffer, icons, entries } = parsed
  console.log(`[icons] ${path.relative(ROOT, exe)}  帧数=${entries.length}（RT_ICON ${icons.size} 个）`)

  let mismatched = 0
  const smallSizes = []
  for (const entry of entries) {
    const icon = icons.get(entry.iconId)
    if (!icon) {
      console.error(`  ✗ group#${entry.groupId} 第${entry.index}帧 引用了不存在的 RT_ICON id=${entry.iconId}`)
      mismatched++
      continue
    }
    const ok = icon.size === entry.declaredBytes
    if (!ok) mismatched++
    if (entry.width <= 32) smallSizes.push(entry.width)
    console.log(
      `  ${ok ? '✓' : '✗'} ${String(entry.width).padStart(3)}x${String(entry.height).padEnd(3)}` +
        ` 声明=${String(entry.declaredBytes).padStart(6)} 实际=${String(icon.size).padStart(6)}` +
        (ok ? '' : `  ← 差值 ${icon.size - entry.declaredBytes}`)
    )
  }

  if (smallSizes.length === 0) {
    console.warn('[icons] ⚠ 没有 ≤32px 的帧：任务栏只能缩放 256 大图，建议补多尺寸图标（scripts/build-icon.cjs）')
  }

  if (mismatched === 0) {
    console.log('[icons] 全部一致 ✅')
    process.exit(0)
  }

  if (!fix) {
    console.error(`[icons] 发现 ${mismatched} 处不一致（可加 --fix 自动修复）`)
    process.exit(1)
  }

  for (const entry of entries) {
    const icon = icons.get(entry.iconId)
    if (icon && icon.size !== entry.declaredBytes) {
      buffer.writeUInt32LE(icon.size, entry.bytesFieldOff)
    }
  }
  fs.writeFileSync(exe, buffer)
  console.log(`[icons] 已自动修复 ${mismatched} 处 dwBytesInRes 并写回 exe`)
  process.exit(0)
}

main()
