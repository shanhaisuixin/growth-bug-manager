# -*- coding: utf-8 -*-
"""
把 APK 里的二进制 AndroidManifest.xml 解出来，列出所有字符串。
只依赖标准库，不装任何东西。

为什么需要它：源清单里没写权限，不代表装到手机上的包里没有 ——
Gradle 合清单、AndroidX、依赖库都会往里加东西。
要回答「为什么权限页里还列着一堆东西」，只能看最终包里到底有什么。
"""
import sys
import zipfile
import struct

RES_STRING_POOL_TYPE = 0x0001
UTF8_FLAG = 1 << 8


def read_string_pool(data, off):
    """解析 AXML 的字符串池 chunk，返回字符串列表。"""
    chunk_type, header_size, chunk_size = struct.unpack_from('<HHI', data, off)
    string_count, style_count, flags, strings_start, styles_start = \
        struct.unpack_from('<IIIII', data, off + 8)
    is_utf8 = bool(flags & UTF8_FLAG)
    offset = off + header_size
    offsets = struct.unpack_from('<%dI' % string_count, data, offset)
    out = []
    for so in offsets:
        p = off + strings_start + so
        if is_utf8:
            # uleb128: 字符数
            n, p = read_uleb128(data, p)
            # uleb128: 字节数
            blen, p = read_uleb128(data, p)
            out.append(data[p:p + blen].decode('utf-8', 'replace'))
        else:
            n = struct.unpack_from('<H', data, p)[0]
            p += 2
            out.append(data[p:p + n * 2].decode('utf-16-le', 'replace'))
    return out


def read_uleb128(data, p):
    result = 0
    shift = 0
    while True:
        b = data[p]
        p += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return result, p


def walk(data, off, end, strings):
    """递归遍历所有 chunk，收集字符串池。"""
    while off + 8 <= end:
        chunk_type, header_size, chunk_size = struct.unpack_from('<HHI', data, off)
        if chunk_size <= 0:
            break
        if chunk_type == RES_STRING_POOL_TYPE:
            strings.extend(read_string_pool(data, off))
        elif chunk_type in (0x0003, 0x0100, 0x0200):  # XML / 元素 / 资源映射
            if chunk_size > header_size:
                walk(data, off + header_size, off + chunk_size, strings)
        off += chunk_size
    return strings


def main(apk):
    with zipfile.ZipFile(apk) as z:
        names = z.namelist()
        raw = z.read('AndroidManifest.xml')
    print('APK：%s' % apk)
    print('包内文件数：%d' % len(names))
    print('=' * 60)
    strings = walk(raw, 8, len(raw), [])
    # 去重但保留顺序
    seen = set()
    uniq = []
    for s in strings:
        if s not in seen:
            seen.add(s)
            uniq.append(s)

    def show(title, pred):
        hits = [s for s in uniq if pred(s)]
        print('\n【%s】共 %d 条' % (title, len(hits)))
        for h in sorted(set(hits)):
            print('   ' + h)
        if not hits:
            print('   （无）')

    show('权限（permission）',
         lambda s: s.startswith('android.permission.') or 'permission.' in s.lower())
    show('硬件特性（uses-feature）',
         lambda s: s.startswith('android.hardware.'))
    show('Intent 动作（action）',
         lambda s: s.startswith('android.intent.action.') or s.startswith('android.intent.category.'))
    show('可疑的能力相关字符串',
         lambda s: any(k in s.lower() for k in (
             'queries', 'package', 'clipboard', 'wallpaper', 'shortcut',
             'receiver', 'provider', 'service', 'audio', 'screen',
         )))


if __name__ == '__main__':
    main(sys.argv[1])
