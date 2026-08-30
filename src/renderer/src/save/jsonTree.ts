/**
 * JSON 树编辑器（renderer，原生 DOM）。
 *
 * 以 `contents` 为唯一数据源原地编辑：折叠/展开、标量内联编辑、
 * 对象加键 / 数组追加、任意节点删除。编辑直接 mutate `root`，
 * 通过 `onChange` 通知上层（标记 dirty 并重渲染两个视图）。
 *
 * 未知字段天然保留（只改被编辑的节点）；"@" 类标记作为普通键展示，
 * 不会误删 —— 配合 JsonEx 语义保证不毁档。
 *
 * 路径处理：内部一律用 **路径段数组**（`getPathSegs/setPathSegs/deletePathSegs`），
 * 键名本身含 `.` 时不会解析错（点分字符串路径无法表达这种键）。
 *
 * 性能（蓝图 §11.2）：大数组（如 `variables._data` 2001 项）展开时不再全量
 * 递归建 DOM，而是按可见窗口惰性渲染（虚拟列表），DOM 恒定、滚动流畅。
 *
 * 搜索：`collectSearchMatches` 在数据模型上遍历（虚拟列表 DOM 不含全部行），
 * 匹配键名 + 值（大小写不敏感子串）；渲染时高亮命中行，`scrollJsonTreeTo`
 * 支持直接行滚动与虚拟数组内跳转。
 */
import { deletePathSegs, getPathSegs, setPathSegs, type PathSeg } from '@lib/save'
import { createVirtualList, type VirtualListHandle } from '../virtualList'
import { shouldVirtualize } from '@lib/virtual'

/** JSON 树本地化标签（由上层经 i18n 缓存后传入，避免每次渲染 IPC） */
export interface JsonTreeLabels {
  collapse: string
  expand: string
  addChild: string
  remove: string
  keyName: string
  toggle: string
  replace: string
}

export interface JsonTreeOptions {
  /** 数据源根对象（原地编辑） */
  root: unknown
  /** 折叠状态集合（跨渲染保留），路径如 "system._bgmOnSave" */
  expanded: Set<string>
  onChange: () => void
  /** 本地化标签 */
  labels: JsonTreeLabels
  /** 命中的路径集合（搜索高亮所有命中） */
  matchKeys?: Set<string>
  /** 当前命中的路径（加深高亮，供 ↑/↓ 跳转定位） */
  currentMatchKey?: string | null
}

export interface SearchMatch {
  segs: PathSeg[]
}

/** 触发虚拟化的大数组阈值（元素全为标量时才虚拟化，保证行高固定） */
const LARGE_ARRAY_THRESHOLD = 200
/** 虚拟列表行高（px） */
const VROW_HEIGHT = 21
/** 虚拟列表容器固定高度（px），内部滚动 */
const VLIST_HEIGHT = 320
/** 搜索最大递归深度（与 JsonEx maxDepth 对齐） */
const SEARCH_MAX_DEPTH = 100
/** 搜索匹配上限（避免对超大存档的极端查询撑爆内存/计数） */
const SEARCH_MAX_MATCHES = 10000

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** 路径段 → 折叠状态 key（与旧字符串路径兼容；含点键用 JSON 转义避免歧义） */
export function pathKey(segs: readonly PathSeg[]): string {
  return segs.map((s) => (typeof s === 'number' ? String(s) : JSON.stringify(s))).join('.')
}

function cssEscape(s: string): string {
  try {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s
  } catch {
    return s
  }
}

/**
 * 在数据模型上收集搜索命中（键名 + 标量值，大小写不敏感子串）。
 * 虚拟列表只渲染可见行，因此搜索必须基于 `root` 而非 DOM。
 */
export function collectSearchMatches(root: unknown, query: string): SearchMatch[] {
  const q = query.trim().toLowerCase()
  const out: SearchMatch[] = []
  if (!q) return out

  const walk = (value: unknown, segs: PathSeg[], depth: number): void => {
    if (out.length >= SEARCH_MAX_MATCHES || depth > SEARCH_MAX_DEPTH) return
    if (segs.length > 0) {
      const keyText = String(segs[segs.length - 1]).toLowerCase()
      if (keyText.includes(q)) out.push({ segs })
    }
    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (out.length >= SEARCH_MAX_MATCHES) return
          walk(value[i], [...segs, i], depth + 1)
        }
      } else {
        for (const k of Object.keys(value as Record<string, unknown>)) {
          if (out.length >= SEARCH_MAX_MATCHES) return
          walk((value as Record<string, unknown>)[k], [...segs, k], depth + 1)
        }
      }
    } else if (segs.length > 0) {
      if (String(value).toLowerCase().includes(q)) out.push({ segs })
    }
  }
  walk(root, [], 0)
  return out
}

/** 当前渲染中的虚拟列表（整树重渲染前统一释放，避免 ResizeObserver/滚动监听泄漏） */
const activeVlists = new Set<VirtualListHandle>()
/** 虚拟列表 base 路径 → 句柄（供 scrollJsonTreeTo 定位数组内命中） */
const vlistByBaseKey = new Map<string, VirtualListHandle>()

export function renderJsonTree(container: HTMLElement, root: unknown, opts: JsonTreeOptions): void {
  for (const v of activeVlists) v.destroy()
  activeVlists.clear()
  vlistByBaseKey.clear()
  container.innerHTML = ''
  if (!opts.expanded.has('')) opts.expanded.add('')
  const rootNode = document.createElement('div')
  rootNode.className = 'tree-node'
  buildNode(rootNode, root, [], 0, opts)
  container.appendChild(rootNode)
}

/**
 * 把某个路径滚动到可见位置：优先直接命中 DOM 行；若在虚拟数组内，
 * 找到所属 vlist 并滚动到对应行（随后该行会被虚拟列表渲染并高亮）。
 */
export function scrollJsonTreeTo(container: HTMLElement, segs: readonly PathSeg[]): void {
  const key = pathKey(segs)
  const direct = container.querySelector<HTMLElement>(`.tree-line[data-path="${cssEscape(key)}"]`)
  if (direct) {
    direct.scrollIntoView({ block: 'center', inline: 'nearest' })
    return
  }
  for (let i = segs.length - 1; i >= 0; i--) {
    const base = segs.slice(0, i)
    const v = vlistByBaseKey.get(pathKey(base))
    if (v) {
      const idx = Number(segs[i])
      if (Number.isInteger(idx)) {
        v.scrollTo(idx)
        return
      }
    }
  }
}

/** 数组元素是否全部为标量（null/string/number/boolean）——标量数组行高固定，可虚拟化 */
function isScalarArray(value: unknown[]): boolean {
  for (const v of value) {
    if (v !== null && typeof v === 'object') return false
  }
  return true
}

/** 是否属于「下标即 ID」的语义数组（variables._data / switches._data）——删除应置 null 而非 splice */
function isIndexKeyedArray(root: unknown, segs: PathSeg[]): boolean {
  if (segs.length < 2) return false
  const parentSegs = segs.slice(0, -1)
  if (parentSegs[parentSegs.length - 1] !== '_data') return false
  const holder = parentSegs[parentSegs.length - 2]
  if (holder !== 'variables' && holder !== 'switches') return false
  return Array.isArray(getPathSegs(root, parentSegs))
}

function buildNode(parent: HTMLElement, value: unknown, segs: PathSeg[], depth: number, opts: JsonTreeOptions): void {
  const isObj = value !== null && typeof value === 'object'
  const keys = isObj ? (Array.isArray(value) ? value.length : Object.keys(value as object).length) : 0
  const collapsible = isObj && keys > 0
  const p = pathKey(segs)
  const open = collapsible && opts.expanded.has(p)

  const line = document.createElement('div')
  line.className = 'tree-line'
  line.dataset.path = p
  if (opts.matchKeys?.has(p)) line.classList.add('search-hit')
  if (opts.currentMatchKey === p) line.classList.add('search-current')

  // 折叠箭头
  const toggle = document.createElement('span')
  toggle.className = 'tree-toggle' + (collapsible ? '' : ' leaf')
  toggle.textContent = collapsible ? (open ? '▾' : '▸') : ''
  if (collapsible) {
    toggle.title = open ? opts.labels.collapse : opts.labels.expand
    toggle.addEventListener('click', () => {
      if (opts.expanded.has(p)) opts.expanded.delete(p)
      else opts.expanded.add(p)
      const kids = parent.querySelector(':scope > .tree-children')
      if (kids) (kids as HTMLElement).hidden = !opts.expanded.has(p)
      toggle.textContent = opts.expanded.has(p) ? '▾' : '▸'
    })
  }
  line.appendChild(toggle)

  // 键名
  if (depth > 0) {
    const key = String(segs[segs.length - 1])
    const keySpan = document.createElement('span')
    const isIdent = IDENT_RE.test(key)
    keySpan.className = 'tree-key' + (isIdent ? '' : ' non-id')
    keySpan.textContent = isIdent ? key : JSON.stringify(key)
    line.appendChild(keySpan)
    const colon = document.createElement('span')
    colon.className = 'tree-punct'
    colon.textContent = ': '
    line.appendChild(colon)
  }

  // 值
  if (isObj) {
    const brace = document.createElement('span')
    brace.className = 'tree-punct'
    brace.textContent = Array.isArray(value) ? '[' : '{'
    line.appendChild(brace)
    if (keys === 0) {
      const close = document.createElement('span')
      close.className = 'tree-punct'
      close.textContent = Array.isArray(value) ? ']' : '}'
      line.appendChild(close)
    } else if (!open) {
      const ellipsis = document.createElement('span')
      ellipsis.className = 'tree-punct'
      ellipsis.textContent = ` … ${keys} ${Array.isArray(value) ? ']' : '}'}` // 折叠摘要
      line.appendChild(ellipsis)
    }
    appendActions(line, segs, true, opts)
    parent.appendChild(line)
    if (collapsible) {
      const kids = document.createElement('div')
      kids.className = 'tree-children'
      kids.hidden = !open
      if (Array.isArray(value)) {
        // 大标量数组：虚拟列表惰性渲染（蓝图 §11.2）
        if (shouldVirtualize(value.length, LARGE_ARRAY_THRESHOLD) && isScalarArray(value)) {
          appendVirtualArray(kids, value, segs, depth, opts)
        } else {
          for (let i = 0; i < value.length; i++) {
            buildNode(kids, value[i], [...segs, i], depth + 1, opts)
          }
        }
      } else {
        for (const k of Object.keys(value as object)) {
          buildNode(kids, (value as Record<string, unknown>)[k], [...segs, k], depth + 1, opts)
        }
      }
      // 收尾括号
      const closeLine = document.createElement('div')
      closeLine.className = 'tree-line tree-punct'
      closeLine.textContent = Array.isArray(value) ? ']' : '}'
      kids.appendChild(closeLine)
      parent.appendChild(kids)
    }
    return
  }

  // 标量
  appendScalar(line, value, segs, opts)
  appendActions(line, segs, false, opts)
  parent.appendChild(line)
}

/** 大数组虚拟列表：每个元素一行（`<i>: 标量`），惰性渲染可见窗口 */
function appendVirtualArray(
  kids: HTMLElement,
  arr: unknown[],
  segs: PathSeg[],
  depth: number,
  opts: JsonTreeOptions
): void {
  const wrap = document.createElement('div')
  wrap.className = 'tree-vlist'
  wrap.style.height = `${VLIST_HEIGHT}px`

  const vlist = createVirtualList({
    container: wrap,
    rowHeight: VROW_HEIGHT,
    total: () => arr.length,
    renderRow: (index, el) => {
      // 行元素复用：内容已构建过则跳过（数据变化会整树重渲染重建本列表）
      if (el.childElementCount > 0) return
      const rowSegs = [...segs, index]
      const key = pathKey(rowSegs)
      const line = document.createElement('div')
      line.className = 'tree-line'
      line.dataset.path = key
      if (opts.matchKeys?.has(key)) line.classList.add('search-hit')
      if (opts.currentMatchKey === key) line.classList.add('search-current')
      const keySpan = document.createElement('span')
      keySpan.className = 'tree-key'
      keySpan.textContent = String(index)
      line.appendChild(keySpan)
      const colon = document.createElement('span')
      colon.className = 'tree-punct'
      colon.textContent = ': '
      line.appendChild(colon)
      appendScalar(line, arr[index], rowSegs, opts)
      appendActions(line, rowSegs, false, opts)
      el.appendChild(line)
    }
  })
  activeVlists.add(vlist)
  vlistByBaseKey.set(pathKey(segs), vlist)
  kids.appendChild(wrap)
  vlist.update()
}

function appendScalar(line: HTMLElement, value: unknown, segs: PathSeg[], opts: JsonTreeOptions): void {
  const span = document.createElement('span')
  if (typeof value === 'string') {
    span.className = 'tree-value-string'
    span.textContent = JSON.stringify(value)
    span.title = value
    span.addEventListener('click', () => {
      const input = document.createElement('input')
      input.className = 'tree-edit-input'
      input.type = 'text'
      input.value = value
      span.replaceWith(input)
      input.focus()
      let doneFlag = false
      const done = (): void => {
        if (doneFlag) return
        doneFlag = true
        setPathSegs(opts.root, segs, input.value)
        opts.onChange()
      }
      input.addEventListener('change', done)
      input.addEventListener('blur', done)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur()
        if (e.key === 'Escape') input.value = value
      })
    })
  } else if (typeof value === 'number') {
    span.className = 'tree-value-number'
    span.textContent = String(value)
    span.addEventListener('click', () => {
      const input = document.createElement('input')
      input.className = 'tree-edit-input'
      input.type = 'number'
      input.value = String(value)
      span.replaceWith(input)
      input.focus()
      let doneFlag = false
      const done = (): void => {
        if (doneFlag) return
        doneFlag = true
        const n = Number(input.value)
        setPathSegs(opts.root, segs, Number.isNaN(n) ? 0 : n)
        opts.onChange()
      }
      input.addEventListener('change', done)
      input.addEventListener('blur', done)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur()
      })
    })
  } else if (typeof value === 'boolean') {
    span.className = 'tree-value-boolean'
    span.textContent = String(value)
    span.title = opts.labels.toggle
    span.addEventListener('click', () => {
      setPathSegs(opts.root, segs, !value)
      opts.onChange()
    })
  } else {
    span.className = 'tree-value-null'
    span.textContent = 'null'
    span.title = opts.labels.replace
  }
  line.appendChild(span)
}

/** 对象加键的内联输入行（替代 Electron 不支持的 window.prompt） */
function promptNewKey(line: HTMLElement, parentVal: Record<string, unknown>, opts: JsonTreeOptions): void {
  const row = document.createElement('div')
  row.className = 'tree-line tree-add-row'
  const openQuote = document.createElement('span')
  openQuote.className = 'tree-key'
  openQuote.textContent = '"'
  const input = document.createElement('input')
  input.className = 'tree-edit-input'
  input.placeholder = opts.labels.keyName
  const closeQuote = document.createElement('span')
  closeQuote.className = 'tree-key'
  closeQuote.textContent = '": '
  const nullSpan = document.createElement('span')
  nullSpan.className = 'tree-value-null'
  nullSpan.textContent = 'null'
  row.append(openQuote, input, closeQuote, nullSpan)
  line.insertAdjacentElement('afterend', row)
  input.focus()

  let committed = false
  const commit = (): void => {
    if (committed) return
    committed = true
    const key = input.value.trim()
    row.remove()
    if (key !== '') {
      parentVal[key] = null
      opts.onChange()
    }
  }
  input.addEventListener('change', commit)
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur()
    if (e.key === 'Escape') {
      committed = true
      row.remove()
    }
  })
}

function appendActions(line: HTMLElement, segs: PathSeg[], collapsible: boolean, opts: JsonTreeOptions): void {
  const actions = document.createElement('span')
  actions.className = 'tree-actions'
  if (collapsible) {
    const add = document.createElement('button')
    add.className = 'btn-mini'
    add.textContent = '+'
    add.title = opts.labels.addChild
    add.addEventListener('click', () => {
      const parentVal = getPathSegs(opts.root, segs)
      if (parentVal === null || parentVal === undefined || typeof parentVal !== 'object') return
      if (Array.isArray(parentVal)) {
        parentVal.push(null)
        opts.onChange()
      } else {
        promptNewKey(line, parentVal as Record<string, unknown>, opts)
      }
    })
    actions.appendChild(add)
  }
  if (segs.length > 0) {
    const del = document.createElement('button')
    del.className = 'btn-mini danger'
    del.textContent = '✕'
    del.title = opts.labels.remove
    del.addEventListener('click', () => {
      // 下标即 ID 的语义数组（variables._data / switches._data）删除置 null，避免 splice 使 ID 错位
      if (isIndexKeyedArray(opts.root, segs)) {
        const parentSegs = segs.slice(0, -1)
        const parent = getPathSegs(opts.root, parentSegs) as unknown[]
        parent[Number(segs[segs.length - 1])] = null
      } else {
        deletePathSegs(opts.root, segs)
      }
      opts.onChange()
    })
    actions.appendChild(del)
  }
  line.appendChild(actions)
}
