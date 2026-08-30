/**
 * JsonEx 语义移植（RPG Maker MV/MZ 官方序列化器）。
 *
 * 来源：RPG Maker MZ 官方 rmmz_core.js 的 JsonEx 类（依据本地私有真实样本），
 * 语义逐行等价（见 HANDOFF §6 下一步、蓝图 §5 关键坑）。
 *
 * 与官方一致的关键行为：
 * 1. `stringify` 序列化前**原地变异**输入对象：凡 `constructor.name` 非 `Object`/`Array`
 *    的对象，在自身加单字符键 `"@"` 记录类名（如 `{"@":"Game_Item", ...}`）。
 * 2. `parse` 还原时官方会 `window[类名]` 恢复原型 —— 编辑器场景**不需要也不应该**恢复原型
 *    （我们没有游戏类，且会污染数据），因此本实现的 `parse` 保留 `"@"` 键为普通字段，
 *    原样 round-trip 无损。
 * 3. **未知字段保留**：只递归、不删除任何键；编辑侧「原地改/深合并」，绝不丢弃未知键。
 * 4. `maxDepth = 100` 防过深递归。
 */

export interface JsonExOptions {
  /** 递归深度上限，默认 100（与官方一致） */
  maxDepth?: number
}

export const JSONEX_DEFAULT_MAX_DEPTH = 100

/**
 * 把 contents 对象序列化为 JSON 字符串（JsonEx 语义）。
 *
 * ⚠️ 与官方一样**原地变异**输入（加 `"@"` 类标记键）。若不想污染原对象，
 * 请先深拷贝再调用（见 `jsonExMakeDeepCopy`）。
 */
export function jsonExStringify(object: unknown, opts: JsonExOptions = {}): string {
  return JSON.stringify(jsonExEncode(object, 0, opts.maxDepth ?? JSONEX_DEFAULT_MAX_DEPTH))
}

/**
 * 解析 JSON 字符串为对象（JsonEx 语义的"安全解析"）。
 *
 * 与官方 `_decode` 的区别：官方会尝试 `window[类名]` 恢复原型；本实现不做原型恢复，
 * `"@"` 类标记保留为普通字段 —— 这正是编辑器「未知字段保留、不毁档」所需要的。
 */
export function jsonExParse(json: string, opts: JsonExOptions = {}): unknown {
  // 解码与解码对称：这里直接 JSON.parse，保留一切键（含 "@"）。
  // 深度上限在 encode 侧检查即可；parse 由 JSON.parse 天然处理。
  void opts
  return JSON.parse(json)
}

/** 深拷贝（保持 JsonEx 语义：拷贝后是普通 Object/Array，序列化时不会新增多余的 "@"）。 */
export function jsonExMakeDeepCopy<T>(object: T): T {
  return jsonExParse(jsonExStringify(object)) as T
}

/**
 * JsonEx._encode 等价实现：原地加类标记 + 递归编码。
 * 递归深度超限抛错（与官方 "Object too deep" 一致）。
 */
export function jsonExEncode(value: unknown, depth: number, maxDepth: number): unknown {
  if (depth >= maxDepth) {
    throw new Error('Object too deep')
  }
  const type = Object.prototype.toString.call(value)
  if (type === '[object Object]' || type === '[object Array]') {
    const record = value as Record<string, unknown>
    const constructorName = record.constructor?.name
    if (constructorName !== 'Object' && constructorName !== 'Array') {
      record['@'] = constructorName
    }
    for (const key of Object.keys(record)) {
      record[key] = jsonExEncode(record[key], depth + 1, maxDepth)
    }
  }
  return value
}
