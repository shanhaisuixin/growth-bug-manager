/* 数据层 —— 全部放在这台设备上（IndexedDB；实在开不起来就退回 localStorage）。
   一句话原则：只存你自己写的字，绝不改写、绝不补写、绝不替你想。

   这一版（简洁版）比主版少了很多东西：
     没有拆分、没有整理、没有去口水词、没有标签、没有合集、没有回溯锁。
   一条记录就两个字段：
     shijian  事件 —— 发生了什么
     shouhuo  收获 —— 收获是什么，未来会怎么做
   外加一个草稿箱（最多 5 条）和一个回收站。 */
(function (global) {
  'use strict';

  var DB_NAME = 'growth-bug-manager-simple';
  var DB_VER = 1;
  var STORE = 'objects';

  var _db = null;
  var _opening = null;
  var _useFallback = false;
  var _memory = {};

  /* 草稿箱容量。满了再存就把最老那条挤出去 —— 它是暂存区，不是仓库。 */
  var DRAFT_MAX = 5;

  function nowISO() { return new Date().toISOString(); }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7);
  }

  /* ================= 打开本地库 =================
     IndexedDB 在两种情况下会用不了：安卓/iOS 的 WebView 里被禁，
     或者用户开了「无痕」。这时候退回 localStorage，功能一样，只是容量小些。 */
  function ensure() {
    if (_useFallback) return Promise.resolve(null);
    if (_db) return Promise.resolve(_db);
    if (_opening) return _opening;

    if (!global.indexedDB) { _useFallback = true; loadFallback(); return Promise.resolve(null); }

    _opening = new Promise(function (resolve) {
      var req;
      try { req = global.indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { _useFallback = true; loadFallback(); resolve(null); return; }

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('kind', 'kind', { unique: false });
        }
      };
      req.onsuccess = function () {
        _db = req.result;
        /* 别的地方（比如另一个标签页）要改库结构时，先把这边的连接让出来 */
        _db.onversionchange = function () { _db.close(); _db = null; };
        _db.onclose = function () { _db = null; };
        resolve(_db);
      };
      req.onerror = function () {
        _useFallback = true; loadFallback(); resolve(null);
      };
      req.onblocked = function () {
        _useFallback = true; loadFallback(); resolve(null);
      };
    }).then(function (db) { _opening = null; return db; });

    return _opening;
  }

  function loadFallback() {
    try {
      var raw = global.localStorage.getItem('gbm.simple.fallback');
      _memory = raw ? JSON.parse(raw) : {};
    } catch (e) { _memory = {}; }
  }
  function saveFallback() {
    try { global.localStorage.setItem('gbm.simple.fallback', JSON.stringify(_memory)); }
    catch (e) {}
  }

  /* 一次读写事务。store 上带 put/getAll/get/delete 的是降级实现，
     真 IndexedDB 的 objectStore 没有这些方法。 */
  function tx(mode, fn) {
    if (_useFallback) {
      return Promise.resolve().then(function () {
        fn({
          put: function (o) { _memory[o.id] = o; saveFallback(); },
          get: function (k) { return _memory[k]; },
          getAll: function () { return Object.keys(_memory).map(function (k) { return _memory[k]; }); },
          delete: function (k) { delete _memory[k]; saveFallback(); }
        });
      });
    }
    return ensure().then(function (db) {
      if (!db) {
        return tx(mode, fn);   /* 刚判定为降级：重跑一遍 */
      }
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var s = t.objectStore(STORE);
        var r = fn(s, t);
        t.oncomplete = function () { resolve(r && r.result !== undefined ? r.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function idbPut(s, obj) { return s.put(obj); }
  function idbDelete(s, key) { return s.delete(key); }

  var APP = {
    version: '1.1.0',
    maker: '凤箫声动',
    repo: 'shanhaisuixin/growth-bug-manager'
  };

  /* 十一颗常见色，按彩虹顺序排（红→粉→玫→紫→靛→蓝→青→绿→金→橙→灰），
     加上最后一颗自定义轮盘，正好铺满六列两行。 */
  var THEME_PRESETS = ['#E46A6A', '#F07C9C', '#C2568C', '#8A6BD1', '#6E6BFE', '#4F7FD6',
    '#3FA9A0', '#5AA06A', '#E0A93B', '#E08A5B', '#6B7280'];

  var api = {
    APP: APP,
    DRAFT_MAX: DRAFT_MAX,
    THEME_PRESETS: THEME_PRESETS,
    uid: uid,
    nowISO: nowISO,
    usingFallback: function () { return _useFallback; },

    /* ---------- 记录 ---------- */

    newEvent: function (shijian, shouhuo) {
      return {
        id: uid('evt'),
        kind: 'event',
        shijian: shijian || '',
        shouhuo: shouhuo || '',
        createdAt: nowISO(),
        updatedAt: nowISO(),
        poem: null
      };
    },

    putEvent: function (evt) {
      evt.kind = 'event';
      evt.updatedAt = nowISO();
      return tx('readwrite', function (s) {
        if (s.getAll) s.put(evt); else idbPut(s, evt);
      }).then(function () { return evt; });
    },

    getEvent: function (id) {
      return ensure().then(function () {
        if (_useFallback) return _memory[id] && _memory[id].kind === 'event' ? _memory[id] : null;
        return new Promise(function (resolve, reject) {
          var r = _db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
          r.onsuccess = function () {
            resolve(r.result && r.result.kind === 'event' ? r.result : null);
          };
          r.onerror = function () { reject(r.error); };
        });
      });
    },

    /* 新在上，老在下 */
    listEvents: function () {
      return api.all().then(function (rows) {
        return rows.filter(function (r) { return r.kind === 'event'; })
          .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
      });
    },

    /* ---------- 草稿箱 ----------
       最多 5 条。第 6 条进来时，最老那条自动让位。
       它是「写到一半先搁着」的地方，不是第二个仓库。 */

    listDrafts: function () {
      return api.all().then(function (rows) {
        return rows.filter(function (r) { return r.kind === 'draft'; })
          .sort(function (a, b) { return a.savedAt < b.savedAt ? 1 : -1; });
      });
    },

    /* 返回 { dropped: 被挤掉的那条 or null } —— 挤掉了要明着告诉用户 */
    putDraft: function (shijian, shouhuo) {
      return api.listDrafts().then(function (list) {
        var dropped = null;
        if (list.length >= DRAFT_MAX) {
          /* savedAt 小的在后面（上面排序是新的在前），取最后一条 */
          dropped = list[list.length - 1];
        }
        var d = {
          id: uid('dft'),
          kind: 'draft',
          shijian: shijian || '',
          shouhuo: shouhuo || '',
          savedAt: nowISO()
        };
        var chain = Promise.resolve();
        if (dropped) {
          chain = chain.then(function () {
            return tx('readwrite', function (s) {
              if (s.delete) s.delete(dropped.id); else idbDelete(s, dropped.id);
            });
          });
        }
        return chain.then(function () {
          return tx('readwrite', function (s) {
            if (s.put) s.put(d); else idbPut(s, d);
          });
        }).then(function () { return { draft: d, dropped: dropped }; });
      });
    },

    /* 草稿取出来用掉之后就从箱子里拿掉 */
    deleteDraft: function (id) {
      return tx('readwrite', function (s) {
        if (s.delete) s.delete(id); else idbDelete(s, id);
      });
    },

    /* ---------- 回收站 ----------
       删除一律是「挪进回收站」，不真抹掉。 */
    getAny: function (id) {
      return ensure().then(function () {
        if (_useFallback) return _memory[id] || null;
        return new Promise(function (resolve, reject) {
          var r = _db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
          r.onsuccess = function () { resolve(r.result || null); };
          r.onerror = function () { reject(r.error); };
        });
      });
    },

    trashById: function (id) {
      return api.getAny(id).then(function (obj) {
        if (!obj) return false;
        var tomb = {
          id: 'trash_' + uid('d'),
          kind: 'trash',
          originalId: obj.id,
          originalKind: obj.kind,
          data: obj,
          deletedAt: nowISO()
        };
        return tx('readwrite', function (s) { if (s.put) s.put(tomb); else idbPut(s, tomb); })
          .then(function () {
            return tx('readwrite', function (s) {
              if (s.delete) s.delete(obj.id); else idbDelete(s, obj.id);
            });
          }).then(function () { return true; });
      });
    },

    listTrash: function () {
      return api.all().then(function (rows) {
        return rows.filter(function (r) { return r.kind === 'trash'; })
          .sort(function (a, b) { return a.deletedAt < b.deletedAt ? 1 : -1; });
      });
    },

    /* 原样写回去 */
    restoreTrash: function (trashId) {
      return api.getAny(trashId).then(function (row) {
        if (!row || row.kind !== 'trash' || !row.data) return false;
        return tx('readwrite', function (s) { if (s.put) s.put(row.data); else idbPut(s, row.data); })
          .then(function () {
            return tx('readwrite', function (s) {
              if (s.delete) s.delete(row.id); else idbDelete(s, row.id);
            });
          }).then(function () { return true; });
      });
    },

    emptyTrash: function () {
      return api.all().then(function (rows) {
        var ids = rows.filter(function (r) { return r.kind === 'trash'; })
          .map(function (r) { return r.id; });
        var chain = Promise.resolve();
        ids.forEach(function (tid) {
          chain = chain.then(function () {
            return tx('readwrite', function (s) {
              if (s.delete) s.delete(tid); else idbDelete(s, tid);
            });
          });
        });
        return chain.then(function () { return ids.length; });
      });
    },

    /* ---------- 设置 ---------- */
    getSettings: function () {
      return api.all().then(function (rows) {
        var s = null;
        rows.forEach(function (r) { if (r.kind === 'settings') s = r; });
        var base = {
          id: 'settings', kind: 'settings',
          theme: '#6E6BFE',
          mode: 'light',
          lastExportAt: null
        };
        if (s) {
          /* 老备份 / 老版本里没有 mode，补一个默认值，别让它变 undefined */
          if (s.mode !== 'dark' && s.mode !== 'auto') s.mode = 'light';
          return s;
        }
        return base;
      });
    },
    putSettings: function (s) {
      s.id = 'settings'; s.kind = 'settings';
      return tx('readwrite', function (x) {
        if (x.put) x.put(s); else idbPut(x, s);
      }).then(function () { return s; });
    },

    all: function () {
      return ensure().then(function () {
        if (_useFallback) return Object.keys(_memory).map(function (k) { return _memory[k]; });
        return new Promise(function (resolve, reject) {
          var r = _db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
          r.onsuccess = function () { resolve(r.result || []); };
          r.onerror = function () { reject(r.error); };
        });
      });
    },

    /* ---------- 导出 / 导入 ---------- */
    exportAll: function () {
      return Promise.all([
        api.listEvents(), api.listDrafts(), api.getSettings()
      ]).then(function (res) {
        return {
          format: 'growth-bug-manager-simple',
          version: 1,
          exportedAt: nowISO(),
          counts: { events: res[0].length, drafts: res[1].length },
          events: res[0],
          drafts: res[1],
          settings: res[2]
        };
      });
    },

    importAll: function (payload) {
      if (!payload) return Promise.reject(new Error('文件读不出来'));
      var ok = payload.format === 'growth-bug-manager-simple' ||
               payload.format === 'growth-bug-manager';
      if (!ok) return Promise.reject(new Error('这不是本产品的备份文件'));

      var events = (payload.events || []).map(function (e) {
        if (e.shijian !== undefined || e.shouhuo !== undefined) {
          return {
            id: e.id || uid('evt'), kind: 'event',
            shijian: String(e.shijian || ''),
            shouhuo: String(e.shouhuo || ''),
            createdAt: e.createdAt || nowISO(),
            updatedAt: e.updatedAt || e.createdAt || nowISO(),
            poem: e.poem || null
          };
        }
        var blocks = e.blocks || {};
        return {
          id: e.id || uid('evt'), kind: 'event',
          shijian: String((blocks.yuanqi && blocks.yuanqi.text) ||
                          e.cleanText || e.rawText || ''),
          shouhuo: String((blocks.xingchi && blocks.xingchi.text) ||
                          (blocks.zhaojian && blocks.zhaojian.text) || ''),
          createdAt: e.createdAt || nowISO(),
          updatedAt: e.updatedAt || e.createdAt || nowISO(),
          poem: e.poem || null
        };
      });

      var drafts = (payload.drafts || []).map(function (d) {
        return {
          id: d.id || uid('dft'), kind: 'draft',
          shijian: String(d.shijian || ''),
          shouhuo: String(d.shouhuo || ''),
          savedAt: d.savedAt || nowISO()
        };
      });

      return api.all().then(function (rows) {
        var seen = {};
        rows.forEach(function (r) { seen[r.id] = true; });
        var added = 0, skipped = 0, addedDrafts = 0;
        var chain = Promise.resolve();

        events.forEach(function (e) {
          if (seen[e.id]) { skipped++; return; }
          chain = chain.then(function () {
            return tx('readwrite', function (s) { if (s.put) s.put(e); else idbPut(s, e); });
          }).then(function () { added++; });
        });
        drafts.forEach(function (d) {
          if (seen[d.id]) return;
          chain = chain.then(function () {
            return tx('readwrite', function (s) { if (s.put) s.put(d); else idbPut(s, d); });
          }).then(function () { addedDrafts++; });
        });

        return chain.then(function () {
          return { added: added, skipped: skipped, drafts: addedDrafts };
        });
      });
    },

    /* 全搜索：事件和收获都参与 */
    search: function (q) {
      var kw = String(q || '').trim().toLowerCase();
      if (!kw) return Promise.resolve([]);
      return api.listEvents().then(function (list) {
        return list.filter(function (e) {
          return (String(e.shijian || '') + ' ' + String(e.shouhuo || ''))
            .toLowerCase().indexOf(kw) >= 0;
        });
      });
    }
  };

  global.Store = api;
})(window);
