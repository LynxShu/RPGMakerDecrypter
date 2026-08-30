/**
 * 极简 i18n 核心（纯 TS、零依赖、零 fs）。
 *
 * 设计要点（见蓝图 §11.1）：
 * - 语言文件是独立 JSON：`<app>/locales/<code>.json`，内含 `__meta`（原生名/方向）与若干文案 key。
 * - 支持嵌套对象，加载时扁平化；支持 `{param}` 占位替换。
 * - 缺失 key 时按 current → fallback → 原 key 兜底。
 */

export type Messages = Record<string, string>

export interface LocaleMeta {
  /** 原生语言名，如 "简体中文" / "English" */
  name?: string
  direction?: 'ltr' | 'rtl'
}

export interface LocaleBundle {
  meta: LocaleMeta
  messages: Messages
}

export interface AvailableLocale {
  code: string
  name: string
  direction: 'ltr' | 'rtl'
}

export interface I18nStoreOptions {
  defaultLocale?: string
  fallbackLocale?: string
  /** 当某个 key 缺失时回调 */
  onMissingKey?: (key: string) => void
}

type Listener = () => void

/**
 * 把嵌套对象扁平化为 key → string 映射。
 * 例如 `{ app: { title: "x" }, "app.hello": "y" }` → `{ "app.title": "x", "app.hello": "y" }`。
 */
export function flattenMessages(source: Record<string, unknown>, prefix = ''): Messages {
  const out: Messages = {}
  for (const [key, value] of Object.entries(source)) {
    const flatKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      out[flatKey] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flattenMessages(value as Record<string, unknown>, flatKey))
    }
  }
  return out
}

/** 插值 `{param}` 占位符 */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = params[name]
    return v === undefined ? match : String(v)
  })
}

export class I18nStore {
  private readonly bundles = new Map<string, LocaleBundle>()
  private current: string
  private readonly fallback: string
  private listeners = new Set<Listener>()
  private readonly onMissingKey?: (key: string) => void

  constructor(opts: I18nStoreOptions = {}) {
    this.current = opts.defaultLocale ?? 'en'
    this.fallback = opts.fallbackLocale ?? 'en'
    this.onMissingKey = opts.onMissingKey
  }

  setLocale(locale: string): void {
    if (locale === this.current) return
    this.current = locale
    this.notify()
  }

  getLocale(): string {
    return this.current
  }

  /** 注册/覆盖一个语言包 */
  addBundle(locale: string, bundle: LocaleBundle): void {
    this.bundles.set(locale, bundle)
    this.notify()
  }

  removeBundle(locale: string): void {
    if (this.bundles.delete(locale)) this.notify()
  }

  hasLocale(locale: string): boolean {
    return this.bundles.has(locale)
  }

  /** 返回已加载语言包的可选项（用于下拉框） */
  getAvailableLocales(): AvailableLocale[] {
    const list: AvailableLocale[] = []
    for (const [code, bundle] of this.bundles) {
      list.push({
        code,
        name: bundle.meta.name ?? code,
        direction: bundle.meta.direction ?? 'ltr'
      })
    }
    // 优先展示当前语言，其次按 code 排序
    list.sort((a, b) => {
      if (a.code === this.current) return -1
      if (b.code === this.current) return 1
      return a.code.localeCompare(b.code)
    })
    return list
  }

  /** 取指定语言的文案（扁平化后） */
  private messagesFor(locale: string): Messages {
    return this.bundles.get(locale)?.messages ?? {}
  }

  t(key: string, params?: Record<string, string | number>): string {
    return this.resolve(key, params)
  }

  private resolve(key: string, params?: Record<string, string | number>): string {
    let template: string | undefined = this.messagesFor(this.current)[key]
    if (template === undefined) {
      template = this.messagesFor(this.fallback)[key]
    }
    if (template === undefined) {
      this.onMissingKey?.(key)
      return interpolate(key, params)
    }
    return interpolate(template, params)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }
}
