import { describe, it, expect } from 'vitest'
import {
  makeHistoryId,
  isValidHistoryEntry,
  upsertHistoryEntry,
  removeHistoryEntry,
  sanitizeHistoryList,
  DEFAULT_HISTORY_CAP,
  type HistoryEntry
} from '@lib/history'

function hist(kind: 'project', path: string, openedAt: number): HistoryEntry {
  return { id: makeHistoryId(kind, path), kind, path, label: path.split(/[\\/]/).pop()!, openedAt }
}

describe('最近项目/密钥历史（蓝图 §11.4-5）', () => {
  it('upsertHistoryEntry：同路径去重置顶 + 倒序 + 上限截断', () => {
    const e1 = hist('project', '/g1', 100)
    const e2 = hist('project', '/g2', 200)
    const e3 = hist('project', '/g3', 300)
    let list = upsertHistoryEntry([e1, e2], e3)
    expect(list.map((x) => x.path)).toEqual(['/g3', '/g2', '/g1'])
    // 同路径再次打开 → 去重置顶，不新增
    list = upsertHistoryEntry(list, hist('project', '/g1', 400))
    expect(list.map((x) => x.path)).toEqual(['/g1', '/g3', '/g2'])
    expect(list).toHaveLength(3)
    // cap 截断
    expect(upsertHistoryEntry([e1], e2, 1).map((x) => x.path)).toEqual(['/g2'])
  })

  it('removeHistoryEntry / sanitizeHistoryList / makeHistoryId', () => {
    const e1 = hist('project', '/g1', 1)
    const e2 = hist('project', '/g3', 2)
    expect(removeHistoryEntry([e1, e2], e1.id).map((x) => x.path)).toEqual(['/g3'])
    expect(sanitizeHistoryList([e1, { bad: true }, 'x', null, e2]).map((x) => x.path)).toEqual(['/g1', '/g3'])
    expect(sanitizeHistoryList('nope')).toEqual([])
    expect(sanitizeHistoryList(42)).toEqual([])
    expect(makeHistoryId('project', '/g1')).toBe('project:/g1')
  })

  it('isValidHistoryEntry 防御性校验', () => {
    expect(isValidHistoryEntry(hist('project', '/g1', 1))).toBe(true)
    expect(isValidHistoryEntry({ kind: 'other', path: '/x', label: 'x', openedAt: 1 })).toBe(false)
    // 旧版本曾写入 kind:'save' 的存档历史，现已不支持，应被过滤
    expect(isValidHistoryEntry({ kind: 'save', path: '/s1', label: 'x', openedAt: 1 })).toBe(false)
    expect(isValidHistoryEntry({ kind: 'project', path: '', label: 'x', openedAt: 1 })).toBe(false)
    expect(isValidHistoryEntry(null)).toBe(false)
  })

  it('DEFAULT_HISTORY_CAP 默认上限', () => {
    expect(DEFAULT_HISTORY_CAP).toBe(20)
  })
})
