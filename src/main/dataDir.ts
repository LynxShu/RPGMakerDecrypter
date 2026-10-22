/**
 * 便携模式（绿色版）数据目录解析。
 *
 * 背景：发布物是「解压即用」的 zip（release/win-unpacked 压缩包），但 Electron 默认把
 * userData（config.json / history.json / locales / Chromium 缓存）写到
 * `%APPDATA%\rpgmaker-decrypter`，等于强制占用 C 盘，而且换机器/拷 U 盘带不走设置。
 * 便携模式下把数据目录搬到 exe 同级的 `rpgmaker-decrypter\`，整包拷走即保留全部数据。
 *
 * 决策顺序（`resolveDataDir`）：
 *   1. `RPGMD_DATA_DIR`（绝对路径，显式指定优先；dev 模式也可用）
 *   2. Windows + 打包版 + exe 同级可写 + 不在系统目录 → `<exeDir>\rpgmaker-decrypter`
 *   3. 其余情况 → 系统默认 userData（`%APPDATA%\rpgmaker-decrypter`），
 *      保证「装在 Program Files / 只读介质 / dev 运行」时设置仍能保存
 *
 * 本模块只用 Node 内置模块、不 import electron，便于在 vitest 里直接单测。
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** 便携模式下 exe 同级的数据目录名（与 Electron 默认 userData 目录同名，README 也这么写）。 */
export const DATA_DIR_NAME = 'rpgmaker-decrypter'

/** 数据目录最终落点：portable = 跟 exe 走；default = 系统默认 userData。 */
export type DataDirMode = 'portable' | 'default'

/** 决策原因（日志/测试用）。 */
export type DataDirReason =
  | 'env'
  | 'exe-writable'
  | 'dev'
  | 'non-windows'
  | 'system-dir'
  | 'not-writable'

export interface DataDirResolution {
  dir: string
  mode: DataDirMode
  reason: DataDirReason
}

export interface ResolveDataDirOptions {
  /** app.isPackaged：dev 运行（electron-vite dev / electron .）为 false */
  isPackaged: boolean
  platform: NodeJS.Platform
  /** 可执行文件路径：打包版为 exe，dev 下为 node_modules 里的 electron.exe */
  exePath: string
  /** Electron 默认 userData，即 `%APPDATA%\rpgmaker-decrypter`（macOS/Linux 对应目录） */
  defaultDir: string
  /** `RPGMD_DATA_DIR`：显式指定时优先于一切自动判断 */
  envDir?: string | undefined
  /** 目录可写探测（注入以便测试） */
  isWritable: (dir: string) => boolean
  /** 不应写入的系统目录（Program Files / Windows / AppData / Temp 等） */
  systemDirs?: string[]
}

/** 统一分隔符 + 去尾分隔符 + 小写，用于 Windows 路径前缀比较。 */
function normalizePath(p: string): string {
  return p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** dir 是否等于某个系统目录或位于其下（按路径分段比较，避免 `C:\Program FilesExtra` 误判）。 */
export function isInsideSystemDir(dir: string, systemDirs: string[]): boolean {
  const target = normalizePath(dir)
  if (!target) return false
  return systemDirs.some((sys) => {
    const prefix = normalizePath(sys)
    return prefix.length > 0 && (target === prefix || target.startsWith(prefix + '\\'))
  })
}

/** 解析数据目录（纯函数，不做 fs 写入）。 */
export function resolveDataDir(opts: ResolveDataDirOptions): DataDirResolution {
  const envDir = (opts.envDir ?? '').trim()
  if (envDir) return { dir: resolve(envDir), mode: 'portable', reason: 'env' }

  if (!opts.isPackaged) return { dir: opts.defaultDir, mode: 'default', reason: 'dev' }
  // 只对 Windows 做便携模式：macOS 的 .app 包内写入会破坏签名，Linux 的 AppImage 是只读挂载。
  if (opts.platform !== 'win32') {
    return { dir: opts.defaultDir, mode: 'default', reason: 'non-windows' }
  }

  const exeDir = dirname(opts.exePath)
  if (isInsideSystemDir(exeDir, opts.systemDirs ?? [])) {
    return { dir: opts.defaultDir, mode: 'default', reason: 'system-dir' }
  }
  if (!opts.isWritable(exeDir)) {
    return { dir: opts.defaultDir, mode: 'default', reason: 'not-writable' }
  }
  return { dir: join(exeDir, DATA_DIR_NAME), mode: 'portable', reason: 'exe-writable' }
}

/**
 * 确保目录存在且真的可写（Windows 上 access(W_OK) 不可靠，实际写一个探针文件）。
 * 失败返回 false，调用方应回退到默认 userData。
 */
export function ensureWritableDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.write-test-${process.pid}-${Date.now().toString(36)}`)
    writeFileSync(probe, '')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * 首次便携启动时，把旧版（默认 userData）里的设置/历史/语言包搬到便携目录。
 * 只补缺失项、不覆盖已有文件；任何单项失败都忽略（迁移只是便利，不能挡住启动）。
 * 返回实际迁移的条目名，便于日志。
 */
export function migrateLegacyData(legacyDir: string, targetDir: string): string[] {
  const migrated: string[] = []
  if (resolve(legacyDir) === resolve(targetDir)) return migrated
  if (!existsSync(legacyDir)) return migrated

  for (const name of ['config.json', 'history.json']) {
    const from = join(legacyDir, name)
    const to = join(targetDir, name)
    if (!existsSync(from) || existsSync(to)) continue
    try {
      mkdirSync(targetDir, { recursive: true })
      copyFileSync(from, to)
      migrated.push(name)
    } catch {
      /* 忽略单项失败 */
    }
  }

  const fromLocales = join(legacyDir, 'locales')
  const toLocales = join(targetDir, 'locales')
  if (existsSync(fromLocales) && !existsSync(toLocales)) {
    try {
      mkdirSync(targetDir, { recursive: true })
      cpSync(fromLocales, toLocales, { recursive: true })
      migrated.push('locales')
    } catch {
      /* 忽略单项失败 */
    }
  }

  return migrated
}
