import { ENCRYPTED_EXTENSIONS, EXTENSION_MAP, MAGIC_NUMBERS } from './constants'
import { Decrypter } from './Decrypter'
import { matchesMagic, type MagicKind } from './magic'
// LZString 为通用压缩工具（纯 TS，零 Node 依赖），供存档 codec 与 key 检测共用
import { decompressFromBase64 } from '../save/lzstring'

/**
 * 纯算法层的密钥反推 / 类型识别。不做文件 I/O（文件扫描在 M1 主进程做）。
 */

/** 判断扩展名是否为加密资源扩展名 */
export function isEncryptedExtension(ext: string): boolean {
  return ENCRYPTED_EXTENSIONS.includes(ext.toLowerCase())
}

/** 加密扩展名 → 正常扩展名（非加密扩展返回 null） */
export function toNormalExtension(ext: string): string | null {
  return EXTENSION_MAP[ext.toLowerCase()] ?? null
}

/**
 * 用魔数识别解密后的资源类型。
 * 返回 'png' | 'ogg' | 'm4a' | 'mp4' | null（null 表示无法判断）。
 */
export function detectMagicKind(data: Uint8Array): string | null {
  for (const kind of Object.keys(MAGIC_NUMBERS)) {
    if (matchesMagic(data, kind as MagicKind)) return kind
  }
  return null
}

/**
 * 从加密 PNG 文件反推密钥（参照 Petschko Decrypter.getKeyFromPNG）。
 *
 * 原理：假头(16B)之后紧跟着【被加密的前 16 字节】，
 * 而加密前的这 16 字节 = 标准 PNG 头，故 key = pngHead[i] ^ encryptedPrefix[i]。
 *
 * @param fileContent 完整的加密文件字节（含假头）
 * @param headerLen   假头长度（默认 16）
 * @returns 反推的密钥 hex，或 null（文件过短/无法反推）
 */
export function getKeyFromPNG(fileContent: Uint8Array, headerLen = 16): string | null {
  if (!fileContent || fileContent.byteLength < headerLen * 2) return null
  const header = fileContent.slice(headerLen, headerLen * 2)
  const pngHeader = Decrypter.getNormalPNGHeader(headerLen)
  let output = ''
  const n = Math.min(headerLen, pngHeader.length)
  for (let i = 0; i < n; i++) {
    output += Decrypter.byteToHex(pngHeader[i] ^ header[i])
  }
  return output
}

/**
 * 用候选密钥解密文件，并校验其结果是否为给定资源类型（魔数验证）。
 * 用于「自动找 key」时校验候选 key 是否正确。
 *
 * @param encryptedData 完整加密文件字节
 * @param key           候选密钥 hex
 * @param kind          期望的资源类型（png/ogg/m4a），缺省则任选其一
 * @returns 是否通过魔数校验
 */
export function verifyKey(
  encryptedData: Uint8Array,
  key: string,
  kind?: string
): boolean {
  if (!key || key.length === 0) return false
  try {
    const decrypted = new Decrypter(key).decrypt(encryptedData)
    const detected = detectMagicKind(decrypted)
    if (kind) return detected === kind
    return detected !== null
  } catch {
    return false
  }
}

/**
 * 从 System.json 文本中提取 encryptionKey（纯解析，无 fs）。
 *
 * 先按普通 JSON 解析；失败时尝试 LZString base64 解压后再解析
 * （罕见情况：System.json 被 LZString 压缩，参照 Petschko `detectEncryptionCode` 的兜底分支）。
 */
export function parseSystemJsonKey(content: string): string | null {
  if (!content || content.trim().length === 0) return null
  const direct = tryParseSystemJson(content)
  if (direct !== null) return direct
  // 兜底：LZString base64 压缩的 System.json
  try {
    const decompressed = decompressFromBase64(content)
    if (decompressed) {
      const viaLz = tryParseSystemJson(decompressed)
      if (viaLz !== null) return viaLz
    }
  } catch {
    // 解压失败/非法输入 → 视为找不到 key
  }
  return null
}

function tryParseSystemJson(text: string): string | null {
  try {
    const data = JSON.parse(text)
    if (data && typeof data === 'object' && typeof data.encryptionKey === 'string') {
      const key = data.encryptionKey.trim()
      return key.length > 0 ? key : null
    }
  } catch {
    // 非 JSON
  }
  return null
}

/**
 * 从 rpg_core.js（或任何 js）文本中提取 `_encryptionKey = "..."` 的密钥（纯解析）。
 *
 * 兼容 `this._encryptionKey` / `Decrypter._encryptionKey`，值可能是双引号或单引号 hex；
 * 直接搜索失败时再尝试 LZString base64 解压后搜索
 * （参照 Petschko `searchEncryptionCode` 的 LZ-String 搜索分支）。
 */
export function extractKeyFromRpgCore(content: string): string | null {
  if (!content) return null
  const direct = matchEncryptionKey(content)
  if (direct !== null) return direct
  // 兜底：LZString base64 压缩的 rpg_core.js
  try {
    const decompressed = decompressFromBase64(content)
    if (decompressed) {
      const viaLz = matchEncryptionKey(decompressed)
      if (viaLz !== null) return viaLz
    }
  } catch {
    // 解压失败/非法输入 → 视为找不到 key
  }
  return null
}

function matchEncryptionKey(text: string): string | null {
  // 兼容 `this._encryptionKey` / `Decrypter._encryptionKey`，值可能是双引号或单引号 hex
  const re = /(?:this|Decrypter)\._encryptionKey\s*=\s*["']([0-9a-fA-F]+)["']/
  const m = text.match(re)
  if (m && m[1]) return m[1]
  return null
}
