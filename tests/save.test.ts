import { describe, it, expect } from 'vitest'
import { deflateSync, inflateSync } from 'node:zlib'
import {
  compressToBase64,
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
  bytesToBinaryString,
  getPath,
  setPath,
  deletePath,
  getPathSegs,
  setPathSegs,
  deletePathSegs,
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
  setActorField,
  parseSaveSchema,
  mergeSaveSchemas,
  coerceFieldValue,
  getSchemaFieldValue,
  setSchemaFieldValue
} from '@lib/save'
import type { ZlibLike } from '@lib/save'

const nodeZlib: ZlibLike = {
  deflateToBinaryString: json => deflateSync(Buffer.from(json, 'utf8'), { level: 1 }).toString('latin1'),
  inflateFromBinaryString: bin => inflateSync(Buffer.from(bin, 'latin1')).toString('utf8')
}

describe('LZString base64', () => {
  it('与官方 1.4.4 已知向量一致', () => {
    expect(compressToBase64('hello world')).toBe('BYUwNmD2AEDukCcwBMg=')
    expect(decompressFromBase64('BYUwNmD2AEDukCcwBMg=')).toBe('hello world')
    expect(compressToBase64('')).toBe('Q===')
    expect(decompressFromBase64('')).toBeNull()
    expect(compressToBase64(null)).toBe('')
    expect(decompressFromBase64(null)).toBe('')
  })

  it('长文本与中文往返', () => {
    const long = JSON.stringify({
      switches: Array.from({ length: 300 }, (_, i) => i % 2 === 0),
      variables: Array.from({ length: 300 }, (_, i) => i * 3)
    })
    expect(decompressFromBase64(compressToBase64(long))).toBe(long)
    expect(decompressFromBase64(compressToBase64('中文测试存档あいうえお'))).toBe('中文测试存档あいうえお')
  })
})

describe('JsonEx 语义', () => {
  it('stringify 原地加 "@" 类标记（官方行为）', () => {
    const obj = { party: { _gold: 500, '@': 'Game_Party' } as Record<string, unknown> }
    const json = jsonExStringify(obj)
    expect(obj.party['@']).toBe('Game_Party')
    expect(json).toContain('"@"')
  })

  it('parse 保留 "@" 与未知字段（不恢复原型，编辑器语义）', () => {
    const json = JSON.stringify({
      system: { _saveCount: 1, '@': 'Game_System' },
      pluginCustom: { nested: [1, 2, { deep: true }] }
    })
    const back = jsonExParse(json) as Record<string, any>
    expect(back.system['@']).toBe('Game_System')
    expect(back.pluginCustom.nested).toEqual([1, 2, { deep: true }])
  })
  it('makeDeepCopy 深拷贝', () => {
    const src = { a: { b: [1, 2, 3] } }
    const copy = jsonExMakeDeepCopy(src)
    expect(copy).toEqual(src)
    expect(copy).not.toBe(src)
    expect((copy as any).a).not.toBe(src.a)
  })
})

describe('MV codec（LZString base64）', () => {
  it('encode → decode 往返，保留 "@" 标记', () => {
    const contents = {
      system: { _saveCount: 1, '@': 'Game_System' },
      party: { _gold: 500, _actors: [1], '@': 'Game_Party' }
    }
    const text = encodeSave(contents, 'mv')
    expect(detectSaveKind(text)).toBe('mv')
    const { kind, contents: back } = decodeSave(text)
    expect(kind).toBe('mv')
    const party = back.party as Record<string, unknown>
    expect(party._gold).toBe(500)
    expect(party['@']).toBe('Game_Party')
  })

  it('decode 可由 hint 强制种类', () => {
    const text = encodeSave({ a: 1 }, 'mv')
    expect(() => decodeSave(text, undefined, 'mz')).toThrow(SaveCodecError)
  })
})

describe('MZ codec（zlib deflate + binary string）', () => {
  it('encode → decode 往返，未注入 zlib 时 MZ 编码抛错', () => {
    const contents = { system: { _saveCount: 1, '@': 'Game_System' }, party: { _gold: 500 } }
    expect(() => encodeSave(contents, 'mz')).toThrow(SaveCodecError)
    const text = encodeSave(contents, 'mz', nodeZlib)
    expect(detectSaveKind(text, nodeZlib)).toBe('mz')
    const { kind, contents: back } = decodeSave(text, nodeZlib)
    expect(kind).toBe('mz')
    const party = back.party as Record<string, unknown>
    const system = back.system as Record<string, unknown>
    expect(party._gold).toBe(500)
    expect(system['@']).toBe('Game_System')
  })

  it('MZ 文本实为可被 zlib 解压的 binary string（与游戏 pako 路径一致）', () => {
    const text = encodeSave({ hello: 'world' }, 'mz', nodeZlib)
    const json = inflateSync(Buffer.from(text, 'latin1')).toString('utf8')
    expect(JSON.parse(json)).toEqual({ hello: 'world' })
  })
})

describe('工具函数', () => {
  it('binary string ↔ bytes', () => {
    const bytes = new Uint8Array([0x78, 0x01, 0xad, 0xff, 0x00, 0x7f])
    const s = bytesToBinaryString(bytes)
    expect(s.length).toBe(6)
    expect(Array.from(binaryStringToBytes(s))).toEqual(Array.from(bytes))
  })

  it('扩展名推断', () => {
    expect(kindFromExtension('file1.rpgsave')).toBe('mv')
    expect(kindFromExtension('file1.rmmzsave')).toBe('mz')
    expect(kindFromExtension('config.rpgsave')).toBe('mv')
    expect(kindFromExtension('global.rmmzsave')).toBe('mz')
    expect(kindFromExtension('.rpgsave')).toBe('mv')
    expect(kindFromExtension('foo.txt')).toBeNull()
  })

  it('非法输入抛 SaveCodecError', () => {
    expect(() => detectSaveKind('not a save at all')).toThrow(SaveCodecError)
    expect(() => detectSaveKind('!!!', nodeZlib)).toThrow(SaveCodecError)
  })
})

// 真实 MZ 存档结构的简化样本（file0.rmmzsave 的形态）
function makeContents(): Record<string, unknown> {
  const vd = new Array(100)
  vd[0] = null
  vd[46] = 0
  vd[47] = 53
  const sd = new Array(100)
  sd[0] = null
  sd[10] = true
  sd[11] = false
  return {
    system: { _saveCount: 1, '@': 'Game_System' },
    switches: { _data: sd, '@': 'Game_Switches' },
    variables: { _data: vd, '@': 'Game_Variables' },
    party: { _gold: 8000, _actors: [1, 2], _items: { 15: 2, 96: 31 }, '@': 'Game_Party' },
    map: { _mapId: 79 },
    player: { _x: 11, _y: 7, _direction: 2 },
    actors: {
      _data: [null, { _actorId: 1, _name: 'Alice', _level: 8, _hp: 558, _mp: 77, _tp: 0 }],
      '@': 'Game_Actors'
    }
  }
}

describe('路径读写', () => {
  it('getPath / setPath / deletePath（点分路径 + 数组下标）', () => {
    const c = makeContents()
    expect(getPath(c, 'party._gold')).toBe(8000)
    expect(getPath(c, 'actors._data.1._hp')).toBe(558)
    expect(getPath(c, 'not.exists')).toBeUndefined()

    setPath(c, 'party._gold', 999)
    expect((c.party as any)._gold).toBe(999)

    // 中间缺失时创建对象
    setPath(c, 'plugin.deep.value', 1)
    expect((c as any).plugin.deep.value).toBe(1)

    deletePath(c, 'party._items.15')
    expect((c.party as any)._items).not.toHaveProperty('15')
    deletePath(c, 'actors._data.1')
    expect((c.actors as any)._data[1]).toBeUndefined()
  })

  it('getPathSegs/setPathSegs/deletePathSegs 支持含点 key（字符串路径的盲区）', () => {
    const c: Record<string, unknown> = { 'a.b': { 'c.d': 1 }, arr: [10, 20] }
    // 点分字符串会把 "a.b" 拆开 → 取不到
    expect(getPath(c, 'a.b.c.d')).toBeUndefined()
    expect(getPathSegs(c, ['a.b', 'c.d'])).toBe(1)
    setPathSegs(c, ['a.b', 'x.y'], 2)
    expect((c['a.b'] as any)['x.y']).toBe(2)
    deletePathSegs(c, ['a.b', 'c.d'])
    expect((c['a.b'] as any)).not.toHaveProperty('c.d')
    // 数组下标
    expect(getPathSegs(c, ['arr', 1])).toBe(20)
    setPathSegs(c, ['arr', 0], 99)
    expect(c.arr).toEqual([99, 20])
    deletePathSegs(c, ['arr', 0])
    expect(c.arr).toEqual([20]) // splice 保持紧凑
  })
})

describe('金币 / 队伍', () => {
  it('getGold / setGold', () => {
    const c = makeContents()
    expect(getGold(c)).toBe(8000)
    setGold(c, 12345)
    expect(getGold(c)).toBe(12345)
    expect(getGold({})).toBeNull()
  })
  it('getPartyActors / setPartyActors', () => {
    const c = makeContents()
    expect(getPartyActors(c)).toEqual([1, 2])
    setPartyActors(c, [1, 3, 5])
    expect(getPartyActors(c)).toEqual([1, 3, 5])
    expect(getPartyActors({})).toBeNull()
  })
})

describe('物品 / 武器 / 防具', () => {
  it('getItemRows 排序 + setItemCount 累加/删除 + addItem', () => {
    const c = makeContents()
    expect(getItemRows(c, 'items')).toEqual([
      { id: 15, count: 2 },
      { id: 96, count: 31 }
    ])
    setItemCount(c, 'items', 15, 10)
    expect(getItemRows(c, 'items')[0]).toEqual({ id: 15, count: 10 })
    addItem(c, 'items', 15, 5)
    expect(getItemRows(c, 'items')[0]).toEqual({ id: 15, count: 15 })
    addItem(c, 'items', 100, 3)
    expect(getItemRows(c, 'items')).toContainEqual({ id: 100, count: 3 })
    setItemCount(c, 'items', 15, 0) // <=0 删除
    expect(getItemRows(c, 'items')).not.toContainEqual({ id: 15, count: 0 })
    removeItem(c, 'items', 96)
    expect(getItemRows(c, 'items')).toHaveLength(1)
  })
  it('缺失时 getItemRows 返回空、setItemCount 会创建容器', () => {
    const c = makeContents()
    delete (c.party as any)._weapons
    expect(getItemRows(c, 'weapons')).toEqual([])
    setItemCount(c, 'weapons', 11, 1)
    expect(getItemRows(c, 'weapons')).toEqual([{ id: 11, count: 1 }])
  })
})

describe('变量 / 开关', () => {
  it('getVariableRows 只含非 null；setVariable / removeVariable 按 id', () => {
    const c = makeContents()
    expect(getVariableRows(c)).toEqual([
      { id: 46, value: 0 },
      { id: 47, value: 53 }
    ])
    setVariable(c, 47, 999)
    expect(getVariableRows(c)).toContainEqual({ id: 47, value: 999 })
    setVariable(c, 60, 42) // 新 id 直接写数组下标
    expect(getVariableRows(c)).toContainEqual({ id: 60, value: 42 })
    removeVariable(c, 46)
    expect(getVariableRows(c)).not.toContainEqual({ id: 46, value: 0 })
    expect((c.variables as any)._data[46]).toBeNull() // 置 null 而非 splice
  })
  it('getSwitchRows / setSwitch / removeSwitch', () => {
    const c = makeContents()
    expect(getSwitchRows(c)).toEqual([
      { id: 10, value: true },
      { id: 11, value: false }
    ])
    setSwitch(c, 11, true)
    expect(getSwitchRows(c)).toContainEqual({ id: 11, value: true })
    removeSwitch(c, 10)
    expect(getSwitchRows(c)).not.toContainEqual({ id: 10, value: true })
  })
  it('变量/开关缺失时返回空且 set 不抛错', () => {
    expect(getVariableRows({})).toEqual([])
    expect(getSwitchRows({})).toEqual([])
    expect(() => setVariable({}, 1, 5)).not.toThrow()
    expect(() => setSwitch({}, 1, true)).not.toThrow()
  })
})

describe('位置 / 角色', () => {
  it('getPlayerPos / setPlayerPos', () => {
    const c = makeContents()
    expect(getPlayerPos(c)).toEqual({ mapId: 79, x: 11, y: 7, direction: 2 })
    setPlayerPos(c, { mapId: 80, x: 1, y: 2, direction: 8 })
    expect(getPlayerPos(c)).toEqual({ mapId: 80, x: 1, y: 2, direction: 8 })
    expect(getPlayerPos({})).toEqual({ mapId: null, x: null, y: null, direction: null })
  })
  it('getActorRows / setActorField', () => {
    const c = makeContents()
    expect(getActorRows(c)).toEqual([
      { actorId: 1, name: 'Alice', level: 8, hp: 558, mp: 77, tp: 0 }
    ])
    setActorField(c, 1, 'level', 99)
    setActorField(c, 1, 'hp', 9999)
    expect(getActorRows(c)[0]).toMatchObject({ level: 99, hp: 9999 })
    expect(getActorRows({})).toEqual([])
    expect(() => setActorField({}, 1, 'hp', 1)).not.toThrow()
  })
})

describe('存档字段 schema（蓝图 §11.4-1）', () => {
  it('parseSaveSchema：合法解析 + 非法字段跳过 + 非法 JSON 抛错', () => {
    const s = parseSaveSchema(
      JSON.stringify({
        name: 'P',
        fields: [
          { path: 'a.b', label: 'A', type: 'number', min: 1, max: 9 },
          { path: '', label: 'bad', type: 'number' },
          { path: 'c', label: 'C', type: 'bogus' },
          { path: 'd', type: 'number' },
          { path: 'e', labelKey: 'plugin.e', type: 'boolean' }
        ]
      })
    )
    expect(s.fields.map((f) => f.path)).toEqual(['a.b', 'e'])
    expect(s.fields[0].min).toBe(1)
    expect(() => parseSaveSchema('not json')).toThrow()
    expect(() => parseSaveSchema('[]')).toThrow()
  })

  it('parseSaveSchema 解析 group / groupKey（渲染层分组标题走 i18n 词典）', () => {
    const s = parseSaveSchema(
      JSON.stringify({
        fields: [
          { path: 'a', label: 'A', type: 'number', group: 'VisuStella', groupKey: 'plugin.vs.group' },
          { path: 'b', label: 'B', type: 'text' },
          { path: 'c', label: 'C', type: 'text', group: 'VisuStella' }
        ]
      })
    )
    expect(s.fields[0].group).toBe('VisuStella')
    expect(s.fields[0].groupKey).toBe('plugin.vs.group')
    expect(s.fields[1].group).toBeUndefined()
    expect(s.fields[1].groupKey).toBeUndefined()
    expect(s.fields[2].group).toBe('VisuStella')
    expect(s.fields[2].groupKey).toBeUndefined()
  })

  it('mergeSaveSchemas：按 path 去重，后者覆盖', () => {
    const a = parseSaveSchema(JSON.stringify({ fields: [{ path: 'x', label: 'A', type: 'number' }] }))
    const b = parseSaveSchema(JSON.stringify({ fields: [{ path: 'x', label: 'B', type: 'boolean' }] }))
    const m = mergeSaveSchemas(a, b)
    expect(m.fields).toHaveLength(1)
    expect(m.fields[0].type).toBe('boolean')
  })

  it('coerceFieldValue：类型规约 + min/max 夹取 + 非法返回 null', () => {
    const n = { path: 'p', label: 'n', type: 'number', min: 1, max: 9 } as const
    expect(coerceFieldValue(n, '5')).toBe(5)
    expect(coerceFieldValue(n, '0')).toBe(1)
    expect(coerceFieldValue(n, '42')).toBe(9)
    expect(coerceFieldValue(n, 'abc')).toBeNull()
    const b = { path: 'p', label: 'b', type: 'boolean' } as const
    expect(coerceFieldValue(b, 'on')).toBe(true)
    const t0 = { path: 'p', label: 't', type: 'text' } as const
    expect(coerceFieldValue(t0, 42)).toBe('42')
  })

  it('schema 字段经路径读写 contents（未知字段原地保留）', () => {
    const c = makeContents()
    const f = { path: 'plugin.data.level', label: 'Lv', type: 'number', min: 1 } as const
    expect(getSchemaFieldValue(c, f)).toBeUndefined()
    setSchemaFieldValue(c, f, '7')
    expect(getPath(c, 'plugin.data.level')).toBe(7)
    expect(getPath(c, 'party._gold')).toBe(8000)
  })
})
