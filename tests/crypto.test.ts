import { describe, it, expect } from 'vitest'
import {
  Decrypter,
  DecryptionError,
  getKeyFromPNG,
  verifyKey,
  isEncryptedExtension,
  toNormalExtension,
  detectMagicKind,
  detectHeader,
  looksEncrypted,
  parseSystemJsonKey,
  extractKeyFromRpgCore,
  matchesMagic,
  expectedMagicKind,
  DEFAULT_HEADER_LEN,
  PNG_HEADER_BYTES,
  hexToBytes
} from '@lib/crypto'
import { compressToBase64 } from '@lib/save'

// 16 字符 hex 密钥（8 组）
const KEY = '0123456789abcdef'

// 一段模拟明文（前 16 字节用标准 PNG 头，其余是任意内容）
function makePlain(length = 24): Uint8Array {
  const buf = new Uint8Array(length)
  for (let i = 0; i < Math.min(length, PNG_HEADER_BYTES.length); i++) {
    buf[i] = PNG_HEADER_BYTES[i]
  }
  // 之后的字节填一些非零值
  for (let i = PNG_HEADER_BYTES.length; i < length; i++) buf[i] = (i * 7 + 13) & 0xff
  return buf
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

describe('Decrypter 假头', () => {
  it('默认假头以 ASCII "RPGMV" 开头（签名嗅探基础）', () => {
    const d = new Decrypter(KEY)
    const fake = d.encrypt(new Uint8Array(DEFAULT_HEADER_LEN)).slice(0, 5)
    expect(bytesEqual(fake, new Uint8Array([0x52, 0x50, 0x47, 0x4d, 0x56]))).toBe(true)
  })

  it('buildFakeHeader 长度为 16 字节', () => {
    const d = new Decrypter(KEY)
    expect(d.getHeaderLen()).toBe(DEFAULT_HEADER_LEN)
    const full = new Uint8Array(DEFAULT_HEADER_LEN)
    const enc = d.encrypt(new Uint8Array(DEFAULT_HEADER_LEN).fill(0))
    expect(d.verifyFakeHeader(enc)).toBe(true)
    expect(full.length).toBe(DEFAULT_HEADER_LEN)
  })
})

describe('Decrypter encrypt / decrypt 往返', () => {
  it('encrypt → decrypt 还原原文', () => {
    const d = new Decrypter(KEY)
    const plain = makePlain(32)
    const encrypted = d.encrypt(plain)
    // 加密结果以假头开头
    expect(d.verifyFakeHeader(encrypted)).toBe(true)
    // 解密还原
    const decrypted = d.decrypt(encrypted)
    expect(bytesEqual(decrypted, plain)).toBe(true)
  })

  it('decrypt 对非加密文件抛错（假头校验）', () => {
    const d = new Decrypter(KEY)
    const random = makePlain(16)
    expect(() => d.decrypt(random)).toThrow(DecryptionError)
  })

  it('ignoreFakeHeader 时跳过校验仍可解密', () => {
    const d = new Decrypter(KEY, { ignoreFakeHeader: true })
    const plain = makePlain(24)
    const encrypted = d.encrypt(plain)
    // 破坏假头签名：ignoreFakeHeader 下应跳过校验、照常剥离假头并解出原文
    const corrupted = encrypted.slice()
    corrupted[0] = 0x00
    const decrypted = d.decrypt(corrupted)
    expect(bytesEqual(decrypted, plain)).toBe(true)
  })
})

describe('短密钥行为（蓝图 §4 之 #2 修复）', () => {
  it('短密钥(<16字节)按索引直取、不循环', () => {
    const shortKey = 'abcd' // 仅 2 组
    const d = new Decrypter(shortKey)
    const plain = makePlain(16)
    const encrypted = d.encrypt(plain)
    // 去掉假头后只观察前 16 字节
    const body = encrypted.slice(DEFAULT_HEADER_LEN)
    // index0/1 被 "ab","cd" 加密，index>=2 不处理（保持原值）
    expect(body[0]).toBe(plain[0] ^ 0xab)
    expect(body[1]).toBe(plain[1] ^ 0xcd)
    expect(body[2]).toBe(plain[2])
    expect(body[3]).toBe(plain[3])
    // 往返仍一致
    const decrypted = d.decrypt(encrypted)
    expect(bytesEqual(decrypted, plain)).toBe(true)
  })

  it('未设置密钥时 encrypt/decrypt 抛错', () => {
    const d = new Decrypter(null)
    expect(() => d.encrypt(makePlain(16))).toThrow(DecryptionError)
  })
})

describe('restorePngHeader 救图', () => {
  it('去掉假头+加密头，补标准 PNG 头', () => {
    const d = new Decrypter(KEY)
    const plain = makePlain(40)
    const encrypted = d.encrypt(plain)
    const restored = d.restorePngHeader(encrypted)
    // 以标准 PNG 头开头
    expect(bytesEqual(restored.slice(0, PNG_HEADER_BYTES.length), new Uint8Array(PNG_HEADER_BYTES))).toBe(true)
    // 内容 = 去掉假头+加密头（共 32 字节）后的明文
    expect(bytesEqual(restored.slice(16), plain.slice(16))).toBe(true)
  })
})

describe('getKeyFromPNG 密钥反推', () => {
  it('从加密 PNG 反推回密钥', () => {
    const d = new Decrypter(KEY)
    const plain = makePlain(32)
    const encrypted = d.encrypt(plain)
    const key = getKeyFromPNG(encrypted, DEFAULT_HEADER_LEN)
    // PNG 头 16 字节、标准 MV 密钥 16 hex 字符（8 字节），故反推得 key + 尾部 '\0' 填充
    expect(key).toBe(KEY + '0'.repeat(16))
  })

  it('verifyKey 用正确/错误密钥判断魔数', () => {
    const d = new Decrypter(KEY)
    const encrypted = d.encrypt(makePlain(32))
    expect(verifyKey(encrypted, KEY, 'png')).toBe(true)
    expect(verifyKey(encrypted, '00000000000000000000000000000000', 'png')).toBe(false)
  })
})

describe('扩展名与魔数', () => {
  it('识别加密扩展名并可映射回正常扩展名', () => {
    expect(isEncryptedExtension('rpgmvp')).toBe(true)
    expect(isEncryptedExtension('png_')).toBe(true)
    expect(isEncryptedExtension('m4a_')).toBe(true)
    expect(isEncryptedExtension('png')).toBe(false)
    expect(toNormalExtension('rpgmvp')).toBe('png')
    expect(toNormalExtension('ogg_')).toBe('ogg')
    expect(toNormalExtension('png')).toBeNull()
  })

  it('用魔数检测资源类型', () => {
    expect(detectMagicKind(new Uint8Array(PNG_HEADER_BYTES))).toBe('png')
    expect(detectMagicKind(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2]))).toBe('ogg')
    expect(detectMagicKind(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

describe('头嗅探（版本无关检测）', () => {
  it('识别 RPGMV 加密头，区分非加密文件', () => {
    const d = new Decrypter(KEY)
    const enc = d.encrypt(makePlain(32))
    expect(looksEncrypted(enc)).toBe(true)
    const info = detectHeader(enc)
    expect(info.encrypted).toBe(true)
    expect(info.signatureHex.slice(0, 10)).toBe('5250474d56') // 'RPGMV'
    expect(looksEncrypted(makePlain(16))).toBe(false)
  })
})

describe('密钥解析（System.json / rpg_core.js）', () => {
  it('parseSystemJsonKey 提取 encryptionKey', () => {
    expect(parseSystemJsonKey('{"encryptionKey":"0123456789abcdef"}')).toBe('0123456789abcdef')
    expect(parseSystemJsonKey('{"no":"key"}')).toBeNull()
    expect(parseSystemJsonKey('not json')).toBeNull()
  })

  it('parseSystemJsonKey 支持 LZString base64 压缩的 System.json（兜底分支）', () => {
    const compressed = compressToBase64('{"encryptionKey":"0123456789abcdef"}')
    expect(compressed).not.toContain('encryptionKey') // 确认确实是压缩形态
    expect(parseSystemJsonKey(compressed)).toBe('0123456789abcdef')
  })

  it('extractKeyFromRpgCore 提取 _encryptionKey', () => {
    expect(extractKeyFromRpgCore('this._encryptionKey = "0123456789abcdef";')).toBe('0123456789abcdef')
    expect(extractKeyFromRpgCore('Decrypter._encryptionKey = "0123456789abcdef";')).toBe('0123456789abcdef')
    expect(extractKeyFromRpgCore('nothing')).toBeNull()
  })

  it('extractKeyFromRpgCore 支持 LZString base64 压缩的 rpg_core.js（兜底分支）', () => {
    const compressed = compressToBase64('Decrypter._encryptionKey = "0123456789abcdef";')
    expect(extractKeyFromRpgCore(compressed)).toBe('0123456789abcdef')
  })
})

describe('导出魔数校验（matchesMagic / expectedMagicKind，蓝图 §11.4-2）', () => {
  it('matchesMagic 匹配/不匹配已知魔数', () => {
    expect(matchesMagic(new Uint8Array(PNG_HEADER_BYTES), 'png')).toBe(true)
    expect(matchesMagic(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), 'ogg')).toBe(true)
    expect(matchesMagic(new Uint8Array(PNG_HEADER_BYTES), 'ogg')).toBe(false)
    expect(matchesMagic(new Uint8Array([]), 'png')).toBe(false)
  })

  it('expectedMagicKind 由加密扩展名推断期望魔数', () => {
    expect(expectedMagicKind('rpgmvp')).toBe('png')
    expect(expectedMagicKind('png_')).toBe('png')
    expect(expectedMagicKind('rpgmvo')).toBe('ogg')
    expect(expectedMagicKind('ogg_')).toBe('ogg')
    expect(expectedMagicKind('rpgmvm')).toBe('m4a')
    expect(expectedMagicKind('m4a_')).toBe('m4a')
    expect(expectedMagicKind('png')).toBeNull()
    expect(expectedMagicKind('')).toBeNull()
  })

  it('解密产物魔数校验：加密→解密后匹配期望魔数；错误 key 不匹配', () => {
    const d = new Decrypter(KEY)
    const enc = d.encrypt(makePlain(40))
    const dec = d.decrypt(enc)
    expect(matchesMagic(dec, expectedMagicKind('rpgmvp')!)).toBe(true)
    const wrong = new Decrypter('0'.repeat(32)).decrypt(enc)
    expect(matchesMagic(wrong, 'png')).toBe(false)
  })
})
