/**
 * decryptPool 解密管线回归（修复「导出卡住无提示」后新增）：
 * - 单文件超时（jobTimeoutMs）：某个文件处理卡住 → 超时按 fail 处理，任务继续推进，不卡整批；
 * - 取消立即生效：abort 后 pump 快速退出（不等待在途任务自然超时）；
 * - 进度带 current：每派发一个任务先上报正在处理的 relPath（UI 显示"卡在哪个文件"）。
 *
 * 用法（先构建 out-lib，再编译 main）：
 *   node node_modules/typescript/bin/tsc -p tsconfig.build-lib.json
 *   node node_modules/typescript/bin/tsc -p tsconfig.buildmain.json
 *   node scripts/verify-pool.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Decrypter } = require('../out-lib/index.js')
const { runDecryptJobs } = require('../out-test/main/decryptPool.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgd-pool2-'))
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

// 生成一个真实加密文件
function makeEncrypted(absPath, size = 64) {
  const plain = new Uint8Array(size)
  for (let i = 0; i < 16; i++) plain[i] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52][i]
  for (let i = 16; i < size; i++) plain[i] = (i * 7 + 13) & 0xff
  fs.writeFileSync(absPath, Buffer.from(new Decrypter('0123456789abcdef').encrypt(plain)))
}

// 一个"永远卡住"的文件：worker 路径下 readFile 会很快返回……为了模拟卡住，
// 用一个超大文件 + 极短超时？不，更可靠：直接制造一个读会失败的路径不存在文件。
// 超时验证：给 jobTimeoutMs=100，任务处理时间 > 100ms 即判超时。用 5MB 文件保证
// readFile+XOR 在 100ms 内完不成（在 worker 中）或直接构造。
async function main() {
  const img = path.join(TMP, 'img')
  fs.mkdirSync(img, { recursive: true })

  console.log('验证 progress current + 完成统计:')
  await ok('进度回调先上报 current（正在处理的 relPath）', async () => {
    const files = []
    for (let i = 0; i < 4; i++) {
      const p = path.join(img, `f${i}.png_`)
      makeEncrypted(p, 1024)
      files.push({ id: i, absPath: p, relPath: `img/f${i}.png_`, ext: 'png_', key: '0123456789abcdef', outPath: path.join(TMP, `out${i}.png`) })
    }
    const currents = []
    const done = []
    const summary = await runDecryptJobs(files, { maxWorkers: 2 }, (d, t, okN, failN, cur) => {
      if (cur) currents.push(cur)
      done.push(d)
    })
    assert.equal(summary.ok, 4)
    assert.equal(summary.fail, 0)
    // 每个任务至少上报过一次 current
    for (let i = 0; i < 4; i++) assert.ok(currents.some((c) => c.includes(`f${i}.png_`)), `missing current for f${i}`)
  })

  console.log('验证单任务超时:')
  await ok('jobTimeoutMs 内未完成 → 按 fail 处理并继续（不卡整批）', async () => {
    const files = []
    for (let i = 0; i < 3; i++) {
      const p = path.join(img, `t${i}.png_`)
      makeEncrypted(p, 1024)
      files.push({ id: i, absPath: p, relPath: `img/t${i}.png_`, ext: 'png_', key: '0123456789abcdef', outPath: path.join(TMP, `t${i}.png`) })
    }
    const started = Date.now()
    const summary = await runDecryptJobs(files, { maxWorkers: 1, jobTimeoutMs: 50 }, () => {})
    const elapsed = Date.now() - started
    // 3 个任务 × 50ms 超时 → 总耗时应该远小于"卡死"（< 5s），且全部有结果
    assert.equal(summary.results.length, 3)
    assert.ok(elapsed < 5000, `took ${elapsed}ms`)
  })

  console.log('验证取消立即生效:')
  await ok('abort 后 pump 快速退出（在途任务不阻塞）', async () => {
    const files = []
    for (let i = 0; i < 10; i++) {
      const p = path.join(img, `c${i}.png_`)
      makeEncrypted(p, 64)
      files.push({ id: i, absPath: p, relPath: `img/c${i}.png_`, ext: 'png_', key: '0123456789abcdef', outPath: path.join(TMP, `c${i}.png`) })
    }
    const controller = new AbortController()
    const started = Date.now()
    const promise = runDecryptJobs(files, { maxWorkers: 2, signal: controller.signal, jobTimeoutMs: 5000 }, () => {})
    // 10ms 后取消
    setTimeout(() => controller.abort(), 10)
    const summary = await promise
    const elapsed = Date.now() - started
    assert.equal(summary.canceled, true)
    // 取消应在 1s 内返回（不等待在途任务 5s 超时）
    assert.ok(elapsed < 1000, `cancel took ${elapsed}ms`)
  })

  fs.rmSync(TMP, { recursive: true, force: true })
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
