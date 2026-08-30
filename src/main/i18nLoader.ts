import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { createI18n } from '@lib/i18n'

export type I18nApi = ReturnType<typeof createI18n>

/**
 * 扫描多个语言包目录并合并注册。这是「即插即用语言包」的实现基础（蓝图 §11.1）。
 *
 * 靠后的目录优先级更高：同名 code 会被后者整体覆盖（例如 userData/locales 覆盖
 * 内置 app.asar/locales）。目录不存在时跳过；单个文件解析失败跳过并 warn，不影响其余文件。
 *
 * @returns 合并后的 code → 原始文件内容 映射（供热监视 diff 用）
 */
export function scanLocaleDirs(i18n: I18nApi, dirs: string[]): Map<string, string> {
  const merged = new Map<string, string>()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue
      if (entry.startsWith('_')) continue // 模板/示例文件（如 _template.json），不作为语言加载
      const code = entry.replace(/\.json$/i, '')
      try {
        const content = readFileSync(join(dir, entry), 'utf-8')
        i18n.loadFromJson(code, JSON.parse(content))
        merged.set(code, content)
      } catch (err) {
        console.warn(`[i18n] 跳过无效语言文件: ${entry}`, err)
      }
    }
  }
  return merged
}
