/* 极简 ZIP 打包器 —— STORE 模式（不做压缩，只做归档）。
   自行实现，不依赖任何第三方库。
   ZIP 结构：本地文件头 + 数据 + 中央目录 + 目录结束记录 */
(function (global) {
  'use strict';

  /* CRC32 查表 */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    if (global.TextEncoder) return new global.TextEncoder().encode(str);
    /* 兜底：手工 UTF-8 编码 */
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xD800 || c >= 0xE000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else {
        i++;
        var c2 = str.charCodeAt(i);
        var cp = 0x10000 + (((c & 0x3FF) << 10) | (c2 & 0x3FF));
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return new Uint8Array(out);
  }

  function dateParts(d) {
    var time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    var date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time: time, date: date };
  }

  function Writer() {
    this.chunks = [];
    this.len = 0;
  }
  Writer.prototype.u16 = function (v) {
    this.chunks.push(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]));
    this.len += 2; return this;
  };
  Writer.prototype.u32 = function (v) {
    this.chunks.push(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]));
    this.len += 4; return this;
  };
  Writer.prototype.raw = function (bytes) {
    this.chunks.push(bytes); this.len += bytes.length; return this;
  };
  Writer.prototype.merge = function () {
    var out = new Uint8Array(this.len), off = 0;
    for (var i = 0; i < this.chunks.length; i++) { out.set(this.chunks[i], off); off += this.chunks[i].length; }
    return out;
  };

  /* files: [{ name: 'a/b.txt', data: '字符串' | Uint8Array }] */
  function zip(files) {
    var w = new Writer();
    var central = [];
    var now = new Date();
    var dt = dateParts(now);

    files.forEach(function (f) {
      var nameBytes = utf8(f.name);
      var dataBytes = typeof f.data === 'string' ? utf8(f.data) : f.data;
      var crc = crc32(dataBytes);
      var offset = w.len;

      /* 本地文件头 */
      var lh = new Writer();
      lh.u32(0x04034b50).u16(20).u16(0x0800).u16(0).u16(dt.time).u16(dt.date)
        .u32(crc).u32(dataBytes.length).u32(dataBytes.length)
        .u16(nameBytes.length).u16(0);
      w.raw(lh.merge()).raw(nameBytes).raw(dataBytes);

      central.push({
        nameBytes: nameBytes, crc: crc, size: dataBytes.length, offset: offset, time: dt.time, date: dt.date
      });
    });

    var cdStart = w.len;
    central.forEach(function (c) {
      var ch = new Writer();
      ch.u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(0).u16(c.time).u16(c.date)
        .u32(c.crc).u32(c.size).u32(c.size)
        .u16(c.nameBytes.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(c.offset);
      w.raw(ch.merge()).raw(c.nameBytes);
    });
    var cdSize = w.len - cdStart;

    var eo = new Writer();
    eo.u32(0x06054b50).u16(0).u16(0).u16(central.length).u16(central.length)
      .u32(cdSize).u32(cdStart).u16(0);
    w.raw(eo.merge());

    return w.merge();
  }

  global.SimpleZip = { zip: zip, crc32: crc32, utf8: utf8 };
})(window);
