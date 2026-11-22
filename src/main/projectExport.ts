/**
 * RPG Maker MV / MZ 可编辑工程恢复模块（纯 Node，无 Electron 依赖，供 GUI 与 CLI 共用）。
 *
 * 原理：MV / MZ 部署包本身保留了完整的 data/ JSON、js/plugins/ 明文源码与 plugins.js 配置；
 * 只需过滤 NW.js 运行时与加密资源、写入解密后的明文资源、关闭 System.json 的加密标志、
 * 并补齐 Game.rpgproject / game.rmmzproject 入口文件，即可直接用 RPG Maker 编辑器打开。
 */
import { existsSync, readFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { isEncryptedExtension } from '@lib/crypto'

export type RpgEngine = 'mv' | 'mz'

export interface DetectedProject {
  engine: RpgEngine
  /** 工程实际源目录（MV 根目录为 <gameDir>/www，MZ 或直接选 www/ 时为 <gameDir>） */
  projectRoot: string
  /** projectRoot 是否位于 gameDir 下的 www 子目录 */
  hasWwwSubdir: boolean
  /** data/System.json 路径 */
  systemJsonPath: string
  /** 从 rpg_core.js / rmmz_core.js 解析出的引擎版本，读不到为 null */
  engineVersion: string | null
  /** 用于生成 <name>_project 目录的基础名称 */
  baseName: string
}

export interface ProjectExportOptions {
  /** 用户选择的原始游戏目录（与扫描/解密缓存的相对路径基准一致） */
  gameDir: string
  /** 最终输出工程目录（调用方已决定好路径，例如 <chosen>/<name>_project） */
  outputDir: string
  /** GUI 解密缓存目录；CLI 如另行直接解密到 outputDir 可传 null/undefined */
  decryptCacheDir?: string | null
  /** 取消信号 */
  signal?: AbortSignal
  /** 进度回调 */
  onProgress?: (done: number, total: number, ok: number, fail: number, current?: string) => void
}

export interface ProjectExportResult {
  canceled: boolean
  engine: RpgEngine
  projectFile: string
  outputDir: string
  /** 拷贝的非加密工程文件数 */
  copied: number
  /** 从解密缓存拷入的明文资源数 */
  decrypted: number
  /** 总成功文件数（copied + decrypted） */
  ok: number
  fail: number
  /** 是否修改了 data/System.json 的加密开关 */
  systemPatched: boolean
  /** 是否新生成了工程入口文件（原目录已有则保留不覆盖） */
  projectFileCreated: boolean
}

/** 遍历时始终跳过的目录名 */
const ALWAYS_SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'release', 'save', 'saves'])

/** 仅在 projectRoot 顶层（非 www 子目录时，即与 NW.js 壳子混放）跳过的运行时目录 */
const RUNTIME_ROOT_DIRS = new Set(['swiftshader', 'pnacl'])

/** 仅在 projectRoot 顶层跳过的 NW.js 运行时精确文件名（小写） */
const RUNTIME_ROOT_FILES = new Set([
  'icudtl.dat',
  'v8_context_snapshot.bin',
  'natives_blob.bin',
  'snapshot_blob.bin',
  'vk_swiftshader_icd.json',
  'credits.html',
  'debug.log',
  'nw.exe',
  'game.exe',
  'notification_helper.exe',
  'nwjs.exe'
])

/** 仅在 projectRoot 顶层跳过的 NW.js 二进制扩展名（小写，不含点） */
const RUNTIME_ROOT_EXTS = new Set(['exe', 'dll', 'pak', 'so', 'dylib'])

export class ProjectExportAbortedError extends Error {
  constructor() {
    super('Project export aborted')
    this.name = 'ProjectExportAbortedError'
  }
}

function readEngineVersion(projectRoot: string, engine: RpgEngine): string | null {
  const candidates =
    engine === 'mz'
      ? [join(projectRoot, 'js', 'rmmz_core.js'), join(projectRoot, 'js', 'rpg_core.js')]
      : [join(projectRoot, 'js', 'rpg_core.js'), join(projectRoot, 'js', 'rmmz_core.js')]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      const content = readFileSync(file, 'utf-8')
      const m = content.match(/Utils\.RPGMAKER_VERSION\s*=\s*["']([^"']+)["']/)
      if (m?.[1]) return m[1].trim()
    } catch {
      /* ignore */
    }
  }
  return null
}

function inferEngineFromDir(projectRoot: string, systemJsonPath: string, hasWwwSubdir: boolean): RpgEngine {
  if (existsSync(join(projectRoot, 'js', 'rmmz_core.js')) || existsSync(join(projectRoot, 'game.rmmzproject'))) {
    return 'mz'
  }
  if (existsSync(join(projectRoot, 'js', 'rpg_core.js')) || existsSync(join(projectRoot, 'Game.rpgproject'))) {
    return 'mv'
  }
  if (hasWwwSubdir) return 'mv'
  // 兜底：MZ 的 System.json 通常含 advanced 对象或 optDrawTitle / battleSystem 字段
  try {
    const sys = JSON.parse(readFileSync(systemJsonPath, 'utf-8')) as Record<string, unknown>
    if (sys && typeof sys === 'object' && ('advanced' in sys || 'battleSystem' in sys)) {
      return 'mz'
    }
  } catch {
    /* ignore */
  }
  return 'mv'
}

/** 探测目录是否为完整的 RPG Maker MV / MZ 游戏目录 */
export function detectRpgProject(gameDir: string): DetectedProject | null {
  if (!gameDir) return null
  const absGameDir = resolve(gameDir)
  if (!existsSync(absGameDir)) return null

  const wwwDir = join(absGameDir, 'www')
  const wwwSys = join(wwwDir, 'data', 'System.json')
  const rootSys = join(absGameDir, 'data', 'System.json')

  let projectRoot: string
  let systemJsonPath: string
  let hasWwwSubdir: boolean

  if (existsSync(wwwSys)) {
    projectRoot = wwwDir
    systemJsonPath = wwwSys
    hasWwwSubdir = true
  } else if (existsSync(rootSys)) {
    projectRoot = absGameDir
    systemJsonPath = rootSys
    hasWwwSubdir = false
  } else {
    return null
  }

  const engine = inferEngineFromDir(projectRoot, systemJsonPath, hasWwwSubdir)
  const engineVersion = readEngineVersion(projectRoot, engine)

  let baseName = basename(absGameDir)
  if (baseName.toLowerCase() === 'www') {
    const parentName = basename(dirname(absGameDir))
    if (parentName) baseName = parentName
  }
  if (!baseName) baseName = 'game'

  return {
    engine,
    projectRoot,
    hasWwwSubdir,
    systemJsonPath,
    engineVersion,
    baseName
  }
}

/** 生成 `<原目录名>_project` 安全子目录名 */
export function makeProjectDirName(baseName: string): string {
  const cleaned = baseName
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  const base = cleaned || 'game'
  return base.toLowerCase().endsWith('_project') ? base : `${base}_project`
}

/** 判断顶层 locales/ 是否是 NW.js 自带的 Chromium .pak 语言目录（避免误跳过游戏自定义 locales/） */
async function isNwjsLocalesDir(dir: string): Promise<boolean> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    if (entries.length === 0) return false
    return entries.every((e) => e.isFile() && extname(e.name).toLowerCase() === '.pak')
  } catch {
    return false
  }
}

function shouldSkipRootFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (RUNTIME_ROOT_FILES.has(lower)) return true
  const ext = extname(lower).slice(1)
  return RUNTIME_ROOT_EXTS.has(ext)
}

function normForCompare(p: string): string {
  const abs = resolve(p)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const rel = relative(normForCompare(parent), normForCompare(candidate))
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && rel !== '..')
}

interface RelFile {
  absPath: string
  relPath: string
}

/** 收集 projectRoot 下需要拷贝的非加密工程文件 */
export async function collectProjectSourceFiles(
  info: DetectedProject,
  opts?: { signal?: AbortSignal; excludeDir?: string }
): Promise<RelFile[]> {
  const out: RelFile[] = []
  const rootAbs = resolve(info.projectRoot)
  const excludeAbs = opts?.excludeDir ? resolve(opts.excludeDir) : null
  const stack: Array<{ dir: string; isRoot: boolean }> = [{ dir: rootAbs, isRoot: true }]

  while (stack.length > 0) {
    if (opts?.signal?.aborted) throw new ProjectExportAbortedError()
    const { dir, isRoot } = stack.pop()!
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (opts?.signal?.aborted) throw new ProjectExportAbortedError()
      const abs = join(dir, entry.name)
      const lower = entry.name.toLowerCase()

      if (entry.isDirectory()) {
        if (excludeAbs && normForCompare(abs) === normForCompare(excludeAbs)) continue
        if (ALWAYS_SKIP_DIRS.has(lower)) continue
        if (isRoot && !info.hasWwwSubdir) {
          if (RUNTIME_ROOT_DIRS.has(lower)) continue
          if (lower === 'locales' && (await isNwjsLocalesDir(abs))) continue
        }
        stack.push({ dir: abs, isRoot: false })
      } else if (entry.isFile()) {
        if (isRoot && !info.hasWwwSubdir && shouldSkipRootFile(entry.name)) continue
        const ext = extname(entry.name).slice(1).toLowerCase()
        if (isEncryptedExtension(ext)) continue
        out.push({ absPath: abs, relPath: relative(rootAbs, abs) })
      }
    }
  }
  return out
}

/** 收集解密缓存中的明文资源，并映射为相对 projectRoot 的路径（自动剥离 MV 的 www/ 前缀） */
async function collectMappedCacheFiles(
  cacheDir: string,
  gameDir: string,
  info: DetectedProject,
  signal?: AbortSignal
): Promise<RelFile[]> {
  if (!cacheDir || !existsSync(cacheDir)) return []
  const out: RelFile[] = []
  const absGameDir = resolve(gameDir)
  const absProjectRoot = resolve(info.projectRoot)
  const stack = [resolve(cacheDir)]

  while (stack.length > 0) {
    if (signal?.aborted) throw new ProjectExportAbortedError()
    const dir = stack.pop()!
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (signal?.aborted) throw new ProjectExportAbortedError()
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(abs)
      } else if (entry.isFile()) {
        const relFromGame = relative(cacheDir, abs)
        // 把缓存相对路径先还原到原 gameDir 视角，再转成相对 projectRoot 的路径
        const virtualOrig = join(absGameDir, relFromGame)
        const relFromProject = relative(absProjectRoot, virtualOrig)
        if (!relFromProject || relFromProject.startsWith('..')) continue
        out.push({ absPath: abs, relPath: relFromProject })
      }
    }
  }
  return out
}

/** 关闭目标工程 data/System.json 中的加密标志 */
async function patchSystemJson(outputDir: string): Promise<boolean> {
  const sysPath = join(outputDir, 'data', 'System.json')
  if (!existsSync(sysPath)) return false
  try {
    const raw = await fsp.readFile(sysPath, 'utf-8')
    const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return false
    parsed.hasEncryptedImages = false
    parsed.hasEncryptedAudio = false
    await fsp.writeFile(sysPath, JSON.stringify(parsed), 'utf-8')
    return true
  } catch {
    return false
  }
}

/** 写入 Game.rpgproject / game.rmmzproject（若已存在则不覆盖） */
async function ensureProjectEntryFile(
  outputDir: string,
  info: DetectedProject
): Promise<{ fileName: string; created: boolean }> {
  const fileName = info.engine === 'mz' ? 'game.rmmzproject' : 'Game.rpgproject'
  const filePath = join(outputDir, fileName)
  if (existsSync(filePath)) {
    return { fileName, created: false }
  }
  const version = info.engineVersion ?? (info.engine === 'mz' ? '1.8.1' : '1.6.2')
  const content = info.engine === 'mz' ? `RPGMZ ${version}` : `RPGMV ${version}`
  await fsp.writeFile(filePath, content, 'utf-8')
  return { fileName, created: true }
}

/**
 * 将 RPG Maker MV / MZ 发行版导出为可直接用编辑器打开的工程目录。
 * 绝不修改原游戏目录，所有输出写入 `opts.outputDir`。
 */
export async function exportEditableProject(opts: ProjectExportOptions): Promise<ProjectExportResult> {
  const info = detectRpgProject(opts.gameDir)
  if (!info) {
    throw new Error('Not a valid RPG Maker MV/MZ game directory (missing data/System.json)')
  }

  const outputAbs = resolve(opts.outputDir)
  if (resolve(info.projectRoot) === outputAbs || isSameOrInside(info.projectRoot, outputAbs)) {
    throw new Error('Output directory cannot be the same as or an ancestor of the source game directory')
  }

  const signal = opts.signal
  const report = opts.onProgress

  let copied = 0
  let decrypted = 0
  let fail = 0
  const projectFileName = info.engine === 'mz' ? 'game.rmmzproject' : 'Game.rpgproject'

  try {
    const sourceFiles = await collectProjectSourceFiles(info, { signal, excludeDir: outputAbs })
    const cacheFiles = opts.decryptCacheDir
      ? await collectMappedCacheFiles(opts.decryptCacheDir, opts.gameDir, info, signal)
      : []

    const total = sourceFiles.length + cacheFiles.length
    await fsp.mkdir(outputAbs, { recursive: true })

    for (const f of sourceFiles) {
      if (signal?.aborted) break
      report?.(copied + decrypted + fail, total, copied + decrypted, fail, f.relPath)
      try {
        const target = join(outputAbs, f.relPath)
        await fsp.mkdir(dirname(target), { recursive: true })
        await fsp.copyFile(f.absPath, target)
        copied++
      } catch {
        fail++
      }
      report?.(copied + decrypted + fail, total, copied + decrypted, fail, f.relPath)
    }

    for (const f of cacheFiles) {
      if (signal?.aborted) break
      report?.(copied + decrypted + fail, total, copied + decrypted, fail, f.relPath)
      try {
        const target = join(outputAbs, f.relPath)
        await fsp.mkdir(dirname(target), { recursive: true })
        await fsp.copyFile(f.absPath, target)
        decrypted++
      } catch {
        fail++
      }
      report?.(copied + decrypted + fail, total, copied + decrypted, fail, f.relPath)
    }

    if (signal?.aborted) {
      return {
        canceled: true,
        engine: info.engine,
        projectFile: projectFileName,
        outputDir: outputAbs,
        copied,
        decrypted,
        ok: copied + decrypted,
        fail,
        systemPatched: false,
        projectFileCreated: false
      }
    }

    const systemPatched = await patchSystemJson(outputAbs)
    const entry = await ensureProjectEntryFile(outputAbs, info)

    return {
      canceled: false,
      engine: info.engine,
      projectFile: entry.fileName,
      outputDir: outputAbs,
      copied,
      decrypted,
      ok: copied + decrypted,
      fail,
      systemPatched,
      projectFileCreated: entry.created
    }
  } catch (e) {
    if (e instanceof ProjectExportAbortedError || signal?.aborted) {
      return {
        canceled: true,
        engine: info.engine,
        projectFile: projectFileName,
        outputDir: outputAbs,
        copied,
        decrypted,
        ok: copied + decrypted,
        fail,
        systemPatched: false,
        projectFileCreated: false
      }
    }
    throw e
  }
}
