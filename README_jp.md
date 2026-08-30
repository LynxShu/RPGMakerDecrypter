<div align="center">

<p><img src="./assets/logo.png"></p>

RPG Maker Decrypter

<p><img src="./assets/index_jp.png"></p>

<p>
<a href="https://github.com/LynxShu/RPGMakerDecrypter/releases"><img src="https://img.shields.io/github/v/release/LynxShu/RPGMakerDecrypter?style=flat&label=Release&color=2EA44F" alt="Release"></a>
<a href="https://github.com/LynxShu/RPGMakerDecrypter/releases"><img src="https://img.shields.io/badge/Windows-10%2F11-4493F8?style=flat" alt="Windows"></a>
<a href="https://github.com/LynxShu/RPGMakerDecrypter/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
</p>

<p><a href="README.md">简体中文</a>  |  <a href="README_en.md">English</a>  |  日本語</p>

**RPG Maker MV / MZ** ゲームリソースの復号・暗号化・セーブデータ編集ツール

</div>


## 📖 はじめに

RPG Maker MV / MZ ゲームからリソースを抽出（復号）または再暗号化でき、ゲームのセーブデータの編集にも対応したツールです。失われた自身のプロジェクトファイルの復旧、許可を得た改造（Modding）、学習・研究を目的としています。

## ✨ 機能

- **復号 / 暗号化**: MV の `.rpgmvp / .rpgmvo / .rpgmvm` と MZ の `.png_ / .ogg_ / .m4a_` は同一アルゴリズムで、双方向に変換できます。
- **画像復元**: 暗号化キーがなくても、PNG ヘッダーを再構築して画像を復元できます。
- **鍵の逆算**: `System.json`、`rpg_core.js`（LZString フォールバック含む）、または暗号化画像ヘッダーから鍵を導出します。復号前に最初のファイルでキーチェックを行い、鍵が誤っていれば警告します。
- **一括処理とパフォーマンス**: マルチスレッド復号、リアルタイム進捗表示、キャンセル対応、ファイルごとのタイムアウトで自動スキップ。巨大なディレクトリもストリーム走査と段階的描画で処理します。
- **エクスポート**: 復号結果をフォルダーまたは ZIP（ストリーム生成・キャンセル対応）で書き出せます。
- **セーブデータエディタ**: MV / MZ のセーブデータをデコードし、クイックフォームと JSON ツリーの2ビューで編集。書き戻し前に `.bak` を自動バックアップします。
- **多言語**: 简体中文 / English / 日本語 を内蔵し、カスタム言語パックのホットスワップに対応（下記参照）。
- **テーマ**: ライト / ダークテーマ。
- **コマンドライン**: バッチ自動化に便利な完全な CLI を搭載。

## ⚡ クイックスタート

1. **ダウンロード**: [GitHub Releases ページ](https://github.com/LynxShu/RPGMakerDecrypter/releases) を開き、アーカイブをダウンロードします。
2. **解凍**: 任意のフォルダーに解凍します（`C:\Program Files` など管理者権限が必要な場所は避けてください）。
3. **実行**: 解凍したフォルダー内の `RPGMakerDecrypter.exe` をダブルクリックするだけです。インストールは不要です。

> ソースから実行したい方・開発者向けの手順は、下記「環境要件と実行」を参照。

## 🚀 使い方

### リソースの復号（GUI）

1. ゲームフォルダーを選択して「復号開始」をクリックすると、暗号化ファイルのスキャン、鍵の検出、キーチェックを自動で行います。
2. 統計を確認したら、「ファイルを書き出し」（フォルダーへコピー）または「ZIP 書き出し」（アーカイブ）を選択します。
3. 「リセット」をクリックして今回のキャッシュをクリアします。

### 暗号化 / 鍵なし画像復元

対応するタブに切り替え、ファイル/フォルダーと出力先を選択して一括処理します。

### セーブデータエディタ

セーブフォルダーまたはセーブファイルを1つ選択し、クイックフォームまたは JSON ツリーで編集します。保存時は自動でバックアップが作成されます。

### コマンドライン（CLI）

```bash
# リソース
rpgmaker-decrypter decrypt <file> -k <key> [-o out] [--json]
rpgmaker-decrypter encrypt <file> -k <key> [-o out]
rpgmaker-decrypter restore <file> [-o out]                       # 鍵なし画像復元
rpgmaker-decrypter detect-key <dir>                               # 鍵を自動検出
rpgmaker-decrypter decode-dir <dir> [-k key] [-o out] [--dry-run] [--jobs 8]

# セーブデータ
rpgmaker-decrypter save-decode <file> [-o out.json]
rpgmaker-decrypter save-encode <json> <out.rpgsave|out.rmmzsave> [--kind mv|mz]
```

共通オプション: `--json`（機械可読な出力）、`--verbose`（詳細な情報）、`--lang <code>`（UI 言語、未指定時は英語にフォールバック）。

開発環境では `rpgmaker-decrypter` の代わりに `npm run cli -- <args>` を使用できます。

## 📦 環境要件と実行

- Node.js ≥ 20（22 推奨）
- npm ≥ 10

```bash
npm install          # 依存関係のインストール
npm run dev          # 開発実行（ホットリロード）
npm run build        # out/ にビルド
npm run package:dir  # ポータブル版 release/win-unpacked/ を生成（.exe 含む）
npm run package      # インストーラー（NSIS）を生成
```

## 🌐 カスタム言語パック

言語パックは JSON ファイル1つで、**ファイル名がそのまま言語コード**になります。完全なテンプレートが同梱されているので、コピーしてリネームし、値を翻訳するだけです。即座に反映され、再起動もコード変更も不要です。

### 新しい言語を追加する3ステップ

1. **テンプレートをコピー**: `_template.json` を複製し、言語コードにリネームします（例: `fr.json`、`de.json`）。
   - ソースから実行する場合: テンプレートはプロジェクト直下の `locales/_template.json` にあります。
   - パッケージ版: 初回起動後、`%APPDATA%\rpgmaker-decrypter\locales\`（Windows）に `_template.json` が自動配置されています。
2. **名前を変更**: ファイル先頭の `"__meta": { "name": "…" }` を言語の正式名称に変更します（言語ドロップダウンに表示されます）。例: `"Français"`。
3. **値を翻訳**: 各キーの後の引用符内の英語を自分の言語に書き換えて保存します。ドロップダウンに新しい言語がすぐに表示されます。

> テンプレートには**すべて**のメッセージキーが含まれています。変更したい行だけを残しても構いません — 記述のないキーは自動的に英語にフォールバックします。

## 🔐 暗号化とセーブデータの形式（概要）

- **暗号化**: MV / MZ は同一アルゴリズムです。各暗号化リソースは16バイトの疑似ヘッダー（先頭5バイトは ASCII `RPGMV`）で始まり、疑似ヘッダー後の先頭16バイトのペイロードを16文字（hex）の鍵と XOR します。鍵は2 hex ずつに分割され、インデックスで直接取得されます（循環なし）。鍵の優先順位: `System.json` → `rpg_core.js` → 暗号化画像ヘッダーからの逆算。
- **セーブデータ**: MV の `.rpgsave` は `LZString.compressToBase64(JsonEx.stringify(contents))`、MZ の `.rmmzsave` は `pako.deflate(json, {level:1})` のバイナリ文字列を UTF-8 で書き出したものです。編集時、未知のフィールドと JsonEx の `"@"` クラスマーカーは**無損失で保持**されます。

## 🧪 開発とテスト

```bash
npm run typecheck    # TypeScript 型チェック
npm test             # vitest 単体テスト
node scripts/verify.cjs               # コア自己検証（事前に tsc -p tsconfig.build-lib.json が必要）
node scripts/regression.cjs           # 合成サンプルによる E2E
node scripts/verify-cli.cjs           # CLI 自動化（事前に prepare-cli-test.cjs が必要）
node scripts/verify-watch.cjs         # ホットリロード / 設定保存の回帰
```

## 🙏 謝辞

本プロジェクトは設計・実装にあたり、以下のオープンソースプロジェクトを参考にしています。

**コアアルゴリズム**

- [Petschko/RPG-Maker-MV-Decrypter](https://github.com/Petschko/RPG-Maker-MV-Decrypter)（MIT）— MV/MZ 加復号のコアアルゴリズム（XOR、疑似ヘッダー、画像復元、鍵の逆算）。
- [pieroxy/lz-string](https://github.com/pieroxy/lz-string)（MIT / WTFPL v2）— セーブデータの LZString 圧縮アルゴリズム。

**セーブデータ編集**

- [takuyaihara/rpgsave-editor](https://github.com/takuyaihara/rpgsave-editor)（MIT）— セーブデータエディタの形態の参考。
- [Gteditor99/rpgsave-decode](https://github.com/Gteditor99/rpgsave-decode)（MIT）— セーブデータ復号の参考。

**その他の参考**

- [RPG-Maker-Translation-Tools/rpgmdec](https://github.com/RPG-Maker-Translation-Tools/rpgmdec)（WTFPL）
- [RPG-Maker-Translation-Tools/rpgm-archive-decrypter](https://github.com/RPG-Maker-Translation-Tools/rpgm-archive-decrypter)（MIT）
- [RPG-Maker-Translation-Tools/rpgm-asset-decrypter-rs](https://github.com/RPG-Maker-Translation-Tools/rpgm-asset-decrypter-rs)（MIT）
- [Petschko/Java-RPG-Maker-MV-Decrypter](https://github.com/Petschko/Java-RPG-Maker-MV-Decrypter)（MIT）
- [omega-slender/NimRpgMakerDecrypt](https://github.com/omega-slender/NimRpgMakerDecrypt)（MIT）
- [paradoxie/saveeditor](https://github.com/paradoxie/saveeditor)（MIT）
- [LackoPotato/RPGMakerMVSaveEditor](https://github.com/LackoPotato/RPGMakerMVSaveEditor)（MIT）

## ⚖️ 免責事項

**本ツールは学習・研究、ファイル復旧、許可を得た改造（Modding）のみを目的としています。**

- 本ツールを使用してリソースを窃取したり、ゲーム開発者の知的財産をいかなる形でも侵害しないでください。
- 対象となるソフトウェアやゲームの著作権および利用規約を尊重してください。
- 本ソフトウェアの使用に起因する不正使用や法的結果について、作者は一切の責任を負いません。

## 📄 ライセンス

本プロジェクトは **MIT** ライセンスで提供されます。
