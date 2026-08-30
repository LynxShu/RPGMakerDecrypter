/**
 * 存档编辑器控制器（renderer）。
 *
 * 入口 `initSaveEditor()`：绑定两个打开按钮（选目录 / 选文件）、存档文件列表、
 * 快捷表单 ↔ JSON 树子 tab、保存（写回）按钮、JSON 树搜索。
 *
 * 数据流：contents（解码后的存档对象）为唯一数据源，快捷表单与 JSON 树
 * 都原地 mutate 它；任一改动 → onModelChange → 标记 dirty + 重渲染当前活动视图。
 * 保存时经 IPC 编码写回（主进程先备份原文件）。
 *
 * 性能：快捷表单 / JSON 树的标签按 locale 缓存（`tMany` 一次），之后同步取用；
 * 编辑时只重渲染当前活动子 tab（编辑快捷表单不重建 JSON 树，反之亦然）。
 */
import { renderJsonTree, collectSearchMatches, scrollJsonTreeTo, pathKey, type JsonTreeLabels, type SearchMatch } from './jsonTree'
import { renderQuickForm } from './quickForm'
import type { SaveFieldSchema } from '../../../lib/save/schema'
import type { LoadedSave, SaveFileInfo } from '../../../preload/index'

const dsh = window.dsh

export interface SaveEditorOptions {
  /** 成功加载/打开存档后的回调（如刷新最近历史） */
  onOpen?: () => void
}

interface SaveEditorState {
  files: SaveFileInfo[]
  current: LoadedSave | null
  dirty: boolean
  subTab: 'quick' | 'json'
  treeExpanded: Set<string>
  formOpen: Set<string>
  /** schema 目录提供的插件自定义字段（蓝图 §11.4-1） */
  schemaFields: SaveFieldSchema[]
  // JSON 树搜索
  searchQuery: string
  searchMatches: SearchMatch[]
  searchIndex: number
}

// ---- 标签缓存（按 locale；i18n 变更时失效） ----
const QUICK_LABEL_KEYS = [
  'gold', 'party', 'partyActors', 'items', 'weapons', 'armors', 'variables', 'switches',
  'position', 'actors', 'level', 'hp', 'mp', 'tp', 'mapId', 'x', 'y', 'direction',
  'id', 'count', 'value', 'empty', 'add', 'remove', 'missing', 'schemaFields'
]
const JSON_LABEL_KEYS = [
  'jsonCollapse', 'jsonExpand', 'jsonAddChild', 'jsonRemove', 'jsonKeyName',
  'jsonToggle', 'jsonReplace', 'searchNoMatch'
]

let labelsCache: Record<string, string> | null = null
let schemaDictCache: Record<string, string> = {}

async function ensureLabels(): Promise<void> {
  if (labelsCache) return
  const keys = [...QUICK_LABEL_KEYS, ...JSON_LABEL_KEYS].map((k) => `save.${k}`)
  labelsCache = await dsh.tMany(keys)
}

async function resolveSchemaDict(fields: SaveFieldSchema[]): Promise<Record<string, string>> {
  const labelKeys = [...new Set(fields.map((f) => f.labelKey).filter(Boolean))] as string[]
  const groupKeys = [...new Set(fields.map((f) => f.groupKey).filter(Boolean))] as string[]
  const all = [...labelKeys, ...groupKeys]
  if (all.length === 0) return {}
  return dsh.tMany(all)
}

function invalidateCaches(): void {
  labelsCache = null
  schemaDictCache = {}
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

export function initSaveEditor(opts?: SaveEditorOptions): SaveEditorHandle {
  const state: SaveEditorState = {
    files: [],
    current: null,
    dirty: false,
    subTab: 'quick',
    treeExpanded: new Set(),
    formOpen: new Set(),
    schemaFields: [],
    searchQuery: '',
    searchMatches: [],
    searchIndex: 0
  }

  const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!
  const t = (key: string, params?: Record<string, string | number>): Promise<string> =>
    dsh.t(`save.${key}`, params)

  const fileList = $('#saveFileList')
  const statusEl = $('#saveStatus')
  const quickBody = $('#saveQuick')
  const jsonBody = $('#saveJson')
  const writeBtn = $('#saveWriteBtn') as HTMLButtonElement
  const writeStatus = $('#saveWriteStatus')
  const dirtyEl = $('#saveDirty')

  const jsonSearch = $('#jsonSearch')
  const searchInput = $('#jsonSearchInput') as HTMLInputElement
  const searchCount = $('#jsonSearchCount')
  const searchPrev = $('#jsonSearchPrev') as HTMLButtonElement
  const searchNext = $('#jsonSearchNext') as HTMLButtonElement
  const searchClear = $('#jsonSearchClear') as HTMLButtonElement

  const setStatus = (text: string): void => {
    statusEl.textContent = text
  }
  const setWriteStatus = (text: string): void => {
    writeStatus.textContent = text
  }
  /** 把选中的路径以悬浮提示挂到按钮上（与主视觉一致的 picker 逻辑） */
  const setTip = (sel: string, path: string): void => {
    const btn = $(sel)
    if (path) {
      btn.setAttribute('data-tip', path)
      btn.classList.add('is-set')
    } else {
      btn.removeAttribute('data-tip')
      btn.classList.remove('is-set')
    }
  }

  function renderFileList(): void {
    fileList.innerHTML = ''
    if (state.files.length === 0) {
      const empty = el('div', 'empty muted')
      empty.textContent = '—'
      fileList.appendChild(empty)
      return
    }
    for (const f of state.files) {
      const item = el('div', 'fileItem saveFileItem')
      const badge = el('span', 'saveKindBadge')
      badge.textContent = f.kind ? f.kind.toUpperCase() : '?'
      const name = el('span')
      name.textContent = f.name
      item.append(badge, name)
      item.title = `${f.size} bytes`
      item.addEventListener('click', () => void loadFile(f.absPath))
      fileList.appendChild(item)
    }
  }

  function jsonLabels(): JsonTreeLabels {
    const l = labelsCache ?? {}
    return {
      collapse: l['save.jsonCollapse'] ?? 'Collapse',
      expand: l['save.jsonExpand'] ?? 'Expand',
      addChild: l['save.jsonAddChild'] ?? 'Add child',
      remove: l['save.jsonRemove'] ?? 'Remove',
      keyName: l['save.jsonKeyName'] ?? 'Key name',
      toggle: l['save.jsonToggle'] ?? 'Click to toggle',
      replace: l['save.jsonReplace'] ?? 'Replace: remove and add'
    }
  }

  function renderQuick(): void {
    const c = state.current
    if (!c) return
    renderQuickForm(quickBody, c.contents, {
      onChange: onModelChange,
      open: state.formOpen,
      schemaFields: state.schemaFields,
      labels: labelsCache ?? {},
      schemaDict: schemaDictCache
    })
  }

  function renderJson(): void {
    const c = state.current
    if (!c) return
    const matchKeys = new Set<string>()
    for (const m of state.searchMatches) matchKeys.add(pathKey(m.segs))
    const currentKey =
      state.searchIndex >= 0 && state.searchIndex < state.searchMatches.length
        ? pathKey(state.searchMatches[state.searchIndex].segs)
        : null
    renderJsonTree(jsonBody, c.contents, {
      root: c.contents,
      expanded: state.treeExpanded,
      onChange: onModelChange,
      labels: jsonLabels(),
      matchKeys,
      currentMatchKey: currentKey
    })
  }

  function renderActive(): void {
    if (state.subTab === 'json') renderJson()
    else renderQuick()
  }

  function onModelChange(): void {
    if (!state.dirty) {
      state.dirty = true
      dirtyEl.hidden = false
      void (async () => {
        dirtyEl.textContent = await t('dirty')
      })()
    }
    refreshSearchIfActive()
    renderActive()
  }

  // ---- JSON 树搜索 ----
  function updateSearchUi(): void {
    const q = state.searchQuery.trim()
    const n = state.searchMatches.length
    if (!q) {
      searchCount.textContent = ''
    } else if (n === 0) {
      searchCount.textContent = labelsCache?.['save.searchNoMatch'] ?? 'No matches'
    } else {
      searchCount.textContent = `${state.searchIndex + 1} / ${n}`
    }
    searchPrev.disabled = n === 0
    searchNext.disabled = n === 0
  }

  function scrollToCurrentMatch(): void {
    const m = state.searchMatches[state.searchIndex]
    if (!m) return
    scrollJsonTreeTo(jsonBody, m.segs)
  }

  function applySearch(query: string): void {
    if (!state.current) return
    state.searchQuery = query
    state.searchMatches = query.trim() ? collectSearchMatches(state.current.contents, query) : []
    state.searchIndex = 0
    // 展开首个命中的祖先，使命中节点可见（否则在折叠子树里 scrollIntoView 无效）
    if (state.searchMatches.length > 0) {
      const segs = state.searchMatches[0].segs
      for (let i = 1; i < segs.length; i++) state.treeExpanded.add(pathKey(segs.slice(0, i)))
    }
    renderJson()
    updateSearchUi()
    if (state.searchMatches.length > 0) scrollToCurrentMatch()
  }

  function navigateSearch(dir: 1 | -1): void {
    const n = state.searchMatches.length
    if (n === 0) return
    state.searchIndex = (state.searchIndex + dir + n) % n
    const segs = state.searchMatches[state.searchIndex].segs
    // 展开所有祖先，使命中节点可见
    for (let i = 1; i < segs.length; i++) state.treeExpanded.add(pathKey(segs.slice(0, i)))
    renderJson()
    updateSearchUi()
    scrollToCurrentMatch()
  }

  function refreshSearchIfActive(): void {
    if (!state.searchQuery.trim() || !state.current) return
    state.searchMatches = collectSearchMatches(state.current.contents, state.searchQuery)
    if (state.searchIndex >= state.searchMatches.length) {
      state.searchIndex = Math.max(0, state.searchMatches.length - 1)
    }
    updateSearchUi()
  }

  async function loadFile(absPath: string): Promise<void> {
    setStatus(await t('loading'))
    setWriteStatus('')
    dirtyEl.hidden = true
    try {
      const loaded = await dsh.loadSave(absPath)
      state.current = loaded
      state.dirty = false
      writeBtn.disabled = false
      state.treeExpanded.clear()
      state.formOpen.clear()
      // 重置搜索状态
      state.searchQuery = ''
      state.searchMatches = []
      state.searchIndex = 0
      searchInput.value = ''
      await ensureLabels()
      updateSearchUi()
      renderActive()
      setStatus(`${loaded.name} · ${loaded.kind.toUpperCase()} · ${loaded.size} B`)
      setTip('#saveOpenFileBtn', absPath)
      opts?.onOpen?.()
    } catch (e) {
      state.current = null
      writeBtn.disabled = true
      quickBody.innerHTML = ''
      jsonBody.innerHTML = ''
      setStatus(`${await t('loadError')}: ${String(e)}`)
    }
  }

  async function writeBack(): Promise<void> {
    const c = state.current
    if (!c) return
    writeBtn.disabled = true
    setWriteStatus(await t('writing'))
    const res = await dsh.writeSave(c.absPath, c.contents, c.kind)
    if (res.ok) {
      state.dirty = false
      dirtyEl.hidden = true
      setWriteStatus(await t('saved', { backup: res.backupPath ?? '' }))
    } else {
      setWriteStatus(await t('writeError', { error: res.error ?? '' }))
    }
    writeBtn.disabled = false
  }

  function setSubTab(tab: 'quick' | 'json'): void {
    state.subTab = tab
    quickBody.hidden = tab !== 'quick'
    jsonBody.hidden = tab !== 'json'
    jsonSearch.hidden = tab !== 'json'
    $('#stabQuick').classList.toggle('active', tab === 'quick')
    $('#stabJson').classList.toggle('active', tab === 'json')
    renderActive()
  }

  async function openDir(dir?: string): Promise<void> {
    const target = dir ?? (await dsh.openSaveDir())?.dir
    if (!target) return
    const files = await dsh.scanSaveDir(target)
    state.files = files
    renderFileList()
    setStatus(await t('filesFound', { count: files.length }))
    setTip('#saveOpenDirBtn', target)
    opts?.onOpen?.()
  }

  // 拉取 schema 目录里的插件自定义字段（蓝图 §11.4-1）
  void (async () => {
    const s = await dsh.getSchemas()
    state.schemaFields = s.fields
    schemaDictCache = await resolveSchemaDict(s.fields)
    if (state.current) renderActive()
  })()

  // 语言包热更新：清缓存 + 重新拉标签 + 重渲染（快捷表单/JSON 树标题跟随语言）
  dsh.onI18nChanged(() => {
    invalidateCaches()
    void (async () => {
      await ensureLabels()
      schemaDictCache = await resolveSchemaDict(state.schemaFields)
      if (state.current) renderActive()
    })()
  })

  // ---- 事件绑定 ----
  $('#saveOpenDirBtn').addEventListener('click', () => void openDir())

  $('#saveOpenFileBtn').addEventListener('click', async () => {
    const res = await dsh.openSaveFile()
    if (!res) return
    await loadFile(res.file)
  })

  $('#stabQuick').addEventListener('click', () => setSubTab('quick'))
  $('#stabJson').addEventListener('click', () => setSubTab('json'))
  writeBtn.addEventListener('click', () => void writeBack())

  // 搜索（200ms 防抖）
  let searchTimer: number | undefined
  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => applySearch(searchInput.value), 200)
  })
  searchPrev.addEventListener('click', () => navigateSearch(-1))
  searchNext.addEventListener('click', () => navigateSearch(1))
  searchClear.addEventListener('click', () => {
    window.clearTimeout(searchTimer)
    searchInput.value = ''
    applySearch('')
  })

  // 暴露给 main.ts 的拖放入口（按当前 tab 分发）
  return { loadFile, openDir }
}

/** initSaveEditor 的句柄（供 main.ts 拖放分发） */
export interface SaveEditorHandle {
  loadFile(absPath: string): Promise<void>
  openDir(dir?: string): Promise<void>
}
