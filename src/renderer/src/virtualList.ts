/**
 * 轻量虚拟列表（renderer，原生 DOM，零依赖）。
 *
 * 蓝图 §11.2：超大文件列表（数万行）只渲染可见行 + overscan，
 * DOM 数量恒定、滚动保持流畅。窗口计算复用 `@lib/virtual`（可单测）。
 *
 * 用法：
 *   const vlist = createVirtualList(container, {
 *     rowHeight: 28,
 *     total: () => state.files.length,
 *     renderRow: (i, el) => { el.textContent = state.files[i].relPath; ... }
 *   })
 *   vlist.update()   // 数据变化后刷新
 *   vlist.scrollTo(0)
 *   vlist.destroy()
 *
 * 实现：容器负责滚动（overflow: auto），内部用 padding-top/bottom 撑出
 * 总高度，只把窗口内的行放入文档流；行元素按 index 缓存复用。
 */
import { computeWindow } from '@lib/virtual'

export interface VirtualListOptions {
  /** 滚动容器（必须 overflow: auto） */
  container: HTMLElement
  /** 固定行高（px） */
  rowHeight: number
  /** 上下 overscan 行数（默认 5） */
  overscan?: number
  /** 总行数（每次 update 时读取） */
  total: () => number
  /** 渲染第 index 行内容到 el（el 已按行高设置好，只需填内容/绑定事件） */
  renderRow: (index: number, el: HTMLElement) => void
  /** 可见窗口变化回调（start/end 开区间），可选 */
  onWindowChange?: (start: number, end: number) => void
}

export interface VirtualListHandle {
  /** 数据变化/尺寸变化后重算窗口并渲染 */
  update(): void
  /** 滚动到某一行（尽量让该行进入视口） */
  scrollTo(index: number): void
  /** 释放监听与 DOM */
  destroy(): void
}

const ROW_CLASS = 'vlist-row'

export function createVirtualList(opts: VirtualListOptions): VirtualListHandle {
  const { container, rowHeight } = opts
  const overscan = opts.overscan ?? 5

  // 清掉容器原有内容，构造内部 wrapper（撑高 + 行容器）
  container.innerHTML = ''
  const inner = document.createElement('div')
  inner.className = 'vlist-inner'
  container.appendChild(inner)

  // 已挂载的行元素缓存：index → el
  const rows = new Map<number, HTMLElement>()
  let raf = 0
  let destroyed = false

  function getViewportHeight(): number {
    return container.clientHeight || container.parentElement?.clientHeight || 0
  }

  function render(): void {
    if (destroyed) return
    const total = Math.max(0, Math.floor(opts.total()))
    const win = computeWindow(container.scrollTop, getViewportHeight(), rowHeight, total, overscan)

    // 移除窗口外的行
    for (const [idx, el] of rows) {
      if (idx < win.start || idx >= win.end) {
        el.remove()
        rows.delete(idx)
      }
    }
    // 渲染窗口内的行（复用缓存元素，避免重复创建）
    for (let i = win.start; i < win.end; i++) {
      let el = rows.get(i)
      if (!el) {
        el = document.createElement('div')
        el.className = ROW_CLASS
        el.style.height = `${rowHeight}px`
        rows.set(i, el)
      }
      opts.renderRow(i, el)
      if (!el.isConnected) inner.appendChild(el)
    }

    // 用 padding 撑出总高度：上 = start * rowHeight，下 = (total - end) * rowHeight
    inner.style.paddingTop = `${win.start * rowHeight}px`
    inner.style.paddingBottom = `${(total - win.end) * rowHeight}px`
    opts.onWindowChange?.(win.start, win.end)
  }

  function scheduleRender(): void {
    if (destroyed) return
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(render)
  }

  container.addEventListener('scroll', scheduleRender, { passive: true })

  // 容器尺寸变化（窗口缩放 / tab 切换导致可见）时重算
  let resizeObs: ResizeObserver | null = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(scheduleRender)
    resizeObs.observe(container)
  }

  render()

  return {
    update: () => render(),
    scrollTo: (index: number) => {
      container.scrollTop = Math.max(0, index * rowHeight)
      render()
    },
    destroy: () => {
      destroyed = true
      cancelAnimationFrame(raf)
      container.removeEventListener('scroll', scheduleRender)
      resizeObs?.disconnect()
      resizeObs = null
      container.innerHTML = ''
      rows.clear()
    }
  }
}
