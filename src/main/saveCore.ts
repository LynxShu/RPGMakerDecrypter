/**
 * 存档文件 IO（main 进程）：扫描存档目录、解码加载、备份写回。
 *
 * 复用 `@lib/save` codec 与 `nodeZlib` 注入；GUI 与 CLI 共用。
 * - 目录扫描：优先 `<dir>/save/`，否则扫 `<dir>` 自身（*.rpgsave / *.rmmzsave）。
 * - 写回：先备份（`.bak`，同名存在则加时间戳），再 encode 后以 UTF-8 写盘
 *   （MZ binary string 的 UTF-8 落盘语义与 NW.js 一致，见 codec.ts 注释）。
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { decodeSave, encodeSave, kindFromExtension, type SaveKind } from '@lib/save'
import { nodeZlib } from './nodeZlib'

export interface SaveFileInfo {
  absPath: string
  name: string
  ext: string
  kind: SaveKind | null
  size: number
}

export interface LoadedSave {
  absPath: string
  name: string
  kind: SaveKind
  contents: Record<string, unknown>
  size: number
}

export interface WriteSaveResult {
  ok: boolean
  backupPath?: string
  error?: string
}

const SAVE_EXTS = ['.rpgsave', '.rmmzsave']

/**
 * 扫描目录中的存档文件。若 `<dir>/save` 存在则扫描它，否则扫描 `<dir>` 自身。
 * 返回按文件名自然排序（file0, file1, file10…）的列表。
 */
export function findSaveFiles(dir: string): SaveFileInfo[] {
  let target = dir
  try {
    if (existsSync(join(dir, 'save')) && statSync(join(dir, 'save')).isDirectory()) {
      target = join(dir, 'save')
    }
  } catch {
    /* 目录不可读则按自身处理 */
  }
  let names: string[]
  try {
    names = readdirSync(target)
  } catch {
    return []
  }
  const files: SaveFileInfo[] = []
  for (const name of names) {
    const ext = extname(name).toLowerCase()
    if (!SAVE_EXTS.includes(ext)) continue
    const absPath = join(target, name)
    let size = 0
    try {
      size = statSync(absPath).size
    } catch {
      continue
    }
    files.push({ absPath, name, ext, kind: kindFromExtension(ext), size })
  }
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return files
}

/** 读取并解码存档。失败抛错（信息面向用户）。 */
export function loadSave(absPath: string): LoadedSave {
  const text = readFileSync(absPath, 'utf8')
  const hint = kindFromExtension(extname(absPath))
  let result
  try {
    result = decodeSave(text, nodeZlib, hint)
  } catch (e) {
    throw new Error(`存档解码失败（${basename(absPath)}）：${(e as Error).message}`)
  }
  let size = 0
  try {
    size = statSync(absPath).size
  } catch {
    /* ignore */
  }
  return {
    absPath,
    name: basename(absPath),
    kind: result.kind,
    contents: result.contents,
    size
  }
}

/** 编码并写回存档（先备份原文件）。 */
export function writeSave(absPath: string, contents: unknown, kind: SaveKind): WriteSaveResult {
  try {
    let backupPath = absPath + '.bak'
    if (existsSync(backupPath)) backupPath = `${absPath}.${Date.now()}.bak`
    copyFileSync(absPath, backupPath)
    const text = encodeSave(contents, kind, nodeZlib)
    writeFileSync(absPath, text, 'utf8')
    return { ok: true, backupPath }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
