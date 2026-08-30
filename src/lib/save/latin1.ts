/**
 * binary string ↔ bytes 转换（Latin-1 语义）。
 *
 * 背景：RPG Maker MZ 的 StorageManager 用 `pako.deflate(json, { to: "string", level: 1 })`
 * 产出 **binary string**（每个字符 charCode 0-255），再经 NW.js `fsWriteFile` 以 **UTF-8 编码**
 * 落盘（见 `rmmz_managers.js` 的 `fsWriteFile` 默认编码）。因此磁盘文件字节 =
 * `utf8(binary_string)`；读回时 `fsReadFile` 按 UTF-8 解码得到的就是原 binary string。
 *
 * 所以对 @lib 而言，MZ 存档的"文本"就是 binary string，只需在 binary string 与字节数组之间
 * 转换即可，**不需要显式做 UTF-8 编解码**（那一步由调用方的 fs 读写完成，与游戏行为一致）。
 *
 * 本模块为零依赖纯 TS，供 @lib/save 与将来渲染进程复用。
 */

/** 把 binary string（charCode 0-255）转为字节数组（等价 latin1 编码）。 */
export function binaryStringToBytes(input: string): Uint8Array {
  const len = input.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = input.charCodeAt(i) & 0xff
  }
  return bytes
}

/** 把字节数组转为 binary string（每个字节一个字符，等价 latin1 解码）。 */
export function bytesToBinaryString(bytes: Uint8Array): string {
  // 逐块拼接避免超长字符串的栈/堆压力（apply 参数上限约 65k）
  const chunk = 0x8000
  let out = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length))
    out += String.fromCharCode(...slice)
  }
  return out
}
