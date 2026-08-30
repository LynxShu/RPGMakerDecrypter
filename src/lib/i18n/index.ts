import { flattenMessages, I18nStore, type LocaleBundle } from './core'
import { diffLocaleSets, type LocaleChangeSet } from './diff'

export * from './core'
export * from './diff'

export interface CreateI18nOptions {
  defaultLocale?: string
  fallbackLocale?: string
  onMissingKey?: (key: string) => void
}

/**
 * 顶层 i18n 工厂。GUI 与 CLI 共用；文件扫描/监视由外层（主进程）完成并注入 bundle。
 */
export function createI18n(opts: CreateI18nOptions = {}) {
  const store = new I18nStore(opts)
  return {
    store,
    t: (key: string, params?: Record<string, string | number>) => store.t(key, params),
    setLocale: (locale: string) => store.setLocale(locale),
    getLocale: () => store.getLocale(),
    getAvailableLocales: () => store.getAvailableLocales(),
    hasLocale: (locale: string) => store.hasLocale(locale),
    /** 移除一个语言包（热监视删除语言文件时用） */
    removeBundle: (locale: string) => store.removeBundle(locale),
    /** 用一个加载好的 raw JSON 对象注册语言包（自动展平嵌套 key） */
    loadFromJson: (locale: string, raw: Record<string, unknown>, meta?: LocaleBundle['meta']) => {
      const { __meta, ...rest } = raw
      const mergedMeta = { ...(__meta as LocaleBundle['meta'] | undefined), ...meta }
      const messages = flattenMessages(rest as Record<string, unknown>)
      store.addBundle(locale, { meta: mergedMeta, messages })
    }
  }
}
