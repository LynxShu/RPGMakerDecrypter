import { describe, it, expect } from 'vitest'
import { detectLocale } from '@lib/i18n'

const AVAILABLE = ['en', 'ja', 'zh-Hans', 'zh-Hant']

describe('detectLocale', () => {
  it('精确匹配（忽略大小写与分隔符）', () => {
    expect(detectLocale(['zh-Hant'], AVAILABLE)).toBe('zh-Hant')
    expect(detectLocale(['ZH_hant'], AVAILABLE)).toBe('zh-Hant')
    expect(detectLocale(['en'], AVAILABLE)).toBe('en')
  })

  it('中文按书写体系/地区分流', () => {
    expect(detectLocale(['zh-TW'], AVAILABLE)).toBe('zh-Hant')
    expect(detectLocale(['zh-HK'], AVAILABLE)).toBe('zh-Hant')
    expect(detectLocale(['zh-MO'], AVAILABLE)).toBe('zh-Hant')
    expect(detectLocale(['zh-Hant-TW'], AVAILABLE)).toBe('zh-Hant')
    expect(detectLocale(['zh-CN'], AVAILABLE)).toBe('zh-Hans')
    expect(detectLocale(['zh-SG'], AVAILABLE)).toBe('zh-Hans')
    expect(detectLocale(['zh'], AVAILABLE)).toBe('zh-Hans')
  })

  it('繁体/简体缺失时互相回退', () => {
    expect(detectLocale(['zh-TW'], ['en', 'zh-Hans'])).toBe('zh-Hans')
    expect(detectLocale(['zh-CN'], ['en', 'zh-Hant'])).toBe('zh-Hant')
  })

  it('其它语言按主语言匹配（含自定义语言包）', () => {
    expect(detectLocale(['ja-JP'], AVAILABLE)).toBe('ja')
    expect(detectLocale(['en-US'], AVAILABLE)).toBe('en')
    expect(detectLocale(['de-DE'], ['en', 'de'])).toBe('de')
  })

  it('按顺序取第一个命中', () => {
    expect(detectLocale(['fr-FR', 'ja-JP', 'en-US'], AVAILABLE)).toBe('ja')
    expect(detectLocale([], AVAILABLE)).toBeNull()
  })

  it('全部不匹配时使用 fallback（fallback 未安装则返回 null）', () => {
    expect(detectLocale(['fr-FR'], AVAILABLE, { fallback: 'en' })).toBe('en')
    expect(detectLocale(['fr-FR'], ['ja', 'zh-Hans'], { fallback: 'en' })).toBeNull()
  })
})
