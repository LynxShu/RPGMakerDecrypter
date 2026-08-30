import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import {
  getKeyFromPNG,
  isEncryptedExtension,
  verifyKey,
  parseSystemJsonKey,
  extractKeyFromRpgCore
} from '@lib/crypto'

/** 读取目录项列表；失败返回空数组 */
function listDir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export interface KeyResult {
  key: string
  source: string
}

export interface ScannedFile {
  absPath: string
  relPath: string
  ext: string
  size: number
  encrypted: boolean
}

/** 遍历时跳过的目录（避免进入 node_modules / .git 等） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'release'])

/** 流式扫描每批推送的文件数量（蓝图 §11.2：分批流式，UI 渐进渲染而非等全部结束） */
export const SCAN_BATCH_SIZE = 50

function trySystemJsonKey(candidate: string): KeyResult | null {
  if (!existsSync(candidate)) return null
  try {
    const key = parseSystemJsonKey(readFileSync(candidate, 'utf-8'))
    return key ? { key, source: candidate } : null
  } catch {
    return null
  }
}

function tryRpgCoreKey(candidate: string): KeyResult | null {
  if (!existsSync(candidate)) return null
  try {
    const key = extractKeyFromRpgCore(readFileSync(candidate, 'utf-8'))
    return key ? { key, source: candidate } : null
  } catch {
    return null
  }
}

/** 在目录中找第一个加密图片用作密钥反推样本 */
function findSampleEncryptedImage(gameDir: string): string | null {
  const stack = [gameDir]
  const imgExts = new Set(['rpgmvp', 'png_'])
  while (stack.length > 0) {
    const dir = stack.pop()!
    const entries = listDir(dir)
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs)
      } else if (entry.isFile()) {
        const ext = extname(entry.name).slice(1).toLowerCase()
        if (imgExts.has(ext)) return abs
      }
    }
  }
  return null
}

/**
 * 自动查找加密密钥（蓝图 §6.2）。
 *
 * 优先级：
 * 1. `data/System.json` / `www/data/System.json`（MZ 用 data，MV 用 www/data）
 * 2. `js/rpg_core.js` / `www/js/rpg_core.js`（this._encryptionKey）
 * 3. 加密图片头反推（getKeyFromPNG），并用魔数验证
 */
export function findEncryptionKey(gameDir: string): KeyResult | null {
  // 1. System.json（多个位置都试）
  for (const c of [
    join(gameDir, 'data', 'System.json'),
    join(gameDir, 'www', 'data', 'System.json')
  ]) {
    const r = trySystemJsonKey(c)
    if (r) return r
  }

  // 2. rpg_core.js
  for (const c of [
    join(gameDir, 'js', 'rpg_core.js'),
    join(gameDir, 'www', 'js', 'rpg_core.js')
  ]) {
    const r = tryRpgCoreKey(c)
    if (r) return r
  }

  // 3. 加密图片头反推
  const sample = findSampleEncryptedImage(gameDir)
  if (sample) {
    try {
      const buf = new Uint8Array(readFileSync(sample))
      const derived = getKeyFromPNG(buf)
      if (derived) {
        // getKeyFromPNG 反推 16 字节（32 hex chars），与标准 MV/MZ 密钥长度一致。
        // 对 8 字节短密钥场景，尾部为 '\0' 填充，作为密钥时等价于 ^0，不影响。
        // 直接使用完整反推结果，避免截断导致图片损坏。
        if (verifyKey(buf, derived, 'png')) {
          return { key: derived, source: sample + ' (derived from PNG header)' }
        }
      }
    } catch {
      // ignore
    }
  }

  return null
}

/**
 * 递归扫描游戏目录，收集加密资源文件（按扩展名）。
 *
 * @param signal 取消信号（AbortSignal），遍历中检查
 */
export function scanEncryptedFiles(gameDir: string, signal?: AbortSignal): ScannedFile[] {
  const out: ScannedFile[] = []
  const stack = [gameDir]
  while (stack.length > 0 && !signal?.aborted) {
    const dir = stack.pop()!
    const entries = listDir(dir)
    for (const entry of entries) {
      if (signal?.aborted) break
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs)
      } else if (entry.isFile()) {
        const ext = extname(entry.name).slice(1).toLowerCase()
        if (isEncryptedExtension(ext)) {
          out.push({
            absPath: abs,
            relPath: relative(gameDir, abs),
            ext,
            size: statSync(abs).size,
            encrypted: true
          })
        }
      }
    }
  }
  return out
}

/**
 * 递归扫描目录，收集指定扩展名的文件（加密/图片还原批量处理用）。
 * 遍历规则与 scanEncryptedFiles 一致（跳过 node_modules/.git/out/release）。
 *
 * @param exts   目标扩展名集合（小写，不含点）
 * @param signal 取消信号（可选）
 */
export function listFilesByExt(root: string, exts: ReadonlySet<string>, signal?: AbortSignal): ScannedFile[] {
  const out: ScannedFile[] = []
  const stack = [root]
  while (stack.length > 0 && !signal?.aborted) {
    const dir = stack.pop()!
    const entries = listDir(dir)
    for (const entry of entries) {
      if (signal?.aborted) break
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs)
      } else if (entry.isFile()) {
        const ext = extname(entry.name).slice(1).toLowerCase()
        if (exts.has(ext)) {
          let size = 0
          try {
            size = statSync(abs).size
          } catch {
            size = 0
          }
          out.push({ absPath: abs, relPath: relative(root, abs), ext, size, encrypted: true })
        }
      }
    }
  }
  return out
}

/**
 * 流式扫描：与 `scanEncryptedFiles` 相同的遍历规则，但用异步 fs 并**分批**产出，
 * 供主进程分块经 IPC 推给渲染层（渐进渲染）。
 *
 * @param signal   取消信号（遍历中检查）
 * @param batchSize 每批文件数量（默认 SCAN_BATCH_SIZE）
 */
export async function* streamEncryptedFiles(
  gameDir: string,
  signal?: AbortSignal,
  batchSize = SCAN_BATCH_SIZE
): AsyncGenerator<ScannedFile[], void, unknown> {
  let batch: ScannedFile[] = []
  const stack = [gameDir]
  while (stack.length > 0 && !signal?.aborted) {
    const dir = stack.pop()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (signal?.aborted) break
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs)
      } else if (entry.isFile()) {
        const ext = extname(entry.name).slice(1).toLowerCase()
        if (isEncryptedExtension(ext)) {
          let size = 0
          try {
            size = (await stat(abs)).size
          } catch {
            size = 0
          }
          batch.push({ absPath: abs, relPath: relative(gameDir, abs), ext, size, encrypted: true })
          if (batch.length >= batchSize) {
            yield batch
            batch = []
          }
        }
      }
    }
  }
  if (batch.length > 0) yield batch
}
