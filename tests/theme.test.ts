import { describe, it, expect } from 'vitest'
import { createThemeStore, ThemeStore, readSystemPref } from '@lib/theme'

describe('ThemeStore', () => {
  it('默认 system 在 Node 环境解析为 light', () => {
    const store = createThemeStore({ mode: 'system' })
    expect(store.getMode()).toBe('system')
    expect(store.getResolved()).toBe('light')
  })

  it('setMode 更新 resolved 并触发订阅', () => {
    const store = new ThemeStore({ mode: 'dark' })
    let called = 0
    const unsub = store.subscribe(() => called++)
    expect(store.getResolved()).toBe('dark')
    store.setMode('light')
    expect(store.getResolved()).toBe('light')
    expect(called).toBe(1)
    unsub()
  })

  it('支持持久化回调', () => {
    let saved: string | null = null
    const store = createThemeStore({
      mode: 'system',
      persist: { get: () => null, set: (m) => (saved = m) }
    })
    store.setMode('dark')
    expect(saved).toBe('dark')
  })
})

describe('readSystemPref', () => {
  it('Node 无 window 时返回 light', () => {
    expect(readSystemPref()).toBe('light')
  })
})
