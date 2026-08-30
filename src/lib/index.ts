/**
 * 纯 TypeScript 核心库 —— 零 Electron / Node 依赖。
 *
 * GUI（src/renderer）与 CLI（src/cli）共用这一层逻辑。
 * 未来如需在渲染进程复用，请保持此处不引入任何 Node 内建模块。
 */
export * from './crypto'
export * from './i18n'
export * from './theme'
export * from './save'
export * from './history'
export * from './virtual'
