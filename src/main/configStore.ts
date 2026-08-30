/**
 * 应用偏好存储（main 进程）：userData/config.json 持久化 locale / theme。
 *
 * 蓝图 §11.1「选择写入 config」——语言与主题选择在重启后保留。
 * 与 historyStore 同理念：纯数据组织在渲染层/store 完成，这里只做 JSON 读写，
 * 写失败不致命（偏好只是便利功能）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AppConfig {
  /** 界面语言 code（如 zh-Hans / en）；缺省用 i18n 默认值 */
  locale?: string
  /** 主题模式：light | dark | system */
  theme?: 'light' | 'dark' | 'system'
}

export interface ConfigStore {
  /** 当前配置（浅拷贝） */
  get(): AppConfig
  /** 合并写入并落盘（返回新配置） */
  set(patch: Partial<AppConfig>): AppConfig
}

/** 防御性校验：损坏的 config 文件不会炸掉应用 */
function sanitize(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const rec = raw as Record<string, unknown>
  const out: AppConfig = {}
  if (typeof rec.locale === 'string' && rec.locale.length > 0) out.locale = rec.locale
  if (rec.theme === 'light' || rec.theme === 'dark' || rec.theme === 'system') {
    out.theme = rec.theme
  }
  return out
}

export function createConfigStore(file: string): ConfigStore {
  let config: AppConfig = {}

  function load(): void {
    try {
      if (existsSync(file)) {
        config = sanitize(JSON.parse(readFileSync(file, 'utf-8')))
      }
    } catch {
      // 损坏的 config：忽略并从头开始
      config = {}
    }
  }

  function persist(next: AppConfig): AppConfig {
    config = next
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8')
    } catch {
      // 写盘失败不致命
    }
    return config
  }

  load()

  return {
    get: () => ({ ...config }),
    set: (patch) => persist({ ...config, ...patch })
  }
}
