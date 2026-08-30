import { describe, it, expect } from 'vitest'
import { computeWindow, shouldVirtualize, DEFAULT_OVERSCAN } from '@lib/virtual'
import { diffLocaleSets } from '@lib/i18n'

describe('virtual 虚拟窗口计算（蓝图 §11.2）', () => {
  it('顶部窗口含 overscan，总高度正确', () => {
    const w = computeWindow(0, 400, 28, 10000, 5)
    expect(w.start).toBe(0)
    expect(w.end).toBeGreaterThanOrEqual(Math.ceil(400 / 28))
    expect(w.totalHeight).toBe(10000 * 28)
    expect(DEFAULT_OVERSCAN).toBe(5)
  })

  it('滚动到中部时窗口平移', () => {
    const w = computeWindow(28 * 500, 400, 28, 10000, 5)
    expect(w.start).toBeGreaterThanOrEqual(500 - 5)
    expect(w.end).toBeLessThanOrEqual(500 + Math.ceil(400 / 28) + 5)
    expect(w.visible).toBeGreaterThan(0)
  })

  it('滚动超出末尾时 start 被截断（不越界）', () => {
    const w = computeWindow(999999, 400, 28, 10, 5)
    expect(w.end).toBe(10)
    expect(w.start).toBeLessThanOrEqual(10)
    expect(w.visible).toBeGreaterThan(0)
  })

  it('边界防御：0 视口 / 0 总行 / 非法行高 / 负滚动', () => {
    expect(computeWindow(0, 0, 28, 0, 5).visible).toBe(0)
    expect(computeWindow(0, 400, 0, 100, 5).totalHeight).toBeGreaterThan(0)
    expect(computeWindow(-5, 400, 28, 100, 5).start).toBe(0)
  })

  it('shouldVirtualize 阈值判断', () => {
    expect(shouldVirtualize(201, 200)).toBe(true)
    expect(shouldVirtualize(200, 200)).toBe(false)
    expect(shouldVirtualize(0, 200)).toBe(false)
  })
})

describe('i18n 语言包 diff（蓝图 §11.1 热监视核心）', () => {
  it('识别 新增 / 删除 / 更新', () => {
    const known = new Map([
      ['en', '{"a":1}'],
      ['zh-Hans', '{"a":2}'],
      ['ja', '{"a":3}']
    ])
    const onDisk = new Map([
      ['en', '{"a":1}'],
      ['zh-Hans', '{"a":99}'],
      ['fr', '{"a":4}']
    ])
    const d = diffLocaleSets(known, onDisk)
    expect(d.added).toEqual(['fr'])
    expect(d.removed).toEqual(['ja'])
    expect(d.updated).toEqual(['zh-Hans'])
  })

  it('空输入防御', () => {
    expect(diffLocaleSets(new Map(), new Map())).toEqual({ added: [], removed: [], updated: [] })
    expect(diffLocaleSets(new Map([['en', 'x']]), new Map()).removed).toEqual(['en'])
  })
})
