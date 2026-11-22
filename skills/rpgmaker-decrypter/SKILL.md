---
name: rpgmaker-decrypter
description: >-
  Standalone, first-principles guide to decrypt, encrypt, recover PNGs without a key,
  find encryption keys, and reconstruct editable projects for RPG Maker MV and MZ games
  (with an optional fast path via the LynxShu/RPGMakerDecrypter CLI when available).
  Use whenever the user asks to decrypt/unpack/re-encrypt RPG Maker MV/MZ assets
  (.rpgmvp, .rpgmvo, .rpgmvm, .png_, .ogg_, .m4a_), recover encrypted PNGs without a key,
  locate an RPG Maker encryptionKey, or rebuild a deployed MV/MZ game into an editable
  Game.rpgproject / game.rmmzproject folder.
---

# RPG Maker MV / MZ Decrypter & Project Reconstructor

This skill is **completely self-contained**: it gives you the exact binary specification, key recovery rules, project reconstruction workflow, and zero-dependency reference code to process **RPG Maker MV** and **RPG Maker MZ** assets anywhere — no GUI, repository, or external binary required.

If the open-source tool **[LynxShu/RPGMakerDecrypter](https://github.com/LynxShu/RPGMakerDecrypter)** is already present locally (or on `PATH`), you may optionally use its multi-threaded CLI as a faster execution path (Section 6).

> **Scope & Safety**
> - Intended for recovering lost projects, learning/research, localization, and authorized modding.
> - **Never mutate the original game directory in place.** Always write decrypted files or reconstructed projects to a separate output folder.
> - Supports **RPG Maker MV** and **RPG Maker MZ** standard encryption only (does not cover RGSS `.rgssad/.rgss2a/.rgss3a`, Enigma Virtual Box single-exe packers, or custom third-party JSON/JS obfuscation plugins).

---

## 1. Binary Format & Encryption Specification

RPG Maker MV and MZ use the **exact same encryption algorithm**; only the file extensions differ.

### File Extension Mapping

| Engine | Plaintext | Encrypted |
| --- | --- | --- |
| MV | `.png` / `.ogg` / `.m4a` | `.rpgmvp` / `.rpgmvo` / `.rpgmvm` |
| MZ | `.png` / `.ogg` / `.m4a` | `.png_` / `.ogg_` / `.m4a_` |

### Layout of an Encrypted File

```text
Offset 0..15   (16 bytes): Fake header
Offset 16..31  (16 bytes): First 16 bytes of original file XOR key[0..15]
Offset 32..EOF (rest)    : Remaining bytes of original file, UNCHANGED
```

- **Default 16-byte fake header** (hex):
  `52 50 47 4D 56 00 00 00 00 03 01 00 00 00 00 00`
  (Bytes `0..4` are ASCII `"RPGMV"`, bytes `8..10` are version `00 03 01`, remaining bytes are `00`.)
- **Key parsing**:
  - Split the hex key string into 2-char hex byte pairs: e.g. 32 hex chars → 16 bytes.
  - **CRITICAL — do NOT modulo-wrap short keys (`i % len(key)`):** for each byte index `i` in `0..15`, if `i < len(key_bytes)` compute `payload[i] ^ key_bytes[i]`; if `i >= len(key_bytes)` leave `payload[i]` unchanged (equivalent to XOR with `0`). Standard keys are 16 bytes (32 hex chars), while some games use 8-byte (16 hex chars) keys.
- **Decrypt**:
  1. Verify file length `> 16` and bytes `0..15` match the fake header (unless the user explicitly asks to ignore fake header validation for a modded header).
  2. Strip the first 16 bytes (`body = data[16:]`).
  3. XOR `body[i]` with `key_bytes[i]` for `i in range(min(16, len(body), len(key_bytes)))`.
  4. Verify magic bytes of `body`.
- **Encrypt**:
  1. Take plaintext bytes `plain`.
  2. Copy `plain` and XOR `out[i]` with `key_bytes[i]` for `i in range(min(16, len(out), len(key_bytes)))`.
  3. Prepend the 16-byte fake header.
  4. Rename extension according to target engine (`mv` or `mz`).

### Decrypted Magic Number Verification

Always verify decrypted output against expected magic bytes to detect a wrong key early:

| Type | Magic Bytes (hex) | Notes |
| --- | --- | --- |
| PNG | `89 50 4E 47 0D 0A 1A 0A` | Standard 8-byte PNG signature |
| OGG | `4F 67 67 53` | ASCII `"OggS"` |
| M4A | `66 74 79 70` at offset `4..7` | ISO BMFF `ftyp` box (commonly `00 00 00 18 66 74 79 70`) |

---

## 2. Finding the Encryption Key (Priority Order)

Check these sources in order and stop at the first verified key:

1. **`System.json`** (most reliable):
   - MZ: `<game>/data/System.json`
   - MV: `<game>/www/data/System.json` (or `<game>/data/System.json` if user pointed directly to `www/`)
   - Read JSON field `encryptionKey` (strip UTF-8 BOM if present).
2. **`rpg_core.js`** (MV fallback):
   - `<game>/www/js/rpg_core.js` or `<game>/js/rpg_core.js`
   - Look for `Decrypter._encryptionKey` or `this._encryptionKey` hex assignment. Some games store an obfuscated/LZString-base64 key; fall back to step 3 if regex doesn't find a clean hex string.
3. **Derive directly from any encrypted PNG** (`.rpgmvp` / `.png_`):
   - Every valid PNG begins with the exact 16 bytes:
     `PNG_HEADER = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52])`
     (8-byte PNG signature + 4-byte `IHDR` length `13` + 4-byte `"IHDR"` chunk type).
   - Take bytes `16..31` of any encrypted PNG file and XOR them with `PNG_HEADER`:
     `key_bytes[i] = enc_file[16 + i] ^ PNG_HEADER[i]` for `i in 0..15`.
   - Convert to lowercase hex (32 hex chars). This recovers the full 16-byte key, which also decrypts all `.rpgmvo`/`.ogg_` and `.rpgmvm`/`.m4a_` audio files in the same game!

---

## 3. Keyless PNG Restoration

If only encrypted PNG files are available (no `System.json`, no key needed):
1. Strip the 16-byte fake header (`body = data[16:]`).
2. Overwrite `body[0:16]` directly with `PNG_HEADER` (`89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52`).
3. Keep `body[16:]` unchanged and save as `.png`.

This works because the first 16 bytes of virtually every standard PNG file are identical (`signature + 0x0000000D + "IHDR"`), and image width/height start at offset 16 (unencrypted). Note: keyless restoration only works for PNG images, not OGG/M4A audio.

---

## 4. Reconstructing an Editable MV / MZ Project

Deployed RPG Maker MV / MZ games do **not** compile maps, databases, or JavaScript plugins — `data/*.json`, `js/plugins/*.js`, and `js/plugins.js` are already shipped in plaintext. Rebuilding an editable project requires 5 steps:

1. **Detect engine & project source root**:
   - If `<game>/www/data/System.json` exists → **MV**, `project_root = <game>/www`.
   - Else if `<game>/data/System.json` exists → `project_root = <game>`; check `js/rmmz_core.js` / `game.rmmzproject` (→ **MZ**) vs `js/rpg_core.js` / `Game.rpgproject` (→ **MV**).
   - Read engine version from `js/rmmz_core.js` or `js/rpg_core.js` via regex `Utils\.RPGMAKER_VERSION\s*=\s*["']([^"']+)["']`.
   - Name the output folder `<base_name>_project` (if user passed `www/`, use its parent folder's name). Never output to the same path as or an ancestor of `project_root`.
2. **Copy non-encrypted project files using a blacklist (NOT a whitelist)**:
   - Copying by blacklist preserves custom directories created by external plugins (e.g. `dlc/`, `movies/`, `effects/`, `fonts/`, custom data folders).
   - Always skip directories: `node_modules`, `.git`, `out`, `release`, `save`, `saves`.
   - When `project_root` is NOT inside `www/` (MZ deployed alongside NW.js), also skip NW.js runtime files at the root level:
     - Extensions: `.exe`, `.dll`, `.pak`, `.so`, `.dylib`
     - Files: `icudtl.dat`, `v8_context_snapshot.bin`, `natives_blob.bin`, `snapshot_blob.bin`, `vk_swiftshader_icd.json`, `credits.html`, `debug.log`
     - Root dirs: `swiftshader/`, `pnacl/`, and `locales/` **only if every entry inside `locales/` is a `.pak` file** (so game-owned JSON `locales/` folders are preserved).
   - Skip all encrypted asset files (`.rpgmvp`, `.rpgmvo`, `.rpgmvm`, `.png_`, `.ogg_`, `.m4a_`).
3. **Decrypt encrypted assets into `output_dir`**:
   - Decrypt every encrypted file found under `project_root` into `output_dir/<relative_path_with_normal_ext>`.
   - Make sure relative paths are relative to `project_root` (so MV's `www/` prefix is stripped).
4. **Patch `<output_dir>/data/System.json`**:
   - Parse JSON (stripping UTF-8 BOM if present), set `"hasEncryptedImages": false` and `"hasEncryptedAudio": false`, and write back UTF-8 JSON.
5. **Create the editor project entry file** (if not already present):
   - MV: `<output_dir>/Game.rpgproject` with content `RPGMV <version>` (fallback `RPGMV 1.6.2`)
   - MZ: `<output_dir>/game.rmmzproject` with content `RPGMZ <version>` (fallback `RPGMZ 1.8.1`)

---

## 5. Self-Contained Python 3 Reference Implementation

When no local CLI binary is installed, you can run a concise Python 3 script directly using standard library modules only:

```python
import json, os, re, shutil
from pathlib import Path

FAKE_HEADER = bytes.fromhex("5250474d560000000003010000000000")
PNG_HEADER = bytes([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
])
ENC_TO_PLAIN = {
    ".rpgmvp": ".png", ".rpgmvo": ".ogg", ".rpgmvm": ".m4a",
    ".png_": ".png",   ".ogg_": ".ogg",   ".m4a_": ".m4a",
}
PLAIN_TO_ENC = {
    "mv": {".png": ".rpgmvp", ".ogg": ".rpgmvo", ".m4a": ".rpgmvm"},
    "mz": {".png": ".png_",   ".ogg": ".ogg_",   ".m4a": ".m4a_"},
}

def parse_key(hex_key: str) -> bytes:
    cleaned = re.sub(r"[^0-9a-fA-F]", "", hex_key)
    return bytes(int(cleaned[i:i+2], 16) for i in range(0, len(cleaned) - 1, 2))

def xor_head(buf: bytearray, key_bytes: bytes) -> bytearray:
    for i in range(min(16, len(buf), len(key_bytes))):
        buf[i] ^= key_bytes[i]
    return buf

def decrypt_bytes(data: bytes, hex_key: str, ignore_fake_header: bool = False) -> bytes:
    if len(data) <= 16:
        raise ValueError("File too small")
    if not ignore_fake_header and data[:16] != FAKE_HEADER:
        raise ValueError("Fake header mismatch")
    body = bytearray(data[16:])
    return bytes(xor_head(body, parse_key(hex_key)))

def encrypt_bytes(plain: bytes, hex_key: str) -> bytes:
    body = bytearray(plain)
    xor_head(body, parse_key(hex_key))
    return FAKE_HEADER + bytes(body)

def restore_png_bytes(data: bytes) -> bytes:
    if len(data) < 32:
        raise ValueError("Encrypted PNG too small")
    return PNG_HEADER + data[32:]

def derive_key_from_png(enc_png: bytes) -> str:
    if len(enc_png) < 32:
        raise ValueError("Encrypted PNG too small")
    return bytes(enc_png[16 + i] ^ PNG_HEADER[i] for i in range(16)).hex()

def verify_magic(plain: bytes, ext: str) -> bool:
    ext = ext.lower()
    if ext == ".png":
        return plain[:8] == PNG_HEADER[:8]
    if ext == ".ogg":
        return plain[:4] == b"OggS"
    if ext == ".m4a":
        return len(plain) >= 8 and plain[4:8] == b"ftyp"
    return True
```

Use these primitives to decrypt single files, walk directories, or execute the 5-step editable project reconstruction described in Section 4.

---

## 6. Optional Fast Path: LynxShu/RPGMakerDecrypter

Source repository: **https://github.com/LynxShu/RPGMakerDecrypter**

- **Never block on cloning or installing this tool** when a quick Python script from Section 5 already solves the user's request.
- **When it IS already available locally** (installed as `rpgmaker-decrypter` on `PATH`, or inside a cloned copy of `LynxShu/RPGMakerDecrypter`), prefer calling its multi-threaded CLI directly for large directories or full project exports:

```bash
# Use `rpgmaker-decrypter`, `node out/main/cli.js`, or `npm run cli --`
rpgmaker-decrypter detect-key "<game-dir>"
rpgmaker-decrypter decode-dir "<game-dir>" -o "<out-dir>" [--dry-run] [--jobs 8] [--json]
rpgmaker-decrypter export-project "<game-dir>" [-o "<out-dir>"] [--dry-run] [--jobs 8] [--json]
rpgmaker-decrypter decrypt "<file>" -k "<hex-key>" [-o "<out-file>"] [--ignore-fake-header] [--json]
rpgmaker-decrypter encrypt "<file>" -k "<hex-key>" [-f mv|mz] [-o "<out-file>"] [--json]
rpgmaker-decrypter restore "<file>" [-o "<out-file>"] [--json]
```

- Always inspect `--dry-run --json` first on unfamiliar game directories.
- Report `magicFail` counts to the user if non-zero (indicates a wrong key or non-standard encryption).
- If the user wants a standalone portable Windows GUI instead of CLI/scripting, point them to the Releases page of https://github.com/LynxShu/RPGMakerDecrypter.

---

## 7. Common Edge Cases & Troubleshooting

- **Magic check fails on all files**: Key is wrong, or the game uses a modified encryption plugin (custom fake header / altered XOR logic). Try deriving the key from an encrypted PNG (`derive_key_from_png`) and compare it with `System.json`'s `encryptionKey`.
- **No `www/data/System.json` or `data/System.json` found**: The game may be packed inside a single executable (e.g. Enigma Virtual Box) or the user pointed to a subfolder like `img/` instead of the game root.
- **Unencrypted deployed game**: Still eligible for project reconstruction — copy files, filter NW.js runtime, ensure `hasEncryptedImages`/`hasEncryptedAudio` are `false`, and create `Game.rpgproject` or `game.rmmzproject`.
- **Obfuscated plugins or "Exclude unused files"**: Project still opens in the RPG Maker editor; minified plugins may simply lack `@param` annotations in the Plugin Manager UI, and excluded unused assets cannot be recovered because they were omitted during deployment.
