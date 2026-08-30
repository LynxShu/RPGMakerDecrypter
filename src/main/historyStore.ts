/**
 * 最近项目/密钥历史存储（main 进程）。
 *
 * 纯数据组织的逻辑在 `@lib/history`（零 Node 依赖，可单测）；
 * 本模块只负责「读/写 JSON 文件」这一层，放在 userData（不进仓库、不随应用分发）。
 *
 * ⚠️ 密钥为敏感数据：当前按明文 JSON 存储（便于快速复用），
 * UI 已提供强提醒文案；如需更强保护可后续加本地加密（蓝图 §11.4-5）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  makeHistoryId,
  sanitizeHistoryList,
  upsertHistoryEntry,
  type HistoryEntry,
  type HistoryKind
} from '@lib/history'

export interface HistoryAddInput {
  kind: HistoryKind
  path: string
  label: string
  key?: string
  keySource?: string
}

export interface HistoryStore {
  /** 当前历史（按最近打开倒序） */
  list(): HistoryEntry[]
  /** 插入/更新一条（同 kind+path 去重置顶），并落盘 */
  add(input: HistoryAddInput): HistoryEntry[]
  /** 删除一条并落盘 */
  remove(id: string): HistoryEntry[]
  /** 清空并落盘 */
  clear(): HistoryEntry[]
}

export function createHistoryStore(file: string): HistoryStore {
  let list: HistoryEntry[] = []

  function load(): void {
    try {
      if (existsSync(file)) {
        list = sanitizeHistoryList(JSON.parse(readFileSync(file, 'utf-8')))
      }
    } catch {
      // 损坏的历史文件：忽略并从头开始（不阻塞应用）
      list = []
    }
  }

  function persist(next: HistoryEntry[]): HistoryEntry[] {
    list = next
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8')
    } catch {
      // 写盘失败不致命（历史只是便利功能）
    }
    return list
  }

  load()

  return {
    list: () => list.slice(),
    add: (input) => {
      const entry: HistoryEntry = {
        id: makeHistoryId(input.kind, input.path),
        kind: input.kind,
        path: input.path,
        label: input.label,
        key: input.key,
        keySource: input.keySource,
        openedAt: Date.now()
      }
      return persist(upsertHistoryEntry(list, entry))
    },
    remove: (id) => persist(list.filter((e) => e.id !== id)),
    clear: () => persist([])
  }
}
