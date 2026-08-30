/**
 * 真实游戏样本（本地私有，不进仓库）端到端回归。
 *
 * 样本位于 `fixtures/real-sample/`，其中 `data/System.json` 含 encryptionKey（16 字节 / 32 个 hex 字符），
 * `img/*.png_` 与 `audio/*.ogg_` 为加密资源。本脚本验证：
 * 1. 自动找 key：从 `data/System.json` 命中完整密钥。
 * 2. 扫描目录：收集到大量加密资源。
 * 3. 解密：解密一张 PNG 与一张 OGG，魔数校验通过。
 * 4. 密钥反推：从加密 PNG 头反推的 key 与 findKey 命中的 key 一致（16 字节密钥时精确相等）。
 *
 * 用法：node node_modules/typescript/bin/tsc -p tsconfig.build-lib.json && node scripts/regression-real.cjs
 */
const assert = require('node:assert/strict')
const { readFileSync, readdirSync, statSync, existsSync } = require('node:fs')
const { join, extname, relative } = require('node:path')
const {
  Decrypter,
  getKeyFromPNG,
  verifyKey,
  isEncryptedExtension,
  detectMagicKind,
  parseSystemJsonKey,
  extractKeyFromRpgCore
} = require('../out-lib/index.js')

const SAMPLE_DIR = join(__dirname, '..', 'fixtures', 'real-sample')

function listDir(dir) {
  try { return readdirSync(dir, { withFileTypes: true }) } catch { return [] }
}

function findKey(dir) {
  const systemCandidates = [join(dir, 'data', 'System.json'), join(dir, 'www', 'data', 'System.json')]
  for (const c of systemCandidates) {
    if (existsSync(c)) {
      const k = parseSystemJsonKey(readFileSync(c, 'utf-8'))
      if (k) return { key: k, source: c }
    }
  }
  const coreCandidates = [join(dir, 'js', 'rmmz_core.js'), join(dir, 'js', 'rpg_core.js'), join(dir, 'www', 'js', 'rmmz_core.js'), join(dir, 'www', 'js', 'rpg_core.js')]
  for (const c of coreCandidates) {
    if (existsSync(c)) {
      const k = extractKeyFromRpgCore(readFileSync(c, 'utf-8'))
      if (k) return { key: k, source: c }
    }
  }
  const sample = findSampleImage(dir)
  if (sample) {
    const buf = new Uint8Array(readFileSync(sample))
    const derived = getKeyFromPNG(buf)
    if (derived && verifyKey(buf, derived, 'png')) return { key: derived, source: sample + ' (derived)' }
  }
  return null
}

function findSampleImage(dir) {
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const e of listDir(cur)) {
      const abs = join(cur, e.name)
      if (e.isDirectory()) { if (!['node_modules', '.git', 'out', 'release'].includes(e.name)) stack.push(abs) }
      else if (e.isFile() && ['rpgmvp', 'png_'].includes(extname(e.name).slice(1).toLowerCase())) return abs
    }
  }
  return null
}

function scan(dir) {
  const out = []
  const stack = [dir]
  const skip = ['node_modules', '.git', 'out', 'release']
  while (stack.length) {
    const cur = stack.pop()
    for (const e of listDir(cur)) {
      const abs = join(cur, e.name)
      if (e.isDirectory()) { if (!skip.includes(e.name)) stack.push(abs) }
      else if (e.isFile()) {
        const ext = extname(e.name).slice(1).toLowerCase()
        if (isEncryptedExtension(ext)) out.push({ absPath: abs, relPath: relative(dir, abs), ext, size: statSync(abs).size })
      }
    }
  }
  return out
}

console.log(`真实样本: ${SAMPLE_DIR}`)
if (!existsSync(SAMPLE_DIR)) {
  console.error('⚠️ 未找到真实样本目录（fixtures/real-sample/）。跳过真实回归。')
  process.exit(0)
}

let passed = 0
let failed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name) }
  catch (e) { failed++; console.error('  ✘ ' + name + '\n    ' + e.message) }
}

console.log('真实样本回归:')

ok('自动找 key（从 data/System.json 命中）', () => {
  const kr = findKey(SAMPLE_DIR)
  assert.ok(kr && kr.source.includes('System.json'), 'key 应来自 System.json')
  assert.ok(/^[0-9a-f]{32}$/i.test(kr.key), `key 应为 32 个 hex 字符: ${kr.key}`)
  console.log(`      key = ${kr.key}`)
})

ok('扫描目录：收集加密资源', () => {
  const files = scan(SAMPLE_DIR)
  const pngs = files.filter((f) => f.ext === 'png_')
  const oggs = files.filter((f) => f.ext === 'ogg_')
  assert.ok(files.length >= 4000, `总加密文件数应 >= 4000，实际 ${files.length}`)
  assert.ok(pngs.length >= 3000, `png_ 应 >= 3000，实际 ${pngs.length}`)
  assert.ok(oggs.length >= 900, `ogg_ 应 >= 900，实际 ${oggs.length}`)
  console.log(`      png_=${pngs.length}, ogg_=${oggs.length}, 总=${files.length}`)
})

ok('解密 PNG：魔数校验通过', () => {
  const files = scan(SAMPLE_DIR)
  const png = files.find((f) => f.ext === 'png_')
  const kr = findKey(SAMPLE_DIR)
  const dec = new Decrypter(kr.key).decrypt(new Uint8Array(readFileSync(png.absPath)))
  assert.equal(detectMagicKind(dec), 'png')
})

ok('解密 OGG：魔数校验通过', () => {
  const files = scan(SAMPLE_DIR)
  const ogg = files.find((f) => f.ext === 'ogg_')
  const kr = findKey(SAMPLE_DIR)
  const dec = new Decrypter(kr.key).decrypt(new Uint8Array(readFileSync(ogg.absPath)))
  assert.equal(detectMagicKind(dec), 'ogg')
})

ok('密钥反推与 findKey 命中的 key 一致（16 字节密钥精确相等）', () => {
  const files = scan(SAMPLE_DIR)
  const png = files.find((f) => f.ext === 'png_')
  const kr = findKey(SAMPLE_DIR)
  const derived = getKeyFromPNG(new Uint8Array(readFileSync(png.absPath)))
  assert.equal(derived, kr.key, `反推=${derived} 应与 ${kr.key} 一致`)
})

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
