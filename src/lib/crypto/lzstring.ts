/**
 * LZString 移植（官方 1.4.4，WTFPL —— pieroxy.net/blog/pages/lz-string/）。
 *
 * 来源：RPG Maker MV 内嵌同款算法（rpg_core.js 中的 LZString 即 1.4.x 系），
 * 参考 `RPG-Maker-MV-Decrypter-petschko/libs/lz-string.js` 逐行等价移植。
 *
 * 本项目的用途：key 检测兜底——System.json / rpg_core.js 若被 LZString base64
 * 压缩，用 `decompressFromBase64` 解压后再匹配密钥（`src/lib/crypto/keyFinder.ts`）。
 *
 * 压缩/解压核心（_compress / _decompress）保持与官方逐行等价，不优化、不改语义。
 */

const f = String.fromCharCode
const keyStrBase64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='

const baseReverseDic: Record<string, Record<string, number>> = {}

function getBaseValue(alphabet: string, character: string): number {
  if (!baseReverseDic[alphabet]) {
    baseReverseDic[alphabet] = {}
    for (let i = 0; i < alphabet.length; i++) {
      baseReverseDic[alphabet][alphabet.charAt(i)] = i
    }
  }
  return baseReverseDic[alphabet][character]
}

/**
 * 把输入字符串压缩为 base64 字符串。
 * 输入为 null 时返回 ""；与官方行为一致。
 */
export function compressToBase64(input: string | null): string {
  if (input == null) return ''
  const res = _compress(input, 6, (a: number) => keyStrBase64.charAt(a))
  switch (res.length % 4) {
    // To produce valid Base64
    default:
    case 0:
      return res
    case 1:
      return res + '==='
    case 2:
      return res + '=='
    case 3:
      return res + '='
  }
}

/**
 * 把 base64 字符串解压回原字符串。
 * 输入为 null 返回 ""；输入为 "" 返回 null；与官方行为一致。
 */
export function decompressFromBase64(input: string | null): string | null {
  if (input == null) return ''
  if (input === '') return null
  return _decompress(input.length, 32, (index: number) => getBaseValue(keyStrBase64, input.charAt(index)))
}

function _compress(uncompressed: string | null, bitsPerChar: number, getCharFromInt: (a: number) => string): string {
  if (uncompressed == null) return ''
  let i: number
  let value: number
  const context_dictionary: Record<string, number> = {}
  const context_dictionaryToCreate: Record<string, boolean> = {}
  let context_c = ''
  let context_wc = ''
  let context_w = ''
  let context_enlargeIn = 2 // Compensate for the first entry which should not count
  let context_dictSize = 3
  let context_numBits = 2
  const context_data: string[] = []
  let context_data_val = 0
  let context_data_position = 0

  for (let ii = 0; ii < uncompressed.length; ii += 1) {
    context_c = uncompressed.charAt(ii)
    if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
      context_dictionary[context_c] = context_dictSize++
      context_dictionaryToCreate[context_c] = true
    }

    context_wc = context_w + context_c
    if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
      context_w = context_wc
    } else {
      if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
        if (context_w.charCodeAt(0) < 256) {
          for (i = 0; i < context_numBits; i++) {
            context_data_val = context_data_val << 1
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0
              context_data.push(getCharFromInt(context_data_val))
              context_data_val = 0
            } else {
              context_data_position++
            }
          }
          value = context_w.charCodeAt(0)
          for (i = 0; i < 8; i++) {
            context_data_val = (context_data_val << 1) | (value & 1)
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0
              context_data.push(getCharFromInt(context_data_val))
              context_data_val = 0
            } else {
              context_data_position++
            }
            value = value >> 1
          }
        } else {
          value = 1
          for (i = 0; i < context_numBits; i++) {
            context_data_val = (context_data_val << 1) | value
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0
              context_data.push(getCharFromInt(context_data_val))
              context_data_val = 0
            } else {
              context_data_position++
            }
            value = 0
          }
          value = context_w.charCodeAt(0)
          for (i = 0; i < 16; i++) {
            context_data_val = (context_data_val << 1) | (value & 1)
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0
              context_data.push(getCharFromInt(context_data_val))
              context_data_val = 0
            } else {
              context_data_position++
            }
            value = value >> 1
          }
        }
        context_enlargeIn--
        if (context_enlargeIn === 0) {
          context_enlargeIn = Math.pow(2, context_numBits)
          context_numBits++
        }
        delete context_dictionaryToCreate[context_w]
      } else {
        value = context_dictionary[context_w]
        for (i = 0; i < context_numBits; i++) {
          context_data_val = (context_data_val << 1) | (value & 1)
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0
            context_data.push(getCharFromInt(context_data_val))
            context_data_val = 0
          } else {
            context_data_position++
          }
          value = value >> 1
        }
      }
      context_enlargeIn--
      if (context_enlargeIn === 0) {
        context_enlargeIn = Math.pow(2, context_numBits)
        context_numBits++
      }
      // Add wc to the dictionary.
      context_dictionary[context_wc] = context_dictSize++
      context_w = String(context_c)
    }
  }

  // Output the code for w.
  if (context_w !== '') {
    if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
      if (context_w.charCodeAt(0) < 256) {
        for (i = 0; i < context_numBits; i++) {
          context_data_val = context_data_val << 1
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0
            context_data.push(getCharFromInt(context_data_val))
            context_data_val = 0
          } else {
            context_data_position++
          }
        }
        value = context_w.charCodeAt(0)
        for (i = 0; i < 8; i++) {
          context_data_val = (context_data_val << 1) | (value & 1)
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0
            context_data.push(getCharFromInt(context_data_val))
            context_data_val = 0
          } else {
            context_data_position++
          }
          value = value >> 1
        }
      } else {
        value = 1
        for (i = 0; i < context_numBits; i++) {
          context_data_val = (context_data_val << 1) | value
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0
            context_data.push(getCharFromInt(context_data_val))
            context_data_val = 0
          } else {
            context_data_position++
          }
          value = 0
        }
        value = context_w.charCodeAt(0)
        for (i = 0; i < 16; i++) {
          context_data_val = (context_data_val << 1) | (value & 1)
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0
            context_data.push(getCharFromInt(context_data_val))
            context_data_val = 0
          } else {
            context_data_position++
          }
          value = value >> 1
        }
      }
      context_enlargeIn--
      if (context_enlargeIn === 0) {
        context_enlargeIn = Math.pow(2, context_numBits)
        context_numBits++
      }
      delete context_dictionaryToCreate[context_w]
    } else {
      value = context_dictionary[context_w]
      for (i = 0; i < context_numBits; i++) {
        context_data_val = (context_data_val << 1) | (value & 1)
        if (context_data_position === bitsPerChar - 1) {
          context_data_position = 0
          context_data.push(getCharFromInt(context_data_val))
          context_data_val = 0
        } else {
          context_data_position++
        }
        value = value >> 1
      }
    }
    context_enlargeIn--
    if (context_enlargeIn === 0) {
      context_enlargeIn = Math.pow(2, context_numBits)
      context_numBits++
    }
  }

  // Mark the end of the stream
  value = 2
  for (i = 0; i < context_numBits; i++) {
    context_data_val = (context_data_val << 1) | (value & 1)
    if (context_data_position === bitsPerChar - 1) {
      context_data_position = 0
      context_data.push(getCharFromInt(context_data_val))
      context_data_val = 0
    } else {
      context_data_position++
    }
    value = value >> 1
  }

  // Flush the last char
  for (;;) {
    context_data_val = context_data_val << 1
    if (context_data_position === bitsPerChar - 1) {
      context_data.push(getCharFromInt(context_data_val))
      break
    }
    context_data_position++
  }

  return context_data.join('')
}

function _decompress(length: number, resetValue: number, getNextValue: (index: number) => number): string | null {
  const dictionary: Array<string | number> = []
  let next: number
  let enlargeIn = 4
  let dictSize = 4
  let numBits = 3
  let entry = ''
  const result: string[] = []
  let i: number
  let w: string
  let bits: number
  let resb: number
  let maxpower: number
  let power: number
  let c: number
  let firstChar = '' // 原版 JS 复用变量 c 存首字符（字符串），此处独立命名以通过 TS 类型检查
  const data = { val: getNextValue(0), position: resetValue, index: 1 }

  for (i = 0; i < 3; i += 1) {
    dictionary[i] = i
  }

  bits = 0
  maxpower = Math.pow(2, 2)
  power = 1
  while (power !== maxpower) {
    resb = data.val & data.position
    data.position >>= 1
    if (data.position === 0) {
      data.position = resetValue
      data.val = getNextValue(data.index++)
    }
    bits |= (resb > 0 ? 1 : 0) * power
    power <<= 1
  }

  switch ((next = bits)) {
    case 0:
      bits = 0
      maxpower = Math.pow(2, 8)
      power = 1
      while (power !== maxpower) {
        resb = data.val & data.position
        data.position >>= 1
        if (data.position === 0) {
          data.position = resetValue
          data.val = getNextValue(data.index++)
        }
        bits |= (resb > 0 ? 1 : 0) * power
        power <<= 1
      }
      firstChar = f(bits)
      break
    case 1:
      bits = 0
      maxpower = Math.pow(2, 16)
      power = 1
      while (power !== maxpower) {
        resb = data.val & data.position
        data.position >>= 1
        if (data.position === 0) {
          data.position = resetValue
          data.val = getNextValue(data.index++)
        }
        bits |= (resb > 0 ? 1 : 0) * power
        power <<= 1
      }
      firstChar = f(bits)
      break
    case 2:
      return ''
  }
  dictionary[3] = firstChar
  w = firstChar
  result.push(firstChar)
  for (;;) {
    if (data.index > length) {
      return ''
    }

    bits = 0
    maxpower = Math.pow(2, numBits)
    power = 1
    while (power !== maxpower) {
      resb = data.val & data.position
      data.position >>= 1
      if (data.position === 0) {
        data.position = resetValue
        data.val = getNextValue(data.index++)
      }
      bits |= (resb > 0 ? 1 : 0) * power
      power <<= 1
    }

    switch ((c = bits)) {
      case 0:
        bits = 0
        maxpower = Math.pow(2, 8)
        power = 1
        while (power !== maxpower) {
          resb = data.val & data.position
          data.position >>= 1
          if (data.position === 0) {
            data.position = resetValue
            data.val = getNextValue(data.index++)
          }
          bits |= (resb > 0 ? 1 : 0) * power
          power <<= 1
        }

        dictionary[dictSize++] = f(bits)
        c = dictSize - 1
        enlargeIn--
        break
      case 1:
        bits = 0
        maxpower = Math.pow(2, 16)
        power = 1
        while (power !== maxpower) {
          resb = data.val & data.position
          data.position >>= 1
          if (data.position === 0) {
            data.position = resetValue
            data.val = getNextValue(data.index++)
          }
          bits |= (resb > 0 ? 1 : 0) * power
          power <<= 1
        }
        dictionary[dictSize++] = f(bits)
        c = dictSize - 1
        enlargeIn--
        break
      case 2:
        return result.join('')
    }

    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits)
      numBits++
    }

    if (dictionary[c]) {
      entry = String(dictionary[c])
    } else {
      if (c === dictSize) {
        entry = w + w.charAt(0)
      } else {
        return null
      }
    }
    result.push(entry)

    // Add w+entry[0] to the dictionary.
    dictionary[dictSize++] = w + entry.charAt(0)
    enlargeIn--

    w = entry

    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits)
      numBits++
    }
  }
}
