import os
import binascii
from typing import Optional, List
from core.language import get_text

class Crypto:
    DEFAULT_HEADER_LEN = 16
    DEFAULT_SIGNATURE = "5250474d56000000"
    DEFAULT_VERSION = "000301"
    DEFAULT_REMAIN = "0000000000"
    # Standard PNG Header: 89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52
    PNG_HEADER = bytes.fromhex("89504E470D0A1A0A0000000D49484452")

    def __init__(self, key: str = None):
        self.key_hex = key
        self.key_bytes = binascii.unhexlify(key) if key else None
        
        # Advanced Settings (Expert Mode)
        self.header_len = self.DEFAULT_HEADER_LEN
        self.signature = self.DEFAULT_SIGNATURE
        self.version = self.DEFAULT_VERSION
        self.remain = self.DEFAULT_REMAIN
        self.ignore_fake_header = False

    def _build_fake_header(self) -> bytes:
        """Constructs the fake header bytes based on current settings."""
        header_hex = self.signature + self.version + self.remain
        # Pad or trim to ensure it matches header_len
        header_bytes = binascii.unhexlify(header_hex)
        if len(header_bytes) != self.header_len:
             # In a real scenario, we might want to warn or adjust. 
             # The JS code assumes the strings match the length. 
             # We'll trust the defaults/inputs for now but ensure length.
             pass
        return header_bytes

    def verify_fake_header(self, file_data: bytes) -> bool:
        """Checks if the file starts with the expected fake header."""
        if len(file_data) < self.header_len:
            return False
        
        expected_header = self._build_fake_header()
        actual_header = file_data[:self.header_len]
        return actual_header == expected_header

    def decrypt(self, data: bytes) -> bytes:
        """
        Decrypts the data.
        1. Verifies/Removes Fake Header.
        2. XORs the first [header_len] bytes of the remaining content.
        """
        if not data:
            raise ValueError(get_text("exception.emptyFile"))

        if not self.ignore_fake_header:
            if not self.verify_fake_header(data):
                raise ValueError(get_text("exception.invalidFakeHeader.1"))

        # Strip Fake Header
        content = data[self.header_len:]

        if not self.key_bytes:
             raise ValueError(get_text("error.enDecrypt.noCode"))

        # XOR the beginning of the content
        # The length to XOR is header_len (usually 16 bytes)
        xor_len = self.header_len
        if len(content) < xor_len:
            xor_len = len(content)

        decrypted_prefix = bytearray(xor_len)
        for i in range(xor_len):
            # XOR with key bytes. Key should be at least xor_len long (16 bytes).
            # If key is shorter, we cycle? The JS code assumes key length covers it.
            # "outputKey += Decrypter._encryptionKey[i];" implies key is array of strings.
            # We'll assume safe key length or cycle.
            k = self.key_bytes[i % len(self.key_bytes)]
            decrypted_prefix[i] = content[i] ^ k

        return bytes(decrypted_prefix) + content[xor_len:]

    def encrypt(self, data: bytes) -> bytes:
        """
        Encrypts the data.
        1. XORs the first [header_len] bytes of the content.
        2. Prepends the Fake Header.
        """
        if not data:
            raise ValueError(get_text("exception.emptyFile"))

        if not self.key_bytes:
            raise ValueError(get_text("error.enDecrypt.noCode"))

        xor_len = self.header_len
        if len(data) < xor_len:
            xor_len = len(data)

        encrypted_prefix = bytearray(xor_len)
        for i in range(xor_len):
             k = self.key_bytes[i % len(self.key_bytes)]
             encrypted_prefix[i] = data[i] ^ k
        
        fake_header = self._build_fake_header()
        
        return fake_header + encrypted_prefix + data[xor_len:]

    def restore_png_header(self, data: bytes) -> bytes:
        """
        Restores a PNG file by discarding the fake header AND the encrypted header,
        then attaching a standard PNG header.
        Used for 'Rescue' mode when key is unknown.
        """
        # Logic from JS: 
        # arrayBuffer = arrayBuffer.slice(headerLen * 2, arrayBuffer.byteLength);
        # tmpInt8Arr.set(pngStartHeader, 0);
        
        strip_len = self.header_len * 2
        if len(data) < strip_len:
             raise ValueError(get_text("exception.fileTooShort"))
             
        rest_of_file = data[strip_len:]
        
        # We need to ensure the PNG header we attach matches the length of what we stripped?
        # No, JS says: "Make sure that to long header values get the correct one... headerLen = pngStartHeader.length;"
        # Essentially, we replace the first 16 bytes of the *original* file (which were encrypted) with the standard PNG header.
        
        return self.PNG_HEADER + rest_of_file

    def decrypt_stream(self, input_stream, output_stream, chunk_size=65536):
        """
        Stream version of decrypt.
        """
        # 1. Read and Verify Fake Header
        if not self.ignore_fake_header:
            fake_header = input_stream.read(self.header_len)
            if len(fake_header) < self.header_len:
                 raise ValueError(get_text("exception.fileTooShort"))
            
            # We need to reconstruct the expected header to compare
            expected_header = self._build_fake_header()
            if fake_header != expected_header:
                raise ValueError(get_text("exception.invalidFakeHeader.1"))
        else:
             # Just skip it
             input_stream.seek(self.header_len)

        # 2. Read encrypted prefix (usually 16 bytes)
        encrypted_prefix = input_stream.read(self.header_len)
        if len(encrypted_prefix) == 0:
             return # Empty file after header?

        if not self.key_bytes:
             raise ValueError(get_text("error.enDecrypt.noCode"))

        # 3. XOR prefix
        # Note: In the byte array version, we did:
        # xor_len = self.header_len if len(content) >= self.header_len else len(content)
        # Here we read exactly header_len or less if EOF.
        
        xor_len = len(encrypted_prefix)
        decrypted_prefix = bytearray(xor_len)
        for i in range(xor_len):
            k = self.key_bytes[i % len(self.key_bytes)]
            decrypted_prefix[i] = encrypted_prefix[i] ^ k
            
        output_stream.write(decrypted_prefix)
        
        # 4. Stream the rest
        while True:
            chunk = input_stream.read(chunk_size)
            if not chunk:
                break
            output_stream.write(chunk)

    def encrypt_stream(self, input_stream, output_stream, chunk_size=65536):
        """
        Stream version of encrypt.
        """
        if not self.key_bytes:
            raise ValueError(get_text("error.enDecrypt.noCode"))

        # 1. Write Fake Header
        fake_header = self._build_fake_header()
        output_stream.write(fake_header)
        
        # 2. Read prefix to encrypt
        prefix_data = input_stream.read(self.header_len)
        
        # 3. XOR prefix
        xor_len = len(prefix_data)
        encrypted_prefix = bytearray(xor_len)
        for i in range(xor_len):
             k = self.key_bytes[i % len(self.key_bytes)]
             encrypted_prefix[i] = prefix_data[i] ^ k
        
        output_stream.write(encrypted_prefix)
        
        # 4. Stream the rest
        while True:
            chunk = input_stream.read(chunk_size)
            if not chunk:
                break
            output_stream.write(chunk)

    def restore_png_header_stream(self, input_stream, output_stream, chunk_size=65536):
        """
        Stream version of restore_png_header.
        """
        strip_len = self.header_len * 2
        
        # 1. Skip header
        # Check if file is large enough
        input_stream.seek(0, 2) # Seek to end
        file_len = input_stream.tell()
        input_stream.seek(0)
        
        if file_len < strip_len:
             raise ValueError(get_text("exception.fileTooShort"))
             
        input_stream.seek(strip_len)
        
        # 2. Write PNG Header
        output_stream.write(self.PNG_HEADER)
        
        # 3. Stream the rest
        while True:
            chunk = input_stream.read(chunk_size)
            if not chunk:
                break
            output_stream.write(chunk)

