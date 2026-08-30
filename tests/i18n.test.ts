import { describe, it, expect } from 'vitest'
import { flattenMessages, interpolate, I18nStore, createI18n } from '@lib/i18n'

describe('flattenMessages', () => {
  it('把嵌套对象展平为 key → string', () => {
    const flat = flattenMessages({ app: { title: 'Hi', sub: { x: 'y' } }, 'a.b': 'c' })
    expect(flat['app.title']).toBe('Hi')
    expect(flat['app.sub.x']).toBe('y')
    expect(flat['a.b']).toBe('c')
  })
})

describe('interpolate', () => {
  it('替换 {param} 占位符', () => {
    expect(interpolate('Hello {name}', { name: 'Lynx' })).toBe('Hello Lynx')
    expect(interpolate('{a}-{b}', { a: 1, b: 2 })).toBe('1-2')
  })
})

describe('I18nStore', () => {
  it('缺失 key 时按 current → fallback → 原 key 兜底', () => {
    const store = new I18nStore({ defaultLocale: 'zh-Hans', fallbackLocale: 'en' })
    store.addBundle('zh-Hans', { meta: { name: '简体中文' }, messages: { hello: '你好', miss: '' } })
    store.addBundle('en', { meta: { name: 'English' }, messages: { hello: 'Hello', fallbackOnly: 'FB' } })
    expect(store.t('hello')).toBe('你好')
    store.setLocale('en')
    expect(store.t('hello')).toBe('Hello')
    expect(store.t('fallbackOnly')).toBe('FB')
    store.setLocale('zh-Hans')
    expect(store.t('fallbackOnly')).toBe('FB') // 走 fallback en
    expect(store.t('not.exists')).toBe('not.exists') // 原 key
  })
})

describe('createI18n.loadFromJson', () => {
  it('从 raw JSON 注册语言包（含 __meta 与嵌套 key）', () => {
    const i18n = createI18n({ defaultLocale: 'zh-Hans' })
    i18n.loadFromJson('zh-Hans', {
      __meta: { name: '简体中文' },
      app: { title: '测试' },
      'flat.key': '值'
    })
    expect(i18n.getAvailableLocales()[0].name).toBe('简体中文')
    expect(i18n.t('app.title')).toBe('测试')
    expect(i18n.t('flat.key')).toBe('值')
  })
})
