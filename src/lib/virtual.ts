/**
 * 虚拟列表窗口计算（纯 TS，零 Node/Electron 依赖）。
 *
 * 蓝图 §11.2：超大列表（数万加密文件 / JSON 树大数组）只渲染可见行，
 * DOM 数量恒定、滚动保持流畅。行高固定（fixed row height）时，
 * 可见窗口由 scrollTop / 视口高度 / 行高 三个量纯函数算出，可单测。
 *
 * 渲染层（src/renderer/src/virtualList.ts）把窗口渲染成 DOM；
 * 本模块只做计算，GUI 与测试共用。
 */

export interface VirtualWindow {
  /** 第一个渲染行索引（含 overscan 上界） */
  start: number
  /** 最后一个渲染行索引（开区间，不含） */
  end: number
  /** 内容总高度（total * rowHeight），用于撑起滚动条 */
  totalHeight: number
  /** 本次渲染的行数 */
  visible: number
  /** 实际使用的 overscan 行数 */
  overscan: number
}

/** 默认上下各多渲染的行数（滚动预取缓冲） */
export const DEFAULT_OVERSCAN = 5

/**
 * 由滚动位置计算可见窗口。
 *
 * @param scrollTop      容器当前滚动偏移（px，>= 0）
 * @param viewportHeight 容器可视高度（px；0/负值按 0 处理）
 * @param rowHeight      固定行高（px，>= 1）
 * @param total          总行数（>= 0）
 * @param overscan       上下各多渲染的行数（默认 DEFAULT_OVERSCAN）
 */
export function computeWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan = DEFAULT_OVERSCAN
): VirtualWindow {
  const safeTotal = Math.max(0, Math.floor(total))
  const safeRow = Math.max(1, rowHeight)
  const safeViewport = Math.max(0, viewportHeight)
  const safeOverscan = Math.max(0, Math.floor(overscan))

  // 想渲染的行数：视口内行数 + 上下各 overscan
  const desired = Math.ceil(safeViewport / safeRow) + safeOverscan * 2
  // 请求的起始行（未夹紧）
  const rawStart = Math.floor(scrollTop / safeRow) - safeOverscan

  // start 夹到 [0, safeTotal - desired]：滚动超出末尾时窗口整体回退，
  // 保证至少渲染尾部几行且 end 不越界；若 start 直接夹到 total，
  // 会得到 start == end == total、visible == 0 的空列表。
  const start = Math.max(0, Math.min(rawStart, Math.max(0, safeTotal - desired)))
  const end = Math.max(start, Math.min(safeTotal, rawStart + desired))
  return {
    start,
    end,
    totalHeight: safeTotal * safeRow,
    visible: Math.max(0, end - start),
    overscan: safeOverscan
  }
}

/**
 * 是否值得走虚拟化（总行数超过阈值时 DOM 收益明显）。
 * 小于等于阈值直接全量渲染更简单，无虚拟化开销。
 */
export function shouldVirtualize(total: number, threshold = 200): boolean {
  return total > threshold
}
