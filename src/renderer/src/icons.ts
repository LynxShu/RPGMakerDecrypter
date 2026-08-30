/**
 * 内联 SVG 图标库（renderer）。
 *
 * 全部手写、stroke 风格（1.75 线宽、圆头），与 Linear/Lucide 气质一致，
 * 零依赖、零请求、随主题变色（用 currentColor）。
 *
 * 用法：`icons.globe` 返回 SVG 字符串，插入 innerHTML 即可。
 */

const svg = (body: string, size = 24, opts: { fill?: boolean } = {}): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${opts.fill ? 'currentColor' : 'none'}" stroke="${opts.fill ? 'none' : 'currentColor'}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
  /** 语言 / 地球 */
  globe: svg(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z"/>'
  ),
  /** 主题：太阳（light 模式显示） */
  sun: svg(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'
  ),
  /** 主题：月亮（dark 模式显示） */
  moon: svg(
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
  ),
  /** GitHub 图标（品牌填充） */
  github: svg(
    '<path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/>',
    20,
    { fill: true }
  ),
  /** 更新检查：云 + 向下箭头（新版本） */
  update: svg(
    '<path d="M7.2 18.5a4.6 4.6 0 1 1 .6-9.16 6.2 6.2 0 0 1 12 1.7 4 4 0 0 1-.8 7.46H7.2z"/><path d="M12 12.5V17"/><path d="m9.5 14.5 2.5 2.5 2.5-2.5"/>'
  ),
  /** 密钥验证：通过（对勾圆圈） */
  checkCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  /** 密钥验证：未通过（叉圆圈） */
  xCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>')
}

export type IconName = keyof typeof icons

/** 取图标（带类型），未知名返回空串 */
export function icon(name: IconName): string {
  return icons[name] ?? ''
}
