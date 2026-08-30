import { app, shell, BrowserWindow, ipcMain, dialog, type IpcMainInvokeEvent } from 'electron'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  promises as fsp
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createI18n } from '@lib/i18n'
import { Decrypter, detectMagicKind, encryptExtFor, RESTORE_IMAGE_EXTENSIONS } from '@lib/crypto'
import JSZip from 'jszip'
import { scanLocaleDirs } from './i18nLoader'
import { watchLocalesDir } from './i18nWatcher'
import { findEncryptionKey, listFilesByExt, streamEncryptedFiles } from './project'
import { runDecryptJobs } from './decryptPool'
import { targetRelPath, type DecryptJob } from './decryptCore'
import { findSaveFiles, loadSave, writeSave, type SaveFileInfo } from './saveCore'
import { createHistoryStore } from './historyStore'
import { createConfigStore, type AppConfig } from './configStore'
import { loadMergedSchema } from './schemaLoader'
import type { SaveKind } from '@lib/save'

const i18n = createI18n({ defaultLocale: 'zh-Hans', fallbackLocale: 'en' })

// 当前进行中的任务取消控制器（一次只允许一个扫描/一个导出/一个批量工具进行）
let scanController: AbortController | null = null
let exportController: AbortController | null = null
let toolController: AbortController | null = null

// 最近项目/密钥历史（bootstrap 时按 userData 路径创建）
let history = createHistoryStore(join(app.getPath('userData'), 'history.json'))

// 应用偏好（locale / theme 持久化，蓝图 §11.1「选择写入 config」）
let config = createConfigStore(join(app.getPath('userData'), 'config.json'))

// locales/ 热监视（蓝图 §11.1：放入新语言包即热切换）
let localeWatcher: ReturnType<typeof watchLocalesDir> | null = null

/** 解密结果缓存根目录（temp/rpgmaker-decrypter，其下每个会话一个 decrypt-<uuid> 子目录） */
function decryptCacheRoot(): string {
  return join(app.getPath('temp'), 'rpgmaker-decrypter')
}

/** 当前会话的解密缓存目录：点击「开始解密」把解密结果落到这里，导出时再从缓存拷走/打包 */
let decryptCacheDir: string | null = null
function clearDecryptCache(): void {
  if (decryptCacheDir && existsSync(decryptCacheDir)) {
    try {
      rmSync(decryptCacheDir, { recursive: true, force: true })
    } catch {
      /* 清理失败不致命 */
    }
  }
  decryptCacheDir = null
}

/** 异步、非阻塞地清扫解密缓存根目录下「非当前会话」的残留 decrypt-<uuid> 目录。
 *  改为异步：避免上次运行/异常退出留下大量文件时，启动时同步 rmSync 卡住主线程，
 *  导致窗口迟迟不显示（表现为「点了没界面、进程却在跑」）。只清非当前会话目录，避免误删进行中的缓存。 */
async function sweepStaleDecryptCache(): Promise<void> {
  const root = decryptCacheRoot()
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => [] as Array<{ name: string; isDirectory(): boolean }>)
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.startsWith('decrypt-')) continue
      const full = join(root, e.name)
      if (full === decryptCacheDir) continue
      try {
        await fsp.rm(full, { recursive: true, force: true })
      } catch {
        /* 单个目录清理失败不致命 */
      }
    }
  } catch {
    /* 根目录不存在等情况忽略 */
  }
}

function getDecryptCacheDir(): string {
  if (!decryptCacheDir || !existsSync(decryptCacheDir)) {
    clearDecryptCache()
    decryptCacheDir = join(decryptCacheRoot(), `decrypt-${randomUUID()}`)
    mkdirSync(decryptCacheDir, { recursive: true })
  }
  return decryptCacheDir
}
/** 导出任务中止（把 AbortSignal 转成可识别的异常） */
class ExportAbortedError extends Error {
  constructor() {
    super('export aborted')
    this.name = 'ExportAbortedError'
  }
}

/** 待导出的缓存文件 */
interface CacheFile {
  absPath: string
  /** 相对缓存根目录的路径（原生分隔符） */
  relPath: string
}

/** 递归收集目录下所有文件（异步，仅读元数据，不读内容） */
async function collectCacheFiles(dir: string, signal: AbortSignal): Promise<CacheFile[]> {
  const out: CacheFile[] = []
  const walk = async (src: string, base: string): Promise<void> => {
    if (signal.aborted) throw new ExportAbortedError()
    const entries = await fsp.readdir(src, { withFileTypes: true })
    for (const e of entries) {
      if (signal.aborted) throw new ExportAbortedError()
      const abs = join(src, e.name)
      const rel = base ? join(base, e.name) : e.name
      if (e.isDirectory()) await walk(abs, rel)
      else if (e.isFile()) out.push({ absPath: abs, relPath: rel })
    }
  }
  await walk(dir, '')
  return out
}

/** 向所有窗口广播语言包变化（渲染层刷新下拉框与文案） */
function broadcastI18nChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('i18n:changed', {
      locales: i18n.getAvailableLocales(),
      current: i18n.getLocale()
    })
  }
}

// ---- 无边框窗口：Windows 上保留系统原生窗口控制按钮（titleBarOverlay），颜色随主题 ----
const OVERLAY_COLORS: Record<'light' | 'dark', { color: string; symbolColor: string }> = {
  light: { color: '#f6f7f9', symbolColor: '#1b2430' },
  dark: { color: '#12151b', symbolColor: '#e8ebf1' }
}

/** 解析配置中的主题为 overlay 用色（system/未配置 → dark，与渲染层「固定深色」默认一致） */
function resolveOverlayTheme(theme: AppConfig['theme']): 'light' | 'dark' {
  return theme === 'light' ? 'light' : 'dark'
}

/**
 * 语义化版本比较：返回 a - b（>0 表示 a 比 b 新，<0 表示旧，0 相等）。
 * 忽略前导 `v`，按点分段转数字逐段比较，段数不足按 0 补齐（如 1.0.1 == 1.0.1.0）。
 * 用于更新检查：仅当线上最新版严格大于当前版本时才提示有更新，避免误报。
 */
function cmpVersion(a: string, b: string): number {
  const pa = a.trim().replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.trim().replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}

/** 让窗口的系统窗口控制按钮颜色跟随主题（仅 Windows titleBarOverlay 生效） */
function applyTitleBarOverlay(win: BrowserWindow, theme: AppConfig['theme']): void {
  if (process.platform !== 'win32') return
  try {
    win.setTitleBarOverlay({ ...OVERLAY_COLORS[resolveOverlayTheme(theme)], height: 40 })
  } catch {
    /* 低版本/非 Windows 忽略 */
  }
}

// ---- 批量工具（加密 / 图片还原）：文件清单 + 输出目录 + 进度推送 + 可取消 ----
interface ToolFile {
  absPath: string
  relPath: string
  ext: string
  size: number
}

interface ToolBatchResult {
  canceled: boolean
  ok: number
  fail: number
  skip: number
  outputDir?: string
}

/** 求多个文件的共同父目录（回退到第一个文件的目录） */
function commonRoot(files: ToolFile[]): string {
  let base = dirname(files[0].absPath)
  for (const f of files) {
    const d = dirname(f.absPath)
    while (d !== base && !d.startsWith(base + sep) && base !== dirname(base)) base = dirname(base)
  }
  return base
}

/**
 * 批量处理：输出目录未指定时弹窗选择；用户取消则自动在源同级生成
 * `<源目录名>_encrypted` / `<源目录名>_restored`（加后缀，不覆盖）。
 * 逐文件处理并推送 `tool:progress`（含成功/失败/跳过统计与当前文件），可取消。
 */
async function runToolBatch(
  event: IpcMainInvokeEvent,
  files: ToolFile[],
  outputDir: string | null,
  kind: 'encrypt' | 'restore',
  opts: { key?: string; version?: 'mv' | 'mz' } = {}
): Promise<ToolBatchResult> {
  if (!Array.isArray(files) || files.length === 0) return { canceled: false, ok: 0, fail: 0, skip: 0 }
  if (kind === 'encrypt' && !opts.key) {
    return { canceled: false, ok: 0, fail: files.length, skip: 0 }
  }

  // 输出目录：未指定 → 弹窗；取消 → 自动同级目录加后缀
  let outDir = outputDir
  if (!outDir) {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (!res.canceled && res.filePaths[0]) outDir = res.filePaths[0]
  }
  if (!outDir) {
    const base = commonRoot(files)
    outDir = join(dirname(base), `${basename(base)}${kind === 'encrypt' ? '_encrypted' : '_restored'}`)
  }
  mkdirSync(outDir, { recursive: true })

  toolController?.abort()
  const controller = new AbortController()
  toolController = controller

  const total = files.length
  let ok = 0
  let fail = 0
  let skip = 0
  let current = ''
  const report = (): void => {
    if (event.sender.isDestroyed()) return
    event.sender.send('tool:progress', { done: ok + fail + skip, total, ok, fail, skip, current })
  }

  try {
    for (const f of files) {
      if (controller.signal.aborted) break
      current = f.relPath
      report()
      try {
        const data = new Uint8Array(readFileSync(f.absPath))
        let out: Uint8Array
        let rel = f.relPath
        if (kind === 'restore') {
          if (!RESTORE_IMAGE_EXTENSIONS.includes(f.ext.toLowerCase())) {
            skip++
            report()
            continue
          }
          out = new Decrypter(null).restorePngHeader(data)
          rel = rel.replace(/\.(rpgmvp|png_)$/i, '.png')
        } else {
          const encExt = encryptExtFor(opts.version ?? 'mv', f.ext)
          if (!encExt) {
            skip++
            report()
            continue
          }
          out = new Decrypter(opts.key ?? '').encrypt(data)
          rel = rel.replace(/\.[^.]+$/, `.${encExt}`)
        }
        const target = join(outDir, rel)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, out)
        ok++
      } catch {
        fail++
      }
      report()
    }
  } finally {
    toolController = null
  }

  return { canceled: controller.signal.aborted, ok, fail, skip, outputDir: outDir }
}

function setupIpc(): void {
  ipcMain.handle('i18n:available', () => i18n.getAvailableLocales())
  ipcMain.handle('i18n:current', () => i18n.getLocale())
  ipcMain.handle('i18n:set', (_e, locale: string) => {
    i18n.setLocale(locale)
    config.set({ locale })
    // 广播语言变化：渲染层据此刷新静态文案（data-i18n）与存档编辑器的缓存标签
    broadcastI18nChanged()
    return i18n.getLocale()
  })
  ipcMain.handle('i18n:t', (_e, key: string, params?: Record<string, string | number>) =>
    i18n.t(key, params)
  )
  // 批量翻译：一次取多个 key（渲染层渲染 schema 字段/组标题时避免逐字段 IPC 往返）
  ipcMain.handle('i18n:tMany', (_e, keys: string[]) => {
    const out: Record<string, string> = {}
    if (!Array.isArray(keys)) return out
    for (const k of keys) {
      if (typeof k === 'string') out[k] = i18n.t(k)
    }
    return out
  })
  ipcMain.handle('app:version', () => app.getVersion())

  // ---- 顶栏工具：GitHub 仓库 / 更新检查 ----
  ipcMain.handle('app:openGitHub', async () => {
    await shell.openExternal('https://github.com/LynxShu/RPGMakerDecrypter')
  })

  // 通用外链（更新下载按钮等）
  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
    }
  })

  // 更新检查：读取 GitHub releases.atom 订阅源（而非 REST API）。
  // 原因：REST API 对未认证请求有 60 次/小时/IP 的速率限制，若用户走代理/共享出口，
  // 很容易被共享该 IP 的其他请求用满而返回 403（"API rate limit exceeded"），
  // 导致「检查更新」一直失败。Atom 订阅源不受该速率限制，且每条 <entry> 以最新发布在前。
  // 网络不可用/请求失败 → 返回 error（UI 静默提示，不打扰）。
  ipcMain.handle('app:checkUpdate', async () => {
    try {
      const res = await fetch('https://github.com/LynxShu/RPGMakerDecrypter/releases.atom', {
        headers: { Accept: 'application/atom+xml' },
        signal: AbortSignal.timeout(15000)
      })
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` }
      const xml = await res.text()
      // 取第一个 <entry>（= 最新发布）里的版本号：<id> 形如
      //   tag:github.com,2008:Repository/.../releases/tag/v1.0.1
      // 退而求其次用 <title>（通常也是 tag）。
      const latestTag =
        /<entry>[\s\S]*?<id>tag:[^<]*?\/releases\/tag\/([^<]+)<\/id>/.exec(xml)?.[1] ||
        /<entry>[\s\S]*?<title>([^<]+)<\/title>/.exec(xml)?.[1] ||
        ''
      const latest = latestTag.trim().replace(/^v/, '')
      const current = app.getVersion().trim().replace(/^v/, '')
      // 语义化版本比较：仅当「线上最新版 严格大于 当前版本」才提示更新；
      // 相等/更旧一律视为已是最新（否则裸字符串 !== 会在 v1.0.1 vs 1.0.1、
      // 或线上还是旧版 1.0.0 时误报「有新版本」）。
      const hasUpdate = latest.length > 0 && cmpVersion(latest, current) > 0
      return {
        ok: true as const,
        hasUpdate,
        latest: latestTag.trim(),
        url: `https://github.com/LynxShu/RPGMakerDecrypter/releases`,
        current: app.getVersion()
      }
    } catch (e) {
      return { ok: false as const, error: String((e as Error).message) }
    }
  })

  // ---- 应用偏好（locale / theme 持久化，蓝图 §11.1） ----
  ipcMain.handle('config:get', () => config.get())
  ipcMain.handle('config:set', (_e, patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...config.get() }
    if (typeof patch?.locale === 'string') next.locale = patch.locale
    if (patch?.theme === 'light' || patch?.theme === 'dark' || patch?.theme === 'system') {
      next.theme = patch.theme
    }
    config.set(next)
    // 主题变化 → 同步无边框窗口的系统窗口控制按钮颜色
    if (typeof patch?.theme === 'string') {
      for (const win of BrowserWindow.getAllWindows()) {
        applyTitleBarOverlay(win, patch.theme as AppConfig['theme'])
      }
    }
    return config.get()
  })

  // ---- M1: 目录选择 / 扫描 / 预览 / 导出 ----
  ipcMain.handle('dialog:selectDir', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  // 通用文件选择（加密 / 救图用）
  ipcMain.handle('dialog:pickFile', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openFile'] })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })

  // 打开文件夹（「打开输出目录」按钮用）
  ipcMain.handle('app:openPath', async (_e, p: string) => {
    if (typeof p !== 'string' || !p) return false
    try {
      await shell.openPath(p)
      return true
    } catch {
      return false
    }
  })

  // 列出目录下指定扩展名的文件（加密/图片还原批量用，跳过 node_modules/.git 等）
  ipcMain.handle('tool:listFiles', (_e, dir: string, exts: string[]) => {
    if (typeof dir !== 'string' || !Array.isArray(exts) || exts.length === 0) return []
    return listFilesByExt(dir, new Set(exts.map((e) => String(e).toLowerCase())))
  })

  // 批量加密：明文 → 加密（MV/MZ 决定输出扩展名），可取消、带进度
  ipcMain.handle('tool:encryptMany', (event, files: ToolFile[], key: string, version: 'mv' | 'mz', outputDir: string | null) =>
    runToolBatch(event, files, outputDir, 'encrypt', { key, version })
  )

  // 批量无密钥救图：去假头+加密头补标准 PNG 头，可取消、带进度
  ipcMain.handle('tool:restoreMany', (event, files: ToolFile[], outputDir: string | null) =>
    runToolBatch(event, files, outputDir, 'restore')
  )

  // 流式扫描：立即返回 jobId，结果分批经 project:scanBatch 推送，结束发 project:scanDone（渐进渲染）。
  ipcMain.handle('project:scanStart', async (event, dir: string, jobId?: string) => {
    scanController?.abort()
    const controller = new AbortController()
    scanController = controller
    const jid = jobId || randomUUID()
    const sender = event.sender
    // 后台并行计算密钥（System.json / rpg_core.js / 加密头反推）
    const keyPromise = Promise.resolve()
      .then(() => findEncryptionKey(dir))
      .catch(() => null)

    void (async () => {
      let found = 0
      // 保存第一批文件用于 key 预检（解密第一个文件验证魔数，提前暴露密钥错误）
      let samplePath: string | null = null
      try {
        for await (const batch of streamEncryptedFiles(dir, controller.signal)) {
          if (sender.isDestroyed()) return
          if (!samplePath && batch.length > 0) samplePath = batch[0].absPath
          found += batch.length
          sender.send('project:scanBatch', { jobId: jid, files: batch, found, done: false })
          // 让出事件循环，避免推送过快而压垮渲染进程
          await new Promise((r) => setImmediate(r))
        }
      } catch {
        /* ignore */
      }
      if (sender.isDestroyed()) return
      const key = controller.signal.aborted ? null : await keyPromise
      // key 预检：解密第一个加密文件，魔数通过则 key 大概率正确（不用等导出才知道）
      let keyOk: boolean | null = null
      if (!controller.signal.aborted && key?.key && samplePath) {
        try {
          const dec = new Decrypter(key.key).decrypt(new Uint8Array(readFileSync(samplePath)))
          keyOk = detectMagicKind(dec) !== null
        } catch {
          keyOk = false
        }
      }
      // 记录最近项目（含密钥，便于快速重开）
      if (!controller.signal.aborted && key?.key) {
        history.add({
          kind: 'project',
          path: dir,
          label: basename(dir),
          key: key.key,
          keySource: key.source ?? undefined
        })
      }
      sender.send('project:scanDone', {
        jobId: jid,
        found,
        key: key?.key ?? null,
        keySource: key?.source ?? null,
        keyOk,
        canceled: controller.signal.aborted
      })
    })()

    return { jobId: jid }
  })

  // 取消任务
  ipcMain.handle('task:cancelScan', () => {
    scanController?.abort()
    scanController = null
  })
  ipcMain.handle('task:cancelExport', () => {
    exportController?.abort()
    exportController = null
  })
  ipcMain.handle('task:cancelTool', () => {
    toolController?.abort()
    toolController = null
  })

  // 解密到缓存：「开始解密」把解密结果落到临时缓存，展示进度/统计；导出时再从缓存拷走或打包
  ipcMain.handle('decode:process', async (event, files: Array<{ absPath: string; relPath: string; ext: string }>, key: string) => {
    exportController?.abort()
    const controller = new AbortController()
    exportController = controller
    clearDecryptCache()
    const dir = getDecryptCacheDir()
    const total = files.length
    const report = (done: number, _t: number, ok: number, fail: number, current?: string): void => {
      event.sender.send('export:progress', { done, total, ok, fail, current })
    }
    const jobs: DecryptJob[] = files.map((f, i) => ({
      id: i,
      absPath: f.absPath,
      relPath: f.relPath,
      ext: f.ext,
      key,
      outPath: join(dir, targetRelPath(f.relPath, f.ext))
    }))
    let summary
    try {
      summary = await runDecryptJobs(jobs, { signal: controller.signal }, report)
    } finally {
      // 无论成功/取消/异常都清掉控制器，避免残留引用阻塞下次；
      // 仅当仍是自己时清空，避免把后来新起的导出控制器误清
      if (exportController === controller) exportController = null
    }
    const magicFail = summary.results.filter((r) => r.magicOk === false).length
    return { canceled: summary.canceled, ok: summary.ok, fail: summary.fail, magicFail }
  })

  // 把缓存里的解密结果异步拷到用户选择的目录（逐文件，可取消、带进度）
  ipcMain.handle('decode:exportFiles', async (event) => {
    const dir = decryptCacheDir
    if (!dir || !existsSync(dir)) return { canceled: false as const, ok: 0, fail: 0, magicFail: 0, outputDir: '' }
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled) return { canceled: true as const, ok: 0, fail: 0, magicFail: 0, outputDir: '' }
    const outputDir = res.filePaths[0]

    exportController?.abort()
    const controller = new AbortController()
    exportController = controller
    const report = (done: number, total: number, ok: number, fail: number, current?: string): void => {
      if (event.sender.isDestroyed()) return
      event.sender.send('export:progress', { done, total, ok, fail, current })
    }
    let ok = 0
    let fail = 0
    try {
      const files = await collectCacheFiles(dir, controller.signal)
      const total = files.length
      for (const f of files) {
        if (controller.signal.aborted) break
        report(ok + fail, total, ok, fail, f.relPath)
        try {
          const target = join(outputDir, f.relPath)
          await fsp.mkdir(dirname(target), { recursive: true })
          await fsp.copyFile(f.absPath, target)
          ok++
        } catch {
          fail++
        }
        report(ok + fail, total, ok, fail, f.relPath)
      }
      return { canceled: controller.signal.aborted, ok, fail, magicFail: 0, outputDir }
    } catch (e) {
      if (e instanceof ExportAbortedError) {
        return { canceled: true, ok, fail, magicFail: 0, outputDir }
      }
      return { canceled: false, ok, fail, magicFail: 0, outputDir }
    } finally {
      if (exportController === controller) exportController = null
    }
  })

  // 把缓存里的解密结果流式打包成 ZIP（流式读写，不把全部文件塞进内存；可取消、带进度）
  ipcMain.handle('decode:exportZip', async (event) => {
    const dir = decryptCacheDir
    if (!dir || !existsSync(dir)) return { canceled: false as const, ok: 0, fail: 0, magicFail: 0, outputDir: '' }
    const res = await dialog.showSaveDialog({
      title: '导出 ZIP',
      defaultPath: 'export.zip',
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    })
    if (res.canceled) return { canceled: true as const, ok: 0, fail: 0, magicFail: 0, outputDir: '' }
    const outFile = res.filePath

    exportController?.abort()
    const controller = new AbortController()
    exportController = controller
    const report = (done: number, total: number, ok: number, current?: string): void => {
      if (event.sender.isDestroyed()) return
      event.sender.send('export:progress', { done, total, ok, fail: 0, current })
    }

    try {
      const files = await collectCacheFiles(dir, controller.signal)
      const total = files.length
      if (controller.signal.aborted) {
        return { canceled: true, ok: 0, fail: 0, magicFail: 0, outputDir: outFile }
      }

      const zip = new JSZip()
      for (const f of files) {
        if (controller.signal.aborted) break
        // 传 ReadStream + streamFiles：让 JSZip 边读边打包，而非 readFileSync 全量塞内存
        zip.file(f.relPath.split(sep).join('/'), createReadStream(f.absPath))
      }
      if (controller.signal.aborted) {
        return { canceled: true, ok: 0, fail: 0, magicFail: 0, outputDir: outFile }
      }

      report(0, total, 0, '打包 ZIP… 0%')
      let lastPct = -1
      const stream = zip.generateNodeStream(
        { streamFiles: true, compression: 'DEFLATE' },
        (meta) => {
          const pct = Math.round(meta.percent)
          if (pct === lastPct) return
          lastPct = pct
          const done = Math.round((pct / 100) * total)
          report(done, total, done, `打包 ZIP… ${pct}%`)
        }
      )
      // pipeline 把 ZIP 流式写盘；signal 中止时自动销毁两端流并抛 AbortError
      await pipeline(stream, createWriteStream(outFile), { signal: controller.signal })
      if (controller.signal.aborted) {
        try { rmSync(outFile, { force: true }) } catch { /* 忽略 */ }
        return { canceled: true, ok: 0, fail: 0, magicFail: 0, outputDir: outFile }
      }
      return { canceled: false, ok: total, fail: 0, magicFail: 0, outputDir: outFile }
    } catch (e) {
      if (controller.signal.aborted || e instanceof ExportAbortedError) {
        try { rmSync(outFile, { force: true }) } catch { /* 忽略 */ }
        return { canceled: true, ok: 0, fail: 0, magicFail: 0, outputDir: outFile }
      }
      // 打包/写盘失败（磁盘满、流错误等）：删除残留文件
      try { rmSync(outFile, { force: true }) } catch { /* 忽略 */ }
      return { canceled: false, ok: 0, fail: 0, magicFail: 0, outputDir: outFile }
    } finally {
      if (exportController === controller) exportController = null
    }
  })

  // 重置：清空解密缓存
  ipcMain.handle('decode:clearCache', () => {
    clearDecryptCache()
  })

  // ---- 最近项目/密钥历史 + schema 字段 ----
  ipcMain.handle('history:list', () => history.list())
  ipcMain.handle('history:add', (_e, kind: 'project' | 'save', path: string, label?: string, key?: string, keySource?: string) => {
    if (kind !== 'project' && kind !== 'save') return history.list()
    history.add({ kind, path, label: label || basename(path), key, keySource })
    return history.list()
  })
  ipcMain.handle('history:remove', (_e, id: string) => {
    history.remove(id)
    return history.list()
  })
  ipcMain.handle('history:clear', () => history.clear())

  // schema 字段（蓝图 §11.4-1）：渲染层用它渲染插件自定义字段
  ipcMain.handle('schema:list', () => loadMergedSchema(join(app.getAppPath(), 'schema')))

  // ---- M2: 存档编辑器 ----
  // 选存档目录（游戏根目录或 save/ 目录均可）：返回目录与其中的存档文件列表
  ipcMain.handle('save:openDir', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    return { dir, files: findSaveFiles(dir) as SaveFileInfo[] }
  })

  // 直接扫描给定目录中的存档文件（拖放目录用）
  ipcMain.handle('save:scanDir', (_e, dir: string) => findSaveFiles(dir) as SaveFileInfo[])

  // 选单个存档文件
  ipcMain.handle('save:openFile', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'RPG Maker Saves', extensions: ['rpgsave', 'rmmzsave'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return { file: res.filePaths[0] }
  })

  // 解码加载存档（读文件 → codec 解码 → contents）
  ipcMain.handle('save:load', (_e, absPath: string) => {
    const loaded = loadSave(absPath)
    // 记录最近存档
    history.add({ kind: 'save', path: absPath, label: basename(absPath) })
    return loaded
  })

  // 编码写回存档（先备份原文件）
  ipcMain.handle('save:write', (_e, absPath: string, contents: unknown, kind: SaveKind) =>
    writeSave(absPath, contents, kind)
  )
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    title: 'RPG Maker Decrypter',
    // 无边框沉浸式：macOS 保留红绿灯（hiddenInset），Windows 用 titleBarOverlay 保留原生窗口控制按钮
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32'
      ? { titleBarOverlay: { ...OVERLAY_COLORS[resolveOverlayTheme(config.get().theme)], height: 40 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 兜底：若 ready-to-show 迟迟不触发（渲染器加载慢/异常），超时后也强制显示，
  // 避免出现「进程在跑但窗口一直不显示」的无窗口启动（show:false 需靠 ready-to-show 才显示）。
  const forceShowTimer = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }, 2500)
  win.on('closed', () => clearTimeout(forceShowTimer))

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

async function bootstrap(): Promise<void> {
  // 语言包目录：内置（asar / 项目 locales）+ 用户自定义（userData/locales，后加载可覆盖同名 code）。
  // 打包后内置在只读 asar 里，用户自定义目录才是「丢一个 json 即多一种语言」的可写入口。
  const builtinLocales = join(app.getAppPath(), 'locales')
  const userLocales = join(app.getPath('userData'), 'locales')
  mkdirSync(userLocales, { recursive: true })
  // 首次启动把内置语言模版复制到用户目录（之后不覆盖，保留用户已改内容），
  // 打包版用户可直接复制该文件改名做成新语言（见 README「自定义语言包」）
  const builtinTemplate = join(builtinLocales, '_template.json')
  const userTemplate = join(userLocales, '_template.json')
  if (!existsSync(userTemplate) && existsSync(builtinTemplate)) {
    try {
      copyFileSync(builtinTemplate, userTemplate)
    } catch (err) {
      console.warn('[i18n] 复制语言模版失败（忽略）', err)
    }
  }
  scanLocaleDirs(i18n, [builtinLocales, userLocales])

  // 应用偏好：恢复上次语言 / 主题（蓝图 §11.1「选择写入 config」）
  // 注：必须在语言包加载之后恢复，否则 hasLocale 恒为 false
  const saved = config.get()
  if (saved.locale && i18n.hasLocale(saved.locale)) {
    i18n.setLocale(saved.locale)
  } else if (saved.locale) {
    // 语言包已被热删除：回退默认并清掉失效偏好
    config.set({ locale: undefined })
  }

  // 热监视内置 + 用户语言包目录：放入/修改/删除 → 立即生效并广播给渲染层（蓝图 §11.1）
  localeWatcher = watchLocalesDir(i18n, [builtinLocales, userLocales], () => {
    broadcastI18nChanged()
  })

  // 启动时清掉上次残留的解密缓存目录（异步非阻塞，不挡住窗口显示；decryptCacheDir 在新进程里为空，
  // 直接删父目录下所有 decrypt-<uuid> 子目录即可清掉上一会话残留）
  void sweepStaleDecryptCache()

  setupIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

// ---- 单实例锁：修复「双击/多次启动堆积无窗口后台进程」----
// 之前没有单实例锁：用户点叉关闭窗口后，主进程有时不会随窗口一起退出（window-all-closed
// 在打包版偶发未走到 app.quit()），残留一个无窗口的主进程；此时再次双击 exe 会新起一个完整
// 实例，而新实例的窗口若 ready-to-show 未触发（show:false 就永远不显示），就表现为
// 「没界面、进程却越堆越多」，最终完全打不开。
// 加锁后：后启动的实例立即退出并聚焦/重建第一个实例的窗口，彻底消除进程堆积。
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  // 已有实例在运行：本实例不再启动窗口，直接退出（由第二个实例把已有窗口带到前台）
  // 用 app.exit() 而非 app.quit()：第二实例没有窗口，无需走完整关闭流程，立即退出避免短暂残留。
  app.exit(0)
} else {
  app.on('second-instance', () => {
    let win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed()) {
      // 主进程仍在但窗口已不存在（如之前点叉只关了窗口）→ 重建一个
      try {
        win = createWindow()
      } catch {
        return
      }
    }
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(bootstrap)
}

// 退出时清理当前会话的解密缓存 + 关闭语言包监视，避免残留句柄
app.on('will-quit', () => {
  clearDecryptCache()
  localeWatcher?.close()
  localeWatcher = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
