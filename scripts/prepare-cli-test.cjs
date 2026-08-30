/**
 * CLI 测试前置：准备 `node_modules/@lib` 垫片（指向 out-lib）并编译 CLI 到 out-cli-test。
 *
 * 为什么需要垫片：CLI 源码用 `@lib/*` 路径（tsconfig paths），tsc 编译时解析到 src/lib；
 * 但产物是 CJS，运行时 Node 只能按 node_modules 解析 `@lib/*`。这里把
 * `node_modules/@lib` 做成指向 `out-lib` 的 junction（Windows 无需管理员），
 * 失败则回退为逐个子包的 re-export 文件。node_modules 已被 gitignore，不污染仓库。
 *
 * 用法（先构建 out-lib）：
 *   node node_modules/typescript/bin/tsc -p tsconfig.build-lib.json
 *   node scripts/prepare-cli-test.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const outLib = path.join(root, 'out-lib')
const libShim = path.join(root, 'node_modules', '@lib')
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')

if (!fs.existsSync(outLib)) {
  console.error('[prepare-cli-test] 缺少 out-lib，请先运行：')
  console.error('  node node_modules/typescript/bin/tsc -p tsconfig.build-lib.json')
  process.exit(1)
}

function ensureShim() {
  if (fs.existsSync(libShim)) {
    console.log('[prepare-cli-test] @lib 垫片已存在:', libShim)
    return
  }
  fs.mkdirSync(path.dirname(libShim), { recursive: true })
  // 首选 junction（Windows 无需管理员；Linux 上同目录链接）
  try {
    fs.symlinkSync(outLib, libShim, 'junction')
    console.log('[prepare-cli-test] 已创建 @lib junction -> out-lib')
    return
  } catch (e) {
    console.warn('[prepare-cli-test] junction 失败，回退 re-export 垫片:', e.message)
  }
  // 回退：真实目录 + 每个子包的 re-export
  fs.mkdirSync(libShim, { recursive: true })
  fs.writeFileSync(
    path.join(libShim, 'package.json'),
    JSON.stringify({ name: '@lib', version: '0.0.0', private: true, main: 'index.js' }, null, 2)
  )
  for (const sub of ['crypto', 'i18n', 'save', 'theme']) {
    const dir = path.join(libShim, sub)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'index.js'),
      `module.exports = require('../../../out-lib/${sub}/index.js')\n`
    )
  }
  console.log('[prepare-cli-test] 已创建 @lib re-export 垫片')
}

ensureShim()

console.log('[prepare-cli-test] 编译 CLI -> out-cli-test …')
const res = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.build-cli.json'], {
  cwd: root,
  stdio: 'inherit'
})
if (res.status !== 0) {
  console.error('[prepare-cli-test] tsc 编译失败 (exit', res.status, ')')
  process.exit(res.status ?? 1)
}
console.log('[prepare-cli-test] 完成')
