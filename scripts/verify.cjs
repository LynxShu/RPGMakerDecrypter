/**
 * 本地自检脚本：用 tsc 编译后的纯 TS 核心（out-lib）跑关键断言。
 *
 * 为什么不用 vitest：在当前受限环境中 esbuild 的子进程服务被沙箱拦截（spawn EPERM）。
 * 本脚本不依赖 esbuild，用 Node 直接运行编译产物，验证算法逻辑正确性。
 *
 * 用法：
 *   node node_modules/typescript/bin/tsc -p tsconfig.build-lib.json
 *   node scripts/verify.cjs
 */
const assert = require('node:assert/strict')
const {
  Decrypter,
  DecryptionError,
  getKeyFromPNG,
  verifyKey,
  isEncryptedExtension,
  toNormalExtension,
  detectMagicKind,
  detectHeader,
  looksEncrypted,
  parseSystemJsonKey,
  extractKeyFromRpgCore,
  encryptExtFor,
  DEFAULT_HEADER_LEN,
  PNG_HEADER_BYTES,
  hexToBytes,
  compressToBase64,
  decompressFromBase64,
  createI18n,
  ThemeStore,
  readSystemPref
} = require('../out-lib/index.js')

const KEY = '0123456789abcdef'
let passed = 0
let failed = 0

function ok(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✔ ${name}`)
  } catch (e) {
    failed++
    console.error(`  ✘ ${name}\n    ${e.message}`)
  }
}

function makePlain(len = 24) {
  const buf = new Uint8Array(len)
  for (let i = 0; i < Math.min(len, PNG_HEADER_BYTES.length); i++) buf[i] = PNG_HEADER_BYTES[i]
  for (let i = PNG_HEADER_BYTES.length; i < len; i++) buf[i] = (i * 7 + 13) & 0xff
  return buf
}

function equal(a, b) {
  assert.equal(a.length, b.length, `长度不同: ${a.length} != ${b.length}`)
  for (let i = 0; i < a.length; i++) assert.equal(a[i], b[i], `第 ${i} 字节不同`)
}

console.log('验证 crypto:')
ok('默认假头以 ASCII "RPGMV" 开头', () => {
  const d = new Decrypter(KEY)
  assert.equal(d.getHeaderLen(), DEFAULT_HEADER_LEN)
  const fake = d.encrypt(new Uint8Array(16)).slice(0, 5)
  equal(fake, new Uint8Array([0x52, 0x50, 0x47, 0x4d, 0x56]))
})

ok('encrypt → decrypt 往返', () => {
  const d = new Decrypter(KEY)
  const plain = makePlain(32)
  const encrypted = d.encrypt(plain)
  assert.equal(d.verifyFakeHeader(encrypted), true)
  equal(d.decrypt(encrypted), plain)
})

ok('decrypt 对非加密文件抛错（假头校验）', () => {
  const d = new Decrypter(KEY)
  assert.throws(() => d.decrypt(makePlain(16)), DecryptionError)
})

ok('短密钥按索引直取、不循环（蓝图§4 修复）', () => {
  const d = new Decrypter('abcd')
  const plain = makePlain(16)
  const enc = d.encrypt(plain)
  const body = enc.slice(DEFAULT_HEADER_LEN)
  assert.equal(body[0], plain[0] ^ 0xab)
  assert.equal(body[1], plain[1] ^ 0xcd)
  assert.equal(body[2], plain[2])
  equal(d.decrypt(enc), plain)
})

ok('restorePngHeader 救图', () => {
  const d = new Decrypter(KEY)
  const plain = makePlain(40)
  const restored = d.restorePngHeader(d.encrypt(plain))
  equal(restored.slice(0, 16), new Uint8Array(PNG_HEADER_BYTES))
  equal(restored.slice(16), plain.slice(16)) // 去掉假头+加密头的 32 字节后，接 PNG 头
})

ok('getKeyFromPNG 反推密钥', () => {
  const d = new Decrypter(KEY)
  // PNG 头 16 字节，但标准 MV 密钥是 16 hex 字符（8 字节），故反推得 key + 尾部 '\0' 填充
  assert.equal(getKeyFromPNG(d.encrypt(makePlain(32)), DEFAULT_HEADER_LEN), KEY + '0'.repeat(16))
})

ok('verifyKey 用魔数校验密钥', () => {
  const d = new Decrypter(KEY)
  const enc = d.encrypt(makePlain(32))
  assert.equal(verifyKey(enc, KEY, 'png'), true)
  assert.equal(verifyKey(enc, '0'.repeat(32), 'png'), false)
})

ok('扩展名与魔数', () => {
  assert.equal(isEncryptedExtension('rpgmvp'), true)
  assert.equal(isEncryptedExtension('png_'), true)
  assert.equal(isEncryptedExtension('png'), false)
  assert.equal(toNormalExtension('rpgmvp'), 'png')
  assert.equal(toNormalExtension('png'), null)
  assert.equal(detectMagicKind(new Uint8Array(PNG_HEADER_BYTES)), 'png')
  assert.equal(detectMagicKind(new Uint8Array([0x4f, 0x67, 0x67, 0x53])), 'ogg')
})

ok('encryptExtFor 按 MV/MZ 版本映射加密扩展名', () => {
  assert.equal(encryptExtFor('mv', 'png'), 'rpgmvp')
  assert.equal(encryptExtFor('mv', 'm4a'), 'rpgmvm')
  assert.equal(encryptExtFor('mv', 'ogg'), 'rpgmvo')
  assert.equal(encryptExtFor('mz', 'png'), 'png_')
  assert.equal(encryptExtFor('mz', 'm4a'), 'm4a_')
  assert.equal(encryptExtFor('mz', 'ogg'), 'ogg_')
  assert.equal(encryptExtFor('mv', 'PNG'), 'rpgmvp') // 大小写不敏感
  assert.equal(encryptExtFor('mv', 'txt'), null)
  assert.equal(encryptExtFor('mz', ''), null)
})

console.log('验证 detect / key 解析:')
ok('头嗅探识别 RPGMV 加密头（版本无关）', () => {
  const d = new Decrypter(KEY)
  const enc = d.encrypt(makePlain(32))
  assert.equal(looksEncrypted(enc), true)
  const info = detectHeader(enc)
  assert.equal(info.encrypted, true)
  assert.equal(info.signatureHex.slice(0, 10), '5250474d56') // 'RPGMV'
  assert.equal(looksEncrypted(makePlain(16)), false) // 非加密
})
ok('parseSystemJsonKey 提取密钥（含 LZString 压缩兜底）', () => {
  assert.equal(parseSystemJsonKey('{"encryptionKey":"0123456789abcdef"}'), '0123456789abcdef')
  assert.equal(parseSystemJsonKey('{"no":"key"}'), null)
  assert.equal(parseSystemJsonKey('not json'), null)
  // 兜底：LZString base64 压缩的 System.json
  assert.equal(
    parseSystemJsonKey(compressToBase64('{"encryptionKey":"0123456789abcdef"}')),
    '0123456789abcdef'
  )
})
ok('extractKeyFromRpgCore 提取密钥（含 LZString 压缩兜底）', () => {
  assert.equal(
    extractKeyFromRpgCore('var x; this._encryptionKey = "0123456789abcdef";'),
    '0123456789abcdef'
  )
  assert.equal(extractKeyFromRpgCore('Decrypter._encryptionKey = "0123456789abcdef";'), '0123456789abcdef')
  assert.equal(extractKeyFromRpgCore('nothing'), null)
  // 兜底：LZString base64 压缩的 rpg_core.js
  assert.equal(
    extractKeyFromRpgCore(compressToBase64('Decrypter._encryptionKey = "0123456789abcdef";')),
    '0123456789abcdef'
  )
})

console.log('验证 i18n:')
ok('嵌套扁平化 + 插值 + 回退', () => {
  const i18n = createI18n({ defaultLocale: 'zh-Hans', fallbackLocale: 'en' })
  i18n.loadFromJson('zh-Hans', { __meta: { name: '简体中文' }, app: { title: '你好 {n}' } })
  i18n.loadFromJson('en', { __meta: { name: 'English' }, app: { title: 'Hello' } })
  assert.equal(i18n.t('app.title', { n: 'Lynx' }), '你好 Lynx')
  i18n.setLocale('en')
  assert.equal(i18n.t('app.title'), 'Hello')
  assert.equal(i18n.t('not.exists'), 'not.exists')
  assert.equal(i18n.getAvailableLocales()[0].name, 'English')
})

console.log('验证 theme:')
ok('主题默认/切换/持久化', () => {
  const t = new ThemeStore({ mode: 'dark' })
  assert.equal(t.getResolved(), 'dark')
  t.setMode('light')
  assert.equal(t.getResolved(), 'light')
  assert.equal(readSystemPref(), 'light') // Node 无 window
})

console.log('验证 LZString（key 检测兜底用）:')
ok('LZString 已知向量（与官方 1.4.4 一致）', () => {
  assert.equal(compressToBase64('hello world'), 'BYUwNmD2AEDukCcwBMg=')
  assert.equal(decompressFromBase64('BYUwNmD2AEDukCcwBMg='), 'hello world')
  assert.equal(compressToBase64(''), 'Q===')
  assert.equal(decompressFromBase64(''), null)
  // 长文本往返
  const long = JSON.stringify({ switches: Array.from({ length: 200 }, (_, i) => i % 2 === 0) })
  assert.equal(decompressFromBase64(compressToBase64(long)), long)
})

console.log('验证导出魔数校验（matchesMagic / expectedMagicKind）:')
const { matchesMagic, expectedMagicKind } = require('../out-lib/crypto/index.js')

ok('matchesMagic 匹配/不匹配已知魔数', () => {
  assert.equal(matchesMagic(new Uint8Array(PNG_HEADER_BYTES), 'png'), true)
  assert.equal(matchesMagic(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), 'ogg'), true)
  assert.equal(matchesMagic(new Uint8Array(PNG_HEADER_BYTES), 'ogg'), false)
  assert.equal(matchesMagic(new Uint8Array([]), 'png'), false)
})

ok('expectedMagicKind 由加密扩展名推断期望魔数', () => {
  assert.equal(expectedMagicKind('rpgmvp'), 'png')
  assert.equal(expectedMagicKind('png_'), 'png')
  assert.equal(expectedMagicKind('rpgmvo'), 'ogg')
  assert.equal(expectedMagicKind('ogg_'), 'ogg')
  assert.equal(expectedMagicKind('rpgmvm'), 'm4a')
  assert.equal(expectedMagicKind('m4a_'), 'm4a')
  assert.equal(expectedMagicKind('png'), null)
  assert.equal(expectedMagicKind(''), null)
})

ok('解密产物魔数校验（加密→解密后匹配期望魔数；错 key 不匹配）', () => {
  const d = new Decrypter(KEY)
  const enc = d.encrypt(makePlain(40))
  const dec = d.decrypt(enc)
  assert.equal(matchesMagic(dec, 'png'), true)
  assert.equal(expectedMagicKind('rpgmvp'), 'png')
})

console.log('验证最近项目/密钥历史核心（upsert / remove / sanitize）:')
const {
  makeHistoryId,
  isValidHistoryEntry,
  upsertHistoryEntry,
  removeHistoryEntry,
  sanitizeHistoryList,
  DEFAULT_HISTORY_CAP
} = require('../out-lib/index.js')

function hist(kind, path, openedAt) {
  return { id: makeHistoryId(kind, path), kind, path, label: path.split(/[\\/]/).pop(), openedAt }
}

ok('upsertHistoryEntry 同路径去重置顶 + 倒序 + 上限截断', () => {
  const e1 = hist('project', '/g1', 100)
  const e2 = hist('project', '/g2', 200)
  const e3 = hist('project', '/g3', 300)
  let list = upsertHistoryEntry([e1, e2], e3)
  assert.deepEqual(list.map((x) => x.path), ['/g3', '/g2', '/g1'])
  const again = upsertHistoryEntry(list, hist('project', '/g1', 400))
  assert.deepEqual(again.map((x) => x.path), ['/g1', '/g3', '/g2'])
  assert.equal(again.length, 3) // 去重不增长
  const capped = upsertHistoryEntry([e1], e2, 1)
  assert.equal(capped.length, 1)
  assert.equal(capped[0].path, '/g2')
})

ok('removeHistoryEntry / sanitizeHistoryList / makeHistoryId', () => {
  const e1 = hist('project', '/g1', 1)
  const e2 = hist('project', '/g3', 2)
  assert.deepEqual(removeHistoryEntry([e1, e2], e1.id).map((x) => x.path), ['/g3'])
  assert.deepEqual(sanitizeHistoryList([e1, { bad: true }, 'x', null, e2]).map((x) => x.path), ['/g1', '/g3'])
  assert.deepEqual(sanitizeHistoryList('nope'), [])
  assert.equal(isValidHistoryEntry(e1), true)
  assert.equal(isValidHistoryEntry({ kind: 'other', path: '/x', label: 'x', openedAt: 1 }), false)
  // 旧版曾写入 kind:'save' 的存档历史，现已不支持，应被过滤
  assert.equal(isValidHistoryEntry({ kind: 'save', path: '/s1', label: 'x', openedAt: 1 }), false)
  assert.equal(DEFAULT_HISTORY_CAP, 20)
})

console.log('验证虚拟列表窗口计算（蓝图 §11.2，src/lib/virtual）:')
const { computeWindow, shouldVirtualize } = require('../out-lib/virtual.js')

ok('computeWindow 基本窗口（含 overscan）', () => {
  // 视口 400px、行高 28、总 10000 行、顶部 → 只渲染 start..end
  const w = computeWindow(0, 400, 28, 10000, 5)
  assert.equal(w.start, 0)
  assert.ok(w.end >= Math.ceil(400 / 28)) // 至少可见行
  assert.ok(w.visible <= 400 / 28 + 12) // overscan 上下各 5
  assert.equal(w.totalHeight, 10000 * 28)
})

ok('computeWindow 滚动到中部时窗口平移', () => {
  const w = computeWindow(28 * 500, 400, 28, 10000, 5)
  assert.ok(w.start >= 500 - 5)
  assert.ok(w.end <= 500 + Math.ceil(400 / 28) + 5)
  assert.ok(w.visible > 0)
})

ok('computeWindow 边界防御（0 视口 / 0 总行 / 非法行高）', () => {
  assert.equal(computeWindow(0, 0, 28, 0, 5).visible, 0)
  assert.equal(computeWindow(999999, 400, 28, 10, 5).end, 10) // 截断到 total
  assert.ok(computeWindow(0, 400, 0, 100, 5).totalHeight > 0) // 非法行高兜底 1
  assert.equal(computeWindow(-5, 400, 28, 100, 5).start, 0) // 负滚动兜底
})

ok('shouldVirtualize 阈值判断', () => {
  assert.equal(shouldVirtualize(201, 200), true)
  assert.equal(shouldVirtualize(200, 200), false)
  assert.equal(shouldVirtualize(0, 200), false)
})

console.log('验证 i18n 语言包 diff（src/lib/i18n/diff，蓝图 §11.1 热监视核心）:')
const { diffLocaleSets } = require('../out-lib/i18n/index.js')

ok('diffLocaleSets 识别 新增/删除/更新', () => {
  const known = new Map([
    ['en', '{"a":1}'],
    ['zh-Hans', '{"a":2}'],
    ['ja', '{"a":3}']
  ])
  const onDisk = new Map([
    ['en', '{"a":1}'], // 不变
    ['zh-Hans', '{"a":99}'], // 更新
    ['fr', '{"a":4}'] // 新增；ja 被删除
  ])
  const d = diffLocaleSets(known, onDisk)
  assert.deepEqual(d.added, ['fr'])
  assert.deepEqual(d.removed, ['ja'])
  assert.deepEqual(d.updated, ['zh-Hans'])
})

ok('diffLocaleSets 空输入防御', () => {
  const d = diffLocaleSets(new Map(), new Map())
  assert.deepEqual(d, { added: [], removed: [], updated: [] })
  const d2 = diffLocaleSets(new Map([['en', 'x']]), new Map())
  assert.deepEqual(d2.removed, ['en'])
})

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
