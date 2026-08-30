/**
 * 语言包集合 diff（纯 TS，零 Node/Electron 依赖）。
 *
 * 热监视（蓝图 §11.1）的核心比较逻辑：把「已注册的语言包」与「磁盘上的
 * 语言包」对比，得出新增 / 删除 / 更新。纯函数便于单测。
 */

export interface LocaleChangeSet {
  /** 新增的语言 code */
  added: string[]
  /** 被移除的语言 code */
  removed: string[]
  /** 内容被更新的语言 code */
  updated: string[]
}

/**
 * 对比两个「code → 内容」映射，得出变更集。
 *
 * @param known   当前已注册的映射（key 为语言 code，value 为原始文件内容）
 * @param onDisk  磁盘上存在的映射
 */
export function diffLocaleSets(
  known: ReadonlyMap<string, string>,
  onDisk: ReadonlyMap<string, string>
): LocaleChangeSet {
  const removed = [...known.keys()].filter((c) => !onDisk.has(c))
  const added = [...onDisk.keys()].filter((c) => !known.has(c))
  const updated = [...onDisk.keys()].filter(
    (c) => known.has(c) && known.get(c) !== onDisk.get(c) && !added.includes(c) && !removed.includes(c)
  )
  return { added, removed, updated }
}
