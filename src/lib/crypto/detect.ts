import { DEFAULT_HEADER_LEN } from './constants'
import { bytesToHex } from './hex'

/**
 * 头嗅探 / 版本无关检测。
 *
 * 不依赖扩展名：读取文件前若干字节，判断前 5 字节是否为 ASCII "RPGMV" 签名，
 * 并解析出假头的 signature / version / remain，可用于构建正确的假头。
 *
 * 对 MV 与 MZ、以及被第三方改名/混淆的文件都健壮（蓝图 §2「用头嗅探解决」）。
 */

export interface HeaderInfo {
  /** 是否为 RPGMV 加密头 */
  encrypted: boolean
  /** 实际读取的头长度 */
  headerLen: number
  /** 假头 hex（原始字节的 hex 表示，长度 = headerLen * 2） */
  fullHex: string
  /** 前 8 字节的 hex（signature，含 "RPGMV"） */
  signatureHex: string
  /** 版本字节 hex（默认 3 字节） */
  versionHex: string
  /** 填充 hex（默认 5 字节） */
  remainHex: string
  /** 原始头字节 */
  raw: Uint8Array
}

export const RPGMV_SIGNATURE_ASCII = 'RPGMV'

function isRPGMV(header: Uint8Array, len: number): boolean {
  if (len < 5) return false
  return (
    header[0] === 0x52 &&
    header[1] === 0x50 &&
    header[2] === 0x47 &&
    header[3] === 0x4d &&
    header[4] === 0x56
  )
}

/**
 * 嗅探一个文件是否为加密资源，并解析假头信息。
 *
 * @param data   文件字节（至少前 16 字节）
 * @param headerLen 假头长度（默认 16）
 */
export function detectHeader(data: Uint8Array, headerLen = DEFAULT_HEADER_LEN): HeaderInfo {
  const len = Math.min(headerLen, data.length)
  const raw = data.slice(0, len)
  const fullHex = bytesToHex(raw)
  // 按默认 8/3/5 字节划分（不足则为空串）
  const signatureHex = fullHex.slice(0, 16)
  const versionHex = fullHex.slice(16, 22)
  const remainHex = fullHex.slice(22, 32)
  return {
    encrypted: isRPGMV(raw, len),
    headerLen: len,
    fullHex,
    signatureHex,
    versionHex,
    remainHex,
    raw
  }
}

/** 快捷判断：该字节流是否带 RPGMV 加密签名 */
export function looksEncrypted(data: Uint8Array, headerLen = DEFAULT_HEADER_LEN): boolean {
  return detectHeader(data, headerLen).encrypted
}
