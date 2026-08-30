import {
  DEFAULT_HEADER_LEN,
  DEFAULT_REMAIN,
  DEFAULT_SIGNATURE,
  DEFAULT_VERSION,
  PNG_HEADER_BYTES
} from './constants'

/** 解密相关错误 */
export class DecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecryptionError'
  }
}

export interface DecrypterOptions {
  /** 是否跳过假头校验（默认 false） */
  ignoreFakeHeader?: boolean
  headerLen?: number
  signature?: string
  version?: string
  remain?: string
  /** PNG 还原时使用的头长度（默认用 getHeaderLen()，即 16） */
  pngHeaderLen?: number
}

/**
 * MV/MZ 文件解密/加密/还原 核心实现。
 *
 * 关键点（与 Petschko 原版 Decrypter.js 一致）：
 * - 密钥被按每 2 个 hex 字符切成数组，XOR 时【按索引直取、不循环】。
 *   这与旧 Python 版 `key_bytes[i % len]` 循环不同 —— 短密钥(<16字节)时行为才会对齐原版，
 *   这是「非标短密钥游戏解错」的修复关键（见蓝图 §4 之 #2）。
 */
export class Decrypter {
  private readonly encryptCode: string
  private readonly encryptionCodeArray: string[]
  private readonly ignoreFakeHeader: boolean
  private readonly headerLen: number | null
  private readonly signature: string | null
  private readonly version: string | null
  private readonly remain: string | null
  private readonly pngHeaderLen: number | null

  constructor(encryptionKey: string | null, opts: DecrypterOptions = {}) {
    this.encryptCode = encryptionKey ?? ''
    this.ignoreFakeHeader = opts.ignoreFakeHeader ?? false
    this.headerLen = opts.headerLen ?? null
    this.signature = opts.signature ?? null
    this.version = opts.version ?? null
    this.remain = opts.remain ?? null
    this.pngHeaderLen = opts.pngHeaderLen ?? null
    this.encryptionCodeArray = this.splitEncryptionCode()
  }

  /** 是否有可用的密钥 */
  hasKey(): boolean {
    return this.encryptionCodeArray.length > 0
  }

  // ---- 带默认值的 getter ----

  getHeaderLen(): number {
    return this.headerLen ?? DEFAULT_HEADER_LEN
  }

  private getSignature(): string {
    return this.signature ?? DEFAULT_SIGNATURE
  }

  private getVersion(): string {
    return this.version ?? DEFAULT_VERSION
  }

  private getRemain(): string {
    return this.remain ?? DEFAULT_REMAIN
  }

  private getPngHeaderLen(): number {
    return this.pngHeaderLen ?? this.getHeaderLen()
  }

  /**
   * 把密钥按每 2 个 hex 字符切成数组。JS 原版：`encryptCode.split(/(.{2})/).filter(Boolean)`。
   * 例如 "0123456789abcdef" → ["01","23","45","67","89","ab","cd","ef"]。
   */
  private splitEncryptionCode(): string[] {
    if (!this.encryptCode) return []
    return this.encryptCode.split(/(.{2})/).filter(Boolean)
  }

  /** 根据当前 settings 构造假头字节 */
  private buildFakeHeader(): Uint8Array {
    const len = this.getHeaderLen()
    const fake = new Uint8Array(len)
    const structure = this.getSignature() + this.getVersion() + this.getRemain()
    for (let i = 0; i < len; i++) {
      fake[i] = parseInt('0x' + structure.slice(i * 2, i * 2 + 2), 16)
    }
    return fake
  }

  /** 校验文件头是否匹配预期的假头 */
  verifyFakeHeader(fileHeader: Uint8Array): boolean {
    const fake = this.buildFakeHeader()
    const len = this.getHeaderLen()
    if (fileHeader.length < len) return false
    for (let i = 0; i < len; i++) {
      if (fileHeader[i] !== fake[i]) return false
    }
    return true
  }

  /**
   * 对给定字节做 XOR。
   * 循环长度取 min(getHeaderLen(), data.length)，防止短数据越界；
   * 短密钥不足的字节按 JS 行为视为 ^0（即不改动该字节）。
   */
  private xOrBytes(data: Uint8Array): Uint8Array {
    const out = new Uint8Array(data)
    const keyArr = this.encryptionCodeArray
    const len = Math.min(this.getHeaderLen(), data.length)
    for (let i = 0; i < len; i++) {
      const hex = keyArr[i]
      if (hex === undefined) continue
      out[i] = data[i] ^ parseInt(hex, 16)
    }
    return out
  }

  /**
   * 解密：校验并去掉 16 字节假头，再对剩余内容前 16 字节 XOR。
   * @returns 解密后的内容（不含假头）
   */
  decrypt(data: Uint8Array): Uint8Array {
    if (!data || data.length === 0) {
      throw new DecryptionError('文件为空或无法读取')
    }
    if (!this.ignoreFakeHeader && !this.verifyFakeHeader(data)) {
      throw new DecryptionError(
        '假头("RPGMV" 签名)校验失败：请确认这是加密文件；若是，请关闭 "假头校验" 后重试。'
      )
    }
    const content = data.slice(this.getHeaderLen())
    return this.xOrBytes(content)
  }

  /**
   * 加密：先对内容前 16 字节 XOR，再在前方补上假头。
   * @returns 加密后的完整字节（含假头）
   */
  encrypt(data: Uint8Array): Uint8Array {
    if (!data || data.length === 0) {
      throw new DecryptionError('文件为空或无法读取')
    }
    if (!this.hasKey()) {
      throw new DecryptionError('未设置加密密钥')
    }
    const headerLen = this.getHeaderLen()
    const xored = this.xOrBytes(data)
    const fake = this.buildFakeHeader()
    const out = new Uint8Array(fake.length + xored.length)
    out.set(fake, 0)
    out.set(xored, headerLen)
    return out
  }

  /**
   * 「救图」还原：去掉假头 + 被加密的 16 字节头，再补上标准 PNG 头。
   * 用于无密钥时尽可能还原图片。
   */
  restorePngHeader(data: Uint8Array): Uint8Array {
    const headerLen = this.getPngHeaderLen()
    const pngHeader = Decrypter.getNormalPNGHeader(headerLen)
    const effectiveLen = pngHeader.length
    if (data.length < effectiveLen * 2) {
      throw new DecryptionError('文件过短，无法还原 PNG 头')
    }
    const rest = data.slice(effectiveLen * 2)
    const out = new Uint8Array(pngHeader.length + rest.length)
    out.set(pngHeader, 0)
    out.set(rest, pngHeader.length)
    return out
  }

  /** 标准 PNG 头（取 min(headerLen, 16) 字节） */
  static getNormalPNGHeader(headerLen: number): Uint8Array {
    let len = Math.floor(headerLen)
    if (len > PNG_HEADER_BYTES.length) len = PNG_HEADER_BYTES.length
    if (len < 0) len = 0
    const out = new Uint8Array(len)
    for (let i = 0; i < len; i++) out[i] = PNG_HEADER_BYTES[i]
    return out
  }

  /** 字节转 2 位小写 hex */
  static byteToHex(byte: number): string {
    return (byte & 0xff).toString(16).padStart(2, '0')
  }

  /** 校验字符串是否仅含 hex 字符 */
  static checkHexChars(str: string): boolean {
    return /^[0-9a-fA-F]+$/.test(str)
  }
}
