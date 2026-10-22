/**
 * CLI 自动化测试（蓝图 §11.3 / HANDOFF「CLI 补齐」）。
 *
 * 不 spawn 子进程：直接 require 编译后的 `out-cli-test/cli/run.js`，
 * 用 `runCli(argv, io)` 注入 argv 与输出通道，检查退出码与输出。
 *
 * 用法：
 *   node node_modules/typescript/bin/tsc -p tsconfig.build-lib.json
 *   node scripts/prepare-cli-test.cjs
 *   node scripts/verify-cli.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Decrypter, PNG_HEADER_BYTES } = require('../out-lib/index.js')
const { runCli } = require('../out-cli-test/cli/run.js')

const KEY = '0123456789abcdef'
let passed = 0
let failed = 0

async function ok(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✔ ${name}`)
  } catch (e) {
    failed++
    console.error(`  ✘ ${name}\n    ${e.message}`)
  }
}

/** 跑一次 CLI，返回 { code, out, err } */
async function run(args) {
  const io = { out: [], err: [] }
  const code = await runCli(['node', 'cli', ...args], {
    out: (s) => io.out.push(s),
    err: (s) => io.err.push(s)
  })
  return { code, out: io.out.join('\n'), err: io.err.join('\n') }
}

// ---- 合成样本目录：fake game ----
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgd-cli-'))
const GAME = path.join(TMP, 'game')
fs.mkdirSync(path.join(GAME, 'data'), { recursive: true })
fs.mkdirSync(path.join(GAME, 'img'), { recursive: true })

// data/System.json（含密钥）
fs.writeFileSync(
  path.join(GAME, 'data', 'System.json'),
  JSON.stringify({ encryptionKey: KEY, gameTitle: 'CLI Test' }),
  'utf-8'
)

// 加密 PNG：真实 PNG 头 16 字节 + 填充，用 Decrypter 加密为 MZ 风格 x.png_
function makeEncryptedPng(size = 40) {
  const plain = new Uint8Array(size)
  for (let i = 0; i < PNG_HEADER_BYTES.length; i++) plain[i] = PNG_HEADER_BYTES[i]
  for (let i = PNG_HEADER_BYTES.length; i < size; i++) plain[i] = (i * 7 + 13) & 0xff
  return Buffer.from(new Decrypter(KEY).encrypt(plain))
}
fs.writeFileSync(path.join(GAME, 'img', 'x.png_'), makeEncryptedPng())

// 一个普通（非加密）文件，确保扫描只收集加密扩展名
fs.writeFileSync(path.join(GAME, 'README.txt'), 'not encrypted', 'utf-8')

async function main() {
  console.log('验证 CLI 基础命令:')
  await ok('--help 退出码 0 且输出用法', async () => {
    const r = await run(['--help'])
    assert.equal(r.code, 0)
    assert.match(r.out, /Usage/)
  })
  await ok('未知命令退出码非 0', async () => {
    const r = await run(['frobnicate'])
    assert.notEqual(r.code, 0)
  })
  await ok('decrypt 缺 key 报错退出码 1', async () => {
    const r = await run(['decrypt', path.join(GAME, 'img', 'x.png_')])
    assert.equal(r.code, 1)
  })
  await ok('--lang zh-Hans 时 decode-dir 缺 key 报中文错误（蓝图 §11.1 CLI 覆盖）', async () => {
    const empty = path.join(TMP, 'empty-game-lang')
    fs.mkdirSync(path.join(empty, 'img'), { recursive: true })
    fs.writeFileSync(path.join(empty, 'img', 'z.ogg_'), Buffer.from('not a real ogg'))
    const r = await run(['--lang', 'zh-Hans', 'decode-dir', empty])
    assert.equal(r.code, 1)
    assert.match(r.err, /未找到加密密钥/)
  })
  await ok('--lang 缺失语言包时回退 en 不报错', async () => {
    const empty = path.join(TMP, 'empty-game-lang2')
    fs.mkdirSync(path.join(empty, 'img'), { recursive: true })
    fs.writeFileSync(path.join(empty, 'img', 'z.ogg_'), Buffer.from('not a real ogg'))
    const r = await run(['--lang', 'xx-XX', 'decode-dir', empty])
    assert.equal(r.code, 1)
    assert.match(r.err, /No encryption key|未找到加密密钥/) // 回退 en 或原 key
  })
  await ok('decrypt/encrypt 往返', async () => {
    const enc = path.join(TMP, 'enc.png_')
    const dec = path.join(TMP, 'dec.png')
    // enc.png_ 直接是加密产物（不要再对已加密文件 encrypt，会二次加密）
    fs.writeFileSync(enc, makeEncryptedPng())
    let r = await run(['decrypt', '-k', KEY, '-o', dec, enc])
    assert.equal(r.code, 0)
    const decBuf = fs.readFileSync(dec)
    for (let i = 0; i < PNG_HEADER_BYTES.length; i++) assert.equal(decBuf[i], PNG_HEADER_BYTES[i])
    // 再加密回去
    r = await run(['encrypt', '-k', KEY, '-o', path.join(TMP, 'enc2.png_'), dec])
    assert.equal(r.code, 0)
    const back = new Decrypter(KEY).decrypt(fs.readFileSync(path.join(TMP, 'enc2.png_')))
    assert.equal(back[0], 0x89)
  })

  console.log('验证 detect-key / decode-dir:')
  await ok('detect-key 从 System.json 命中密钥（JSON 输出）', async () => {
    const r = await run(['detect-key', GAME])
    assert.equal(r.code, 0)
    const j = JSON.parse(r.out)
    assert.equal(j.ok, true)
    assert.equal(j.key, KEY)
    assert.match(j.source, /System\.json/)
  })
  await ok('decode-dir --dry-run 只报告不写盘', async () => {
    const outDir = path.join(TMP, 'dryout')
    const r = await run(['decode-dir', '--dry-run', '--json', '-o', outDir, GAME])
    assert.equal(r.code, 0)
    const j = JSON.parse(r.out)
    assert.equal(j.dryRun, true)
    assert.equal(j.scanned, 1)
    assert.equal(j.key, KEY)
    assert.equal(j.files.some((f) => f.replace(/\\/g, '/') === 'img/x.png_'), true)
    assert.equal(fs.existsSync(outDir), false)
  })
  await ok('decode-dir --jobs 并发解密并保留目录结构（魔数通过）', async () => {
    const outDir = path.join(TMP, 'out1')
    const r = await run(['decode-dir', '--jobs', '2', '--json', '-o', outDir, GAME])
    assert.equal(r.code, 0)
    const j = JSON.parse(r.out)
    assert.equal(j.scanned, 1)
    assert.equal(j.success, 1)
    assert.equal(j.fail, 0)
    assert.equal(j.magicFail, 0)
    const target = path.join(outDir, 'img', 'x.png')
    assert.equal(fs.existsSync(target), true)
    assert.equal(fs.readFileSync(target)[0], 0x89)
  })
  await ok('decode-dir 错误 key 时魔数校验上报 magicFail', async () => {
    const outDir = path.join(TMP, 'out2')
    const r = await run(['decode-dir', '-k', '0'.repeat(16), '--json', '-o', outDir, GAME])
    assert.equal(r.code, 0)
    const j = JSON.parse(r.out)
    assert.equal(j.success, 1) // 解密本身不抛错
    assert.equal(j.magicFail, 1) // 但魔数校验失败
  })
  await ok('decode-dir 找不到 key 时退出码 1', async () => {
    // 用 OGG 扩展名：无 System.json/rpg_core.js，且 PNG 头反推不适用 → 必然找不到 key
    const empty = path.join(TMP, 'empty-game')
    fs.mkdirSync(path.join(empty, 'img'), { recursive: true })
    fs.writeFileSync(path.join(empty, 'img', 'y.ogg_'), Buffer.from('not a real ogg'))
    const r = await run(['decode-dir', empty])
    assert.equal(r.code, 1)
    assert.match(r.err, /No encryption key|密钥/) // 默认 en 或 --lang 中文
  })

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
  fs.rmSync(TMP, { recursive: true, force: true })
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
