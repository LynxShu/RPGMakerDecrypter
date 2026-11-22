import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectRpgProject, exportEditableProject, makeProjectDirName } from '../src/main/projectExport'

const tempDirs: string[] = []

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('makeProjectDirName', () => {
  it('appends _project and sanitizes invalid characters', () => {
    expect(makeProjectDirName('MyGame')).toBe('MyGame_project')
    expect(makeProjectDirName('My:Game*Test?')).toBe('My_Game_Test__project')
    expect(makeProjectDirName('MyGame_project')).toBe('MyGame_project')
    expect(makeProjectDirName('   ')).toBe('game_project')
  })
})

describe('detectRpgProject', () => {
  it('detects MV root with www/ subdir and parses Utils.RPGMAKER_VERSION', () => {
    const root = makeTemp('rpgd-mv-')
    const game = join(root, 'DemoMV')
    mkdirSync(join(game, 'www', 'data'), { recursive: true })
    mkdirSync(join(game, 'www', 'js'), { recursive: true })
    writeFileSync(join(game, 'www', 'data', 'System.json'), JSON.stringify({ hasEncryptedImages: true }))
    writeFileSync(join(game, 'www', 'js', 'rpg_core.js'), 'Utils.RPGMAKER_VERSION = "1.6.1";')

    const info = detectRpgProject(game)
    expect(info).not.toBeNull()
    expect(info!.engine).toBe('mv')
    expect(info!.hasWwwSubdir).toBe(true)
    expect(info!.engineVersion).toBe('1.6.1')
    expect(info!.baseName).toBe('DemoMV')
  })

  it('uses parent folder name when user selects www/ directly', () => {
    const root = makeTemp('rpgd-mv-www-')
    const www = join(root, 'HeroQuest', 'www')
    mkdirSync(join(www, 'data'), { recursive: true })
    mkdirSync(join(www, 'js'), { recursive: true })
    writeFileSync(join(www, 'data', 'System.json'), JSON.stringify({ hasEncryptedImages: true }))
    writeFileSync(join(www, 'js', 'rpg_core.js'), 'Utils.RPGMAKER_VERSION = "1.6.2";')

    const info = detectRpgProject(www)
    expect(info).not.toBeNull()
    expect(info!.engine).toBe('mv')
    expect(info!.hasWwwSubdir).toBe(false)
    expect(info!.baseName).toBe('HeroQuest')
  })

  it('detects MZ root and returns null for non-game folders', () => {
    const root = makeTemp('rpgd-mz-')
    const game = join(root, 'DemoMZ')
    mkdirSync(join(game, 'data'), { recursive: true })
    mkdirSync(join(game, 'js'), { recursive: true })
    writeFileSync(join(game, 'data', 'System.json'), JSON.stringify({ hasEncryptedImages: true, advanced: {} }))
    writeFileSync(join(game, 'js', 'rmmz_core.js'), 'Utils.RPGMAKER_VERSION = "1.8.0";')

    const info = detectRpgProject(game)
    expect(info).not.toBeNull()
    expect(info!.engine).toBe('mz')
    expect(info!.hasWwwSubdir).toBe(false)
    expect(info!.engineVersion).toBe('1.8.0')

    const notGame = join(root, 'only-img')
    mkdirSync(notGame, { recursive: true })
    expect(detectRpgProject(notGame)).toBeNull()
  })
})

describe('exportEditableProject', () => {
  it('exports MV project: strips www/ prefix from cache, patches System.json, creates Game.rpgproject', async () => {
    const root = makeTemp('rpgd-exp-mv-')
    const game = join(root, 'SampleMV')
    const cache = join(root, 'cache')
    const out = join(root, 'out', 'SampleMV_project')

    mkdirSync(join(game, 'www', 'data'), { recursive: true })
    mkdirSync(join(game, 'www', 'js', 'plugins'), { recursive: true })
    mkdirSync(join(game, 'www', 'img', 'pictures'), { recursive: true })
    mkdirSync(join(game, 'www', 'save'), { recursive: true })
    writeFileSync(join(game, 'Game.exe'), 'nwjs-binary')
    writeFileSync(
      join(game, 'www', 'data', 'System.json'),
      JSON.stringify({
        gameTitle: 'Sample MV',
        hasEncryptedImages: true,
        hasEncryptedAudio: true,
        encryptionKey: '0123456789abcdef0123456789abcdef'
      })
    )
    writeFileSync(join(game, 'www', 'js', 'rpg_core.js'), 'Utils.RPGMAKER_VERSION = "1.6.2";')
    writeFileSync(join(game, 'www', 'js', 'plugins', 'CustomPlugin.js'), '// plugin')
    writeFileSync(join(game, 'www', 'img', 'pictures', 'hero.rpgmvp'), 'encrypted-bytes')
    writeFileSync(join(game, 'www', 'save', 'file1.rpgsave'), 'save-data')

    // 解密缓存里的 relPath 是相对 gameDir 的（带 www/ 前缀）
    mkdirSync(join(cache, 'www', 'img', 'pictures'), { recursive: true })
    writeFileSync(join(cache, 'www', 'img', 'pictures', 'hero.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const res = await exportEditableProject({
      gameDir: game,
      outputDir: out,
      decryptCacheDir: cache
    })

    expect(res.canceled).toBe(false)
    expect(res.engine).toBe('mv')
    expect(res.projectFile).toBe('Game.rpgproject')
    expect(res.projectFileCreated).toBe(true)
    expect(res.systemPatched).toBe(true)
    expect(res.fail).toBe(0)

    expect(readFileSync(join(out, 'Game.rpgproject'), 'utf-8')).toBe('RPGMV 1.6.2')
    expect(existsSync(join(out, 'js', 'plugins', 'CustomPlugin.js'))).toBe(true)
    expect(existsSync(join(out, 'img', 'pictures', 'hero.png'))).toBe(true)
    // 不应携带加密文件、存档或 NW.js 壳子
    expect(existsSync(join(out, 'img', 'pictures', 'hero.rpgmvp'))).toBe(false)
    expect(existsSync(join(out, 'save', 'file1.rpgsave'))).toBe(false)
    expect(existsSync(join(out, 'Game.exe'))).toBe(false)

    // System.json 的加密标志已关闭，但原游戏目录未被改动
    const patchedSys = JSON.parse(readFileSync(join(out, 'data', 'System.json'), 'utf-8'))
    expect(patchedSys.hasEncryptedImages).toBe(false)
    expect(patchedSys.hasEncryptedAudio).toBe(false)
    expect(patchedSys.gameTitle).toBe('Sample MV')
    const origSys = JSON.parse(readFileSync(join(game, 'www', 'data', 'System.json'), 'utf-8'))
    expect(origSys.hasEncryptedImages).toBe(true)
  })

  it('exports MZ project: filters NW.js runtime files while preserving custom plugin dirs and game locales', async () => {
    const root = makeTemp('rpgd-exp-mz-')
    const game = join(root, 'SampleMZ')
    const out = join(root, 'SampleMZ_project')

    mkdirSync(join(game, 'data'), { recursive: true })
    mkdirSync(join(game, 'js'), { recursive: true })
    mkdirSync(join(game, 'locales'), { recursive: true })
    mkdirSync(join(game, 'swiftshader'), { recursive: true })
    mkdirSync(join(game, 'custom_dlc'), { recursive: true })

    writeFileSync(join(game, 'Game.exe'), 'exe')
    writeFileSync(join(game, 'nw.dll'), 'dll')
    writeFileSync(join(game, 'icudtl.dat'), 'icu')
    writeFileSync(join(game, 'resources.pak'), 'pak')
    writeFileSync(join(game, 'locales', 'en-US.pak'), 'nwjs-locale-pak')
    writeFileSync(join(game, 'swiftshader', 'libEGL.dll'), 'egl')
    writeFileSync(join(game, 'index.html'), '<!doctype html>')
    writeFileSync(join(game, 'package.json'), '{"name":"sample"}')
    writeFileSync(join(game, 'custom_dlc', 'extra.json'), '{"ok":true}')
    writeFileSync(join(game, 'js', 'rmmz_core.js'), 'Utils.RPGMAKER_VERSION = "1.8.1";')
    writeFileSync(
      join(game, 'data', 'System.json'),
      JSON.stringify({ hasEncryptedImages: false, hasEncryptedAudio: false })
    )

    const res = await exportEditableProject({ gameDir: game, outputDir: out, decryptCacheDir: null })
    expect(res.engine).toBe('mz')
    expect(res.projectFile).toBe('game.rmmzproject')
    expect(readFileSync(join(out, 'game.rmmzproject'), 'utf-8')).toBe('RPGMZ 1.8.1')
    expect(existsSync(join(out, 'index.html'))).toBe(true)
    expect(existsSync(join(out, 'package.json'))).toBe(true)
    expect(existsSync(join(out, 'custom_dlc', 'extra.json'))).toBe(true)
    // NW.js 运行时全部被过滤
    expect(existsSync(join(out, 'Game.exe'))).toBe(false)
    expect(existsSync(join(out, 'nw.dll'))).toBe(false)
    expect(existsSync(join(out, 'icudtl.dat'))).toBe(false)
    expect(existsSync(join(out, 'resources.pak'))).toBe(false)
    expect(existsSync(join(out, 'locales'))).toBe(false)
    expect(existsSync(join(out, 'swiftshader'))).toBe(false)
  })
})
