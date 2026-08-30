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

console.log('验证 save codec（MV base64 / MZ zlib / JsonEx）:')
const {
  decompressFromBase64,
  jsonExStringify,
  jsonExParse,
  jsonExMakeDeepCopy,
  decodeSave,
  encodeSave,
  detectSaveKind,
  kindFromExtension,
  SaveCodecError,
  binaryStringToBytes,
  bytesToBinaryString
} = require('../out-lib/save/index.js')
const { deflateSync, inflateSync } = require('node:zlib')
const nodeZlib = {
  deflateToBinaryString: json => deflateSync(Buffer.from(json, 'utf8'), { level: 1 }).toString('latin1'),
  inflateFromBinaryString: bin => inflateSync(Buffer.from(bin, 'latin1')).toString('utf8')
}

ok('LZString 已知向量（与官方 1.4.4 一致）', () => {
  assert.equal(compressToBase64('hello world'), 'BYUwNmD2AEDukCcwBMg=')
  assert.equal(decompressFromBase64('BYUwNmD2AEDukCcwBMg='), 'hello world')
  assert.equal(compressToBase64(''), 'Q===')
  assert.equal(decompressFromBase64(''), null)
  // 长文本往返
  const long = JSON.stringify({ switches: Array.from({ length: 200 }, (_, i) => i % 2 === 0) })
  assert.equal(decompressFromBase64(compressToBase64(long)), long)
})

ok('JsonEx 语义：@ 类标记 + 未知字段保留', () => {
  const obj = { party: { _gold: 500, '@': 'Game_Party' }, plugin: { custom: [1, 2, { deep: true }] } }
  const json = jsonExStringify(obj)
  assert.equal(obj.party['@'], 'Game_Party') // 原地变异
  const back = jsonExParse(json)
  assert.equal(back.party['@'], 'Game_Party') // 标记保留
  assert.deepEqual(back.plugin.custom, [1, 2, { deep: true }]) // 未知字段保留
  // 深拷贝后序列化不污染原对象
  const src = { a: { b: 1 } }
  const copy = jsonExMakeDeepCopy(src)
  assert.deepEqual(copy, src)
})

ok('MV：encode(base64) → decode 往返', () => {
  const contents = { system: { _saveCount: 1 }, party: { _gold: 500, '@': 'Game_Party' } }
  const text = encodeSave(contents, 'mv')
  assert.equal(detectSaveKind(text), 'mv')
  const { kind, contents: back } = decodeSave(text)
  assert.equal(kind, 'mv')
  assert.equal(back.party._gold, 500)
  assert.equal(back.party['@'], 'Game_Party')
})

ok('MZ：encode(zlib) → decode 往返（binary string 语义）', () => {
  const contents = { system: { _saveCount: 1 }, party: { _gold: 500, '@': 'Game_Party' } }
  const text = encodeSave(contents, 'mz', nodeZlib)
  assert.equal(typeof text, 'string')
  assert.equal(detectSaveKind(text, nodeZlib), 'mz')
  const { kind, contents: back } = decodeSave(text, nodeZlib)
  assert.equal(kind, 'mz')
  assert.equal(back.party._gold, 500)
  assert.equal(back.party['@'], 'Game_Party')
})

ok('binary string ↔ bytes 互转', () => {
  const bytes = new Uint8Array([0x78, 0x01, 0xad, 0xff, 0x00, 0x7f])
  const s = bytesToBinaryString(bytes)
  assert.equal(s.length, 6)
  assert.deepEqual(Array.from(binaryStringToBytes(s)), Array.from(bytes))
})

ok('扩展名推断 mv/mz', () => {
  assert.equal(kindFromExtension('file1.rpgsave'), 'mv')
  assert.equal(kindFromExtension('file1.rmmzsave'), 'mz')
  assert.equal(kindFromExtension('config.rpgsave'), 'mv')
  assert.equal(kindFromExtension('global.rmmzsave'), 'mz')
  assert.equal(kindFromExtension('foo.txt'), null)
  assert.equal(kindFromExtension('.rpgsave'), 'mv')
})

ok('非法存档抛 SaveCodecError', () => {
  assert.throws(() => detectSaveKind('not a save at all'), SaveCodecError)
  assert.throws(() => encodeSave({}, 'mz'), SaveCodecError) // 未注入 zlib
})

console.log('验证 save 编辑模型（path / 金币 / 物品 / 变量 / 开关 / 位置 / 角色）:')
const {
  getPath,
  setPath,
  deletePath,
  getGold,
  setGold,
  getPartyActors,
  setPartyActors,
  getItemRows,
  setItemCount,
  addItem,
  removeItem,
  getVariableRows,
  setVariable,
  removeVariable,
  getSwitchRows,
  setSwitch,
  removeSwitch,
  getPlayerPos,
  setPlayerPos,
  getActorRows,
  setActorField
} = require('../out-lib/save/index.js')

// 真实 MZ 存档结构的简化样本
function makeContents() {
  const vd = new Array(100)
  vd[46] = 0
  vd[47] = 53
  const sd = new Array(100)
  sd[10] = true
  sd[11] = false
  return {
    system: { _saveCount: 1, '@': 'Game_System' },
    switches: { _data: sd, '@': 'Game_Switches' },
    variables: { _data: vd, '@': 'Game_Variables' },
    party: { _gold: 8000, _actors: [1, 2], _items: { 15: 2, 96: 31 }, '@': 'Game_Party' },
    map: { _mapId: 79 },
    player: { _x: 11, _y: 7, _direction: 2 },
    actors: { _data: [null, { _actorId: 1, _name: 'Alice', _level: 8, _hp: 558, _mp: 77, _tp: 0 }], '@': 'Game_Actors' }
  }
}

ok('path 读写：点分路径 + 数组下标 + 缺失创建', () => {
  const c = makeContents()
  assert.equal(getPath(c, 'party._gold'), 8000)
  assert.equal(getPath(c, 'actors._data.1._hp'), 558)
  assert.equal(getPath(c, 'not.exists'), undefined)
  setPath(c, 'party._gold', 999)
  assert.equal(c.party._gold, 999)
  setPath(c, 'plugin.deep.value', 1)
  assert.equal(c.plugin.deep.value, 1)
  deletePath(c, 'party._items.15')
  assert.equal('15' in c.party._items, false)
  deletePath(c, 'actors._data.1')
  assert.equal(c.actors._data[1], undefined)
})

ok('金币 / 队伍', () => {
  const c = makeContents()
  assert.equal(getGold(c), 8000)
  setGold(c, 12345)
  assert.equal(getGold(c), 12345)
  assert.equal(getGold({}), null)
  assert.deepEqual(getPartyActors(c), [1, 2])
  setPartyActors(c, [1, 3, 5])
  assert.deepEqual(getPartyActors(c), [1, 3, 5])
})

ok('物品：getItemRows / setItemCount / addItem / removeItem', () => {
  const c = makeContents()
  assert.deepEqual(getItemRows(c, 'items'), [
    { id: 15, count: 2 },
    { id: 96, count: 31 }
  ])
  addItem(c, 'items', 15, 5)
  assert.equal(getItemRows(c, 'items')[0].count, 7)
  setItemCount(c, 'items', 15, 0)
  assert.equal(getItemRows(c, 'items').some(r => r.id === 15), false)
  removeItem(c, 'items', 96)
  assert.deepEqual(getItemRows(c, 'items'), [])
  setItemCount(c, 'weapons', 11, 1)
  assert.deepEqual(getItemRows(c, 'weapons'), [{ id: 11, count: 1 }])
})

ok('变量 / 开关：按 id 读写，删除置 null 不 splice', () => {
  const c = makeContents()
  assert.deepEqual(getVariableRows(c), [
    { id: 46, value: 0 },
    { id: 47, value: 53 }
  ])
  setVariable(c, 60, 42)
  assert.equal(getVariableRows(c).some(r => r.id === 60 && r.value === 42), true)
  removeVariable(c, 46)
  assert.equal(c.variables._data[46], null)
  assert.deepEqual(getSwitchRows(c), [
    { id: 10, value: true },
    { id: 11, value: false }
  ])
  setSwitch(c, 11, true)
  assert.equal(getSwitchRows(c).find(r => r.id === 11).value, true)
  removeSwitch(c, 10)
  assert.equal(c.switches._data[10], null)
})

ok('位置 / 角色', () => {
  const c = makeContents()
  assert.deepEqual(getPlayerPos(c), { mapId: 79, x: 11, y: 7, direction: 2 })
  setPlayerPos(c, { mapId: 80, x: 1, y: 2, direction: 8 })
  assert.deepEqual(getPlayerPos(c), { mapId: 80, x: 1, y: 2, direction: 8 })
  assert.deepEqual(getActorRows(c), [{ actorId: 1, name: 'Alice', level: 8, hp: 558, mp: 77, tp: 0 }])
  setActorField(c, 1, 'level', 99)
  assert.equal(getActorRows(c)[0].level, 99)
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

console.log('验证存档字段 schema（parse / merge / coerce / 读写）:')
const {
  parseSaveSchema,
  mergeSaveSchemas,
  coerceFieldValue,
  getSchemaFieldValue,
  setSchemaFieldValue
} = require('../out-lib/save/index.js')

ok('parseSaveSchema 解析 + 非法字段跳过 + 非法 JSON 抛错', () => {
  const s = parseSaveSchema(
    JSON.stringify({
      name: 'P',
      fields: [
        { path: 'a.b', label: 'A', type: 'number', min: 1, max: 9 },
        { path: '', label: 'bad path', type: 'number' },
        { path: 'c', label: 'C', type: 'bogus' },
        { path: 'd', type: 'number' }, // 无 label/labelKey
        { path: 'e', labelKey: 'plugin.e', type: 'boolean' }
      ]
    })
  )
  assert.equal(s.fields.length, 2)
  assert.equal(s.fields[0].path, 'a.b')
  assert.equal(s.fields[0].min, 1)
  assert.equal(s.fields[1].labelKey, 'plugin.e')
  assert.throws(() => parseSaveSchema('not json'), SyntaxError)
  assert.throws(() => parseSaveSchema('[]'), /顶层/)
})

ok('mergeSaveSchemas 按 path 去重，后者覆盖', () => {
  const a = parseSaveSchema(JSON.stringify({ fields: [{ path: 'x', label: 'A', type: 'number' }, { path: 'y', label: 'Y', type: 'text' }] }))
  const b = parseSaveSchema(JSON.stringify({ fields: [{ path: 'x', label: 'B', type: 'boolean' }] }))
  const m = mergeSaveSchemas(a, b)
  assert.equal(m.fields.length, 2)
  assert.equal(m.fields[0].path, 'x')
  assert.equal(m.fields[0].type, 'boolean') // b 覆盖 a
  assert.equal(m.fields[1].path, 'y')
})

ok('coerceFieldValue 类型规约 + min/max 夹取', () => {
  const n = { path: 'p', label: 'n', type: 'number', min: 1, max: 9 }
  assert.equal(coerceFieldValue(n, '5'), 5)
  assert.equal(coerceFieldValue(n, '0'), 1) // 低于 min 夹取
  assert.equal(coerceFieldValue(n, '42'), 9) // 高于 max 夹取
  assert.equal(coerceFieldValue(n, 'abc'), null) // 非法不写入
  const b = { path: 'p', label: 'b', type: 'boolean' }
  assert.equal(coerceFieldValue(b, 'on'), true)
  assert.equal(coerceFieldValue(b, false), false)
  const t0 = { path: 'p', label: 't', type: 'text' }
  assert.equal(coerceFieldValue(t0, 42), '42')
})

ok('schema 字段经路径读写 contents（未知字段原地保留）', () => {
  const c = makeContents()
  const f = { path: 'plugin.data.level', label: 'Lv', type: 'number', min: 1 }
  assert.equal(getSchemaFieldValue(c, f), undefined)
  setSchemaFieldValue(c, f, '7')
  assert.equal(c.plugin.data.level, 7)
  assert.equal(c.party._gold, 8000) // 其余字段不受影响
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
  const e3 = hist('save', '/s1', 300)
  let list = upsertHistoryEntry([e1, e2], e3)
  assert.deepEqual(list.map((x) => x.path), ['/s1', '/g2', '/g1'])
  const again = upsertHistoryEntry(list, hist('project', '/g1', 400))
  assert.deepEqual(again.map((x) => x.path), ['/g1', '/s1', '/g2'])
  assert.equal(again.length, 3) // 去重不增长
  const capped = upsertHistoryEntry([e1], e2, 1)
  assert.equal(capped.length, 1)
  assert.equal(capped[0].path, '/g2')
})

ok('removeHistoryEntry / sanitizeHistoryList / makeHistoryId', () => {
  const e1 = hist('project', '/g1', 1)
  const e2 = hist('save', '/s1', 2)
  assert.deepEqual(removeHistoryEntry([e1, e2], e1.id).map((x) => x.path), ['/s1'])
  assert.deepEqual(sanitizeHistoryList([e1, { bad: true }, 'x', null, e2]).map((x) => x.path), ['/g1', '/s1'])
  assert.deepEqual(sanitizeHistoryList('nope'), [])
  assert.equal(isValidHistoryEntry(e1), true)
  assert.equal(isValidHistoryEntry({ kind: 'other', path: '/x', label: 'x', openedAt: 1 }), false)
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

console.log('验证路径段数组读写（含点 key，src/lib/save/model）:')
const { getPathSegs, setPathSegs, deletePathSegs } = require('../out-lib/save/index.js')

ok('getPathSegs/setPathSegs/deletePathSegs 支持含点 key', () => {
  const obj = { 'a.b': { 'c.d': 1 }, arr: [10, 20] }
  // 点分字符串路径会把 "a.b" 拆开 → 取不到；seg 数组原样按 key 取
  assert.equal(getPath(obj, 'a.b.c.d'), undefined)
  assert.equal(getPathSegs(obj, ['a.b', 'c.d']), 1)
  setPathSegs(obj, ['a.b', 'x.y'], 2)
  assert.equal(obj['a.b']['x.y'], 2)
  deletePathSegs(obj, ['a.b', 'c.d'])
  assert.equal('c.d' in obj['a.b'], false)
  // 数组下标
  assert.equal(getPathSegs(obj, ['arr', 1]), 20)
  setPathSegs(obj, ['arr', 0], 99)
  assert.equal(obj.arr[0], 99)
  deletePathSegs(obj, ['arr', 0])
  assert.equal(obj.arr.length, 1) // splice 保持紧凑
})

console.log('验证 schema groupKey（src/lib/save/schema）:')
ok('parseSaveSchema 解析 groupKey', () => {
  const s = parseSaveSchema(
    JSON.stringify({
      name: 'P',
      fields: [
        { path: 'a', label: 'A', type: 'number', group: 'VisuStella', groupKey: 'plugin.vs.group' },
        { path: 'b', label: 'B', type: 'text' }
      ]
    })
  )
  assert.equal(s.fields.length, 2)
  assert.equal(s.fields[0].group, 'VisuStella')
  assert.equal(s.fields[0].groupKey, 'plugin.vs.group')
  assert.equal(s.fields[1].group, undefined)
  assert.equal(s.fields[1].groupKey, undefined)
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
