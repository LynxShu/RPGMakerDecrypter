/**
 * CLI 逻辑（与入口分离，便于自动化测试）。
 *
 * 与 GUI 共用同一套 `@lib` 核心与主进程的 `project.ts`/`decryptPool.ts`（蓝图 §11.3）。
 * `runCli(argv, io)` 可注入输出通道与 argv，测试无需 spawn 子进程。
 */
import { Command } from 'commander'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import { Decrypter, toNormalExtension } from '@lib/crypto'
import { createI18n } from '@lib/i18n'
import { decodeSave, encodeSave, kindFromExtension, type SaveKind, type ZlibLike } from '@lib/save'
import { findEncryptionKey, scanEncryptedFiles } from '../main/project'
import { runDecryptJobs } from '../main/decryptPool'
import { targetRelPath, type DecryptJob } from '../main/decryptCore'

/** CLI 输出通道（测试可注入数组捕获） */
export interface CliIO {
  out(s: string): void
  err(s: string): void
}

const defaultIo: CliIO = { out: (s) => console.log(s), err: (s) => console.error(s) }

// Node zlib 注入（@lib 零 Node 依赖，CLI 侧提供）
const nodeZlib: ZlibLike = {
  deflateToBinaryString: (json) => deflateSync(Buffer.from(json, 'utf8'), { level: 1 }).toString('latin1'),
  inflateFromBinaryString: (bin) => inflateSync(Buffer.from(bin, 'latin1')).toString('utf8')
}

// 需与 package.json 的 version 保持一致（CLI 打包后无法方便 import package.json）
const VERSION = '0.0.1'

interface RunOptions {
  key?: string
  output?: string
  ignoreFakeHeader?: boolean
  json?: boolean
}

/** 生成默认输出文件名：加密扩展名映射为正常扩展名，否则追加后缀 */
function defaultOutput(input: string, mode: string): string {
  const ext = extname(input).slice(1)
  const normal = toNormalExtension(ext)
  if (normal) {
    return input.slice(0, input.length - ext.length - 1) + '.' + normal
  }
  return input + '.' + (mode === 'restore' ? 'restored' : 'dec')
}

/**
 * 加载 CLI 语言包：始终先加载 en（内置兜底），再按 `--lang` 覆盖；
 * 找不到指定语言文件时静默回退 en（不报错）。候选路径覆盖
 * 源码运行（src/cli → 仓库根 locales）与编译产物（out/cli、out-cli-test）。
 * CLI 打包为单文件后语言包不在分发内，此时 --lang 仅对内置文案生效（回退 en）。
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
    .description('RPG Maker MV/MZ 资源解密/加密/救图（Electron + TypeScript 核心）')
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

  // 语言包：--lang 覆盖（蓝图 §11.1「CLI 用 --lang 覆盖」）。
  // 惰性初始化：buildProgram 时选项尚未解析，首次使用（action 内）时才有值。
  let resolvedI18n: ReturnType<typeof createI18n> | null = null
  const getI18n = (): ReturnType<typeof createI18n> => {
    if (!resolvedI18n) {
      resolvedI18n = loadCliI18n(program.opts().lang as string | undefined)
    }
    return resolvedI18n
  }

  function run(mode: 'decrypt' | 'encrypt' | 'restore', input: string, opts: RunOptions): void {
    const data = new Uint8Array(readFileSync(input))

    const d = new Decrypter(opts.key ?? null, { ignoreFakeHeader: opts.ignoreFakeHeader ?? false })

    // --json 声明在根命令（子命令 action 的 opts 不会继承同名选项，见 commander 行为）
    const json = opts.json ?? Boolean(program.opts().json)

    let out: Uint8Array
    switch (mode) {
      case 'decrypt':
        if (!opts.key) {
          if (json) {
            io.out(JSON.stringify({ ok: false, error: getI18n().t('error.noKey') }))
          } else {
            io.err(getI18n().t('error.noKey'))
          }
          fail()
          return
        }
        out = d.decrypt(data)
        break
      case 'encrypt':
        if (!opts.key) {
          io.err(getI18n().t('error.noKey'))
          fail()
          return
        }
        out = d.encrypt(data)
        break
      case 'restore':
        out = d.restorePngHeader(data)
        break
    }

    const output = opts.output ?? defaultOutput(input, mode)
    writeFileSync(output, out)
    if (json) {
      io.out(JSON.stringify({ ok: true, input, output: join(process.cwd(), output) }))
    } else {
      io.out(`${mode.toUpperCase()} OK -> ${output}`)
    }
  }

  const isVerbose = (): boolean => Boolean(program.opts().verbose)

  program
    .command('decrypt')
    .description('解密资源')
    .argument('<file>', '加密文件')
    .requiredOption('-k, --key <key>', '密钥 hex（16 字符）')
    .option('-o, --output <file>', '输出文件')
    .option('--ignore-fake-header', '跳过假头校验')
    .action((file: string, opts: RunOptions) => run('decrypt', file, opts))

  program
    .command('encrypt')
    .description('加密资源')
    .argument('<file>', '明文文件')
    .requiredOption('-k, --key <key>', '密钥 hex（16 字符）')
    .option('-o, --output <file>', '输出文件')
    .action((file: string, opts: RunOptions) => run('encrypt', file, opts))

  program
    .command('restore')
    .description('无密钥救图（还原 PNG 头）')
    .argument('<file>', '加密 PNG')
    .option('-o, --output <file>', '输出文件')
    .action((file: string, opts: RunOptions) => run('restore', file, opts))

  program
    .command('detect-key')
    .description('自动查找游戏目录的加密密钥')
    .argument('<dir>', '游戏目录')
    .action((dir: string) => {
      const r = findEncryptionKey(dir)
      if (r) {
        if (isVerbose()) io.err(`key source: ${r.source}`)
        io.out(JSON.stringify({ ok: true, key: r.key, source: r.source }))
      } else {
        io.err('未找到加密密钥')
        fail()
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
        const files = scanEncryptedFiles(dir)
        if (files.length === 0) {
          io.err(getI18n().t('error.noEncryptedFiles'))
          fail()
          return
        }
        const key = opts.key ?? findEncryptionKey(dir)?.key
        if (!key) {
          io.err(getI18n().t('error.noKeyInDir'))
          fail()
          return
        }
        const outputDir = opts.output ? resolve(opts.output) : resolve(dir + '-decrypted')
        const verbose = isVerbose()
        // --json 声明在根命令（子命令 action 的 opts 不继承同名选项，见 commander 行为）
        const json = opts.json || Boolean(program.opts().json)

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
    .command('save-decode')
    .description('解码 MV/MZ 存档（LZString base64 / zlib deflate + JsonEx）为 JSON')
    .argument('<file>', '存档文件（save/fileN.rpgsave 或 fileN.rmmzsave）')
    .option('-o, --output <file>', '输出 JSON 文件（默认打印到 stdout）')
    .action((file: string, opts: { output?: string }) => {
      try {
        const text = readFileSync(file, 'utf8')
        const hint = kindFromExtension(extname(file))
        const { kind, contents } = decodeSave(text, nodeZlib, hint)
        const json = JSON.stringify(contents, null, 2)
        if (opts.output) {
          writeFileSync(opts.output, json)
          io.out(`${kind.toUpperCase()} 存档已解码 -> ${opts.output}`)
        } else {
          io.out(json)
        }
      } catch (e) {
        io.err(`解码失败: ${(e as Error).message}`)
        fail()
      }
    })

  program
    .command('save-encode')
    .description('把 JSON 编码为 MV/MZ 存档（JsonEx + LZString base64 / zlib deflate）')
    .argument('<json>', 'JSON 文件（存档 contents）')
    .argument('<output>', '输出存档路径（.rpgsave → MV，.rmmzsave → MZ）')
    .option('--kind <mv|mz>', '强制存档种类（默认按输出扩展名推断）')
    .action((jsonFile: string, output: string, opts: { kind?: string }) => {
      try {
        const contents = JSON.parse(readFileSync(jsonFile, 'utf8'))
        const kind: SaveKind | null =
          opts.kind === 'mv' || opts.kind === 'mz' ? opts.kind : kindFromExtension(extname(output))
        if (!kind) {
          io.err('无法推断存档种类，请用 --kind mv|mz 指定')
          fail()
          return
        }
        const text = encodeSave(contents, kind, nodeZlib)
        writeFileSync(output, text)
        io.out(`${kind.toUpperCase()} 存档已编码 -> ${output}`)
      } catch (e) {
        io.err(`编码失败: ${(e as Error).message}`)
        fail()
      }
    })

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
