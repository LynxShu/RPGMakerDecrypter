import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { HistoryEntry, HistoryKind } from '../lib/history'
import type { SaveSchema } from '../lib/save/schema'

export interface AvailableLocale {
  code: string
  name: string
  direction: 'ltr' | 'rtl'
}

export interface ScannedFile {
  absPath: string
  relPath: string
  ext: string
  size: number
  encrypted: boolean
}

export interface ScanStartResult {
  jobId: string
}

export interface ScanBatchPayload {
  jobId: string
  files: ScannedFile[]
  found: number
  done: boolean
}

export interface ScanDonePayload {
  jobId: string
  found: number
  key: string | null
  keySource: string | null
  /** key 预检结果：解密第一个加密文件后魔数是否通过（null=未验证，如无 key/无文件） */
  keyOk?: boolean | null
  canceled: boolean
}

export interface ExportResult {
  canceled: boolean
  /** 处理/导出涉及的文件总数 */
  scanned?: number
  ok: number
  fail: number
  /** 解密成功但魔数与期望类型不符的文件数（大概率 key 错误） */
  magicFail?: number
  outputDir?: string
}

// ---- M2: 存档编辑器 ----
export type SaveKind = 'mv' | 'mz'

export interface SaveFileInfo {
  absPath: string
  name: string
  ext: string
  kind: SaveKind | null
  size: number
}

export interface OpenSaveDirResult {
  dir: string
  files: SaveFileInfo[]
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

export interface I18nChangedPayload {
  locales: AvailableLocale[]
  current: string
}

export interface AppConfig {
  locale?: string
  theme?: 'light' | 'dark' | 'system'
}

export interface UpdateCheckResult {
  ok: boolean
  hasUpdate?: boolean
  latest?: string
  url?: string
  current?: string
  error?: string
}

// ---- 批量工具（加密 / 图片还原） ----
export interface ToolFile {
  absPath: string
  relPath: string
  ext: string
  size: number
}

export interface ToolProgressPayload {
  done: number
  total: number
  ok: number
  fail: number
  skip: number
  /** 当前正在处理的文件 relPath */
  current?: string
}

export interface ToolBatchResult {
  canceled: boolean
  ok: number
  fail: number
  skip: number
  outputDir?: string
}

const api = {
  getAvailableLocales: (): Promise<AvailableLocale[]> => ipcRenderer.invoke('i18n:available'),
  getCurrentLocale: (): Promise<string> => ipcRenderer.invoke('i18n:current'),
  setLocale: (locale: string): Promise<string> => ipcRenderer.invoke('i18n:set', locale),
  t: (key: string, params?: Record<string, string | number>): Promise<string> =>
    ipcRenderer.invoke('i18n:t', key, params),
  /** 批量翻译：一次取多个 key（渲染 schema 字段/组标题时避免逐字段 IPC） */
  tMany: (keys: string[]): Promise<Record<string, string>> => ipcRenderer.invoke('i18n:tMany', keys),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  openGitHub: (): Promise<void> => ipcRenderer.invoke('app:openGitHub'),
  checkUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('app:checkUpdate'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (patch: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:set', patch),
  onI18nChanged: (cb: (payload: I18nChangedPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: I18nChangedPayload) => cb(payload)
    ipcRenderer.on('i18n:changed', listener)
    return () => ipcRenderer.removeListener('i18n:changed', listener)
  },
  selectDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDir'),
  scanStart: (dir: string, jobId?: string): Promise<ScanStartResult> =>
    ipcRenderer.invoke('project:scanStart', dir, jobId),
  /** 「开始解密」：扫描后把解密结果落到临时缓存（进度/统计），导出时再从缓存拷走/打包 */
  processAll: (files: ScannedFile[], key: string): Promise<ExportResult> =>
    ipcRenderer.invoke('decode:process', files, key),
  /** 把缓存里的解密结果拷到用户选择的目录 */
  exportFiles: (): Promise<ExportResult> => ipcRenderer.invoke('decode:exportFiles'),
  /** 把缓存里的解密结果打包成 ZIP */
  exportZip: (): Promise<ExportResult> => ipcRenderer.invoke('decode:exportZip'),
  /** 重置：清空解密缓存 */
  clearDecrypt: (): Promise<void> => ipcRenderer.invoke('decode:clearCache'),
  cancelScan: (): Promise<void> => ipcRenderer.invoke('task:cancelScan'),
  cancelExport: (): Promise<void> => ipcRenderer.invoke('task:cancelExport'),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  onScanBatch: (cb: (payload: ScanBatchPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: ScanBatchPayload) => cb(payload)
    ipcRenderer.on('project:scanBatch', listener)
    return () => ipcRenderer.removeListener('project:scanBatch', listener)
  },
  onScanDone: (cb: (payload: ScanDonePayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: ScanDonePayload) => cb(payload)
    ipcRenderer.on('project:scanDone', listener)
    return () => ipcRenderer.removeListener('project:scanDone', listener)
  },
  onExportProgress: (cb: (payload: ExportProgress) => void): (() => void) => {
    const listener = (_e: unknown, payload: ExportProgress) => cb(payload)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
  openSaveDir: (): Promise<OpenSaveDirResult | null> => ipcRenderer.invoke('save:openDir'),
  scanSaveDir: (dir: string): Promise<SaveFileInfo[]> => ipcRenderer.invoke('save:scanDir', dir),
  openSaveFile: (): Promise<{ file: string } | null> => ipcRenderer.invoke('save:openFile'),
  loadSave: (absPath: string): Promise<LoadedSave> => ipcRenderer.invoke('save:load', absPath),
  writeSave: (absPath: string, contents: unknown, kind: SaveKind): Promise<WriteSaveResult> =>
    ipcRenderer.invoke('save:write', absPath, contents, kind),
  // ---- 最近项目/密钥历史 + schema 字段 ----
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:list'),
  addHistory: (
    kind: HistoryKind,
    path: string,
    label?: string,
    key?: string,
    keySource?: string
  ): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:add', kind, path, label, key, keySource),
  removeHistory: (id: string): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:remove', id),
  clearHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:clear'),
  getSchemas: (): Promise<SaveSchema> => ipcRenderer.invoke('schema:list'),
  // ---- 批量工具：加密 / 图片还原 ----
  /** 当前平台（'win32' / 'darwin' / 'linux'），渲染层据此适配无边框窗口布局 */
  platform: process.platform,
  pickFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFile'),
  listFilesByExt: (dir: string, exts: string[]): Promise<ScannedFile[]> =>
    ipcRenderer.invoke('tool:listFiles', dir, exts),
  encryptMany: (files: ToolFile[], key: string, version: 'mv' | 'mz', outputDir: string | null): Promise<ToolBatchResult> =>
    ipcRenderer.invoke('tool:encryptMany', files, key, version, outputDir),
  restoreMany: (files: ToolFile[], outputDir: string | null): Promise<ToolBatchResult> =>
    ipcRenderer.invoke('tool:restoreMany', files, outputDir),
  cancelTool: (): Promise<void> => ipcRenderer.invoke('task:cancelTool'),
  openPath: (p: string): Promise<boolean> => ipcRenderer.invoke('app:openPath', p),
  onToolProgress: (cb: (payload: ToolProgressPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: ToolProgressPayload) => cb(payload)
    ipcRenderer.on('tool:progress', listener)
    return () => ipcRenderer.removeListener('tool:progress', listener)
  }
}

export interface ExportProgress {
  done: number
  total: number
  ok: number
  fail: number
  /** 当前正在处理的文件 relPath（或打包阶段提示），可选 */
  current?: string
}

export type DshApi = typeof api

contextBridge.exposeInMainWorld('dsh', api)
