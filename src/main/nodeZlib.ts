/**
 * Node `zlib` 的 ZlibLike 适配器（供 main 进程与 CLI 注入 @lib/save 的 MZ 编解码）。
 *
 * @lib 本身零 Node 依赖；此处是 Node 侧的注入实现：
 * - deflate：json 文本 → `zlib.deflateSync`（level 1，与游戏 pako `{level:1}` 对齐）→ latin1 binary string
 * - inflate：latin1 binary string → `zlib.inflateSync` → utf8 json 文本
 */
import { deflateSync, inflateSync } from 'node:zlib'
import type { ZlibLike } from '@lib/save'

export const nodeZlib: ZlibLike = {
  deflateToBinaryString(json: string): string {
    return deflateSync(Buffer.from(json, 'utf8'), { level: 1 }).toString('latin1')
  },
  inflateFromBinaryString(bin: string): string {
    return inflateSync(Buffer.from(bin, 'latin1')).toString('utf8')
  }
}
