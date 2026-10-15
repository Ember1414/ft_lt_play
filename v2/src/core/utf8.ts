/**
 * utf8.ts — UTF-8 编解码（自 v1 util.js 迁移）
 * 纯 JS 实现，兼容无 TextEncoder/TextDecoder 的测试沙箱。
 * 用途：实验分享编码（experiment.ts）等需要字节级精确的场景。
 */

/** 字符串 → 二进制字符串（每字符一字节，码点 ≤ 255） */
export function utf8Encode(str: string): string {
  let binary = '';
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 128) {
      binary += String.fromCharCode(code);
    } else if (code < 2048) {
      binary += String.fromCharCode(192 | (code >> 6), 128 | (code & 63));
    } else if (code < 0xd800 || code >= 0xe000) {
      binary += String.fromCharCode(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
    } else {
      i++;
      code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      binary += String.fromCharCode(
        240 | (code >> 18),
        128 | ((code >> 12) & 63),
        128 | ((code >> 6) & 63),
        128 | (code & 63),
      );
    }
  }
  return binary;
}

/** 二进制字符串 → 字符串（与 utf8Encode 互逆） */
export function utf8Decode(bin: string): string {
  let out = '';
  for (let i = 0; i < bin.length; ) {
    const c = bin.charCodeAt(i);
    if (c < 128) {
      out += String.fromCharCode(c);
      i++;
    } else if (c >= 192 && c < 224) {
      out += String.fromCharCode(((c & 31) << 6) | (bin.charCodeAt(i + 1) & 63));
      i += 2;
    } else if (c >= 224 && c < 240) {
      out += String.fromCharCode(
        ((c & 15) << 12) | ((bin.charCodeAt(i + 1) & 63) << 6) | (bin.charCodeAt(i + 2) & 63),
      );
      i += 3;
    } else {
      let u =
        ((c & 7) << 18) |
        ((bin.charCodeAt(i + 1) & 63) << 12) |
        ((bin.charCodeAt(i + 2) & 63) << 6) |
        (bin.charCodeAt(i + 3) & 63);
      u -= 0x10000;
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      i += 4;
    }
  }
  return out;
}