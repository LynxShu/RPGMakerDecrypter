/**
 * 最近项目 / 密钥历史（纯 TS，零 Node/Electron 依赖）。
 *
 * 蓝图 §11.4-5：本地保存最近打开的项目目录，便于快速重开。
 * 注意：密钥为敏感数据——本模块只负责「数据组织」；落盘与是否加密由主进程
 * （historyStore.ts）决定，UI 需给出强提醒。
 *
 * 设计：
 * - id 由 kind + path 决定（确定性），同一路径重复打开只更新 openedAt，不产生重复条目；
 * - 按 openedAt 倒序；超出 cap 丢弃最旧条目。
 */
export type HistoryKind = 'project'

export interface HistoryEntry {
  id: string
  kind: HistoryKind
  /** 项目目录的绝对路径 */
  path: string
  /** 展示名（通常为目录名） */
  label: string
  /** 项目密钥（有 key 时才有） */
  key?: string
  /** 密钥来源说明（如 data/System.json） */
  keySource?: string
  /** 最近打开时间（epoch ms） */
  openedAt: number
}

/** 历史条数上限 */
export const DEFAULT_HISTORY_CAP = 20

export function makeHistoryId(kind: HistoryKind, path: string): string {
  return `${kind}:${path}`
}

/** 防御性校验：结构合法的条目才允许进入存储（损坏的历史文件不会炸掉应用） */
export function isValidHistoryEntry(e: unknown): e is HistoryEntry {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false
  const rec = e as Record<string, unknown>
  return (
    rec.kind === 'project' &&
    typeof rec.path === 'string' &&
    rec.path.length > 0 &&
    typeof rec.label === 'string' &&
    typeof rec.openedAt === 'number'
  )
}

/**
 * 插入/更新一条历史：同 id（kind+path）已存在则更新并置顶；否则插入头部；
 * 按 openedAt 倒序排序并截断到 cap。
 */
export function upsertHistoryEntry(
  list: HistoryEntry[],
  entry: HistoryEntry,
  cap = DEFAULT_HISTORY_CAP
): HistoryEntry[] {
  const rest = list.filter((e) => e.id !== entry.id)
  const next = [entry, ...rest].sort((a, b) => b.openedAt - a.openedAt)
  return next.slice(0, Math.max(1, cap))
}

/** 按 id 删除一条历史 */
export function removeHistoryEntry(list: HistoryEntry[], id: string): HistoryEntry[] {
  return list.filter((e) => e.id !== id)
}

/** 过滤出合法条目（加载损坏文件时使用） */
export function sanitizeHistoryList(list: unknown): HistoryEntry[] {
  if (!Array.isArray(list)) return []
  return list.filter(isValidHistoryEntry)
}
