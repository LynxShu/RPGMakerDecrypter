/**
 * 首次启动的系统语言检测（纯 TS、零依赖、可单测）。
 *
 * 输入是系统语言偏好（主进程用 `app.getPreferredSystemLanguages()`，再补 `app.getSystemLocale()`），
 * 输出是已安装语言包中的一个 code；无法判断时返回 `options.fallback`（或 null）。
 *
 * 规则（按序取第一个命中）：
 * - 精确匹配（忽略大小写与 `_`/`-` 差异）；
 * - `zh`：Hant/TW/HK/MO → 繁体；Hans/CN/SG/无地区 → 简体；两者只会命中已安装的那个；
 * - 其它语言按主语言子标签匹配（`ja-JP` → `ja`、`de-DE` → 自定义包 `de`）；
 * - 都不匹配 → fallback（GUI 传 `en`；没有英文包时返回 null，由调用方保持默认）。
 */

export interface DetectLocaleOptions {
  /** 全部候选都不匹配时的回退 code（需已安装） */
  fallback?: string
}

function normalizeTag(tag: string): string[] {
  return tag
    .trim()
    .toLowerCase()
    .split(/[-_]/)
    .filter(Boolean)
}

function findExact(parts: string[], available: Map<string, string>): string | null {
  return available.get(parts.join('-')) ?? null
}

/** 按主语言子标签匹配：先 `base` 本身，再 `base-*` 的任一已安装变体 */
function findByBase(base: string, available: Map<string, string>): string | null {
  const exact = available.get(base)
  if (exact) return exact
  for (const [code, original] of available) {
    if (code.startsWith(`${base}-`)) return original
  }
  return null
}

function pickChinese(parts: string[], available: Map<string, string>): string | null {
  const subtags = parts.slice(1)
  const script = subtags.find((p) => p === 'hant' || p === 'hans')
  const region = subtags.find((p) => /^[a-z]{2}$/.test(p) || /^\d{3}$/.test(p))
  const traditional =
    script === 'hant' || region === 'tw' || region === 'hk' || region === 'mo'
  const simplified =
    script === 'hans' || region === 'cn' || region === 'sg' || subtags.length === 0
  if (traditional) {
    return available.get('zh-hant') ?? available.get('zh-hans') ?? null
  }
  if (simplified) {
    return available.get('zh-hans') ?? available.get('zh-hant') ?? null
  }
  return available.get('zh-hans') ?? available.get('zh-hant') ?? null
}

/**
 * 从系统语言偏好中挑一个已安装的界面语言。
 *
 * @param preferred 有序的系统语言列表（越靠前优先级越高），如 `['zh-TW', 'zh-Hans', 'en-US']`
 * @param available 已安装语言包的 code 列表（内置 + 用户自定义）
 * @param options   `fallback`：全部不匹配时的回退语言
 */
export function detectLocale(
  preferred: readonly string[],
  available: readonly string[],
  options: DetectLocaleOptions = {}
): string | null {
  if (available.length === 0) return null
  const availableMap = new Map<string, string>()
  for (const code of available) {
    const normalized = normalizeTag(code).join('-')
    if (normalized) availableMap.set(normalized, code)
  }

  for (const tag of preferred) {
    if (typeof tag !== 'string' || tag.trim() === '') continue
    const parts = normalizeTag(tag)
    if (parts.length === 0) continue

    const exact = findExact(parts, availableMap)
    if (exact) return exact

    const base = parts[0]
    if (base === 'zh') {
      const zh = pickChinese(parts, availableMap)
      if (zh) return zh
      continue
    }
    const hit = findByBase(base, availableMap)
    if (hit) return hit
  }

  const fallback = options.fallback
  if (fallback) {
    const parts = normalizeTag(fallback)
    return findExact(parts, availableMap) ?? findByBase(parts[0] ?? '', availableMap)
  }
  return null
}
