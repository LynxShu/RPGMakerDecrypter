/**
 * i18nWatcher / configStore 运行时回归（蓝图 §11.1）。
 *
 * 验证热监视：往 locales/ 放新语言包 → onChanged(added) 且 i18n 可用；
 * 修改 → updated；删除 → removed 且 bundle 移除；无效文件跳过；目录缺失兜底。
 * configStore 验证偏好持久化往返 / 损坏文件 sanitize / 合并写。
 *
 * 用法（先构建 out-lib，再编译 main 相关模块）：
 *   node node_modules/typescript/bin/tsc -p tsconfig.build-lib.json
 *   node node_modules/typescript/bin/tsc -p tsconfig.buildmain.json
 *   node scripts/verify-watch.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createI18n } = require('../out-lib/i18n/index.js')
const { watchLocalesDir } = require('../out-test/main/i18nWatcher.js')
const { createConfigStore } = require('../out-test/main/configStore.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgd-watch-'))
let passed = 0
let failed = 0
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log(`  ✔ ${name}`)
    })
    .catch((e) => {
      failed++
      console.error(`  ✘ ${name}\n    ${e.message}`)
    })
}

async function main() {
  console.log('验证 i18nWatcher 热监视（蓝图 §11.1）:')
  await ok('放入新语言包 → added 回调 + i18n 立即可用', async () => {
    const dir = path.join(TMP, 'loc1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify({ __meta: { name: 'English' }, hello: 'hi' }))
    const i18n = createI18n({ defaultLocale: 'en' })
    const changes = []
    const watcher = watchLocalesDir(i18n, dir, (c) => changes.push(c), { debounceMs: 20 })
    // 初始扫描已注册 en
    assert.deepEqual(watcher.codes(), ['en'])
    // 放入 fr.json
    fs.writeFileSync(path.join(dir, 'fr.json'), JSON.stringify({ __meta: { name: 'French' }, hello: 'salut' }))
    await sleep(150)
    assert.deepEqual(changes.map((c) => c.added).flat(), ['fr'])
    i18n.setLocale('fr')
    assert.equal(i18n.t('hello'), 'salut')
    watcher.close()
  })

  await ok('修改语言包 → updated 回调且文案刷新', async () => {
    const dir = path.join(TMP, 'loc2')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'en.json')
    fs.writeFileSync(file, JSON.stringify({ __meta: { name: 'English' }, hello: 'v1' }))
    const i18n = createI18n({ defaultLocale: 'en' })
    const changes = []
    const watcher = watchLocalesDir(i18n, dir, (c) => changes.push(c), { debounceMs: 20 })
    assert.equal(i18n.t('hello'), 'v1')
    fs.writeFileSync(file, JSON.stringify({ __meta: { name: 'English' }, hello: 'v2' }))
    await sleep(150)
    assert.deepEqual(changes.map((c) => c.updated).flat(), ['en'])
    assert.equal(i18n.t('hello'), 'v2')
    watcher.close()
  })

  await ok('删除语言包 → removed 回调且 bundle 移除', async () => {
    const dir = path.join(TMP, 'loc3')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify({ __meta: { name: 'English' }, hello: 'hi' }))
    fs.writeFileSync(path.join(dir, 'ja.json'), JSON.stringify({ __meta: { name: '日本語' }, hello: 'こんにちは' }))
    const i18n = createI18n({ defaultLocale: 'en' })
    const changes = []
    const watcher = watchLocalesDir(i18n, dir, (c) => changes.push(c), { debounceMs: 20 })
    assert.ok(i18n.hasLocale('ja'))
    fs.rmSync(path.join(dir, 'ja.json'))
    await sleep(150)
    assert.deepEqual(changes.map((c) => c.removed).flat(), ['ja'])
    assert.equal(i18n.hasLocale('ja'), false)
    watcher.close()
  })

  await ok('无效语言文件被跳过不炸', async () => {
    const dir = path.join(TMP, 'loc4')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify({ __meta: { name: 'English' }, hello: 'hi' }))
    fs.writeFileSync(path.join(dir, 'bad.json'), 'not json {')
    const i18n = createI18n({ defaultLocale: 'en' })
    const watcher = watchLocalesDir(i18n, dir, () => {}, { debounceMs: 20 })
    assert.deepEqual(watcher.codes(), ['en']) // bad 被跳过
    watcher.close()
  })

  await ok('目录不存在时 watcher 不抛错且 codes 为空', async () => {
    const i18n = createI18n({ defaultLocale: 'en' })
    const watcher = watchLocalesDir(i18n, path.join(TMP, 'nope'), () => {}, { debounceMs: 20 })
    assert.deepEqual(watcher.codes(), [])
    watcher.close()
  })

  console.log('验证 configStore（蓝图 §11.1 偏好持久化）:')
  await ok('set → 重新创建 store 后 get 恢复', async () => {
    const file = path.join(TMP, 'config.json')
    const s1 = createConfigStore(file)
    s1.set({ locale: 'zh-Hans', theme: 'dark' })
    const s2 = createConfigStore(file)
    assert.deepEqual(s2.get(), { locale: 'zh-Hans', theme: 'dark' })
  })
  await ok('非法 config 文件被 sanitize 为空', async () => {
    const file = path.join(TMP, 'config-bad.json')
    fs.writeFileSync(file, '{broken', 'utf-8')
    const s = createConfigStore(file)
    assert.deepEqual(s.get(), {})
  })
  await ok('set 合并而非覆盖', async () => {
    const file = path.join(TMP, 'config-merge.json')
    const s = createConfigStore(file)
    s.set({ locale: 'en' })
    s.set({ theme: 'system' })
    assert.deepEqual(s.get(), { locale: 'en', theme: 'system' })
  })

  fs.rmSync(TMP, { recursive: true, force: true })
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
