<div align="center">

<p><img src="./assets/logo.png"></p>

RPG Maker Decrypter

<p><img src="./assets/index_en.png"></p>

<p>
<a href="https://github.com/LynxShu/RPGMakerDecrypter/releases"><img src="https://img.shields.io/github/v/release/LynxShu/RPGMakerDecrypter?style=flat&label=Release&color=2EA44F" alt="Release"></a>
<a href="https://github.com/LynxShu/RPGMakerDecrypter/releases"><img src="https://img.shields.io/badge/Windows-10%2F11-4493F8?style=flat" alt="Windows"></a>
<a href="https://github.com/LynxShu/RPGMakerDecrypter/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
</p>

<p><a href="README.md">简体中文</a>  |  English  |  <a href="README_jp.md">日本語</a></p>

**RPG Maker MV / MZ** game resource decryption, encryption, and save-editing tool

</div>


## 📖 Introduction

This tool extracts (decrypts) or re-encrypts resources from RPG Maker MV / MZ games, and also edits game save files. It is intended for recovering your own lost project files, authorized modding, and learning/research.

## ✨ Features

- **Decrypt / Encrypt**: MV `.rpgmvp / .rpgmvo / .rpgmvm` and MZ `.png_ / .ogg_ / .m4a_` use the same algorithm — conversion works in both directions.
- **Image recovery**: recover images without the encryption key by rebuilding the PNG header.
- **Key inference**: derive the key from `System.json`, `rpg_core.js` (with an LZString fallback), or the encrypted image header; a pre-check on the first file warns you if the key is wrong.
- **Bulk & performance**: multithreaded decryption with real-time progress, cancellable, per-file timeout with automatic skip; streamed scanning and progressive rendering for very large folders.
- **Export**: export decrypted results to a folder or a ZIP archive (streamed, cancellable).
- **Save editor**: decode MV / MZ save files and edit them in both a quick form and a JSON tree view; a `.bak` backup is created automatically before writing back.
- **Multilingual**: built-in 简体中文 / English / 日本語, plus hot-swappable custom language packs (see below).
- **Theme**: light and dark themes.
- **CLI**: a complete command-line interface for batch automation.

## ⚡ Quick Start

1. **Download**: open the [GitHub Releases page](https://github.com/LynxShu/RPGMakerDecrypter/releases) and download the archive.
2. **Extract**: extract it to any folder (avoid locations that require administrator rights, such as `C:\Program Files`).
3. **Run**: open the extracted folder and double-click `RPGMakerDecrypter.exe` — no installation needed.

> Want to run from source or do development? See "Requirements & Running" below.

## 🚀 Usage Guide

### Decrypt resources (GUI)

1. Select the game folder and click "Start Decrypt" — encrypted files are scanned, the key is found, and a pre-check is performed automatically.
2. Review the stats, then choose "Export files" (copy to a folder) or "Export ZIP" (archive).
3. Click "Reset" to clear the current cache.

### Encrypt / recover images without a key

Switch to the corresponding tab, select files/folders and an output folder, then batch-process.

### Save editor

Select a save folder or a single save file, edit with the quick form or the JSON tree; a backup is created automatically when saving.

### Command line (CLI)

```bash
# Assets
rpgmaker-decrypter decrypt <file> -k <key> [-o out] [--json]
rpgmaker-decrypter encrypt <file> -k <key> [-o out]
rpgmaker-decrypter restore <file> [-o out]                       # image recovery without a key
rpgmaker-decrypter detect-key <dir>                               # auto-detect key
rpgmaker-decrypter decode-dir <dir> [-k key] [-o out] [--dry-run] [--jobs 8]

# Saves
rpgmaker-decrypter save-decode <file> [-o out.json]
rpgmaker-decrypter save-encode <json> <out.rpgsave|out.rmmzsave> [--kind mv|mz]
```

Common options: `--json` (machine-readable output), `--verbose` (more detail), `--lang <code>` (interface language; falls back to English).

In a development environment, use `npm run cli -- <args>` instead of `rpgmaker-decrypter`.

## 📦 Requirements & Running

- Node.js ≥ 20 (22 recommended)
- npm ≥ 10

```bash
npm install          # install dependencies
npm run dev          # development run (hot reload)
npm run build        # build to out/
npm run package:dir  # portable folder release/win-unpacked/ (contains .exe)
npm run package      # installer (NSIS)
```

## 🌐 Custom Language Packs

A language pack is a single JSON file whose **filename is the language code**. The project ships a complete template — just copy it, rename it, and translate the values. It takes effect immediately: no restart, no code changes.

### Add a language in three steps

1. **Copy the template**: duplicate `_template.json` and rename it to a language code, e.g. `fr.json`, `de.json`.
   - Running from source: the template is at `locales/_template.json` in the project root;
   - Packaged app: after the first launch, `_template.json` is already placed in `%APPDATA%\rpgmaker-decrypter\locales\` (Windows).
2. **Set the name**: change `"__meta": { "name": "…" }` at the top of the file to the language's own name (shown in the language dropdown), e.g. `"Français"`.
3. **Translate the values**: replace the English text in quotes after each key with your language and save. The new language appears in the dropdown immediately.

> The template contains **all** message keys. You can also keep only the lines you want to change — missing keys fall back to English automatically.

## 🔐 Encryption & Save Format (Overview)

- **Encryption**: MV / MZ use the same algorithm. Each encrypted resource starts with a 16-byte fake header (first 5 bytes ASCII `RPGMV`); encryption XORs the 16 bytes of payload after the fake header with a 16-character (hex) key, split into 2-hex chunks and taken by index (no cycling). Key priority: `System.json` → `rpg_core.js` → inferred from the encrypted image header.
- **Saves**: MV `.rpgsave` is `LZString.compressToBase64(JsonEx.stringify(contents))`; MZ `.rmmzsave` is a `pako.deflate(json, {level:1})` binary string written as UTF-8. Unknown fields and JsonEx `"@"` class markers are preserved losslessly when editing.

## 🧪 Development & Testing

```bash
npm run typecheck    # TypeScript type check
npm test             # vitest unit tests
node scripts/verify.cjs               # core self-check (run tsc -p tsconfig.build-lib.json first)
node scripts/regression.cjs           # end-to-end with synthetic samples
node scripts/verify-cli.cjs           # CLI automation (run prepare-cli-test.cjs first)
node scripts/verify-watch.cjs         # hot-reload / preferences regression
```

## 🙏 Acknowledgments

This project references the following open-source projects in its design and implementation:

**Core algorithms**

- [Petschko/RPG-Maker-MV-Decrypter](https://github.com/Petschko/RPG-Maker-MV-Decrypter) (MIT) — core MV/MZ encryption/decryption algorithm (XOR, fake header, image recovery, key inference).
- [pieroxy/lz-string](https://github.com/pieroxy/lz-string) (MIT / WTFPL v2) — LZString compression for save data.

**Save editing**

- [takuyaihara/rpgsave-editor](https://github.com/takuyaihara/rpgsave-editor) (MIT) — reference for the save editor design.
- [Gteditor99/rpgsave-decode](https://github.com/Gteditor99/rpgsave-decode) (MIT) — reference for save decoding.

**Other references**

- [RPG-Maker-Translation-Tools/rpgmdec](https://github.com/RPG-Maker-Translation-Tools/rpgmdec) (WTFPL)
- [RPG-Maker-Translation-Tools/rpgm-archive-decrypter](https://github.com/RPG-Maker-Translation-Tools/rpgm-archive-decrypter) (MIT)
- [RPG-Maker-Translation-Tools/rpgm-asset-decrypter-rs](https://github.com/RPG-Maker-Translation-Tools/rpgm-asset-decrypter-rs) (MIT)
- [Petschko/Java-RPG-Maker-MV-Decrypter](https://github.com/Petschko/Java-RPG-Maker-MV-Decrypter) (MIT)
- [omega-slender/NimRpgMakerDecrypt](https://github.com/omega-slender/NimRpgMakerDecrypt) (MIT)
- [paradoxie/saveeditor](https://github.com/paradoxie/saveeditor) (MIT)
- [LackoPotato/RPGMakerMVSaveEditor](https://github.com/LackoPotato/RPGMakerMVSaveEditor) (MIT)

## ⚖️ Disclaimer

**This tool is intended for learning/research, file recovery, and authorized modding only.**

- Do not use this tool to steal assets or infringe on game developers' intellectual property in any way.
- Respect the copyrights and terms of use of the software or games you work with.
- The author assumes no responsibility for any misuse or legal consequences arising from the use of this software.

## 📄 License

This project is licensed under the **MIT** License.
