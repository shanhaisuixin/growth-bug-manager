/* 存储层 —— 本地优先。IndexedDB 为主，不可用时降级 localStorage。
   设计原则：
   1) 原始记录一旦写入，任何流程都不得改写 rawText（第十、十一条红线）
   2) 聚合/关联只做追加，不做替换（第十二、三十五条红线）
   3) 所有删除都进回收站表，可恢复
*/
(function (global) {
  'use strict';

  var DB_NAME = 'growth-bug-manager';
  var DB_VER = 1;
  var STORE = 'objects';       // 统一对象表：按 kind 区分
  var FALLBACK_KEY = 'gbm.fallback';

  var _db = null;
  var _memory = null;          // 降级时的内存镜像
  var _useFallback = false;

  /* ---------- id / 时间 ---------- */
  function uid(prefix) {
    var t = Date.now().toString(36);
    var r = Math.random().toString(36).slice(2, 7);
    return (prefix || 'id') + '_' + t + r;
  }
  function nowISO() { return new Date().toISOString(); }

  /* ---------- IndexedDB 打开 ---------- */
  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) return reject(new Error('no-idb'));
      var req = global.indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('kind', 'kind', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb-open-failed')); };
    });
  }

  /* 保证有一个可用的连接。
     ⚠️ 这里以前是「每调一次就 openDB() 一次」，_db 虽然存下来了却从没被复用 ——
     于是一次点击（1 次写 + 3 次读）会开出 5 个连接，框越开越多、每次还都得等异步建连。
     现在：连上了就直接用；正在开就等那一个；只有真的断开（比如浏览器回收、
     或者另一个标签页要升级版本）才重开。 */
  var _opening = null;

  function ensure() {
    if (_memory) return Promise.resolve();          /* 已经降级了，不再试 IndexedDB */
    if (_db) return Promise.resolve();              /* 有现成的连接，直接用 */
    if (_opening) return _opening;                  /* 正有个连接在开，等它，不必再开一个 */
    _opening = openDB().then(function (db) {
      _db = db;
      _useFallback = false;
      _opening = null;
      /* 连接被浏览器收掉时把引用清空，下次操作自然重开 */
      db.onclose = function () { _db = null; };
      /* 别的标签页要升版本时主动让路，免得把对方卡在 blocked 上 */
      db.onversionchange = function () {
        try { db.close(); } catch (e) { /* 忽略 */ }
        _db = null;
      };
    }).catch(function () {
      _useFallback = true;
      _memory = loadFallback();
      _opening = null;
      console.warn('[GBM] IndexedDB 不可用，已降级到 localStorage');
    });
    return _opening;
  }

  function loadFallback() {
    try {
      var raw = global.localStorage.getItem(FALLBACK_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) { return {}; }
  }
  function saveFallback() {
    try { global.localStorage.setItem(FALLBACK_KEY, JSON.stringify(_memory || {})); }
    catch (e) { console.warn('[GBM] 本地保存失败', e); }
  }

  function tx(mode, fn) {
    return ensure().then(function () {
      if (_useFallback) return fn(fallbackAPI());
      return new Promise(function (resolve, reject) {
        var t = _db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out = fn(store);
        t.oncomplete = function () { resolve(out && out.__then ? out : undefined) || resolve(); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('tx-abort')); };
      });
    });
  }

  /* 极小的一层封装：让 IndexedDB 与 localStorage 暴露同样的读写口 */
  function fallbackAPI() {
    return {
      put: function (obj) { _memory[obj.id] = obj; saveFallback(); },
      getAll: function () { return Object.keys(_memory).map(function (k) { return _memory[k]; }); },
      get: function (id) { return _memory[id]; },
      delete: function (id) { delete _memory[id]; saveFallback(); }
    };
  }

  function idbPut(store, obj) { store.put(obj); }
  function idbDelete(store, id) { store.delete(id); }

  /* ---------- 数据形态 ---------- */

  /* 一条成长事件。
     blocks 内每个字段要么是 null（未记录），要么是 {text, source, pickedFrom}
     source: 'user' 表示从原话里抠出来的一段（本机候选，你自己点采纳的）；
            'hand' 表示你后来一个字一个字手写的
  */
  function newEvent(rawText) {
    var t = nowISO();
    return {
      id: uid('evt'),
      kind: 'event',
      createdAt: t,
      updatedAt: t,
      rawText: rawText || '',
      cleanText: '',
      cleanAccepted: false,
      structState: 'raw',          // raw | cleaning | structured | unreliably
      blocks: {
        yuanqi: null,
        zhaojian: null,
        xingchi: null
      },
      tags: { domain: [], mechanism: [], scene: [] },
      tagState: 'none',            // none | suggested | confirmed
      collectionId: null,
      relations: [],               // {eventId, score, reason, auto}
      reflections: [],             // {at, thinking, revealed:boolean}
      outcome: null,               // 'done' | 'again' | 'unsure'
      poem: null                  // 结尾配的那一句（换一句会把它换掉）
    };
  }

  /* 这里以前放的是各家大模型的预置列表（服务商 / 接口地址 / 模型名）。
     现在整理、拆开、分类全部由本机规则完成，不联网、不要 Key，所以整块删掉了。 */

  /* 主题色预设 */
  var THEME_PRESETS = [
    '#6E6BFE', '#F0435F', '#E8899B', '#A96B5B', '#F0C64A', '#4CAF7D', '#8A9A8B',
    '#7EC8E3', '#2C7BE5', '#4A5A6A', '#8B7FA8', '#5AC8B0', '#1F1F22', '#B5AC9E'
  ];

  /* 拆开的三个格子。用户 2026-10-05 把原来的五格并成了这三格：
       缘起 —— 发生了什么
       照见 —— 这件事让我看见了什么
       行持 —— 我从中得到什么，又准备如何去做
     标题只两个字，长的那句是灰字提示，写在框里当 placeholder。 */
  var BLOCK_KEYS = ['yuanqi', 'zhaojian', 'xingchi'];
  var BLOCK_LABELS = {
    yuanqi: '缘起',
    zhaojian: '照见',
    xingchi: '行持'
  };
  var BLOCK_HINTS = {
    yuanqi: '发生了什么？',
    zhaojian: '这件事让我看见了什么？',
    xingchi: '我从中得到什么，又准备如何去做？'
  };

  /* 老记录（五格那版）→ 新记录（三格）的合并路线。
     只影响「读出来怎么显示」，库里的老字段一个字都不动 ——
     user 的原话不能因为改版就没掉。 */
  var LEGACY_BLOCK_MAP = {
    happened: 'yuanqi',
    bug: 'zhaojian',
    solution: 'xingchi',
    insight: 'xingchi',
    nextAction: 'xingchi'
  };

  /* 把五格的老记录读成三格。已经存进去的 happened/bug/… 原样保留。 */
  function migrateBlocks(evt) {
    if (!evt || !evt.blocks) return evt;
    var b = evt.blocks;
    if (BLOCK_KEYS.some(function (k) { return k in b; })) return evt;  // 已是新格式

    var acc = {};
    BLOCK_KEYS.forEach(function (k) { acc[k] = { texts: [], carrier: null, from: [] }; });
    /* 按老字段的书写顺序合并（happened → bug → solution → insight → nextAction），
       这样「我的解决办法 + 我的收获 + 下一次怎么做」拼进「行持」时顺序是通顺的 */
    Object.keys(b).forEach(function (k) {
      var to = LEGACY_BLOCK_MAP[k];
      var cell = b[k];
      if (!to || !cell) return;
      var t = String(cell.text == null ? '' : cell.text).trim();
      if (!t) return;
      acc[to].texts.push(t);
      acc[to].from.push(k);
      if (!acc[to].carrier) acc[to].carrier = cell;
    });

    BLOCK_KEYS.forEach(function (k) {
      var a = acc[k];
      if (!a.texts.length) {
        if (!(k in b)) b[k] = null;
        return;
      }
      var c = a.carrier || {};
      b[k] = {
        text: a.texts.join('\n'),
        source: c.source || 'hand',
        pickedFrom: c.pickedFrom || null,
        mergedFrom: a.from       // 留个记号：这一格是从老记录哪几格并过来的
      };
    });
    return evt;
  }

  var TAG_LABELS = { domain: '领域', mechanism: '问题机制', scene: '场景' };

  /* 分类候选池 —— 就是给你点着用的，点「＋ 其他」可以加自己的词 */
  var VOCAB = {
    domain: ['自我管理', '执行力', '情绪', '人际关系', '沟通', '决策', '工作', '学习', '金钱', '生活', '认知', '其他'],
    mechanism: ['拖延', '逃避', '讨好', '冲动', '情绪化', '过度思考', '边界不足', '注意力分散',
      '判断错误', '信息不足', '执行断裂', '知道但做不到', '事后才反应', '害怕承担后果',
      '自我合理化', '过度依赖经验', '其他'],
    scene: ['工作', '学习', '冲突', '沟通', '拒绝别人', '做决定', '社交', '金钱', '项目执行', '时间管理', '网络信息', '其他']
  };

  /* ---------- 对外 API ---------- */

  /* 版本号与出处。「关于」里会显示，检查更新时拿它跟 GitHub 上的最新版本比。
     改版本号这一步要跟仓库里的 git tag 对上。 */
  var APP = {
    version: '1.0.0',
    maker: '凤箫声动',
    repo: 'shanhaisuixin/growth-bug-manager'
  };

  var api = {
    APP: APP,
    ensure: ensure,
    uid: uid,
    nowISO: nowISO,
    newEvent: newEvent,
    THEME_PRESETS: THEME_PRESETS,
    BLOCK_KEYS: BLOCK_KEYS,
    BLOCK_LABELS: BLOCK_LABELS,
    BLOCK_HINTS: BLOCK_HINTS,
    migrateBlocks: migrateBlocks,
    TAG_LABELS: TAG_LABELS,
    VOCAB: VOCAB,

    usingFallback: function () { return _useFallback; },

    /* 保存（新增或更新）。原始记录只允许在『还没有任何结构化动作前』被用户自己改写。 */
    putEvent: function (evt) {
      evt.kind = 'event';
      evt.updatedAt = nowISO();
      return tx('readwrite', function (s) {
        if (s.getAll) s.put(evt); else idbPut(s, evt);
      }).then(function () { return evt; });
    },

    getEvent: function (id) {
      return ensure().then(function () {
        if (_useFallback) return _memory[id] && _memory[id].kind === 'event' ? migrateBlocks(_memory[id]) : null;
        return new Promise(function (resolve, reject) {
          var r = _db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
          r.onsuccess = function () { resolve(r.result && r.result.kind === 'event' ? migrateBlocks(r.result) : null); };
          r.onerror = function () { reject(r.error); };
        });
      });
    },

    listEvents: function () {
      return ensure().then(function () {
        if (_useFallback) {
          return Object.keys(_memory).map(function (k) { return _memory[k]; })
            .filter(function (o) { return o.kind === 'event'; });
        }
        return new Promise(function (resolve, reject) {
          var out = [];
          var r = _db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
          r.onsuccess = function () {
            var c = r.result;
            if (!c) return resolve(out);
            if (c.value.kind === 'event') out.push(c.value);
            c.continue();
          };
          r.onerror = function () { reject(r.error); };
        });
      }).then(function (list) {
        /* 老备份里的五格记录在这里并成三格。只改读出来的样子，库里不动。 */
        list.forEach(migrateBlocks);
        return list.sort(function (a, b) { return b.createdAt < a.createdAt ? -1 : 1; });
      });
    },

    /* ---------- 回收站 ----------
       删除一律是「挪进回收站」，不真正抹掉；回收站里能还原，也能一次清空。 */

    /* 按 id 读任意对象（不挑 kind）。
       原先只有 getEvent，它对 kind !== 'event' 一律返回 null ——
       于是「取消合集」传进来一个合集 id 时读到 null、什么也没删，
       界面上却老老实实提示「合集已取消」。 */
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

    /* 删除：读原对象 → 写一条回收站记录 → 删掉原对象。任何 kind 都能删。 */
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
        return tx('readwrite', function (s) { s.put(tomb); }).then(function () {
          return tx('readwrite', function (s) {
            if (s.delete) s.delete(obj.id); else idbDelete(s, obj.id);
          });
        }).then(function () { return true; });
      });
    },

    /* 兼容旧名字（以前只有事件能进回收站） */
    trashEvent: function (id) { return api.trashById(id); },

    listTrash: function () {
      return api.all().then(function (rows) {
        return rows.filter(function (r) { return r.kind === 'trash'; })
          .sort(function (a, b) { return a.deletedAt < b.deletedAt ? 1 : -1; });
      });
    },

    /* 还原：把当初那一份原样写回去，再删掉回收站记录。
       不走 putEvent —— 那是给事件用的，会给合集硬打上 kind:'event'。 */
    restoreTrash: function (trashId) {
      return api.getAny(trashId).then(function (row) {
        if (!row || row.kind !== 'trash' || !row.data) return false;
        return tx('readwrite', function (s) { s.put(row.data); }).then(function () {
          return tx('readwrite', function (s) {
            if (s.delete) s.delete(row.id); else idbDelete(s, row.id);
          });
        }).then(function () { return true; });
      });
    },

    /* 清空回收站：真正抹掉，不可恢复。调用方必须先让用户确认。 */
    emptyTrash: function () {
      return api.all().then(function (rows) {
        var ids = rows.filter(function (r) { return r.kind === 'trash'; })
          .map(function (r) { return r.id; });
        var chain = Promise.resolve();
        ids.forEach(function (tid) {
          chain = chain.then(function () {
            return tx('readwrite', function (s) { if (s.delete) s.delete(tid); else idbDelete(s, tid); });
          });
        });
        return chain.then(function () { return ids.length; });
      });
    },

    /* 合集（Bug 聚合） */
    putCollection: function (c) {
      c.kind = 'collection';
      c.createdAt = c.createdAt || nowISO();
      c.updatedAt = nowISO();
      return tx('readwrite', function (s) { if (s.put) s.put(c); else idbPut(s, c); }).then(function () { return c; });
    },
    newCollection: function (name, mechanism) {
      return { id: uid('col'), kind: 'collection', name: name, mechanism: mechanism || '',
        eventIds: [], createdAt: nowISO(), updatedAt: nowISO(), accepted: false };
    },
    listCollections: function () {
      return api.all().then(function (rows) {
        return rows.filter(function (r) { return r.kind === 'collection'; })
          .sort(function (a, b) { return b.createdAt < a.createdAt ? -1 : 1; });
      });
    },

    /* 设置 */
    getSettings: function () {
      return api.all().then(function (rows) {
        var s = null;
        rows.forEach(function (r) { if (r.kind === 'settings') s = r; });
        return s || {
          id: 'settings', kind: 'settings',
          theme: '#6E6BFE',
          customColor: '',
          lastExportAt: null,
          reviewReminder: 'off',
          autoAssociate: true
        };
      });
    },
    putSettings: function (s) {
      s.id = 'settings'; s.kind = 'settings';
      return tx('readwrite', function (x) { if (x.put) x.put(s); else idbPut(x, s); }).then(function () { return s; });
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
      return Promise.all([api.listEvents(), api.listCollections(), api.getSettings()]).then(function (res) {
        return {
          format: 'growth-bug-manager',
          version: 1,
          exportedAt: nowISO(),
          counts: { events: res[0].length, collections: res[1].length },
          events: res[0],
          collections: res[1],
          settings: res[2]
        };
      });
    },

    /* 导入：只做合并，绝不覆盖同名 id 之外的数据 —— 不删用户任何东西 */
    importAll: function (payload) {
      if (!payload || payload.format !== 'growth-bug-manager') {
        return Promise.reject(new Error('这不是本产品的备份文件'));
      }
      var events = payload.events || [], cols = payload.collections || [];
      return api.listEvents().then(function (exist) {
        var seen = {};
        exist.forEach(function (e) { seen[e.id] = true; });
        var added = 0, skipped = 0;
        var chain = Promise.resolve();
        events.forEach(function (e) {
          if (seen[e.id]) { skipped++; return; }
          chain = chain.then(function () { return api.putEvent(e); }).then(function () { added++; });
        });
        cols.forEach(function (c) {
          chain = chain.then(function () { return api.putCollection(c); });
        });
        return chain.then(function () { return { added: added, skipped: skipped, collections: cols.length }; });
      });
    },

    /* 全搜索：原始记录 / 各信息块 / 标签 都参与 */
    search: function (q) {
      var kw = String(q || '').trim().toLowerCase();
      if (!kw) return Promise.resolve([]);
      return api.listEvents().then(function (list) {
        return list.filter(function (e) {
          var hay = [e.rawText, e.cleanText];
          Object.keys(e.blocks || {}).forEach(function (k) {
            if (e.blocks[k] && e.blocks[k].text) hay.push(e.blocks[k].text);
          });
          ['domain', 'mechanism', 'scene'].forEach(function (g) {
            (e.tags[g] || []).forEach(function (t) { hay.push(t); });
          });
          (e.reflections || []).forEach(function (r) { hay.push(r.thinking || ''); });
          return hay.join(' ').toLowerCase().indexOf(kw) >= 0;
        });
      });
    }
  };

  global.Store = api;
})(window);
