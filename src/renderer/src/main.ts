import { applyToDom, createThemeStore, type ThemeMode } from '@lib/theme'
import { initSaveEditor, type SaveEditorHandle } from './save/editor'
import { createVirtualList } from './virtualList'
import { icons, icon } from './icons'

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!
const dsh = window.dsh

// 当前激活的 tab
let activeTab: 'decrypt' | 'encrypt' | 'restore' | 'save' = 'decrypt'

// ---- 主题（持久化；light ↔ dark 互切，去掉 system 自适应） ----
async function restoreTheme(): Promise<string> {
  const saved = await dsh.getConfig()
  // 固定深色为默认；旧配置里的 system 也按固定深色迁移（用户拍板）
  return saved.theme === 'light' ? 'light' : 'dark'
}

// ---- 解密状态 ----
type FileEntry = {
  absPath: string
  relPath: string
  ext: string
  size: number
  encrypted: boolean
}
const state = {
  dir: '',
  key: '',
  files: [] as FileEntry[],
  scanJobId: '',
  scanning: false,
  processing: false,
  exporting: false
}

// 当前任务的事件订阅
let offScanBatch: (() => void) | null = null
let offScanDone: (() => void) | null = null

// ---- 文件列表（虚拟列表） ----
const FILE_ROW_HEIGHT = 32
let fileVlist: ReturnType<typeof createVirtualList> | null = null

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let u = -1
  do { v /= 1024; u++ } while (v >= 1024 && u < units.length - 1)
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`
}

function initFileList(): void {
  const list = $('#fileList') as HTMLElement
  fileVlist = createVirtualList({
    container: list,
    rowHeight: FILE_ROW_HEIGHT,
    total: () => state.files.length,
    renderRow: (index, el) => {
      const f = state.files[index]
      el.textContent = ''
      const name = document.createElement('span')
      name.className = 'file-name'
      name.textContent = f.relPath
      const size = document.createElement('span')
      size.className = 'file-size'
      size.textContent = formatBytes(f.size)
      el.appendChild(name)
      el.appendChild(size)
      el.onclick = () => {}
    }
  })
}

// ---- Logo：用户提供 logo.png 后放入 src/renderer/assets/，img 自动替换占位符 ----
function initLogo(): void {
  const slot = $('#logoSlot')
  // Vite 会把 assets 下的资源打包并给出 URL；用 import.meta.glob 惰性探测
  const glob = import.meta.glob<{ default: string }>('../assets/logo.{png,jpg,jpeg,svg}', {
    eager: false
  })
  const keys = Object.keys(glob)
  if (keys.length === 0) return
  const img = document.createElement('img')
  img.alt = 'logo'
  void glob[keys[0]]().then((m) => {
    img.src = m.default
    slot.innerHTML = ''
    slot.appendChild(img)
    // 去掉占位芯片的渐变背景，让透明底 logo 直接透出
    slot.classList.add('has-logo')
  })
}

// ---- 进度条 ----
function setProgress(elId: string, percent: number, visible: boolean): void {
  const wrap = $(`#${elId}`) as HTMLElement
  wrap.hidden = !visible
  if (visible) {
    const bar = wrap.querySelector<HTMLElement>('.bar')!
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`
  }
}

// ==========================================================================
// i18n
// ==========================================================================
async function refreshI18n(): Promise<void> {
  const version = await dsh.getVersion()
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n!
    el.textContent = await dsh.t(key)
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    const key = el.dataset.i18nPlaceholder!
    el.setAttribute('placeholder', await dsh.t(key))
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = el.dataset.i18nTitle!
    el.title = await dsh.t(key)
  }
  // 版本号：不论语言一律 `v x.x`（取前两位）
  $('#version').textContent = formatVersion(version)
}

/** 直接显示完整版本号（如 `1.0.0`），与 package.json 保持一致 */
function formatVersion(v: string): string {
  return v.replace(/^v/i, '')
}

/** 语言包热更新 */
function bindI18nHotReload(): void {
  dsh.onI18nChanged((payload) => {
    rebuildLocaleMenu(payload.locales, payload.current)
    void refreshI18n()
  })
}

async function initLocaleMenu(): Promise<void> {
  const locales = await dsh.getAvailableLocales()
  const current = await dsh.getCurrentLocale()
  rebuildLocaleMenu(locales, current)
  $('#localeBtn').innerHTML = icons.globe
}

function rebuildLocaleMenu(locales: Array<{ code: string; name: string }>, current: string): void {
  const menu = $('#localeMenu')
  menu.innerHTML = ''
  for (const loc of locales) {
    const item = document.createElement('button')
    item.className = 'menu-item' + (loc.code === current ? ' selected' : '')
    item.dataset.locale = loc.code
    item.textContent = loc.name
    item.addEventListener('click', async () => {
      await dsh.setLocale(loc.code)
      void dsh.setConfig({ locale: loc.code })
      closeMenus()
      // 切换后重建菜单，让高亮与排序跟随当前语种（修复：之前 .selected 永远停在启动时的第一项）
      rebuildLocaleMenu(await dsh.getAvailableLocales(), loc.code)
      await refreshI18n()
    })
    menu.appendChild(item)
  }
}

// ==========================================================================
// 顶栏菜单（语言）+ 工具按钮
// ==========================================================================
let themeStore: ReturnType<typeof createThemeStore> | null = null

/** 关闭语言下拉菜单 */
function closeMenus(): void {
  const menu = $('#localeMenu')
  menu.classList.remove('open')
  const btn = $('#localeBtn')
  btn.classList.remove('active')
  btn.setAttribute('aria-expanded', 'false')
}

function toggleMenu(menu: HTMLElement, btn: HTMLElement): void {
  const isOpen = menu.classList.contains('open')
  closeMenus()
  if (!isOpen) {
    menu.classList.add('open')
    btn.classList.add('active')
    btn.setAttribute('aria-expanded', 'true')
  }
}

// ---- 主题：点击图标直接 light ↔ dark 互切 ----
// 水波纹为半透明墨水涟漪（Material 风格），界面始终可见，不被纯色遮挡；
// 主题色切换本身由 body 的 background transition 平滑完成。
function rippleInk(next: 'light' | 'dark'): string {
  return next === 'dark' ? 'rgba(255, 255, 255, 0.28)' : 'rgba(15, 23, 42, 0.20)'
}

function updateThemeBtn(mode: ThemeMode): void {
  const btn = $('#themeBtn')
  btn.innerHTML = mode === 'light' ? icons.sun : icons.moon
}

/** 从按钮位置扩散半透明水波纹（覆盖整个界面但透明），随后切换主题 */
function cycleTheme(): void {
  if (!themeStore) return
  const cur = themeStore.getMode()
  const next: 'light' | 'dark' = cur === 'dark' ? 'light' : 'dark'

  const btn = $('#themeBtn')
  const rect = btn.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  // 半径需覆盖到离按钮最远的屏幕角
  const maxR = Math.hypot(
    Math.max(cx, window.innerWidth - cx),
    Math.max(cy, window.innerHeight - cy)
  )
  const ripple = document.createElement('div')
  ripple.className = 'theme-ripple'
  ripple.style.left = `${cx}px`
  ripple.style.top = `${cy}px`
  ripple.style.width = `${maxR * 2}px`
  ripple.style.height = `${maxR * 2}px`
  ripple.style.background = `radial-gradient(circle at center, ${rippleInk(next)} 0%, transparent 62%)`
  document.body.appendChild(ripple)
  // 先渲染一帧再扩散 + 淡出，确保 transition 生效
  requestAnimationFrame(() => {
    ripple.style.transform = 'translate(-50%, -50%) scale(1)'
    ripple.style.opacity = '0'
  })
  // 主题切换与涟漪同步
  themeStore.setMode(next)
  // 涟漪完成后移除
  setTimeout(() => ripple.remove(), 700)
}

// ---- 更新检查：底部中央悬浮提示（toast） ----
let toastTimer: number | undefined

function hideToast(): void {
  const t = $('#toast')
  t.classList.remove('show')
  window.setTimeout(() => {
    t.hidden = true
  }, 220)
}

function showToast(node: HTMLElement, autoHideMs?: number): void {
  const t = $('#toast')
  t.innerHTML = ''
  t.appendChild(node)
  t.hidden = false
  t.classList.remove('show')
  void t.offsetWidth // reflow，重启入场动画
  t.classList.add('show')
  window.clearTimeout(toastTimer)
  if (autoHideMs) toastTimer = window.setTimeout(hideToast, autoHideMs)
}

function toastRow(text: string, extra?: HTMLElement): HTMLElement {
  const box = document.createElement('div')
  box.style.cssText = 'display:flex;flex-direction:column;gap:8px;align-items:center;'
  const row = document.createElement('div')
  row.textContent = text
  box.appendChild(row)
  if (extra) box.appendChild(extra)
  return box
}

function toastActionRow(actions: Array<{ label: string; primary?: boolean; onClick: () => void }>): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;gap:8px;'
  for (const a of actions) {
    const b = document.createElement('button')
    b.className = 'btn' + (a.primary ? ' primary' : '')
    b.textContent = a.label
    b.addEventListener('click', a.onClick)
    wrap.appendChild(b)
  }
  return wrap
}

async function checkUpdate(): Promise<void> {
  const btn = $('#updateBtn') as HTMLButtonElement
  btn.disabled = true
  btn.style.opacity = '0.6'
  try {
    showToast(toastRow(await dsh.t('update.checking')))
    const res = await dsh.checkUpdate()
    if (!res.ok) {
      // 检查失败：静默，几秒后自动消失（与「已是最新」同处理）
      showToast(toastRow(await dsh.t('update.checkFailed')), 3000)
      return
    }
    if (!res.hasUpdate) {
      showToast(toastRow(await dsh.t('update.latest')), 3000)
      return
    }
    // 有新版本：常驻不消失，提供「下载 / 关闭」
    const row = toastRow(
      await dsh.t('update.available', { version: res.latest ?? '' }),
      toastActionRow([
        { label: await dsh.t('update.download'), primary: true, onClick: () => void dsh.openExternal(res.url ?? '') },
        { label: await dsh.t('update.close'), onClick: hideToast }
      ])
    )
    showToast(row)
  } finally {
    btn.disabled = false
    btn.style.opacity = ''
  }
}

async function initTheme(): Promise<void> {
  const initial = (await restoreTheme()) as ThemeMode
  themeStore = createThemeStore({
    mode: initial,
    persist: {
      get: () => null,
      set: (mode) => void dsh.setConfig({ theme: mode })
    }
  })
  const render = (): void => {
    applyToDom(themeStore!.getResolved())
    updateThemeBtn(themeStore!.getMode())
  }
  themeStore.subscribe(render)
  render()
}

// ==========================================================================
// 解密流程
// ==========================================================================
async function renderFileList(): Promise<void> {
  const list = $('#fileList') as HTMLElement
  if (state.files.length === 0) {
    fileVlist?.destroy()
    fileVlist = null
    list.innerHTML = ''
    const empty = document.createElement('div')
    empty.className = 'file-empty muted'
    empty.textContent = await dsh.t('error.noEncryptedFiles')
    list.appendChild(empty)
    return
  }
  if (!fileVlist) initFileList()
  else fileVlist.update()
}

function renderStats(): void {
  const exported = state.exporting
  if (!exported) {
    $('#statTotal').textContent = String(state.files.length)
    $('#statOk').textContent = '—'
    $('#statFail').textContent = '—'
    $('#statMagic').textContent = '—'
  }
}

function setScanStatus(text: string): void {
  const el = $('#scanStatus')
  if (el) el.textContent = text
}

/** 更新解密主按钮（FAB）的状态：开始 / 扫描取消 / 解密取消 / 导出取消 */
function updateDecryptFab(): void {
  const btn = $('#scanBtn') as HTMLButtonElement
  const busy = state.scanning || state.processing || state.exporting
  if (busy) {
    btn.textContent = '…'
    void dsh.t('crypto.cancel').then((t) => (btn.textContent = t))
    btn.classList.add('danger')
    btn.disabled = false
  } else {
    void dsh.t('crypto.startDecrypt').then((t) => {
      btn.textContent = t
      btn.disabled = !state.dir
    })
    btn.classList.remove('danger')
  }
}

function setScanningUI(on: boolean): void {
  state.scanning = on
  ;($('#openBtn') as HTMLButtonElement).disabled = on
  ;($('#keyInput') as HTMLInputElement).disabled = on
  updateDecryptFab()
}

function detachScanListeners(): void {
  offScanBatch?.()
  offScanDone?.()
  offScanBatch = null
  offScanDone = null
}

function setProcessUI(on: boolean): void {
  state.processing = on
  ;($('#openBtn') as HTMLButtonElement).disabled = on
  ;($('#keyInput') as HTMLInputElement).disabled = on
  updateDecryptFab()
}

function setExportingUI(on: boolean): void {
  state.exporting = on
  ;($('#exportBtn') as HTMLButtonElement).disabled = on
  ;($('#exportZipBtn') as HTMLButtonElement).disabled = on
  updateDecryptFab()
}

/** 密钥验证图标（嵌在密钥框最右）：通过 ✓ / 未通过 ✕，悬浮显示提示 */
async function setKeyState(ok: boolean | null, tipKey: string): Promise<void> {
  const el = $('#keyState') as HTMLElement
  const box = $('#keyStatus') as HTMLElement
  box.dataset.ok = ok === null ? '0' : ok ? '1' : '0'
  if (ok === null) {
    el.hidden = true
    el.innerHTML = ''
    el.className = 'key-state'
    el.removeAttribute('data-tip')
    return
  }
  const iconName = ok ? 'checkCircle' : 'xCircle'
  el.hidden = false
  el.className = 'key-state ' + (ok ? 'ok' : 'bad')
  el.innerHTML = icon(iconName)
  el.setAttribute('data-tip', await dsh.t(tipKey))
}

/** 开始解密 = 扫描加密文件 + 自动找 key + key 预检 */
async function startDecrypt(dir: string): Promise<void> {
  await dsh.cancelScan()
  detachScanListeners()

  state.dir = dir
  state.key = ''
  state.files = []
  void renderFileList()
  ;($('#keyInput') as HTMLInputElement).value = ''
  ;($('#exportBtn') as HTMLButtonElement).disabled = true
  ;($('#exportZipBtn') as HTMLButtonElement).disabled = true
  void setKeyState(null, '')
  setProgress('scanProgress', 0, false)
  setProgress('exportProgress', 0, false)
  setScanStatus(await dsh.t('crypto.scanning'))
  setScanningUI(true)

  const jobId = crypto.randomUUID()
  state.scanJobId = jobId

  offScanBatch = dsh.onScanBatch((p) => {
    if (p.jobId !== state.scanJobId) return
    state.files.push(...p.files)
    void renderFileList()
    void setScanStatusFromFound(p.found)
  })
  offScanDone = dsh.onScanDone(async (p) => {
    if (p.jobId !== state.scanJobId) return
    setScanningUI(false)
    state.key = p.key ?? ''
    ;($('#keyInput') as HTMLInputElement).value = state.key
    if (p.canceled) {
      setScanStatus(await dsh.t('task.cancelled'))
      await setKeyState(null, '')
    } else {
      await setScanStatusFromFound(p.found)
      renderStats()
      if (p.keyOk === true) await setKeyState(true, 'crypto.keyOk')
      else if (p.keyOk === false) await setKeyState(false, 'crypto.keyBad')
      else await setKeyState(p.key ? true : null, p.key ? 'crypto.keyOk' : 'error.noKey')
      // 扫完自动开跑解密（把结果落到缓存），跑完再决定导出
      if (p.keyOk !== false && state.key) void runProcess()
    }
  })

  const res = await dsh.scanStart(dir, jobId)
  state.scanJobId = res.jobId ?? jobId
}

async function setScanStatusFromFound(found: number): Promise<void> {
  setScanStatus(await dsh.t('crypto.found', { count: found }))
}

// ---- 解密到缓存（「开始解密」的真正执行） ----
async function runProcess(): Promise<void> {
  if (state.files.length === 0 || !state.key) return
  const box = $('#scanStatus') as HTMLElement
  setProcessUI(true)
  box.textContent = await dsh.t('task.working')
  setProgress('exportProgress', 0, true)
  const unsubscribe = bindExportProgress(box)
  try {
    const res = await dsh.processAll(state.files, state.key)
    if (res.canceled) {
      box.textContent = await dsh.t('task.cancelled')
    } else {
      let text = await dsh.t('task.completed', { count: res.ok })
      if (res.magicFail) text += '\n' + (await dsh.t('crypto.magicFail', { count: res.magicFail }))
      box.textContent = text
      ;($('#exportBtn') as HTMLButtonElement).disabled = false
      ;($('#exportZipBtn') as HTMLButtonElement).disabled = false
    }
    $('#statOk').textContent = String(res.ok)
    $('#statFail').textContent = String(res.fail)
    $('#statMagic').textContent = String(res.magicFail ?? 0)
  } finally {
    unsubscribe()
    setProcessUI(false)
    setProgress('exportProgress', 100, true)
    setTimeout(() => setProgress('exportProgress', 0, false), 1200)
  }
}

// ---- 导出（从缓存拷走/打包） ----
function bindExportProgress(box: HTMLElement): () => void {
  return dsh.onExportProgress((p) => {
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
    setProgress('exportProgress', pct, true)
    const base = `${pct}% (${p.done}/${p.total})  成功 ${p.ok}  失败 ${p.fail}`
    box.textContent = p.current ? `${base}\n${p.current}` : base
    $('#statOk').textContent = String(p.ok)
    $('#statFail').textContent = String(p.fail)
  })
}

async function runExport(mode: 'files' | 'zip'): Promise<void> {
  if (state.files.length === 0) return
  const box = $('#scanStatus') as HTMLElement
  setExportingUI(true)
  box.textContent = await dsh.t('task.working')
  setProgress('exportProgress', 0, true)
  const unsubscribe = bindExportProgress(box)
  try {
    const res = mode === 'files' ? await dsh.exportFiles() : await dsh.exportZip()
    if (res.canceled) {
      box.textContent = await dsh.t('task.cancelled')
    } else {
      const text = await dsh.t('task.completed', { count: res.ok })
      box.textContent = text
      $('#statOk').textContent = String(res.ok)
    }
  } finally {
    unsubscribe()
    setExportingUI(false)
    setProgress('exportProgress', 100, true)
    setTimeout(() => setProgress('exportProgress', 0, false), 1200)
  }
}

/** 重置：清空解密缓存 + 清空工作区 */
async function resetDecrypt(): Promise<void> {
  await dsh.cancelExport()
  await dsh.cancelScan()
  detachScanListeners()
  await dsh.clearDecrypt()
  state.dir = ''
  state.key = ''
  state.files = []
  state.scanning = false
  state.processing = false
  state.exporting = false
  ;($('#keyInput') as HTMLInputElement).value = ''
  ;($('#keyInput') as HTMLInputElement).disabled = false
  ;($('#openBtn') as HTMLButtonElement).disabled = false
  ;($('#exportBtn') as HTMLButtonElement).disabled = true
  ;($('#exportZipBtn') as HTMLButtonElement).disabled = true
  await setKeyState(null, '')
  setScanStatus('')
  setProgress('scanProgress', 0, false)
  setProgress('exportProgress', 0, false)
  await renderFileList()
  updateDecryptFab()
}

// ==========================================================================
// 批量工具（加密 / 图片还原）：文件/目录选择 + 输出目录 + 进度 + 取消
// ==========================================================================
type ToolFile = { absPath: string; relPath: string; ext: string; size: number }

interface ToolState {
  files: ToolFile[]
  label: string
  outputDir: string
  version: 'mv' | 'mz'
  running: boolean
}

interface ToolUiSpec {
  state: ToolState
  mode: 'encrypt' | 'restore'
  /** 可处理扩展名（小写） */
  exts: string[]
  /** 选中来源后，把路径作为悬浮提示挂到的按钮 */
  pickFileSel: string
  pickDirSel: string
  /** 输出目录按钮：选择后把目录作为悬浮提示挂到它上面 */
  outSel: string
  /** 底部主按钮（开始/取消合并） */
  goSel: string
  statusSel: string
  progressId: string
  statsSel: string
  statOkSel: string
  statFailSel: string
  statSkipSel: string
  fileListSel: string
  openOutSel: string
}

const encState: ToolState = { files: [], label: '', outputDir: '', version: 'mv', running: false }
const resState: ToolState = { files: [], label: '', outputDir: '', version: 'mv', running: false }

const ENC_EXTS = ['png', 'm4a', 'ogg']
const RES_EXTS = ['rpgmvp', 'png_']

const encUi: ToolUiSpec = {
  state: encState,
  mode: 'encrypt',
  exts: ENC_EXTS,
  pickFileSel: '#encPickFileBtn',
  pickDirSel: '#encPickDirBtn',
  outSel: '#encOutBtn',
  goSel: '#encGoBtn',
  statusSel: '#encStatus',
  progressId: 'encProgress',
  statsSel: '#encStats',
  statOkSel: '#encStatOk',
  statFailSel: '#encStatFail',
  statSkipSel: '#encStatSkip',
  fileListSel: '#encFileList',
  openOutSel: '#encOpenOutBtn'
}

const resUi: ToolUiSpec = {
  state: resState,
  mode: 'restore',
  exts: RES_EXTS,
  pickFileSel: '#resPickFileBtn',
  pickDirSel: '#resPickDirBtn',
  outSel: '#resOutBtn',
  goSel: '#resGoBtn',
  statusSel: '#resStatus',
  progressId: 'resProgress',
  statsSel: '#resStats',
  statOkSel: '#resStatOk',
  statFailSel: '#resStatFail',
  statSkipSel: '#resStatSkip',
  fileListSel: '#resFileList',
  openOutSel: '#resOpenOutBtn'
}

async function renderToolFileList(spec: ToolUiSpec): Promise<void> {
  const { state, fileListSel } = spec
  const list = $(fileListSel) as HTMLElement
  list.innerHTML = ''
  if (state.files.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'file-empty muted'
    empty.textContent = await dsh.t('error.noEncryptedFiles')
    list.appendChild(empty)
    return
  }
  const MAX_ROWS = 300
  state.files.slice(0, MAX_ROWS).forEach((f) => {
    const row = document.createElement('div')
    row.className = 'fileItem'
    const name = document.createElement('span')
    name.className = 'file-name'
    name.textContent = f.relPath
    const size = document.createElement('span')
    size.className = 'file-size'
    size.textContent = formatBytes(f.size)
    row.appendChild(name)
    row.appendChild(size)
    list.appendChild(row)
  })
  if (state.files.length > MAX_ROWS) {
    const more = document.createElement('div')
    more.className = 'muted'
    more.style.padding = '4px 10px'
    more.textContent = `… 共 ${state.files.length} 个文件`
    list.appendChild(more)
  }
}

/** 把选中路径作为悬浮提示挂到按钮上，并高亮「已选择」状态 */
function setButtonTooltip(btnSel: string, path: string, siblingSel?: string): void {
  const btn = $(btnSel) as HTMLElement
  if (path) {
    btn.setAttribute('data-tip', path)
    btn.classList.add('is-set')
  } else {
    btn.removeAttribute('data-tip')
    btn.classList.remove('is-set')
  }
  if (siblingSel) {
    const sib = $(siblingSel) as HTMLElement
    sib.removeAttribute('data-tip')
    sib.classList.remove('is-set')
  }
}

/** 更新工具的底部主按钮（FAB）：开始 / 取消 */
function updateToolFab(spec: ToolUiSpec): void {
  const { state, mode } = spec
  const btn = $(spec.goSel) as HTMLButtonElement
  if (state.running) {
    btn.classList.add('danger')
    btn.disabled = false
    void dsh.t('crypto.cancel').then((t) => (btn.textContent = t))
  } else {
    btn.classList.remove('danger')
    const startKey = mode === 'encrypt' ? 'encrypt.start' : 'restore.start'
    void dsh.t(startKey).then((t) => (btn.textContent = t))
    const keyEl = $('#encKey') as HTMLInputElement | null
    const hasKey = mode !== 'encrypt' || (keyEl ? keyEl.value.trim() !== '' : false)
    const hasFiles = state.files.length > 0
    btn.disabled = !(hasFiles && hasKey)
  }
}

async function setToolFiles(spec: ToolUiSpec, files: ToolFile[], label: string, tipSel: string): Promise<void> {
  const { state } = spec
  state.files = files
  state.label = label
  // 路径不再常驻显示，改为悬浮在触发按钮上；同时清掉另一个来源按钮的旧提示
  setButtonTooltip(tipSel, label, tipSel === spec.pickFileSel ? spec.pickDirSel : spec.pickFileSel)
  updateToolFab(spec)
  await renderToolFileList(spec)
}

function basenameOf(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

async function pickToolFile(spec: ToolUiSpec): Promise<void> {
  const p = await dsh.pickFile()
  if (!p) return
  const ext = basenameOf(p).split('.').pop()?.toLowerCase() ?? ''
  await setToolFiles(spec, [{ absPath: p, relPath: basenameOf(p), ext, size: -1 }], p, spec.pickFileSel)
}

async function pickToolDir(spec: ToolUiSpec): Promise<void> {
  const dir = await dsh.selectDir()
  if (!dir) return
  const files = await dsh.listFilesByExt(dir, spec.exts)
  await setToolFiles(spec, files, dir, spec.pickDirSel)
  const status = $(spec.statusSel) as HTMLElement
  status.textContent = files.length
    ? await dsh.t('tool.found', { count: files.length })
    : await dsh.t('error.noEncryptedFiles')
}

async function pickToolOutput(spec: ToolUiSpec): Promise<void> {
  const dir = await dsh.selectDir()
  if (!dir) return
  spec.state.outputDir = dir
  setButtonTooltip(spec.outSel, dir)
}

function setToolRunning(spec: ToolUiSpec, on: boolean): void {
  spec.state.running = on
  const disable = (sel: string): void => {
    const el = $(sel) as HTMLButtonElement | null
    if (el) el.disabled = on
  }
  disable(spec.pickFileSel)
  disable(spec.pickDirSel)
  disable(spec.outSel)
  disable('#encKey')
  updateToolFab(spec)
}

function resetToolStats(spec: ToolUiSpec): void {
  $(spec.statOkSel).textContent = '0'
  $(spec.statFailSel).textContent = '0'
  $(spec.statSkipSel).textContent = '0'
}

function bindToolProgress(spec: ToolUiSpec, statusEl: HTMLElement): () => void {
  return dsh.onToolProgress((p) => {
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
    setProgress(spec.progressId, pct, true)
    const base = `${pct}% (${p.done}/${p.total})  成功 ${p.ok}  失败 ${p.fail}  跳过 ${p.skip}`
    statusEl.textContent = p.current ? `${base}\n${p.current}` : base
    $(spec.statOkSel).textContent = String(p.ok)
    $(spec.statFailSel).textContent = String(p.fail)
    $(spec.statSkipSel).textContent = String(p.skip)
  })
}

function bindToolFab(spec: ToolUiSpec): void {
  ;($(spec.goSel) as HTMLButtonElement).addEventListener('click', () => {
    if (spec.state.running) void dsh.cancelTool()
    else void runTool(spec)
  })
}

async function runTool(spec: ToolUiSpec): Promise<void> {
  const { state, mode } = spec
  if (state.running || state.files.length === 0) return
  let key = ''
  if (mode === 'encrypt') {
    key = ($('#encKey') as HTMLInputElement).value.trim()
    if (!key) {
      ;($(spec.statusSel) as HTMLElement).textContent = await dsh.t('error.noKey')
      return
    }
  }

  setToolRunning(spec, true)
  resetToolStats(spec)
  const statusEl = $(spec.statusSel) as HTMLElement
  statusEl.textContent = await dsh.t('task.working')
  setProgress(spec.progressId, 0, true)
  const unsubscribe = bindToolProgress(spec, statusEl)
  try {
    const res =
      mode === 'encrypt'
        ? await dsh.encryptMany(state.files, key, state.version, state.outputDir || null)
        : await dsh.restoreMany(state.files, state.outputDir || null)

    // 实际输出目录（未预选时主进程弹窗/自动生成）
    if (res.outputDir) {
      state.outputDir = res.outputDir
      setButtonTooltip(spec.outSel, res.outputDir)
    }

    if (res.canceled) {
      statusEl.textContent = await dsh.t('task.cancelled')
    } else {
      let text = await dsh.t('task.completed', { count: res.ok })
      if (res.fail > 0) text += '\n' + (await dsh.t('task.failed', { count: res.fail }))
      if (res.skip > 0) text += '\n' + (await dsh.t('task.skipped', { count: res.skip }))
      statusEl.textContent = text
      // 完成后启用「打开输出目录」
      const openBtn = $(spec.openOutSel) as HTMLButtonElement
      const outDir = res.outputDir
      if (outDir) {
        openBtn.disabled = false
        openBtn.onclick = () => void dsh.openPath(outDir)
      }
    }
  } finally {
    unsubscribe()
    setToolRunning(spec, false)
    setProgress(spec.progressId, 100, true)
    setTimeout(() => setProgress(spec.progressId, 0, false), 1200)
  }
}

/** 拖放路径解析为可处理文件清单（目录→批量，文件→单个） */
async function toolFilesFromDrop(spec: ToolUiSpec, path: string): Promise<void> {
  const ext = basenameOf(path).split('.').pop()?.toLowerCase() ?? ''
  const listed = await dsh.listFilesByExt(path, spec.exts)
  if (listed.length > 0) {
    await setToolFiles(spec, listed, path, spec.pickDirSel)
  } else if (spec.exts.includes(ext)) {
    await setToolFiles(spec, [{ absPath: path, relPath: basenameOf(path), ext, size: -1 }], path, spec.pickFileSel)
  } else {
    await setToolFiles(spec, [], path, spec.pickFileSel)
    ;($(spec.statusSel) as HTMLElement).textContent = await dsh.t('error.noEncryptedFiles')
  }
}

// ---- 事件绑定 ----
function bind(): void {
  $('#openBtn').addEventListener('click', async () => {
    const dir = await dsh.selectDir()
    if (!dir) return
    state.dir = dir // 修复：之前只显示路径，没写 state.dir，导致「开始解密」无效
    setButtonTooltip('#openBtn', dir)
    updateDecryptFab()
    setScanStatus('')
  })
  // 底部主按钮：按状态路由（开始解密 / 取消扫描 / 取消解密 / 取消导出）
  $('#scanBtn').addEventListener('click', () => {
    if (state.scanning) void dsh.cancelScan()
    else if (state.processing || state.exporting) void dsh.cancelExport()
    else if (state.dir) void startDecrypt(state.dir)
  })
  $('#resetBtn').addEventListener('click', () => void resetDecrypt())
  $('#exportBtn').addEventListener('click', () => void runExport('files'))
  $('#exportZipBtn').addEventListener('click', () => void runExport('zip'))
  const keyInput = $('#keyInput') as HTMLInputElement
  keyInput.addEventListener('input', () => {
    state.key = keyInput.value.trim()
  })

  // ---- 加密 ----
  $('#encPickFileBtn').addEventListener('click', () => void pickToolFile(encUi))
  $('#encPickDirBtn').addEventListener('click', () => void pickToolDir(encUi))
  $('#encOutBtn').addEventListener('click', () => void pickToolOutput(encUi))
  bindToolFab(encUi)
  $('#encOpenOutBtn').addEventListener('click', () => {
    if (encState.outputDir) void dsh.openPath(encState.outputDir)
  })
  ;($('#encKey') as HTMLInputElement).addEventListener('input', () => updateToolFab(encUi))
  // MV/MZ 版本分段按钮
  $('#encVerSeg').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.seg-btn')
    if (!btn) return
    encState.version = btn.dataset.ver === 'mz' ? 'mz' : 'mv'
    for (const b of $('#encVerSeg').querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      b.classList.toggle('active', b === btn)
    }
  })

  // ---- 图片还原 ----
  $('#resPickFileBtn').addEventListener('click', () => void pickToolFile(resUi))
  $('#resPickDirBtn').addEventListener('click', () => void pickToolDir(resUi))
  $('#resOutBtn').addEventListener('click', () => void pickToolOutput(resUi))
  bindToolFab(resUi)
  $('#resOpenOutBtn').addEventListener('click', () => {
    if (resState.outputDir) void dsh.openPath(resState.outputDir)
  })

  // ---- 顶栏 ----
  $('#localeBtn').addEventListener('click', () => toggleMenu($('#localeMenu'), $('#localeBtn')))
  $('#themeBtn').addEventListener('click', () => {
    closeMenus()
    cycleTheme()
  })
  $('#githubBtn').addEventListener('click', () => {
    closeMenus()
    void dsh.openGitHub()
  })
  $('#githubBtn').innerHTML = icons.github
  $('#updateBtn').addEventListener('click', () => {
    closeMenus()
    void checkUpdate()
  })
  $('#updateBtn').innerHTML = icons.update
  // 点击外部关闭菜单
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (!t.closest('.menu') && !t.closest('.icon-btn')) closeMenus()
  })
  // Esc 关闭菜单
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus()
  })
}

// ---- tab 导航 ----
function initTabs(saveEditor: SaveEditorHandle): void {
  const panes: Record<string, string> = {
    decrypt: 'decryptPane',
    encrypt: 'encryptPane',
    restore: 'restorePane',
    save: 'savePane'
  }
  const tabs: Array<[string, string]> = [
    ['decrypt', 'tabDecrypt'],
    ['encrypt', 'tabEncrypt'],
    ['restore', 'tabRestore'],
    ['save', 'tabSave']
  ]
  const show = (which: 'decrypt' | 'encrypt' | 'restore' | 'save'): void => {
    activeTab = which
    for (const [key, tabId] of tabs) {
      ;($(`#${panes[key]}`) as HTMLElement).hidden = key !== which
      ;($(`#${tabId}`) as HTMLElement).classList.toggle('active', key === which)
    }
    if (which === 'decrypt') fileVlist?.update()
  }
  for (const [key, tabId] of tabs) {
    ;($(`#${tabId}`) as HTMLElement).addEventListener('click', () => show(key as typeof activeTab))
  }

  // 拖放：按当前 tab 分发
  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    const items = Array.from(e.dataTransfer?.items ?? [])
    const firstItem = items.find((it) => it.kind === 'file')
    if (!firstItem) return
    const file = firstItem.getAsFile()
    if (!file) return
    const path = dsh.getPathForFile(file)
    if (!path) return
    if (activeTab === 'save') {
      if (/\.(rpgsave|rmmzsave)$/i.test(file.name)) void saveEditor.loadFile(path)
      else void saveEditor.openDir(path)
    } else if (activeTab === 'encrypt') {
      void toolFilesFromDrop(encUi, path)
    } else if (activeTab === 'restore') {
      void toolFilesFromDrop(resUi, path)
    } else {
      void startDecrypt(path)
    }
  })
}

async function main(): Promise<void> {
  // 无边框窗口平台适配（Windows 需给系统窗口控制按钮留位，macOS 需给红绿灯留位）
  const plat = dsh.platform === 'win32' ? 'win' : dsh.platform
  document.body.classList.add('platform-' + plat)
  initLogo()
  initFileList()
  await initLocaleMenu()
  await initTheme()
  await refreshI18n()
  bindI18nHotReload()
  const saveEditor = initSaveEditor()
  initTabs(saveEditor)
  bind()
}

main().catch((err) => console.error('renderer 初始化失败', err))
