#!/usr/bin/env node
/**
 * electron-builder 启动包装器（`npm run package` / `npm run package:dir` 走这里）。
 *
 * 做两件事，让打包在「受限终端 / 无符号链接权限」的 Windows 环境里也能跑通：
 *
 * 1) 把 Electron 与 electron-builder 的下载缓存固定到仓库内：
 *      .electron-cache/          ← Electron 发行包（electron-builder.yml 的 electronDownload.cache 也指向它）
 *      electron-builder-cache/   ← winCodeSign / NSIS 等构建工具
 *    两者都已在 .gitignore 里。默认缓存位置是 %LOCALAPPDATA%\electron 与 %LOCALAPPDATA%\electron-builder，
 *    在受限令牌（沙箱终端）里会直接报：
 *      mkdir C:\Users\<user>\AppData\Local\electron: Access is denied
 *
 * 2) Windows 上预置 winCodeSign 缓存：官方 winCodeSign-2.6.0.7z 内含 macOS 符号链接，
 *    没有 SeCreateSymbolicLinkPrivilege 的终端里 7za 解压会失败（ERROR_PRIVILEGE_NOT_HELD），
 *    表现为打包卡在 “updating asar integrity executable resource” 并反复重试。
 *    electron-builder 只检查 <cache>/winCodeSign/winCodeSign-2.6.0 目录是否存在，
 *    所以这里预解压时排除 Windows 打包用不到的 darwin 目录即可。
 */
'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const WINCODESIGN_NAME = 'winCodeSign-2.6.0'
const WINCODESIGN_ARCHIVE = `${WINCODESIGN_NAME}.7z`
const WINCODESIGN_URL =
  'https://github.com/electron-userland/electron-builder-binaries/releases/download/' +
  `winCodeSign-2.6.0/${WINCODESIGN_ARCHIVE}`

const builderCache =
  process.env.ELECTRON_BUILDER_CACHE || path.join(root, 'electron-builder-cache')

const env = {
  ...process.env,
  ELECTRON_BUILDER_CACHE: builderCache,
  ELECTRON_CACHE: process.env.ELECTRON_CACHE || path.join(root, '.electron-cache')
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

/** 若 winCodeSign 缓存缺失，则下载并按「排除 darwin」方式预解压（仅 Windows 需要）。 */
async function ensureWinCodeSign() {
  if (process.platform !== 'win32') return

  const sevenZip = path.join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')
  if (!fs.existsSync(sevenZip)) return

  const dir = path.join(builderCache, 'winCodeSign')
  const finalDir = path.join(dir, WINCODESIGN_NAME)
  if (fs.existsSync(finalDir)) return

  const archive = path.join(dir, WINCODESIGN_ARCHIVE)
  const tmpDir = path.join(dir, `.tmp-${process.pid}`)

  console.log(`[package] 预置 ${WINCODESIGN_NAME} 缓存（跳过 darwin 符号链接）…`)
  if (!fs.existsSync(archive)) {
    await download(WINCODESIGN_URL, archive)
  }

  fs.rmSync(tmpDir, { recursive: true, force: true })
  const extracted = spawnSync(sevenZip, ['x', '-bd', `-o${tmpDir}`, archive, '-xr!darwin'], {
    stdio: 'ignore'
  })
  if (extracted.status !== 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    throw new Error(`解压 ${WINCODESIGN_ARCHIVE} 失败（7za exit ${extracted.status}）`)
  }
  fs.renameSync(tmpDir, finalDir)
}

async function main() {
  try {
    await ensureWinCodeSign()
  } catch (err) {
    // 预置失败不致命：让 electron-builder 自己下载/解压，报错会更贴近官方行为
    console.warn(`[package] 预置 winCodeSign 缓存失败，交由 electron-builder 处理：${err.message}`)
  }

  const cli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
  const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: root,
    env
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
