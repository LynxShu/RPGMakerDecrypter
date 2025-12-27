import binascii

def hex_to_bytes(hex_str: str) -> bytes:
    """Converts a hex string to bytes."""
    return binascii.unhexlify(hex_str)

def bytes_to_hex(data: bytes) -> str:
    """Converts bytes to a hex string."""
    return binascii.hexlify(data).decode('utf-8')

def xor_bytes(data: bytes, key: bytes) -> bytes:
    """XORs bytes with a key (repeating key if necessary)."""
    # Note: In RPG Maker decryption, the key is usually hex string, but here we expect bytes.
    # The key is applied cyclically? No, the original JS says:
    # byteArray[i] = byteArray[i] ^ parseInt(this.encryptionCodeArray[i], 16);
    # where encryptionCodeArray matches the key length.
    # The key length seems to always match the header length (16 bytes).
    
    key_len = len(key)
    data_len = len(data)
    result = bytearray(data_len)
    
    for i in range(data_len):
        result[i] = data[i] ^ key[i % key_len]
        
    return bytes(result)
