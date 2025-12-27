import os
import re
import json
import binascii
from typing import Optional
import logging

try:
    import lzstring
except ImportError:
    lzstring = None

from .crypto import Crypto

class KeyFinder:
    def __init__(self, game_dir: str):
        self.game_dir = game_dir
        self.logger = logging.getLogger("KeyFinder")

    def find_key(self) -> Optional[str]:
        """Attempts to find the key using all available methods."""
        # 1. System.json
        key = self.find_key_in_system_json()
        if key:
            return key

        # 2. Code Scan
        key = self.scan_js_files()
        if key:
            return key
            
        # 3. Image Analysis (Last resort, requires an encrypted image)
        key = self.derive_key_from_images()
        if key:
            return key
            
        return None

    def find_key_in_system_json(self) -> Optional[str]:
        system_json_path = os.path.join(self.game_dir, "data", "System.json")
        if not os.path.exists(system_json_path):
            # Try www/data/System.json (deployed web version)
            system_json_path = os.path.join(self.game_dir, "www", "data", "System.json")
        
        if not os.path.exists(system_json_path):
            return None

        try:
            with open(system_json_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Try direct JSON parse
            try:
                data = json.loads(content)
                if 'encryptionKey' in data:
                    return data['encryptionKey']
                # Sometimes System.json is an object, sometimes array? 
                # In MV/MZ it's usually an object.
            except json.JSONDecodeError:
                # Try LZString decompress
                if lzstring:
                    decoded = lzstring.LZString.decompressFromBase64(content)
                    if decoded:
                        data = json.loads(decoded)
                        if 'encryptionKey' in data:
                            return data['encryptionKey']
        except Exception as e:
            self.logger.error(f"Error parsing System.json: {e}")
            
        return None

    def scan_js_files(self) -> Optional[str]:
        """Scans js files for the encryption key assignment."""
        js_dir = os.path.join(self.game_dir, "js")
        if not os.path.exists(js_dir):
             js_dir = os.path.join(self.game_dir, "www", "js")
        
        if not os.path.exists(js_dir):
            return None

        js_files = []
        for root, _, files in os.walk(js_dir):
            for file in files:
                if file.endswith(".js"):
                    js_files.append(os.path.join(root, file))
        
        # Prioritize rpg_core.js
        js_files.sort(key=lambda x: 0 if "rpg_core.js" in os.path.basename(x) else 1)
        
        pattern = re.compile(r'this\._encryptionKey\s*=\s*["\']([0-9a-fA-F]+)["\']')
        
        for full_path in js_files:
            try:
                with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    match = pattern.search(content)
                    if match:
                        return match.group(1)
            except Exception as e:
                self.logger.error(f"Error scanning {full_path}: {e}")

        return None

    def derive_key_from_images(self) -> Optional[str]:
        """
        Derives key by comparing encrypted image header with standard PNG header.
        Key = EncryptedBytes ^ PNGHeaderBytes
        """
        img_dir = os.path.join(self.game_dir, "img")
        if not os.path.exists(img_dir):
            img_dir = os.path.join(self.game_dir, "www", "img")
            
        if not os.path.exists(img_dir):
            return None

        # Find a .rpgmvp or .png_ file
        target_exts = {'.rpgmvp', '.png_'}
        sample_file = None
        
        for root, _, files in os.walk(img_dir):
            for file in files:
                _, ext = os.path.splitext(file)
                if ext.lower() in target_exts:
                    sample_file = os.path.join(root, file)
                    break
            if sample_file:
                break
        
        if not sample_file:
            return None

        try:
            with open(sample_file, 'rb') as f:
                data = f.read(32) # Read first 32 bytes (16 Fake + 16 Encrypted)
            
            crypto = Crypto()
            if not crypto.verify_fake_header(data):
                self.logger.warning("Sample image has invalid fake header, skipping derivation.")
                return None
            
            encrypted_header = data[16:32]
            png_header = crypto.PNG_HEADER
            
            key_bytes = bytearray(16)
            for i in range(16):
                key_bytes[i] = encrypted_header[i] ^ png_header[i]
            
            key_hex = binascii.hexlify(key_bytes).decode('utf-8')
            return key_hex
            
        except Exception as e:
            self.logger.error(f"Error deriving key from image: {e}")
            
        return None
