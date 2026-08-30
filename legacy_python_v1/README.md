# RPG Maker MV/MZ 加解密工具

<div align="center">

解密和加密 **RPG Maker MV** 和 **RPG Maker MZ** 游戏资源的小玩具

![Python](https://img.shields.io/badge/Python-3.8%2B-blue) ![License](https://img.shields.io/badge/License-MIT-green) ![Status](https://img.shields.io/badge/Bilibili%20-%20LynxShu%20-%20%23006cff&logo=bilibili&logoColor=white) 

<p><a href="README_EN.md">English</a> | 简体中文</p>
</div>

## 📖 简介

本工具允许你从 RPG Maker 游戏中提取（解锁）资源，以用于学习研究、模组制作（Modding）或恢复你自己丢失的项目文件。

## ✨ 功能特性

- **双重模式**：同时支持对素材进行 **解密** 和 **加密**。
- **自动检测**：自动从游戏文件（`System.json`、JS 代码或已加密图片）中查找加密密钥。
- **拖放支持**：只需将文件或文件夹拖入窗口即可进行处理。
- **格式支持**：
  - **图片**：`.rpgmvp` / `.png_` ↔ `.png`
  - **音频**：`.rpgmvm` / `.m4a_` ↔ `.m4a`, `.rpgmvo` / `.ogg_` ↔ `.ogg`
- **救援模式**：提供“图片还原”功能，即使**没有**加密密钥，也能通过重建标准 PNG 文件头来恢复 PNG 文件。
- **命令行 (CLI) 支持**：功能齐全的命令行接口，便于批量自动化处理。
- **专家设置**：针对非标准加密方案，支持自定义文件头长度、签名和验证方式。

## 📂 项目结构

```text
RPGMakerDecrypter/
├── assets/             # 图标和语言文件
├── core/               # 核心逻辑 (加密算法、密钥搜索、工作线程)
│   ├── crypto.py       # 加密/解密算法
│   ├── key_finder.py   # 自动密钥检测逻辑
│   └── ...
├── gui/                # GUI 实现 (CustomTkinter)
├── Output/             # 处理后文件的默认输出目录
├── main.py             # 入口点 (CLI 和 GUI 启动器)
├── config.json         # 用户配置 (自动生成)
└── requirements.txt    # Python 依赖列表
```

## 🛠️ 安装说明

### 环境要求
- Python 3.8 或更高版本。

### 安装步骤
1. **克隆仓库**:
   
   ```bash
   git clone https://github.com/LynxShu/RPGMakerDecrypter.git
   cd RPGMakerDecrypter
   ```
   
2. **安装依赖**:
   
   ```bash
   pip install -r requirements.txt
   ```

## 🚀 使用指南

### GUI 模式（推荐）
直接运行主脚本即可启动图形界面（无需参数）：

```bash
python main.py
```

1. **选择模式**：通过侧边栏选择“解密(Decrypt)”、“加密(Encrypt)”或“还原(Restore)”。
2. **设置密钥**：手动输入加密密钥，或点击 **检测(Detect)** 按钮自动从游戏文件夹中查找。
3. **添加文件**：将文件或文件夹拖放到操作区域。
4. **开始处理**：点击“开始处理(Start Processing)”。文件将出现在 `Output` 文件夹中。

### CLI 模式（命令行）
用于自动化脚本或无界面环境，请使用命令行参数：

```bash
# 基础解密
python main.py -i "Path/To/Encrypted/File.rpgmvp" -o "Output/File.png" -k "ac12..."

# 递归目录解密
python main.py -i "Path/To/Game/img" -o "Output/img" -k "ac12..." --recursive

# 自动检测密钥并解密
python main.py --detect-key "Path/To/Game" 
```

**参数说明：**
- `-i, --input`: 输入文件或目录路径。
- `-o, --output`: 输出文件或目录路径。
- `-k, --key`: 加密密钥（十六进制字符串）。
- `--detect-key`: 用于搜索密钥的游戏目录路径。
- `--mode`: 模式选择，`decrypt` (默认) 或 `encrypt`。
- `--recursive`: 递归处理子目录。

## ⚠️ 重要说明

- **“图片还原” (Restore Images) 模式**：此模式**不需要**密钥。它的工作原理是丢弃加密头并附加标准的 PNG 文件头。这**仅适用于**图片资源（`.png`），无法恢复音频文件。
- **专家设置**：如果游戏使用了修改过的加密头（不是标准的 "RPGMV"），你可以在“设置(Settings)”标签页中调整签名和头长度。

## ⚖️ 免责声明

**本工具仅供学习研究、文件恢复和获得授权的模组修改(Modding)使用。**

- 请勿使用本工具窃取资源或通过任何方式侵犯游戏开发者的知识产权。
- 请尊重你所操作的任何软件或游戏的版权及使用条款。
- 作者对因使用本软件而产生的任何滥用行为或法律后果不承担任何责任。

## 📄 许可证

本项目基于 [RPG-Maker-MV-Decrypter](https://github.com/Petschko/RPG-Maker-MV-Decrypter) (@Petschko) 项目开发，其核心原理与实现均基于原项目，沿用其 [MIT 许可证](LICENSE) 授权。

---
*由 LynxShu 和 Gemini CLI 用 ❤️ 构建。*