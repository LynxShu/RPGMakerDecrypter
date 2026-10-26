import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { flattenMessages } from '@lib/i18n'

/**
 * 内置语言包一致性：
 * - 所有语言包必须与基准（zh-Hans）拥有完全相同的 key 集合；
 * - 每个 key 的 `{param}` 占位符也必须一致（避免翻译时漏掉/写错变量名）；
 * - __meta.name / direction 合法。
 *
 * 以后 zh-Hans 新增 key、其它语言漏翻，这个测试会直接失败，而不是静默回退英文。
 */

const LOCALES_DIR = join(process.cwd(), 'locales')

const CODES = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json') && !file.startsWith('_'))
  .map((file) => file.slice(0, -'.json'.length))
  .sort()

interface LoadedLocale {
  meta: { name?: string; direction?: string }
  messages: Record<string, string>
}

function loadLocale(code: string): LoadedLocale {
  const raw = JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf-8')) as Record<
    string,
    unknown
  >
  const { __meta, ...rest } = raw
  return {
    meta: (__meta ?? {}) as LoadedLocale['meta'],
    messages: flattenMessages(rest)
  }
}

function placeholders(messages: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(messages)) {
    const found = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    if (found.length > 0) out[key] = found
  }
  return out
}

const baseline = loadLocale('zh-Hans')
const baselineKeys = Object.keys(baseline.messages).sort()
const baselinePlaceholders = placeholders(baseline.messages)

describe('内置语言包', () => {
  it('包含 zh-Hans / zh-Hant / en / ja', () => {
    expect(CODES).toEqual(expect.arrayContaining(['zh-Hans', 'zh-Hant', 'en', 'ja']))
  })

  it.each(CODES)('%s 的 key 集合与 zh-Hans 一致', (code) => {
    expect(Object.keys(loadLocale(code).messages).sort()).toEqual(baselineKeys)
  })

  it.each(CODES)('%s 的占位符与 zh-Hans 一致', (code) => {
    expect(placeholders(loadLocale(code).messages)).toEqual(baselinePlaceholders)
  })

  it.each(CODES)('%s 的 __meta 合法', (code) => {
    const { meta } = loadLocale(code)
    expect(meta.name).toBeTruthy()
    expect(['ltr', 'rtl']).toContain(meta.direction ?? 'ltr')
  })
})
