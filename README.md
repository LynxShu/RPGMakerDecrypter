<div align="center">

<p><img src="./assets/logo.png"></p>

RPG Maker Decrypter

<p><img src="./assets/index_zh.png"></p>

<p>
<a href="https://github.com/LynxShu/RPGMakerDecrypter/releases"><img src="https://img.shields.io/github/v/release/LynxShu/RPGMakerDecrypter?style=flat&label=Release&color=2EA44F" alt="Release"></a>
<a href="https://github.com/LynxShu/RPGMakerDecrypter/releases"><img src="https://img.shields.io/badge/Windows-10%2F11-4493F8?style=flat" alt="Windows"></a>
<a href="https://github.com/LynxShu/RPGMakerDecrypter/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
</p>

<p>简体中文  |  <a href="README_en.md">English</a>  |  <a href="README_jp.md">日本語</a></p>

**RPG Maker MV / MZ** 游戏资源的解密、加密、存档编辑工具

</div>


## 📖 简介

本工具用于从 RPG Maker MV / MZ 游戏中提取（解密）或重新加密资源，并支持编辑游戏存档，适用于找回自己丢失的项目文件、获得授权的改模（Modding）与学习研究。

## ✨ 功能特性

- **解密 / 加密**：MV `.rpgmvp / .rpgmvo / .rpgmvm` 与 MZ `.png_ / .ogg_ / .m4a_` 使用同一套算法，可双向转换。
- **图片恢复**：即使没有加密密钥，也能通过重建 PNG 文件头恢复图片。
- **密钥反推**：从 `System.json`、`rpg_core.js`（含 LZString 兜底）或加密图片头反推密钥；解密前对首个文件做 key 预检，密钥错误提示。
- **批量与性能**：多线程解密，实时进度、可取消、单文件超时自动跳过；超大目录流式扫描、渐进渲染。
- **导出**：解密结果可导出为文件目录或打包 ZIP（流式打包、可取消）。
- **存档编辑器**：MV / MZ 存档解码，快捷表单与 JSON 树双视图编辑，写回前自动备份 `.bak`。
- **多语言**：内置中文 / English / 日本語，支持**自定义语言包热切换**（见下文）。
- **主题**：明暗主题。
- **命令行**：完整 CLI，便于批量自动化。

## ⚡ 快速使用

1. **下载**：打开 [GitHub Releases 发布页](https://github.com/LynxShu/RPGMakerDecrypter/releases)，下载压缩包。
2. **解压**：解压到任意目录（建议不要解压到需要管理员权限的位置，如 `C:\Program Files`）。
3. **运行**：进入解压后的文件夹，双击 `RPGMakerDecrypter.exe` 即可，无需安装。

> 想从源码运行或二次开发？见下文「环境要求与运行」。

## 🚀 使用指南

### 解密资源（GUI）

1. 选择游戏目录，点「开始解密」——自动扫描加密文件、查找密钥并做 key 预检。
2. 查看统计后，选择「导出文件」（拷贝到目录）或「导出 ZIP」（打包）。
3. 点「重置」清空本次缓存。

### 加密 / 无密钥救图

切换到对应标签，选择文件/目录与输出目录，批量处理。

### 存档编辑器

选择存档目录或单个存档文件，用快捷表单或 JSON 树编辑，保存时自动备份。

### 命令行（CLI）

```bash
# 资源
rpgmaker-decrypter decrypt <file> -k <key> [-o out] [--json]
rpgmaker-decrypter encrypt <file> -k <key> [-o out]
rpgmaker-decrypter restore <file> [-o out]                       # 无密钥救图
rpgmaker-decrypter detect-key <dir>                               # 自动找 key
rpgmaker-decrypter decode-dir <dir> [-k key] [-o out] [--dry-run] [--jobs 8]

# 存档
rpgmaker-decrypter save-decode <file> [-o out.json]
rpgmaker-decrypter save-encode <json> <out.rpgsave|out.rmmzsave> [--kind mv|mz]
```

通用选项：`--json`（机器可读输出）、`--verbose`（更多过程信息）、`--lang <code>`（界面语言，找不到回退英文）。

开发环境下可用 `npm run cli -- <args>` 代替 `rpgmaker-decrypter`。


## 📦 环境要求与运行

- Node.js ≥ 20（建议 22）
- npm ≥ 10

```bash
npm install          # 安装依赖
npm run dev          # 开发运行（热更新）
npm run build        # 构建到 out/
npm run package:dir  # 生成免安装目录 release/win-unpacked/（含 .exe）
npm run package      # 生成安装程序（NSIS）
```

## 🌐 自定义语言包

语言包就是一个 JSON 文件，**文件名就是语言代码**。项目自带一份完整模版，照着改就行；放入后**立即生效、无需重启、无需改代码**。

### 三步添加新语言

1. **复制模版**：把 `_template.json` 复制一份，改名为语言代码，如 `fr.json`、`de.json`。
   - 源码运行时：模版在项目根目录 `locales/_template.json`；
   - 打包版：首次启动后，`%APPDATA%\rpgmaker-decrypter\locales\`（Windows）下已自动放好 `_template.json`。
2. **改名字**：文件开头的 `"__meta": { "name": "…" }` 改成语言名称（会显示在语言下拉框），如 `"Français"`。
3. **翻译文案**：把每个 key 后面引号里的英文改成你的语言，保存即可。下拉框里马上出现新语言。

> 模版含**全部**文案 key；也可以只留想改的几行，没写的 key 会自动回退到英文。

## 🔐 加解密与存档格式（简述）

- **加密**：MV / MZ 同一套算法。每个加密资源以 16 字节假头开头（前 5 字节 ASCII `RPGMV`），加密仅是把假头后的前 16 字节负载与 16 字符（hex）密钥做 XOR；密钥按每 2 个 hex 切分、按索引直取（不循环）。密钥优先级：`System.json` → `rpg_core.js` → 加密图片头反推。
- **存档**：MV `.rpgsave` 为 `LZString.compressToBase64(JsonEx.stringify(contents))`；MZ `.rmmzsave` 为 `pako.deflate(json, {level:1})` 的 binary string 按 UTF-8 落盘。编辑时未知字段与 JsonEx `"@"` 类标记**无损保留**。

## 🧪 开发与测试

```bash
npm run typecheck    # TS 类型检查
npm test             # vitest 单元测试
node scripts/verify.cjs               # 核心自检（需先 tsc -p tsconfig.build-lib.json）
node scripts/regression.cjs           # 合成样本端到端
node scripts/verify-cli.cjs           # CLI 自动化（需先 prepare-cli-test.cjs）
node scripts/verify-watch.cjs         # 热监视/偏好存储回归
```

## 🙏 特别鸣谢

本项目在设计与实现中参考了以下开源项目：

**核心算法**

- [Petschko/RPG-Maker-MV-Decrypter](https://github.com/Petschko/RPG-Maker-MV-Decrypter)（MIT）—— MV/MZ 加解密核心算法（XOR、假头、救图、密钥反推）。
- [pieroxy/lz-string](https://github.com/pieroxy/lz-string)（MIT / WTFPL v2）—— 存档 LZString 压缩算法。

**存档编辑**

- [takuyaihara/rpgsave-editor](https://github.com/takuyaihara/rpgsave-editor)（MIT）—— 存档编辑器形态参考。
- [Gteditor99/rpgsave-decode](https://github.com/Gteditor99/rpgsave-decode)（MIT）—— 存档解码参考。

**其它参考**

- [RPG-Maker-Translation-Tools/rpgmdec](https://github.com/RPG-Maker-Translation-Tools/rpgmdec)（WTFPL）
- [RPG-Maker-Translation-Tools/rpgm-archive-decrypter](https://github.com/RPG-Maker-Translation-Tools/rpgm-archive-decrypter)（MIT）
- [RPG-Maker-Translation-Tools/rpgm-asset-decrypter-rs](https://github.com/RPG-Maker-Translation-Tools/rpgm-asset-decrypter-rs)（MIT）
- [Petschko/Java-RPG-Maker-MV-Decrypter](https://github.com/Petschko/Java-RPG-Maker-MV-Decrypter)（MIT）
- [omega-slender/NimRpgMakerDecrypt](https://github.com/omega-slender/NimRpgMakerDecrypt)（MIT）
- [paradoxie/saveeditor](https://github.com/paradoxie/saveeditor)（MIT）
- [LackoPotato/RPGMakerMVSaveEditor](https://github.com/LackoPotato/RPGMakerMVSaveEditor)（MIT）

## ⚖️ 免责声明

**本工具仅供学习研究、文件恢复和获得授权的改模（Modding）使用。**

- 请勿使用本工具窃取资源或以任何方式侵犯游戏开发者的知识产权。
- 请尊重所操作软件或游戏的版权及使用条款。
- 作者对因使用本软件而产生的任何滥用行为或法律后果不承担任何责任。

## 📄 许可证

本项目采用 **MIT** 许可证。
