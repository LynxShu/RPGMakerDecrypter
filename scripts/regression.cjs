/**
 * 端到端回归脚本（合成样本）。
 *
 * 目的：在本受限环境（无法跑 electron / esbuild）也能验证「自动找 key → 扫描目录 → 解密 → 魔数校验」
 * 这条组合链路的正确性。它基于 `out-lib/` 的纯 TS 函数 + node:fs，模拟 `src/main/project.ts` 的
 * `findEncryptionKey` / `scanEncryptedFiles` 流程（两者必须保持一致）。
 *
 * 用法：
 *   node node_modules/typescript/bin/tsc -p tsconfig.build-lib.json
 *   node scripts/regression.cjs
 *
 * 当真实游戏样本就绪时，可把样本放入 fixtures/ 并改用真实路径回归。
 */
const assert = require('node:assert/strict')
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  rmSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join, extname, relative } = require('node:path')
const {
  Decrypter,
  getKeyFromPNG,
  verifyKey,
  isEncryptedExtension,
  toNormalExtension,
  detectMagicKind,
  parseSystemJsonKey,
  extractKeyFromRpgCore,
  looksEncrypted,
  PNG_HEADER_BYTES
} = require('../out-lib/index.js')

const KEY = '0123456789abcdef'

function pngSample(len = 24) {
  const buf = new Uint8Array(len)
  for (let i = 0; i < Math.min(len, PNG_HEADER_BYTES.length); i++) buf[i] = PNG_HEADER_BYTES[i]
  for (let i = PNG_HEADER_BYTES.length; i < len; i++) buf[i] = (i * 7 + 13) & 0xff
  return buf
}

/** 构造一个合成 MV 风格游戏目录（data/System.json + img/characters/*.rpgmvp） */
function buildSampleDir() {
  const dir = mkdtempSync(join(tmpdir(), 'rpgm-decrypt-'))
  mkdirSync(join(dir, 'data'), { recursive: true })
  writeFileSync(join(dir, 'data', 'System.json'), JSON.stringify({ encryptionKey: KEY }))
  mkdirSync(join(dir, 'img', 'characters'), { recursive: true })
  const png = pngSample()
  writeFileSync(
    join(dir, 'img', 'characters', 'actor.rpgmvp'),
    Buffer.from(new Decrypter(KEY).encrypt(png))
  )
  return dir
}

// —— 与 src/main/project.ts 保持一致的核心流程 ——
function findKey(dir) {
  for (const c of [join(dir, 'data', 'System.json'), join(dir, 'www', 'data', 'System.json')]) {
    if (existsSync(c)) {
      const k = parseSystemJsonKey(readFileSync(c, 'utf-8'))
      if (k) return { key: k, source: c }
    }
  }
  for (const c of [join(dir, 'js', 'rpg_core.js'), join(dir, 'www', 'js', 'rpg_core.js')]) {
    if (existsSync(c)) {
      const k = extractKeyFromRpgCore(readFileSync(c, 'utf-8'))
      if (k) return { key: k, source: c }
    }
  }
  const sample = findSampleImage(dir)
  if (sample) {
    const buf = new Uint8Array(readFileSync(sample))
    const derived = getKeyFromPNG(buf)
    if (derived) {
      if (verifyKey(buf, derived, 'png')) return { key: derived, source: sample + ' (derived)' }
    }
  }
  return null
}

function findSampleImage(dir) {
  const stack = [dir]
  const imgExts = new Set(['rpgmvp', 'png_'])
  while (stack.length) {
    const cur = stack.pop()
    const entries = (() => { try { return readdirSync(cur, { withFileTypes: true }) } catch { return [] } })()
    for (const e of entries) {
      const abs = join(cur, e.name)
      if (e.isDirectory()) { if (!['node_modules', '.git', 'out', 'release'].includes(e.name)) stack.push(abs) }
      else if (e.isFile() && imgExts.has(extname(e.name).slice(1).toLowerCase())) return abs
    }
  }
  return null
}

function scan(dir) {
  const out = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    const entries = (() => { try { return readdirSync(cur, { withFileTypes: true }) } catch { return [] } })()
    for (const e of entries) {
      const abs = join(cur, e.name)
      if (e.isDirectory()) { if (!['node_modules', '.git', 'out', 'release'].includes(e.name)) stack.push(abs) }
      else if (e.isFile()) {
        const ext = extname(e.name).slice(1).toLowerCase()
        if (isEncryptedExtension(ext)) out.push({ absPath: abs, relPath: relative(dir, abs), ext, size: statSync(abs).size })
      }
    }
  }
  return out
}

let passed = 0
let failed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name) }
  catch (e) { failed++; console.error('  ✘ ' + name + '\n    ' + e.message) }
}

const dir = buildSampleDir()
console.log(`合成样本目录: ${dir}`)
console.log('端到端回归:')

ok('自动找 key：从 data/System.json 命中', () => {
  const r = findKey(dir)
  assert.equal(r.key, KEY)
  assert.equal(r.source, join(dir, 'data', 'System.json'))
})

ok('扫描目录：收集到加密文件', () => {
  const files = scan(dir)
  assert.ok(files.length >= 1)
  assert.equal(files[0].ext, 'rpgmvp')
})

ok('头嗅探：加密文件被识别为 RPGMV', () => {
  const files = scan(dir)
  const raw = new Uint8Array(readFileSync(files[0].absPath))
  assert.equal(looksEncrypted(raw), true)
})

ok('解密：还原出 PNG 魔数', () => {
  const files = scan(dir)
  const raw = new Uint8Array(readFileSync(files[0].absPath))
  const dec = new Decrypter(KEY).decrypt(raw)
  assert.equal(detectMagicKind(dec), 'png')
})

ok('导出映射：rpgmvp → png', () => {
  assert.equal(toNormalExtension('rpgmvp'), 'png')
})

rmSync(dir, { recursive: true, force: true })
console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
