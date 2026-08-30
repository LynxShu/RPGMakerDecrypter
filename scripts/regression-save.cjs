/**
 * 真实游戏样本（本地私有，不进仓库）存档 codec 回归。
 *
 * 样本位于 `fixtures/real-sample/save/`（.gitignore 排除，仅本地有样本时运行）：
 * - `file0.rmmzsave`：真实 MZ 存档（pako deflate level 1，经 NW.js UTF-8 落盘）。
 * 本脚本验证：
 * 1. 自动检测：无 hint 时识别为 mz。
 * 2. 解码：顶层键（system/screen/timer/switches/variables/selfSwitches/actors/party/map/player/...）。
 * 3. 修改 `party._gold` 后编码再解码：修改生效。
 * 4. **无损 round-trip**：不改字段时 encode → decode 与原文件 inflate 出的 JSON 字节级一致
 *    （证明不毁档：未知键 / JsonEx "@" 类标记 / 键序全保留）。
 *
 * 用法：node node_modules/typescript/bin/tsc -p tsconfig.build-lib.json && node scripts/regression-save.cjs
 */
const assert = require('node:assert/strict')
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { deflateSync, inflateSync } = require('node:zlib')
const { decodeSave, encodeSave, detectSaveKind } = require('../out-lib/save/index.js')

const nodeZlib = {
  deflateToBinaryString: json => deflateSync(Buffer.from(json, 'utf8'), { level: 1 }).toString('latin1'),
  inflateFromBinaryString: bin => inflateSync(Buffer.from(bin, 'latin1')).toString('utf8')
}

const SAVE_DIR = join(__dirname, '..', 'fixtures', 'real-sample', 'save')
const SAVE_FILE = join(SAVE_DIR, 'file0.rmmzsave')

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

if (!existsSync(SAVE_FILE)) {
  console.log('未找到真实样本（fixtures 被 .gitignore 排除），跳过存档真实回归。')
  console.log('提示：将 MZ 游戏的 save/fileN.rmmzsave 放入 fixtures/real-sample/save/ 后重跑。')
  process.exit(0)
}

const originalText = readFileSync(SAVE_FILE, 'utf8')

console.log('验证真实 MZ 存档 codec:')
ok('无 hint 自动检测为 mz', () => {
  assert.equal(detectSaveKind(originalText, nodeZlib), 'mz')
})

let decoded = null
ok('解码成功且顶层键齐全', () => {
  const r = decodeSave(originalText, nodeZlib)
  assert.equal(r.kind, 'mz')
  decoded = r.contents
  for (const k of ['system', 'screen', 'timer', 'switches', 'variables', 'selfSwitches', 'actors', 'party', 'map', 'player']) {
    assert.ok(k in decoded, `缺少顶层键 ${k}`)
  }
})

ok('关键字段可读（gold / saveCount / 队员）', () => {
  assert.equal(decoded.party._gold, 8000)
  assert.equal(decoded.system._saveCount, 635)
  assert.equal(decoded.party._actors[0], 1)
})

ok('修改 party._gold 后编码→解码生效', () => {
  decoded.party._gold = 12345
  const text = encodeSave(decoded, 'mz', nodeZlib)
  const r = decodeSave(text, nodeZlib, 'mz')
  assert.equal(r.contents.party._gold, 12345)
  assert.equal(r.contents.system._saveCount, 635)
  assert.equal(r.contents.party._actors[0], 1)
})

ok('无损 round-trip：不改字段 encode→decode 与原 JSON 字节级一致', () => {
  // 重新解码原始文本（上一个断言改了 decoded，此处从原始文本重新解码）
  const fresh = decodeSave(originalText, nodeZlib).contents
  const encoded = encodeSave(fresh, 'mz', nodeZlib)
  const originalJson = inflateSync(Buffer.from(originalText, 'latin1')).toString('utf8')
  const reencodedJson = inflateSync(Buffer.from(encoded, 'latin1')).toString('utf8')
  assert.equal(reencodedJson, originalJson)
})

ok('JsonEx "@" 类标记数量保留', () => {
  const count = obj => {
    let n = 0
    if (obj && typeof obj === 'object') {
      if (Object.prototype.hasOwnProperty.call(obj, '@')) n++
      for (const k of Object.keys(obj)) n += count(obj[k])
    }
    return n
  }
  const fresh = decodeSave(originalText, nodeZlib).contents
  const back = decodeSave(encodeSave(fresh, 'mz', nodeZlib), nodeZlib, 'mz').contents
  assert.equal(count(back), count(fresh))
})

console.log('验证真实 MZ 存档编辑模型:')
const {
  getGold,
  getPartyActors,
  getItemRows,
  getVariableRows,
  getSwitchRows,
  getPlayerPos,
  getActorRows,
  setActorField,
  setGold
} = require('../out-lib/save/index.js')

ok('表单模型可读（金币/队伍/物品/变量/开关/位置/角色）', () => {
  const fresh = decodeSave(originalText, nodeZlib).contents
  assert.equal(getGold(fresh), 8000)
  assert.deepEqual(getPartyActors(fresh), [1])
  assert.ok(getItemRows(fresh, 'items').length > 0, '应有物品')
  assert.ok(getVariableRows(fresh).length > 0, '应有变量')
  assert.ok(getSwitchRows(fresh).length > 0, '应有开关')
  assert.ok(getActorRows(fresh).length > 0, '应有角色')
  const pos = getPlayerPos(fresh)
  assert.equal(typeof pos.x, 'number')
  assert.equal(typeof pos.y, 'number')
})

ok('表单模型修改后 round-trip 生效（改 gold 与角色等级）', () => {
  const fresh = decodeSave(originalText, nodeZlib).contents
  setGold(fresh, 4321)
  const first = getActorRows(fresh)[0]
  setActorField(fresh, first.actorId, 'level', first.level + 1)
  const text = encodeSave(fresh, 'mz', nodeZlib)
  const back = decodeSave(text, nodeZlib, 'mz').contents
  assert.equal(back.party._gold, 4321)
  assert.equal(getActorRows(back)[0].level, first.level + 1)
  assert.equal(back.system._saveCount, 635) // 其余字段未受影响
})

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
