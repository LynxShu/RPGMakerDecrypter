/**
 * 日夜/明暗主题（纯 TS，可选依赖 DOM）。
 *
 * 模式：light | dark | system。system 模式跟随系统深色偏好（通过 matchMedia），
 * 并监听系统变化实时联动。渲染进程通过 applyToDom 把 resolved 主题写到 DOM。
 */

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_MODES: ReadonlyArray<{ value: ThemeMode; labelKey: string }> = [
  { value: 'light', labelKey: 'theme.mode.light' },
  { value: 'dark', labelKey: 'theme.mode.dark' },
  { value: 'system', labelKey: 'theme.mode.system' }
]

type Listener = () => void

/** 读取系统深色偏好（渲染进程可用；Node 环境降级为 light） */
export function readSystemPref(): ResolvedTheme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export interface ThemeStoreOptions {
  mode?: ThemeMode
  /** 持久化读写（主进程/渲染进程各自实现），可为 null 表示不持久化 */
  persist?: {
    get(): ThemeMode | null
    set(mode: ThemeMode): void
  }
}

export class ThemeStore {
  private mode: ThemeMode
  private resolved: ResolvedTheme
  private listeners = new Set<Listener>()
  private readonly persist?: ThemeStoreOptions['persist']
  private readonly mediaCleanup?: () => void

  constructor(opts: ThemeStoreOptions = {}) {
    const initial = opts.persist?.get?.() ?? opts.mode ?? 'system'
    this.mode = initial
    this.resolved = this.computeResolved(initial)
    this.persist = opts.persist

    // 监听系统深色切换（仅 system 模式下有意义，但保持订阅以实时联动）
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = () => {
        if (this.mode === 'system') {
          this.resolved = mq.matches ? 'dark' : 'light'
          this.notify()
        }
      }
      mq.addEventListener('change', onChange)
      this.mediaCleanup = () => mq.removeEventListener('change', onChange)
    }
  }

  getMode(): ThemeMode {
    return this.mode
  }

  getResolved(): ResolvedTheme {
    return this.resolved
  }

  setMode(mode: ThemeMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.resolved = this.computeResolved(mode)
    this.persist?.set(mode)
    this.notify()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  dispose(): void {
    this.mediaCleanup?.()
    this.listeners.clear()
  }

  private computeResolved(mode: ThemeMode): ResolvedTheme {
    return mode === 'system' ? readSystemPref() : mode
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }
}

/** 把 resolved 主题应用到 DOM（渲染进程用），写入 `data-theme` 属性 */
export function applyToDom(resolved: ResolvedTheme, el?: HTMLElement | null): void {
  const root = el ?? (typeof document !== 'undefined' ? document.documentElement : null)
  if (root) root.setAttribute('data-theme', resolved)
}

export function createThemeStore(opts: ThemeStoreOptions = {}): ThemeStore {
  return new ThemeStore(opts)
}
