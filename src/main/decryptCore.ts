/**
 * 加解密任务的「核心执行器」：读文件 → 解密 → 写盘或回传字节。
 *
 * 该模块不依赖 Electron，也不依赖 worker_threads API，因此可以被两处复用：
 * - `src/main/worker.ts`：作为 worker_threads 的工作负载（真正多线程，不阻塞主进程事件循环）。
 * - `src/main/decryptPool.ts`：线程池意外不可用时的内联回退路径（用异步 fs.promises，避免阻塞）。
 *
 * 与 GUI/CLI 共享同一套 `@lib/crypto` 纯算法核心。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Decrypter, toNormalExtension, expectedMagicKind, matchesMagic } from '@lib/crypto'

/** 单个加解密任务的输入（可序列化，经 IPC / postMessage 传输） */
export interface DecryptJob {
  id: number
  /** 加密文件的绝对路径 */
  absPath: string
  /** 相对游戏目录的路径（仅用于构造输出路径，不参与加解密） */
  relPath: string
  /** 加密扩展名（如 rpgmvp / png_ / m4a_ / ogg_） */
  ext: string
  /** 密钥 hex */
  key: string
  /**
   * 若给出则把解密结果写盘（导出目录用）；否则把解密字节回传（导 ZIP 用）。
   * 由调用方基于 `relPath` + `targetRelPath()` 计算而来。
   */
  outPath?: string | null
}

/** 单个任务的执行结果 */
export interface DecryptResult {
  id: number
  status: 'ok' | 'fail'
  /** 失败原因（status === 'fail' 时存在） */
  error?: string
  relPath: string
  ext: string
  /**
   * 解密后的字节：
   * - 内联路径（decryptCore 直接调用）：为 `Uint8Array`；
   * - worker 路径（postMessage 回传）：为 `ArrayBuffer`（可转移）；
   * 调用方需统一转成 `Uint8Array`（见 pool 内的归一化）。
   */
  data?: ArrayBuffer | Uint8Array
  /**
   * 导出产物魔数校验结果（蓝图 §11.4-2）：
   * - `true` 解密成功且魔数与期望类型一致；
   * - `false` 解密成功但魔数不匹配（大概率 key 错误）；
   * - `null`/缺省 该扩展名无对应期望魔数，跳过校验。
   */
  magicOk?: boolean | null
}

/** 计算解密输出应使用的相对路径（去掉加密扩展名，换成正常扩展名） */
export function targetRelPath(relPath: string, ext: string): string {
  const normalExt = toNormalExtension(ext) ?? ext
  if (relPath.length <= ext.length + 1) return normalExt
  const relNoExt = relPath.slice(0, relPath.length - ext.length - 1)
  return relNoExt + '.' + normalExt
}

/**
 * 执行一次「读文件 → 解密 → 写盘或回传」的请求。
 *
 * - `req.outPath` 缺省则回传解密字节（data 为 `Uint8Array`）。
 * - 任何异常都不会抛出，而是以 `status: 'fail'` 返回，保证单个文件失败不影响整批。
 */
export async function processDecryptRequest(req: DecryptJob): Promise<DecryptResult> {
  try {
    const raw = new Uint8Array(await readFile(req.absPath))
    const dec = new Decrypter(req.key).decrypt(raw)
    // 导出产物魔数校验：期望类型已知则校验并上报（不因魔数不符而判失败，仅作统计提示）
    const magicKind = expectedMagicKind(req.ext)
    const magicOk = magicKind ? matchesMagic(dec, magicKind) : null
    if (req.outPath) {
      await mkdir(dirname(req.outPath), { recursive: true })
      await writeFile(req.outPath, dec)
      return { id: req.id, status: 'ok', relPath: req.relPath, ext: req.ext, magicOk }
    }
    return { id: req.id, status: 'ok', relPath: req.relPath, ext: req.ext, magicOk, data: dec }
  } catch (e) {
    return { id: req.id, status: 'fail', error: String(e), relPath: req.relPath, ext: req.ext }
  }
}
