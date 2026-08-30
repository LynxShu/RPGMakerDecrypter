/**
 * 与 Petschko 原版 Decrypter.js 保持一致的默认常量。
 *
 * 说明：MV 与 MZ 是同一套加密 —— 每个加密资源以 16 字节假头开头，
 * 前 5 字节为 ASCII 签名 "RPGMV"（52 50 47 4D 56），随后为版本字节 + 填充。
 */

/** 默认假头长度（字节） */
export const DEFAULT_HEADER_LEN = 16

/** 默认签名（hex 字符串），前 5 字节为 ASCII "RPGMV" */
export const DEFAULT_SIGNATURE = '5250474d56000000'

/** 默认版本字节（hex 字符串） */
export const DEFAULT_VERSION = '000301'

/** 默认填充字节（hex 字符串） */
export const DEFAULT_REMAIN = '0000000000'

/** 标准 PNG 头（16 字节） */
export const PNG_HEADER_BYTES: readonly number[] = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]

/** MV / MZ 加密资源扩展名（双方命名不一，均列出） */
export const ENCRYPTED_EXTENSIONS: readonly string[] = [
  'rpgmvp', 'rpgmvm', 'rpgmvo',
  'png_', 'ogg_', 'm4a_'
] as const

/** 加密扩展名 → 解密后的正常扩展名 */
export const EXTENSION_MAP: Readonly<Record<string, string>> = {
  rpgmvp: 'png',
  rpgmvm: 'm4a',
  rpgmvo: 'ogg',
  png_: 'png',
  m4a_: 'm4a',
  ogg_: 'ogg'
}

/** 解密后可校验的资源魔数（每种资源头几个字节，用于快速判断解密是否成功/找 key 时验证候选 key） */
export const MAGIC_NUMBERS: Readonly<Record<string, readonly number[]>> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  ogg: [0x4f, 0x67, 0x67, 0x53], // 'OggS'
  m4a: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], // ftyp box
  mp4: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]
}

/** 引擎版本 → 明文扩展名 → 加密扩展名（MV/MZ 算法相同，仅命名不同；与旧 Python 版 worker 一致） */
export const ENCRYPT_EXT_BY_VERSION: Readonly<Record<'mv' | 'mz', Readonly<Record<string, string>>>> = {
  mv: { png: 'rpgmvp', m4a: 'rpgmvm', ogg: 'rpgmvo' },
  mz: { png: 'png_', m4a: 'm4a_', ogg: 'ogg_' }
}

/** 加密时按版本与明文扩展名取目标加密扩展名；不支持的扩展名返回 null（调用方跳过并统计） */
export function encryptExtFor(version: 'mv' | 'mz', plainExt: string): string | null {
  return ENCRYPT_EXT_BY_VERSION[version]?.[plainExt.toLowerCase()] ?? null
}

/** 图片还原（无密钥救图）支持处理的加密图片扩展名 */
export const RESTORE_IMAGE_EXTENSIONS: readonly string[] = ['rpgmvp', 'png_'] as const
