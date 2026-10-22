import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DATA_DIR_NAME,
  ensureWritableDir,
  isInsideSystemDir,
  migrateLegacyData,
  resolveDataDir
} from '../src/main/dataDir'

const roots: string[] = []

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rpgmd-data-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 构造一份「Windows 打包版」的解析入参 */
function winOptions(root: string, override: Partial<Parameters<typeof resolveDataDir>[0]> = {}) {
  const exeDir = join(root, 'app')
  mkdirSync(exeDir, { recursive: true })
  return {
    isPackaged: true,
    platform: 'win32' as const,
    exePath: join(exeDir, 'RPGMakerDecrypter.exe'),
    defaultDir: join(root, 'appdata', DATA_DIR_NAME),
    isWritable: () => true,
    systemDirs: [] as string[],
    ...override
  }
}

describe('isInsideSystemDir', () => {
  it('匹配系统目录本身及其子目录，且区分路径分段', () => {
    const sys = ['C:\\Program Files', 'C:\\Windows\\']
    expect(isInsideSystemDir('C:\\Program Files', sys)).toBe(true)
    expect(isInsideSystemDir('C:\\Program Files\\App', sys)).toBe(true)
    expect(isInsideSystemDir('c:/program files/app', sys)).toBe(true)
    expect(isInsideSystemDir('C:\\Windows', sys)).toBe(true)
    // 仅前缀相同但不是同一路径分段：不应算系统目录
    expect(isInsideSystemDir('C:\\Program FilesExtra', sys)).toBe(false)
    expect(isInsideSystemDir('D:\\Apps', sys)).toBe(false)
  })

  it('空列表 / 空串不误判', () => {
    expect(isInsideSystemDir('C:\\Apps', [])).toBe(false)
    expect(isInsideSystemDir('C:\\Apps', [''])).toBe(false)
  })
})

describe('resolveDataDir', () => {
  it('打包版 Windows + exe 同级可写 → 便携模式（数据目录在 exe 同级）', () => {
    const root = tempRoot()
    const opts = winOptions(root)
    const got = resolveDataDir(opts)
    expect(got.mode).toBe('portable')
    expect(got.reason).toBe('exe-writable')
    expect(got.dir).toBe(join(root, 'app', DATA_DIR_NAME))
  })

  it('RPGMD_DATA_DIR 优先于一切自动判断（dev 下也生效）', () => {
    const root = tempRoot()
    const custom = join(root, 'custom-data')
    const packed = resolveDataDir(winOptions(root, { envDir: custom }))
    expect(packed).toMatchObject({ dir: custom, mode: 'portable', reason: 'env' })

    const dev = resolveDataDir(winOptions(root, { isPackaged: false, envDir: custom }))
    expect(dev).toMatchObject({ dir: custom, mode: 'portable', reason: 'env' })
  })

  it('dev（未打包）保持系统默认 userData', () => {
    const root = tempRoot()
    const opts = winOptions(root, { isPackaged: false })
    expect(resolveDataDir(opts)).toMatchObject({ dir: opts.defaultDir, mode: 'default', reason: 'dev' })
  })

  it('非 Windows（macOS/Linux）保持系统默认 userData', () => {
    const root = tempRoot()
    const opts = winOptions(root, { platform: 'darwin' })
    expect(resolveDataDir(opts)).toMatchObject({ dir: opts.defaultDir, mode: 'default', reason: 'non-windows' })
  })

  it('exe 位于系统目录（如 Program Files）→ 回退默认 userData', () => {
    const root = tempRoot()
    const programFiles = join(root, 'Program Files')
    const opts = winOptions(root, {
      exePath: join(programFiles, 'RPGMakerDecrypter', 'RPGMakerDecrypter.exe'),
      systemDirs: [programFiles]
    })
    expect(resolveDataDir(opts)).toMatchObject({
      dir: opts.defaultDir,
      mode: 'default',
      reason: 'system-dir'
    })
  })

  it('exe 同级不可写（只读介质 / 受限 ACL）→ 回退默认 userData', () => {
    const root = tempRoot()
    const opts = winOptions(root, { isWritable: () => false })
    expect(resolveDataDir(opts)).toMatchObject({
      dir: opts.defaultDir,
      mode: 'default',
      reason: 'not-writable'
    })
  })
})

describe('ensureWritableDir', () => {
  it('目录不存在时会递归创建并返回 true', () => {
    const root = tempRoot()
    const target = join(root, 'a', 'b', 'c')
    expect(ensureWritableDir(target)).toBe(true)
    expect(existsSync(target)).toBe(true)
  })

  it('目标是文件时返回 false（而非抛错）', () => {
    const root = tempRoot()
    const file = join(root, 'not-a-dir')
    writeFileSync(file, 'x')
    expect(ensureWritableDir(file)).toBe(false)
  })
})

describe('migrateLegacyData', () => {
  it('首次便携启动：补缺失的 config/history/locales，不覆盖已有内容', () => {
    const root = tempRoot()
    const legacy = join(root, 'appdata', DATA_DIR_NAME)
    const target = join(root, 'app', DATA_DIR_NAME)
    mkdirSync(join(legacy, 'locales'), { recursive: true })
    writeFileSync(join(legacy, 'config.json'), '{"locale":"ja"}')
    writeFileSync(join(legacy, 'history.json'), '[]')
    writeFileSync(join(legacy, 'locales', 'zh-Hant.json'), '{}')

    expect(migrateLegacyData(legacy, target).sort()).toEqual(['config.json', 'history.json', 'locales'])
    expect(readFileSync(join(target, 'config.json'), 'utf-8')).toBe('{"locale":"ja"}')
    expect(existsSync(join(target, 'locales', 'zh-Hant.json'))).toBe(true)

    // 再迁一次：目标已存在 → 不覆盖、不重复
    writeFileSync(join(target, 'config.json'), '{"locale":"en"}')
    expect(migrateLegacyData(legacy, target)).toEqual([])
    expect(readFileSync(join(target, 'config.json'), 'utf-8')).toBe('{"locale":"en"}')
  })

  it('旧目录不存在 / 与目标相同 → 空操作', () => {
    const root = tempRoot()
    const target = join(root, 'data')
    mkdirSync(target, { recursive: true })
    expect(migrateLegacyData(join(root, 'missing'), target)).toEqual([])
    expect(migrateLegacyData(target, target)).toEqual([])
  })
})
