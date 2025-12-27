# RPG Maker MV/MZ Decrypter

<div align="center">

A handy tool to decrypt and encrypt **RPG Maker MV** and **RPG Maker MZ** game assets.

![Python](https://img.shields.io/badge/Python-3.8%2B-blue) ![License](https://img.shields.io/badge/License-MIT-green) ![Status](https://img.shields.io/badge/Bilibili%20-%20LynxShu%20-%20%23006cff&logo=bilibili&logoColor=white) 

<p><a href="README.md">English</a> | <a href="README_zh.md">简体中文</a></p>
</div>

## 📖 Introduction

This tool allows you to extract (unlock) resources from RPG Maker games for educational research, modding, or recovering your own lost project files.

## ✨ Features

- **Dual Mode**: Supports both **Decryption** and **Encryption** of assets.
- **Auto-Detection**: Automatically identifies encryption keys from game files (`System.json`, JS code, or encrypted images).
- **Drag & Drop**: Simply drag files or folders into the window to process them.
- **Format Support**:
  - **Images**: `.rpgmvp` / `.png_` ↔ `.png`
  - **Audio**: `.rpgmvm` / `.m4a_` ↔ `.m4a`, `.rpgmvo` / `.ogg_` ↔ `.ogg`
- **Rescue Mode**: Includes an "Image Restoration" feature. It verifies and rebuilds standard PNG headers to recover images even **without** a known encryption key.
- **CLI Support**: Fully featured Command Line Interface for batch automation and scripting.
- **Expert Settings**: Supports custom header lengths, signatures, and validation logic for games using non-standard encryption schemes.

## 📂 Project Structure

```text
RPGMakerDecrypter/
├── assets/             # Icons and localization files
├── core/               # Core logic (Crypto algorithms, Key search, Workers)
│   ├── crypto.py       # Encryption/Decryption implementation
│   ├── key_finder.py   # Auto-detection logic for keys
│   └── ...
├── gui/                # GUI implementation (CustomTkinter)
├── Output/             # Default output directory for processed files
├── main.py             # Entry point (CLI and GUI launcher)
├── config.json         # User configuration (Auto-generated)
└── requirements.txt    # Python dependency list
```

## 🛠️ Installation

### Prerequisites
- Python 3.8 or higher.

### Steps
1. **Clone the repository**:
   
   ```bash
   git clone https://github.com/LynxShu/RPGMakerDecrypter.git
   cd RPGMakerDecrypter
   ```
   
2. **Install dependencies**:
   
   ```bash
   pip install -r requirements.txt
   ```

## 🚀 Usage Guide

### GUI Mode (Recommended)
Run the main script directly to launch the graphical interface (no arguments needed):

```bash
python main.py
```

1. **Select Mode**: Use the sidebar to choose "Decrypt", "Encrypt", or "Restore".
2. **Set Key**: Manually enter the encryption key, or click **Detect** to find it automatically within the game folder.
3. **Add Files**: Drag and drop files or folders into the drop zone.
4. **Start Processing**: Click "Start Processing". Files will appear in the `Output` folder.

### CLI Mode (Command Line)
For automation scripts or headless environments, use command-line arguments:

```bash
# Basic Decryption
python main.py -i "Path/To/Encrypted/File.rpgmvp" -o "Output/File.png" -k "ac12..."

# Recursive Directory Decryption
python main.py -i "Path/To/Game/img" -o "Output/img" -k "ac12..." --recursive

# Auto-detect key and decrypt
python main.py --detect-key "Path/To/Game" 
```

**Arguments:**
- `-i, --input`: Input file or directory path.
- `-o, --output`: Output file or directory path.
- `-k, --key`: Encryption key (Hex string).
- `--detect-key`: Game directory path to search for the key.
- `--mode`: Operation mode, `decrypt` (default) or `encrypt`.
- `--recursive`: Recursively process subdirectories.

## ⚠️ Important Notes

- **"Restore Images" Mode**: This mode **does not** require a key. It works by discarding the encrypted file head and appending a standard PNG header. This works **only** for image assets (`.png`) and cannot recover audio files.
- **Expert Settings**: If a game uses a modified header (different from the standard "RPGMV"), you can adjust the expected signature and header length in the "Settings" tab.

## ⚖️ Disclaimer

**This tool is intended for educational purposes, file recovery, and authorized modding only.**

- Do not use this tool to steal assets or infringe upon the intellectual property rights of game developers in any way.
- Please respect the copyright and license terms of any software or game you interact with.
- The author assumes no liability for any misuse or legal consequences arising from the use of this software.

## 📄 License

This project is based on [RPG-Maker-MV-Decrypter](https://github.com/Petschko/RPG-Maker-MV-Decrypter) by @Petschko. The core logic and implementation are derived from the original project and follow its [MIT License](LICENSE).

---
*Built with ❤️ by LynxShu and Gemini CLI.*