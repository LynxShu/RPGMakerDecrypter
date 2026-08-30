/**
 * 存档字段 schema 目录加载（main 进程）。
 *
 * 蓝图 §11.4-1：扫描 `<app>/schema/*.json`（与 locales/ 同理念），
 * 合并后经 IPC 交给渲染层，快捷表单即可按描述渲染插件字段。
 *
 * 约定：
 * - 只加载 `*.json`；
 * - 文件名以 `_` 开头视为示例/模板，跳过（如 `_example-plugin.json`）；
 * - 单个文件解析失败不影响其他文件（warn 并跳过）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeSaveSchemas, parseSaveSchema, type SaveSchema } from '@lib/save'

/** 从目录加载全部 schema 文件（未合并，保留各自 name） */
export function loadSchemasFromDir(dir: string): SaveSchema[] {
  if (!existsSync(dir)) return []
  const out: SaveSchema[] = []
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue
    if (entry.startsWith('_')) continue // 示例/模板文件
    try {
      const schema = parseSaveSchema(readFileSync(join(dir, entry), 'utf-8'))
      if (!schema.name) schema.name = entry.replace(/\.json$/i, '')
      out.push(schema)
    } catch (err) {
      console.warn(`[schema] 跳过无效 schema 文件: ${entry}`, err)
    }
  }
  return out
}

/** 加载目录下全部 schema 并按 path 合并为一份（渲染层直接用 fields） */
export function loadMergedSchema(dir: string): SaveSchema {
  return mergeSaveSchemas(...loadSchemasFromDir(dir))
}
