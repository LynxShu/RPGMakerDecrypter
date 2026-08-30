/**
 * 语言包目录热监视（main 进程，零新依赖 —— 用 Node 内置 fs.watch）。
 *
 * 蓝图 §11.1：语言包"即插即用"的最后一环——放入新语言包文件（或修改/删除），
 * 下拉框立即出现并热切换，无需重启应用。
 *
 * 设计：
 * - 同时监视多个目录（内置 app.asar/locales + 用户 userData/locales），
 *   靠后的目录优先级更高（同名 code 覆盖内置），见 i18nLoader.scanLocaleDirs；
 * - `fs.watch(dir)` 监听目录级事件（新增/删除/改名/内容变化都会触发 rename/change）；
 * - 收到事件后**防抖**（默认 250ms）再重新扫描，避免编辑器保存时多次触发；
 * - 重扫后 diff（added/removed/updated），删除→removeBundle，新增/更新已由扫描注册；
 * - 变更集回调 `onChanged(changes)` 由主进程广播给渲染层刷新下拉框与文案。
 *
 * 注：chokidar 在蓝图里被点名，但项目保持"零依赖或极轻度"（蓝图 §11.2），
 * locales/ 是单层小目录，fs.watch + 防抖重扫足够可靠且无安装负担。
 */
import { existsSync } from 'node:fs'
import { watch, type FSWatcher } from 'node:fs'
import { scanLocaleDirs, type I18nApi } from './i18nLoader'
import { diffLocaleSets, type LocaleChangeSet } from '@lib/i18n'

export type { LocaleChangeSet }

export interface LocaleWatcherOptions {
  /** 事件防抖毫秒数（默认 250） */
  debounceMs?: number
}

export interface LocaleWatcher {
  /** 当前已注册的语言 code 列表（合并后） */
  codes(): string[]
  /** 立即重扫一次并应用变更（测试/手动刷新用） */
  rescan(): LocaleChangeSet
  /** 停止监视并释放 watcher */
  close(): void
}

/**
 * 监视多个语言包目录，变化时自动注册/移除并回调。
 *
 * @param i18n      已创建的 i18n 实例（含内置语言包）
 * @param dirs      要监视的语言包目录（靠后的优先级更高）
 * @param onChanged 变更回调（防抖后触发，含 added/removed/updated）
 */
export function watchLocalesDir(
  i18n: I18nApi,
  dirs: string[],
  onChanged: (changes: LocaleChangeSet) => void,
  opts: LocaleWatcherOptions = {}
): LocaleWatcher {
  const debounceMs = opts.debounceMs ?? 250
  const watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | null = null
  let closed = false

  /** 当前已注册的 code → 原始文件内容（合并后，用于 diff 出 updated） */
  let known = new Map<string, string>()

  /** 重扫全部目录并 diff，应用变更，返回变更集 */
  function rescan(): LocaleChangeSet {
    const onDisk = scanLocaleDirs(i18n, dirs)
    const changes = diffLocaleSets(known, onDisk)
    known = onDisk
    for (const c of changes.removed) i18n.removeBundle(c)
    if (changes.added.length > 0 || changes.removed.length > 0 || changes.updated.length > 0) {
      onChanged(changes)
    }
    return changes
  }

  function scheduleRescan(): void {
    if (closed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      rescan()
    }, debounceMs)
  }

  // 首次扫描：注册合并后的全部语言包（也作为 initial known 快照）
  known = scanLocaleDirs(i18n, dirs)

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    try {
      const watcher = watch(dir, { persistent: false }, (_event, filename) => {
        // 非 .json 文件的变化忽略（如编辑器临时文件）
        if (filename && !String(filename).endsWith('.json')) return
        scheduleRescan()
      })
      watcher.on('error', (err) => {
        console.warn(`[i18n] 语言包监视出错: ${err?.message ?? err}`)
      })
      watchers.push(watcher)
    } catch (err) {
      console.warn(`[i18n] 无法监视语言包目录 ${dir}: ${err}`)
    }
  }

  return {
    codes: () => [...known.keys()],
    rescan,
    close: () => {
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
      for (const w of watchers) w.close()
      watchers.length = 0
    }
  }
}
