/**
 * 资源魔数校验（纯 TS，零 Node 依赖）。
 *
 * 用途（蓝图 §11.4-2）：
 * - 批量解密导出后校验每个产物的魔数，key 错误会立刻在结果里暴露；
 * - 自动找 key 时用魔数验证候选 key（verifyKey 已用 detectMagicKind）。
 *
 * 魔数定义在 constants.ts 的 MAGIC_NUMBERS；本模块只做「匹配」与「扩展名 → 期望魔数」。
 */
import { EXTENSION_MAP, MAGIC_NUMBERS } from './constants'

/** 已知魔数的资源类型（png / ogg / m4a / mp4） */
export type MagicKind = keyof typeof MAGIC_NUMBERS

/** 判断字节流是否以给定魔数开头 */
export function startsWithBytes(data: Uint8Array, prefix: readonly number[]): boolean {
  if (!data || data.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] !== prefix[i]) return false
  }
  return true
}

/** 字节流是否匹配某资源类型的魔数 */
export function matchesMagic(data: Uint8Array, kind: MagicKind): boolean {
  return startsWithBytes(data, MAGIC_NUMBERS[kind])
}

/**
 * 由加密扩展名推断解密产物的期望魔数类型。
 * 例如 `rpgmvp`/`png_` → `png`、`rpgmvo`/`ogg_` → `ogg`、`rpgmvm`/`m4a_` → `m4a`。
 * 无法推断（非加密扩展名）返回 null，调用方应跳过校验。
 */
export function expectedMagicKind(ext: string): MagicKind | null {
  const normal = EXTENSION_MAP[ext.toLowerCase()]
  if (!normal) return null
  return normal in MAGIC_NUMBERS ? (normal as MagicKind) : null
}
