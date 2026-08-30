/**
 * 存档 codec：MV/MZ 存档文件的解码与编码（JsonEx + LZString / zlib）。
 *
 * 磁盘格式（已用真实样本验证，见 HANDOFF §6 下一步 / 蓝图 §5）：
 * - **MV**（`save/fileN.rpgsave`）：`LZString.compressToBase64(JsonEx.stringify(contents))`
 *   → 磁盘上是 **base64 文本**（ASCII，可直接读写文本）。
 * - **MZ**（`save/fileN.rmmzsave`）：`pako.deflate(JsonEx.stringify(contents), {to:"string", level:1})`
 *   → pako 输出 **binary string**（charCode 0-255），NW.js `fsWriteFile` 再按 **UTF-8 编码**落盘。
 *   （MZ 的 `config.*` / `global.*` 元数据文件走同一 StorageManager 路径，格式相同。）
 *
 * 因此 MZ 的"文本"层就是 binary string：
 * - 读回：文件 utf8 解码后的文本（= binary string）→ `inflateFromBinaryString` → JSON。
 * - 写回：JSON → `deflateToBinaryString` → binary string 文本，调用方以 utf8 写盘
 *   （与游戏行为一致，产出可被 pako.inflate 读取的合法 zlib 流）。
 *
 * zlib 通过 **ZlibLike 注入**，@lib 保持零 Node 依赖：main 进程 / CLI 注入 `node:zlib`
 * （utf8 编解码也由注入方完成），未来渲染进程可注入 pako/fflate。
 */

import { compressToBase64, decompressFromBase64 } from './lzstring'
import { jsonExStringify } from './jsonEx'

export type SaveKind = 'mv' | 'mz'

/**
 * zlib 注入接口（@lib 不直接依赖 node:zlib）。
 * 约定：binary string = 每个字符 charCode 0-255 的 JS 字符串。
 * - deflate：json 文本 → deflate 压缩后的 binary string（pako `{to:"string"}` 同款）
 * - inflate：deflate 二进制（binary string）→ json 文本
 */
export interface ZlibLike {
  deflateToBinaryString(json: string): string
  inflateFromBinaryString(bin: string): string
}

export interface SaveDecodeResult {
  kind: SaveKind
  /** 存档 contents 对象（含 JsonEx "@" 标记键，顶层小写键如 system/actors/party） */
  contents: Record<string, unknown>
}

/** 存档编解码错误 */
export class SaveCodecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaveCodecError'
  }
}

// LZString 官方允许 0-3 个 '='（res.length % 4 === 1 时补 "==="，非标准但官方如此）
const BASE64_RE = /^[A-Za-z0-9+\/]*={0,3}$/

/** MV 存档扩展名 */
export const MV_SAVE_EXT = 'rpgsave'
/** MZ 存档扩展名 */
export const MZ_SAVE_EXT = 'rmmzsave'

/** 由文件名/扩展名推断存档种类；不认识返回 null（如 `file1.rpgsave`、`config.rmmzsave`、`.rpgsave`） */
export function kindFromExtension(ext: string): SaveKind | null {
  const dot = ext.lastIndexOf('.')
  const e = (dot >= 0 ? ext.slice(dot + 1) : ext).toLowerCase()
  if (e === MV_SAVE_EXT) return 'mv'
  if (e === MZ_SAVE_EXT) return 'mz'
  return null
}

/** 尝试按 MV（LZString base64）解码，成功返回 contents，失败返回 null */
function tryDecodeMv(input: string): Record<string, unknown> | null {
  if (!BASE64_RE.test(input.trim())) return null
  try {
    const json = decompressFromBase64(input)
    if (json == null) return null
    const obj: unknown = JSON.parse(json)
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      return obj as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/** 尝试按 MZ（zlib deflate）解码，成功返回 contents，失败返回 null */
function tryDecodeMz(input: string, zlib: ZlibLike): Record<string, unknown> | null {
  try {
    const json = zlib.inflateFromBinaryString(input)
    const obj: unknown = JSON.parse(json)
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      return obj as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/**
 * 检测存档种类。优先用 hint（扩展名推断）；否则双尝试解码（MV base64 → MZ zlib）。
 * 均失败抛 SaveCodecError。
 */
export function detectSaveKind(input: string, zlib?: ZlibLike, hint?: SaveKind | null): SaveKind {
  if (hint === 'mv' || hint === 'mz') return hint
  if (zlib && tryDecodeMz(input, zlib)) return 'mz'
  if (tryDecodeMv(input)) return 'mv'
  throw new SaveCodecError('无法识别的存档格式（既不是 MV base64 也不是 MZ zlib）')
}

/**
 * 解码存档文本为 contents 对象。
 *
 * @param input 磁盘读回的文本（MV 为 base64；MZ 为 utf8 解码后的 binary string）
 * @param zlib zlib 实现（MZ 必需；MV 可省略）
 * @param hint 已知种类（扩展名推断），省略则自动检测
 */
export function decodeSave(input: string, zlib?: ZlibLike, hint?: SaveKind | null): SaveDecodeResult {
  const kind = detectSaveKind(input, zlib, hint)
  if (kind === 'mv') {
    const contents = tryDecodeMv(input)
    if (contents) return { kind, contents }
  } else if (zlib) {
    const contents = tryDecodeMz(input, zlib)
    if (contents) return { kind, contents }
  }
  throw new SaveCodecError(`存档解码失败（${kind}）`)
}

/**
 * 编码 contents 为磁盘文本。
 *
 * ⚠️ 与 JsonEx 官方行为一致：编码会**原地变异** contents（加 "@" 类标记）。
 * 若要保留原对象请先深拷贝（`jsonExMakeDeepCopy`）。
 *
 * @param contents 存档 contents
 * @param kind mv | mz
 * @param zlib zlib 实现（mz 必需）
 * @returns MV 返回 base64 文本；MZ 返回 binary string 文本（调用方以 utf8 写盘）
 */
export function encodeSave(contents: unknown, kind: SaveKind, zlib?: ZlibLike): string {
  const json = jsonExStringify(contents)
  if (kind === 'mv') {
    return compressToBase64(json)
  }
  if (!zlib) {
    throw new SaveCodecError('MZ 编码需要注入 zlib 实现')
  }
  return zlib.deflateToBinaryString(json)
}
