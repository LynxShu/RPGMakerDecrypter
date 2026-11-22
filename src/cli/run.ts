/**
 * CLI 逻辑（与入口分离，便于自动化测试）。
 *
 * 与 GUI 共用同一套 `@lib` 核心与主进程的 `project.ts`/`decryptPool.ts`/`projectExport.ts`。
 * `runCli(argv, io)` 可注入输出通道与 argv，测试无需 spawn 子进程。
 */
import { Command } from 'commander'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { Decrypter, encryptExtFor, toNormalExtension } from '@lib/crypto'
import { createI18n } from '@lib/i18n'
import { findEncryptionKey, scanEncryptedFiles } from '../main/project'
import {
  collectProjectSourceFiles,
  detectRpgProject,
  exportEditableProject,
  makeProjectDirName
} from '../main/projectExport'
import { runDecryptJobs } from '../main/decryptPool'
import { targetRelPath, type DecryptJob } from '../main/decryptCore'

/** CLI 输出通道（测试可注入数组捕获） */
export interface CliIO {
  out(s: string): void
  err(s: string): void
}

const defaultIo: CliIO = { out: (s) => console.log(s), err: (s) => console.error(s) }

// 需与 package.json 的 version 保持一致（CLI 打包后无法方便 import package.json）
const VERSION = '1.0.3'

interface RunOptions {
  key?: string
  output?: string
  format?: string
  ignoreFakeHeader?: boolean
  json?: boolean
}

/** 生成默认输出文件名：解密/还原映射为正常扩展名，加密按 mv/mz 映射为加密扩展名 */
function defaultOutput(input: string, mode: 'decrypt' | 'encrypt' | 'restore', format: 'mv' | 'mz' = 'mv'): string {
  const ext = extname(input).slice(1)
  if (mode === 'encrypt') {
    const enc = encryptExtFor(format, ext)
    if (enc) {
      return input.slice(0, input.length - ext.length - 1) + '.' + enc
    }
    return input + '.enc'
  }
  const normal = toNormalExtension(ext)
  if (normal) {
    return input.slice(0, input.length - ext.length - 1) + '.' + normal
  }
  return input + '.' + (mode === 'restore' ? 'restored' : 'dec')
}

/**
 * 加载 CLI 语言包：始终先加载 en（内置兜底），再按 `--lang` 覆盖；
 * 找不到指定语言文件时静默回退 en（不报错）。候选路径覆盖
 * 源码运行（src/cli → 仓库根 locales）与编译产物（out/main、out-cli-test）。
 */
function loadCliI18n(lang?: string) {
  const i18n = createI18n({ defaultLocale: lang || 'en', fallbackLocale: 'en' })
  const candidates = [
    join(__dirname, '..', '..', 'locales'),
    join(__dirname, '..', '..', '..', 'locales'),
    join(process.cwd(), 'locales')
  ]
  const tryLoad = (code: string): void => {
    for (const dir of candidates) {
      try {
        const file = join(dir, `${code}.json`)
        if (existsSync(file)) {
          i18n.loadFromJson(code, JSON.parse(readFileSync(file, 'utf-8')))
          return
        }
      } catch {
        /* 忽略，继续下一个候选 */
      }
    }
  }
  // 先注册 en 兜底，保证缺失 key 有英文文案而非原样 key
  tryLoad('en')
  if (lang && lang !== 'en') {
    tryLoad(lang)
    i18n.setLocale(lang) // 找不到文件也无妨：resolve 回退 en
  } else {
    i18n.setLocale('en')
  }
  return i18n
}

/** 构建 commander 程序；所有错误经 `fail()` 置为非零退出码，不直接 process.exit */
function buildProgram(io: CliIO, fail: () => void): Command {
  const program = new Command()
    .name('rpgmaker-decrypter')
    .description('RPG Maker MV/MZ 资源解密/加密/救图/工程恢复（Electron + TypeScript 核心）')
    .version(VERSION)
    .option('--json', '机器可读的 JSON 输出')
    .option('--lang <lang>', '界面语言（默认 en）')
    .option('--verbose', '输出更多过程信息')
  // 必须先把 help/version/未知命令等输出路由到 io（测试可捕获；生产走 console）
  program.configureOutput({
    writeOut: (str) => io.out(str),
    writeErr: (str) => io.err(str)
  })
  // 必须在创建子命令前调用：子命令的 _exitCallback 在创建时从父命令复制，
  // 否则子命令报错（如缺 required option）会直接 process.exit。
  program.exitOverride()

  // 语言包：--lang 覆盖。惰性初始化：首次使用（action 内）时选项已解析完毕。
  let resolvedI18n: ReturnType<typeof createI18n> | null = null
  const getI18n = (): ReturnType<typeof createI18n> => {
    if (!resolvedI18n) {
      resolvedI18n = loadCliI18n(program.opts().lang as string | undefined)
    }
    return resolvedI18n
  }

  const isJson = (opts?: { json?: boolean }): boolean => Boolean(opts?.json || program.opts().json)
  const isVerbose = (): boolean => Boolean(program.opts().verbose)

  function emitError(msg: string, json: boolean): void {
    if (json) io.out(JSON.stringify({ ok: false, error: msg }))
    else io.err(msg)
    fail()
  }

  function run(mode: 'decrypt' | 'encrypt' | 'restore', input: string, opts: RunOptions): void {
    const json = isJson(opts)
    const fmt = (opts.format ?? 'mv').toLowerCase()
    if (mode === 'encrypt' && fmt !== 'mv' && fmt !== 'mz') {
      emitError(`Invalid --format "${opts.format}", expected "mv" or "mz"`, json)
      return
    }
    const format: 'mv' | 'mz' = fmt === 'mz' ? 'mz' : 'mv'

    const data = new Uint8Array(readFileSync(input))
    const d = new Decrypter(opts.key ?? null, { ignoreFakeHeader: opts.ignoreFakeHeader ?? false })

    let out: Uint8Array
    switch (mode) {
      case 'decrypt':
        if (!opts.key) {
          emitError(getI18n().t('error.noKey'), json)
          return
        }
        out = d.decrypt(data)
        break
      case 'encrypt':
        if (!opts.key) {
          emitError(getI18n().t('error.noKey'), json)
          return
        }
        out = d.encrypt(data)
        break
      case 'restore':
        out = d.restorePngHeader(data)
        break
    }

    const output = opts.output ?? defaultOutput(input, mode, format)
    const resolvedOut = resolve(output)
    mkdirSync(dirname(resolvedOut), { recursive: true })
    writeFileSync(resolvedOut, out)
    if (json) {
      io.out(JSON.stringify({ ok: true, input: resolve(input), output: resolvedOut }))
    } else {
      io.out(`${mode.toUpperCase()} OK -> ${output}`)
    }
  }

  program
    .command('decrypt')
    .description('解密资源')
    .argument('<file>', '加密文件')
    .requiredOption('-k, --key <key>', '密钥 hex（通常 32 字符 / 16 字节）')
    .option('-o, --output <file>', '输出文件')
    .option('--ignore-fake-header', '跳过假头校验')
    .option('--json', 'JSON 输出')
    .action((file: string, opts: RunOptions) => run('decrypt', file, opts))

  program
    .command('encrypt')
    .description('加密资源')
    .argument('<file>', '明文文件')
    .requiredOption('-k, --key <key>', '密钥 hex（通常 32 字符 / 16 字节）')
    .option('-o, --output <file>', '输出文件')
    .option('-f, --format <mv|mz>', '默认输出扩展名格式（mv 或 mz，默认 mv）', 'mv')
    .option('--json', 'JSON 输出')
    .action((file: string, opts: RunOptions) => run('encrypt', file, opts))

  program
    .command('restore')
    .description('无密钥救图（还原 PNG 头）')
    .argument('<file>', '加密 PNG')
    .option('-o, --output <file>', '输出文件')
    .option('--json', 'JSON 输出')
    .action((file: string, opts: RunOptions) => run('restore', file, opts))

  program
    .command('detect-key')
    .description('自动查找游戏目录的加密密钥')
    .argument('<dir>', '游戏目录')
    .option('--json', 'JSON 输出')
    .action((dir: string, opts: { json?: boolean }) => {
      const json = isJson(opts)
      const r = findEncryptionKey(dir)
      if (r) {
        if (isVerbose()) io.err(`key source: ${r.source}`)
        io.out(JSON.stringify({ ok: true, key: r.key, source: r.source }))
      } else {
        emitError(getI18n().t('error.noKeyInDir'), json)
      }
    })

  program
    .command('decode-dir')
    .description('解密整个游戏目录（自动找 key，保留目录结构）')
    .argument('<dir>', '游戏目录')
    .option('-o, --output <dir>', '输出目录（默认 <dir>-decrypted）')
    .option('-k, --key <key>', '密钥（未提供则自动查找）')
    .option('--dry-run', '只列出将解密的文件，不写盘')
    .option('--jobs <n>', '并发任务数（默认 8）')
    .option('--json', 'JSON 输出')
    .action(
      async (
        dir: string,
        opts: { output?: string; key?: string; dryRun?: boolean; jobs?: string; json?: boolean }
      ) => {
        const json = isJson(opts)
        const files = scanEncryptedFiles(dir)
        if (files.length === 0) {
          emitError(getI18n().t('error.noEncryptedFiles'), json)
          return
        }
        const key = opts.key ?? findEncryptionKey(dir)?.key
        if (!key) {
          emitError(getI18n().t('error.noKeyInDir'), json)
          return
        }
        const outputDir = opts.output ? resolve(opts.output) : resolve(dir + '-decrypted')
        const verbose = isVerbose()

        // --dry-run：只报告将处理的内容，绝不写盘
        if (opts.dryRun) {
          if (json) {
            io.out(
              JSON.stringify({
                ok: true,
                dryRun: true,
                scanned: files.length,
                key,
                files: files.map((f) => f.relPath)
              })
            )
          } else {
            io.out(`[dry-run] 将解密 ${files.length} 个文件（key: ${key}）-> ${outputDir}`)
            if (verbose) for (const f of files) io.out(`  ${f.relPath}`)
          }
          return
        }

        mkdirSync(outputDir, { recursive: true })
        const maxWorkers = Math.max(1, Math.floor(Number(opts.jobs)) || 8)
        const jobs: DecryptJob[] = files.map((f, i) => ({
          id: i,
          absPath: f.absPath,
          relPath: f.relPath,
          ext: f.ext,
          key,
          outPath: join(outputDir, targetRelPath(f.relPath, f.ext))
        }))
        const progress = (done: number, total: number, okN: number, failN: number): void => {
          if (verbose) io.err(`  ${done}/${total}  ok=${okN}  fail=${failN}`)
        }
        const summary = await runDecryptJobs(jobs, { maxWorkers }, progress)
        const magicFail = summary.results.filter((r) => r.magicOk === false).length

        if (json) {
          io.out(
            JSON.stringify({
              ok: true,
              scanned: files.length,
              success: summary.ok,
              fail: summary.fail,
              magicFail,
              output: outputDir,
              errors: summary.results
                .filter((r) => r.status === 'fail')
                .map((r) => ({ file: r.relPath, error: r.error }))
            })
          )
        } else {
          io.out(`完成: ${summary.ok} 成功, ${summary.fail} 失败`)
          if (magicFail > 0) io.err(`⚠ ${magicFail} 个文件魔数校验未通过（密钥可能不正确）`)
          io.out(`输出目录: ${outputDir}`)
        }
      }
    )

  program
    .command('export-project')
    .description('将 MV/MZ 发行版还原为可直接用 RPG Maker 编辑器打开的工程目录')
    .argument('<dir>', '游戏目录')
    .option('-o, --output <dir>', '输出工程目录（默认同级 <目录名>_project）')
    .option('-k, --key <key>', '密钥（有加密文件且未提供时自动查找）')
    .option('--dry-run', '只探测工程信息与文件数量，不写盘')
    .option('--jobs <n>', '解密并发任务数（默认 8）')
    .option('--json', 'JSON 输出')
    .action(
      async (
        dir: string,
        opts: { output?: string; key?: string; dryRun?: boolean; jobs?: string; json?: boolean }
      ) => {
        const json = isJson(opts)
        const verbose = isVerbose()
        const info = detectRpgProject(dir)
        if (!info) {
          emitError(getI18n().t('error.notRpgProject'), json)
          return
        }

        const encryptedFiles = scanEncryptedFiles(info.projectRoot)
        let key: string | null = null
        if (encryptedFiles.length > 0) {
          key = opts.key ?? findEncryptionKey(dir)?.key ?? null
          if (!key) {
            emitError(getI18n().t('error.noKeyInDir'), json)
            return
          }
        }

        const absDir = resolve(dir)
        const outputDir = opts.output
          ? resolve(opts.output)
          : resolve(dirname(absDir), makeProjectDirName(info.baseName))

        if (opts.dryRun) {
          const sourceFiles = await collectProjectSourceFiles(info, { excludeDir: outputDir })
          const projectFile = info.engine === 'mz' ? 'game.rmmzproject' : 'Game.rpgproject'
          if (json) {
            io.out(
              JSON.stringify({
                ok: true,
                dryRun: true,
                engine: info.engine,
                engineVersion: info.engineVersion,
                projectRoot: info.projectRoot,
                projectFile,
                output: outputDir,
                copied: sourceFiles.length,
                encrypted: encryptedFiles.length,
                key
              })
            )
          } else {
            io.out(
              `[dry-run] 引擎: ${info.engine.toUpperCase()}${info.engineVersion ? ' ' + info.engineVersion : ''}` +
                ` | 拷贝 ${sourceFiles.length} 个工程文件 + 解密 ${encryptedFiles.length} 个资源 -> ${outputDir}`
            )
          }
          return
        }

        const projRes = await exportEditableProject({
          gameDir: dir,
          outputDir,
          decryptCacheDir: null,
          onProgress: (done, total, okN, failN) => {
            if (verbose) io.err(`  [copy] ${done}/${total}  ok=${okN}  fail=${failN}`)
          }
        })

        let decOk = 0
        let decFail = 0
        let magicFail = 0
        const errors: Array<{ file: string; error?: string }> = []

        if (encryptedFiles.length > 0 && key) {
          const maxWorkers = Math.max(1, Math.floor(Number(opts.jobs)) || 8)
          const jobs: DecryptJob[] = encryptedFiles.map((f, i) => ({
            id: i,
            absPath: f.absPath,
            relPath: f.relPath,
            ext: f.ext,
            key,
            outPath: join(outputDir, targetRelPath(f.relPath, f.ext))
          }))
          const summary = await runDecryptJobs(jobs, { maxWorkers }, (done, total, okN, failN) => {
            if (verbose) io.err(`  [decrypt] ${done}/${total}  ok=${okN}  fail=${failN}`)
          })
          decOk = summary.ok
          decFail = summary.fail
          magicFail = summary.results.filter((r) => r.magicOk === false).length
          for (const r of summary.results) {
            if (r.status === 'fail') errors.push({ file: r.relPath, error: r.error })
          }
        }

        const totalOk = projRes.copied + decOk
        const totalFail = projRes.fail + decFail

        if (json) {
          io.out(
            JSON.stringify({
              ok: true,
              engine: projRes.engine,
              projectFile: projRes.projectFile,
              projectFileCreated: projRes.projectFileCreated,
              systemPatched: projRes.systemPatched,
              copied: projRes.copied,
              decrypted: decOk,
              success: totalOk,
              fail: totalFail,
              magicFail,
              output: projRes.outputDir,
              errors
            })
          )
        } else {
          io.out(
            `完成 (${projRes.engine.toUpperCase()}): 拷贝 ${projRes.copied} + 解密 ${decOk} = ${totalOk} 成功, ${totalFail} 失败`
          )
          io.out(`工程入口: ${projRes.projectFile} | System.json 已解除加密标记: ${projRes.systemPatched ? '是' : '否'}`)
          if (magicFail > 0) io.err(`⚠ ${magicFail} 个文件魔数校验未通过（密钥可能不正确）`)
          io.out(`输出工程: ${projRes.outputDir}`)
        }
      }
    )

  return program
}

/**
 * 以给定 argv 运行 CLI（argv 需含 node + 脚本两项，如 `['node','cli','decode-dir',...]`）。
 *
 * @returns 退出码（0 成功 / 非 0 失败）。内部不会调用 process.exit，
 *          commander 的 help/version 经 exitOverride 转成返回码。
 */
export async function runCli(argv: string[], io: CliIO = defaultIo): Promise<number> {
  let exitCode = 0
  const fail = (): void => {
    exitCode = 1
  }
  const program = buildProgram(io, fail)
  program.exitOverride()
  try {
    await program.parseAsync(argv)
  } catch (e) {
    // commander 的 help/version/未知参数等以 CommanderError 抛出（exitOverride 行为）
    if (e && typeof e === 'object' && 'exitCode' in e && typeof (e as { exitCode: unknown }).exitCode === 'number') {
      return (e as { exitCode: number }).exitCode
    }
    io.err(String(e))
    return 1
  }
  return exitCode
}
