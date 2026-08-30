#!/usr/bin/env node
/**
 * CLI 入口（蓝图 §11.3）。逻辑在 `./run`（可注入测试）；本文件只负责
 * 以真实 argv 运行并映射退出码。
 *
 * 支持 `tsx src/cli/index.ts` 直接运行；打包后挂在 package.json 的 bin。
 */
import { runCli } from './run'

runCli(process.argv).then((code) => {
  process.exitCode = code
})
