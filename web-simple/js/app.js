/* 控制器 —— 路由、状态、交互。
   这一版（简洁版）只有一条主流程：首页写两个框 → 保存 → 完事。
   没有拆分、没有整理、没有去口水词、没有标签、没有合集。
   写进来的字一个都不会被改写。 */
(function (global) {
  'use strict';

  var stage = null, topbar = null, toastEl = null, navPill = null;

  var S = {
    route: 'home',
    events: [],
    byId: {},
    drafts: [],
    settings: null,
    trash: [],

    /* 首页那两个框里现在的字（还没保存的） */
    form: { shijian: '', shouhuo: '' },
    sedimentTab: 'shijian',
    openEvent: null,
    /* 详情页里「未记录」那一块被点开、正在编辑的格子 */
    filling: null,
    confirmDelete: null,
    confirmEmptyTrash: false,
    query: '',
    results: [],

    poemMatch: null,
    poemIdx: 0,
    poemNow: null
  };

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('on'); }, 2400);
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /* ================= 主题 ================= */
  function hexToRgb(h) {
    h = String(h || '').replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 110, g: 107, b: 254 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }
  function mixRgb(c, target, ratio) {
    return {
      r: Math.round(c.r + (target.r - c.r) * ratio),
      g: Math.round(c.g + (target.g - c.g) * ratio),
      b: Math.round(c.b + (target.b - c.b) * ratio)
    };
  }
  function rgba(c, a) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'; }
  function toHex(c) {
    function p(v) {
      var s = Math.max(0, Math.min(255, v)).toString(16);
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + p(c.r) + p(c.g) + p(c.b);
  }
  function applyTheme(hex) {
    var c = hexToRgb(hex);
    var deep = mixRgb(c, { r: 0, g: 0, b: 0 }, 0.30);
    var t = mixRgb(c, { r: 255, g: 255, b: 255 }, 0.35);
    var root = document.documentElement.style;
    root.setProperty('--accent', toHex(c));
    root.setProperty('--accent-deep', toHex(deep));
    root.setProperty('--accent-soft', rgba(c, 0.10));
    root.setProperty('--accent-line', rgba(c, 0.26));
    root.setProperty('--aura-1', rgba(t, 0.22));
    root.setProperty('--aura-2', rgba(t, 0.15));
    root.setProperty('--aura-3', rgba(t, 0.12));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', themeColorHex());
  }

  /* ================= 模式：浅色 / 深色 / 跟随系统 =================
     偏好值只有 light / dark / auto 三个，落到页面上的永远只有 light / dark。
     「跟随系统」不在 CSS 里用 @media 判 —— 手动指定的那两档优先级更高，
     CSS 没法表达「跟着系统，但用户手动改过之后就不再跟」。
     所以由 JS 解出最终值写死到 <html> 的 data-mode 上，CSS 只管两套变量。 */
  var _mode = 'light';

  function resolveMode(pref) {
    if (pref === 'dark') return 'dark';
    if (pref === 'auto') {
      try {
        if (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
      } catch (e) {}
      return 'light';
    }
    return 'light';
  }

  /* 状态栏那一条的颜色 = 页面最顶上那一像素的真实颜色。
     #aura 的最顶边是「纸色 + 主题色 22%」，这里照着算一遍，
     算出多少就是多少，中间不会留一道缝。 */
  function themeColorHex() {
    var hex = (S.settings && S.settings.theme) || '#6E6BFE';
    var t = mixRgb(hexToRgb(hex), { r: 255, g: 255, b: 255 }, 0.35);
    var paper = _mode === 'dark' ? { r: 14, g: 15, b: 18 } : { r: 253, g: 253, b: 255 };
    var a = 0.22;
    return toHex({
      r: Math.round(paper.r * (1 - a) + t.r * a),
      g: Math.round(paper.g * (1 - a) + t.g * a),
      b: Math.round(paper.b * (1 - a) + t.b * a)
    });
  }

  function applyMode(pref) {
    _mode = resolveMode(pref);
    S.mode = _mode;
    document.documentElement.setAttribute('data-mode', _mode);

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', themeColorHex());

    /* iOS 装到主屏之后那一条状态栏：
       default = 白底黑字（内容从文字下面开始，跟顶上的颜色是断的）；
       black-translucent = 状态栏那一片直接透出来，白色文字压在内容上。
       颜色既然一路铺到最顶，深夜模式就得用后者，不然顶上又出现一条白杠。 */
    var ios = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (ios) ios.setAttribute('content', _mode === 'dark' ? 'black-translucent' : 'default');
  }

  /* 系统深浅色自己变了：只有偏好是「跟随系统」时才跟着变。 */
  function watchSystemMode() {
    if (!global.matchMedia) return;
    var mq;
    try { mq = global.matchMedia('(prefers-color-scheme: dark)'); }
    catch (e) { return; }
    var onChange = function () {
      if (!S.settings || S.settings.mode !== 'auto') return;
      applyMode('auto');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ================= 数据 ================= */
  function refresh() {
    return Promise.all([
      Store.listEvents(), Store.listDrafts(), Store.getSettings(), Store.listTrash()
    ]).then(function (r) {
      S.events = r[0];
      S.byId = {};
      S.events.forEach(function (e) { S.byId[e.id] = e; });
      S.drafts = r[1];
      S.settings = r[2];
      S.trash = r[3] || [];
      /* 刷新之后库里是新对象，正在看的那条要换成新副本，
         不然界面上画的还是旧的，改了也存不回去。 */
      if (S.openEvent) S.openEvent = S.byId[S.openEvent.id] || null;
    });
  }

  /* 首页两个框里没保存的字，先在本机留一份。
     关掉页面、手机切后台被回收，回来字还在 —— 不用额外点任何按钮。 */
  var FORM_KEY = 'gbm.simple.form';
  function formSave() {
    try { global.localStorage.setItem(FORM_KEY, JSON.stringify(S.form)); } catch (e) {}
  }
  function formLoad() {
    try {
      var s = global.localStorage.getItem(FORM_KEY);
      if (s) {
        var o = JSON.parse(s);
        S.form.shijian = String(o.shijian || '');
        S.form.shouhuo = String(o.shouhuo || '');
      }
    } catch (e) {}
  }
  function formClear() {
    S.form.shijian = ''; S.form.shouhuo = '';
    try { global.localStorage.removeItem(FORM_KEY); } catch (e) {}
  }

  /* ================= 顶栏 ================= */
  var TITLES = {
    home: '', editor: '今日记录', event: '这条记录', sediment: '沉淀', trace: '轨迹',
    drafts: '草稿箱', search: '搜索', settings: '设置', trash: '回收站'
  };

  function renderTopbar() {
    var bar = $('#topbar');
    var r = S.route;

    if (r === 'home') { bar.classList.remove('on'); bar.innerHTML = ''; return; }
    bar.classList.add('on');

    var html = '<div class="tb-row">';

    if (r === 'sediment') {
      html += '<h1 class="tb-title">' + TITLES[r] + '</h1>' +
        '<div class="tb-actions">' +
        '<button class="tb-btn" data-act="go" data-route="search" aria-label="搜索">' +
        Views.ICON.search + '</button></div>';
    } else if (r === 'trace') {
      html += '<h1 class="tb-title">轨迹</h1>' +
        '<div class="tb-actions">' +
        '<button class="tb-btn" data-act="go" data-route="settings" aria-label="设置">' +
        Views.ICON.gear + '</button></div>';
    } else {
      html += '<button class="tb-btn" data-act="back" aria-label="返回">' +
        Views.ICON.back + '</button>' +
        '<h1 class="tb-title" style="margin-left:2px">' + TITLES[r] + '</h1>';
    }

    bar.innerHTML = html + '</div>';
  }

  function updateNavPill() {
    if (!navPill) return;
    var bar = $('#tabbar');
    var active = null;
    $$('#tabbar .tab').forEach(function (t) { if (t.classList.contains('on')) active = t; });
    if (!active) { navPill.style.opacity = '0'; return; }
    var br = bar.getBoundingClientRect();
    var tr = active.getBoundingClientRect();
    navPill.style.opacity = '1';
    navPill.style.width = Math.max(0, tr.width - 18) + 'px';
    navPill.style.transform = 'translateX(' + (tr.left - br.left + 9) + 'px)';
  }

  /* ================= 渲染 ================= */

  /* 这次重画算不算「换了一屏」？
     换页面、沉淀里换分段、换看另一条记录 —— 算，播滑入动画。
     原地刷新（点标签、展开输入框、二次确认）—— 不算，不然整屏老重新淡入，很毛躁。 */
  var _screenKey = null;
  function screenKey() {
    var k = S.route;
    if (S.route === 'sediment') k += '·' + S.sedimentTab;
    if (S.route === 'event') k += '·' + (S.openEvent ? S.openEvent.id : '');
    return k;
  }

  function render() {
    var html = '';
    switch (S.route) {
      case 'home': html = Views.home(S); break;
      case 'editor': html = Views.editor(S); break;
      case 'drafts': html = Views.drafts(S); break;
      case 'sediment': html = Views.sediment(S); break;
      case 'event':
        if (S.openEvent) {
          preparePoem(S.openEvent);
          html = Views.event(S);
        } else {
          S.route = 'trace';
          html = Views.trace(S);
          toast('这条记录找不到了');
        }
        break;
      case 'trace': html = Views.trace(S); break;
      case 'search': html = Views.search(S); break;
      case 'settings': html = Views.settings(S); break;
      case 'trash': html = Views.trash(S); break;
      default: html = Views.home(S);
    }

    var key = screenKey();
    var fresh = key !== _screenKey;
    _screenKey = key;

    renderTopbar();
    /* 外壳只在「今日记录编辑页」挂 editor 类（它要靠这个撑满一屏）。
       别的页面一律不加路由名 —— 首页的路由名正好叫 home，
       撞上按钮那套布局的 .home{...} 会把外壳压成按内容收缩，
       按钮的 width:100% 就跟着缩成一小条（实测 117px）。 */
    stage.innerHTML = '<div class="page' + (S.route === 'editor' ? ' editor' : '') +
      (fresh ? '' : ' still') + '">' + html + '</div>';

    $$('#tabbar .tab').forEach(function (b) {
      var r = b.getAttribute('data-route');
      var on =
        (r === 'home' && (S.route === 'home' || S.route === 'editor' || S.route === 'drafts')) ||
        (r === 'sediment' && (S.route === 'sediment')) ||
        (r === 'trace' && (S.route === 'trace' || S.route === 'event' ||
          S.route === 'settings' || S.route === 'trash' || S.route === 'search'));
      b.classList.toggle('on', !!on);
    });
    updateNavPill();

    if (S.route === 'search') bindSearch();
    if (S.route === 'editor') {
      var box = $('#inShijian');
      if (box && !box.value) box.focus();
    }
    if (S.route === 'event' && S.filling) {
      var ta = $('[data-act="edit-field"][data-key="' + S.filling + '"]');
      if (ta) ta.focus();
    }
  }

  function go(route) {
    S.route = route;
    if (route !== 'event') { S.openEvent = null; S.confirmDelete = null; S.filling = null; }
    if (route !== 'trash') S.confirmEmptyTrash = false;
    render();
    window.scrollTo(0, 0);
  }

  /* ================= 诗词 =================
     诗词库（920 KB）是开机之后才挂上来的，这里只是给它拼一个它认得的形状。
     简洁版一条记录只有「事件」「收获」两句话，照样能配。 */
  function poemView(e) {
    var all = String(e.shijian || '') + '\n' + String(e.shouhuo || '');
    return {
      rawText: all,
      cleanText: all,
      blocks: {
        yuanqi: { text: e.shijian || '', source: 'user' },
        zhaojian: { text: e.shijian || '', source: 'user' },
        xingchi: { text: e.shouhuo || '', source: 'user' }
      },
      tags: {}
    };
  }

  function preparePoem(evt) {
    if (!evt) { S.poemMatch = null; S.poemNow = null; return; }
    var m = Poem.match(poemView(evt));
    S.poemMatch = m;
    var at = evt.poem ? Poem.indexOfLine(m.items, evt.poem) : -1;
    S.poemIdx = at >= 0 ? at : 0;
    S.poemNow = m.items.length ? { line: m.items[S.poemIdx], confident: m.confident } : null;

    /* 词库还没挂上来：先空着，等它到位再补一次。
       如果你正好在打字，这次就跳过 —— 不能为了补一句诗打断你写字。 */
    if (m.pending) {
      Poem.load().then(function (ok) {
        if (!ok) return;
        var ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
        if (S.route === 'event' && S.openEvent) render();
      });
    }
  }

  function shufflePoem() {
    var e = S.openEvent;
    var m = S.poemMatch;
    if (!e || !m || !m.items.length) return;
    if (m.items.length < 2) { toast('这一句最贴，没有别的了'); return; }
    S.poemIdx = (S.poemIdx + 1) % m.items.length;
    var it = m.items[S.poemIdx];
    S.poemNow = { line: it, confident: m.confident };
    e.poem = { t: it.t, d: it.d, a: it.a, s: it.s };
    Store.putEvent(e).then(refresh).then(function () {
      S.openEvent = S.byId[e.id];
      render();
    });
  }

  /* ================= 去发布页看看 =================
     这里刻意**不发任何网络请求**。App 连「联网」权限都没申请，
     所以把发布页交给系统浏览器去开 —— 浏览器联网，App 一个请求都不发。 */
  function openReleases() {
    var app = Store.APP || {};
    var repo = String(app.repo || '').replace(/^\/+|\/+$/g, '');
    var url = 'https://github.com/' + repo + '/releases/latest';
    var box = $('#updateBox');
    if (box) {
      box.innerHTML = '<div class="tiny dim mt-s">已经在浏览器里打开了，' +
        '最新版本和安装包都在那个页面。</div>';
    }
    var w = global.open(url, '_blank', 'noopener');
    if (!w) global.location.href = url;
  }

  /* ================= 导出 / 导入 ================= */
  function shellOf() {
    var s = global.GBMShell;
    if (s && typeof s.saveZip === 'function') return s;
    var h = global.webkit && global.webkit.messageHandlers &&
            global.webkit.messageHandlers.gbmShell;
    if (h && typeof h.postMessage === 'function') {
      return {
        saveZip: function (b64, name) { h.postMessage({ op: 'saveZip', b64: b64, name: name }); }
      };
    }
    return null;
  }

  function b64OfBytes(bytes) {
    var CH = 0x8000;
    var s = '';
    for (var i = 0; i < bytes.length; i += CH) {
      var end = Math.min(i + CH, bytes.length);
      var sub = bytes.subarray ? bytes.subarray(i, end)
        : Array.prototype.slice.call(bytes, i, end);
      s += String.fromCharCode.apply(null, sub);
    }
    return global.btoa(s);
  }

  global.GBM_EXPORT_DONE = function (r) {
    var s = String(r || '');
    if (s === 'ok') {
      S.settings.lastExportAt = new Date().toISOString();
      Store.putSettings(S.settings).then(function () {
        if (S.route === 'settings') render();
      });
      toast('已导出，就在你刚才选的位置');
    } else if (s === 'cancel') {
      toast('没选位置，这次没导出');
    } else {
      toast('导出失败：' + s.replace(/^fail:/, ''));
    }
  };

  function stamp() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function mdAll(data) {
    var out = '# 成长记录\n\n导出于 ' + (data.exportedAt || '').slice(0, 10) + '\n\n';
    (data.events || []).forEach(function (e) {
      out += '## ' + (e.createdAt || '').slice(0, 10) + '\n\n';
      out += '**事件**\n\n' + (e.shijian || '未记录') + '\n\n';
      out += '**收获**\n\n' + (e.shouhuo || '未记录') + '\n\n';
    });
    return out;
  }
  function mdList(data, key, title) {
    var out = '# ' + title + '\n\n';
    var n = 0;
    (data.events || []).forEach(function (e) {
      var t = String(e[key] || '').trim();
      if (!t) return;
      n++;
      out += '- ' + (e.createdAt || '').slice(0, 10) + '　' + t.replace(/\n+/g, ' ') + '\n';
    });
    if (!n) out += '（还没有）\n';
    return out;
  }
  function aboutText(data) {
    var app = Store.APP || {};
    return '个人成长 Bug 管理器（简洁版）\n' +
      '版本：' + (app.version || '') + '\n' +
      '导出时间：' + (data.exportedAt || '') + '\n' +
      '记录：' + (data.counts ? data.counts.events : 0) + ' 条\n' +
      '草稿：' + (data.counts ? data.counts.drafts : 0) + ' 条\n\n' +
      '这个文件里的内容全部是你自己写的字，没有任何一条是机器替你生成的。\n' +
      '把它存好 —— 它是你唯一的底。\n';
  }

  function doExport() {
    return Store.exportAll().then(function (data) {
      var files = [
        { name: '全部数据.json', data: JSON.stringify(data, null, 2) },
        { name: '成长记录.md', data: mdAll(data) },
        { name: '事件清单.md', data: mdList(data, 'shijian', '事件清单') },
        { name: '收获清单.md', data: mdList(data, 'shouhuo', '收获清单') },
        { name: '关于.txt', data: aboutText(data) }
      ];
      var bytes = SimpleZip.zip(files);
      var fname = '成长Bug备份-' + stamp() + '.zip';

      var sh = shellOf();
      if (sh) {
        /* 装在 App 里：`<a download>` 在 WebView 里根本不生效，
           得把字节交给壳，让壳去拉系统「保存到哪儿」的选择器。
           这条路同样一条权限都不用 —— 存哪儿是你当场自己挑的。 */
        try {
          sh.saveZip(b64OfBytes(bytes), fname);
          toast('选个地方存起来…');
        } catch (e) {
          toast('导出失败：' + (e && e.message || ''));
        }
        return;
      }

      var blob = new Blob([bytes], { type: 'application/zip' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);

      S.settings.lastExportAt = new Date().toISOString();
      return Store.putSettings(S.settings).then(refresh).then(function () {
        toast('已导出 ZIP');
        if (S.route === 'settings') render();
      });
    }).catch(function (err) {
      toast('导出失败：' + (err && err.message || ''));
    });
  }

  /* 解开自己打的 ZIP（STORE 模式，无需压缩库） */
  function unzip(bytes) {
    var out = [];
    var i = 0;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function u16(p) { return dv.getUint16(p, true); }
    function u32(p) { return dv.getUint32(p, true); }
    while (i < bytes.length - 4) {
      if (u32(i) !== 0x04034b50) break;
      var size = u32(i + 18);
      var nameLen = u16(i + 26);
      var extraLen = u16(i + 28);
      var nameStart = i + 30;
      var nameBytes = bytes.subarray(nameStart, nameStart + nameLen);
      var name = '';
      for (var k = 0; k < nameBytes.length; k++) name += String.fromCharCode(nameBytes[k]);
      try { name = decodeURIComponent(escape(name)); } catch (e) {}
      var dataStart = nameStart + nameLen + extraLen;
      out.push({ name: name, data: bytes.subarray(dataStart, dataStart + size) });
      i = dataStart + size;
    }
    return out;
  }

  function doImport() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.zip,.json,application/zip,application/json';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var buf = fr.result;
        var payload = null;
        var name = (f.name || '').toLowerCase();

        if (name.slice(-4) === '.zip') {
          try {
            unzip(new Uint8Array(buf)).forEach(function (en) {
              if (en.name.indexOf('全部数据.json') >= 0) {
                var txt = '';
                for (var k = 0; k < en.data.length; k++) txt += String.fromCharCode(en.data[k]);
                payload = JSON.parse(decodeURIComponent(escape(txt)));
              }
            });
            if (!payload) { toast('这个 ZIP 里没找到「全部数据.json」'); return; }
          } catch (e) {
            toast('ZIP 读不出来：' + (e && e.message || '')); return;
          }
        } else {
          try { payload = JSON.parse(String(buf)); }
          catch (e) { toast('文件读不出来，可能坏了'); return; }
        }

        Store.importAll(payload).then(function (res) {
          return refresh().then(function () { return res; });
        }).then(function (res) {
          var msg = [];
          if (res.added) msg.push('恢复了 ' + res.added + ' 条');
          if (res.drafts) msg.push('草稿 ' + res.drafts + ' 条');
          toast(msg.length ? msg.join('，') : '备份里没有新内容');
          render();
        }).catch(function (err) {
          toast(err && err.message ? err.message : '导入失败');
        });
      };
      fr.readAsArrayBuffer(f);
    });
    inp.click();
  }

  /* ================= 首页的两个框 ================= */
  function formValues() {
    var a = $('#inShijian'), b = $('#inShouhuo');
    return {
      shijian: a ? String(a.value || '') : S.form.shijian,
      shouhuo: b ? String(b.value || '') : S.form.shouhuo
    };
  }

  /* 保存：写进库，自动分开 —— 事件进沉淀的事件区，收获进收获区。
     存完直接回首页，不逗留。 */
  function save() {
    var v = formValues();
    if (!v.shijian.trim() && !v.shouhuo.trim()) { toast('先写点什么'); return; }
    var e = Store.newEvent(v.shijian.trim(), v.shouhuo.trim());
    Store.putEvent(e).then(refresh).then(function () {
      formClear();
      go('home');
      toast('已保存');
    });
  }

  function saveDraft() {
    var v = formValues();
    if (!v.shijian.trim() && !v.shouhuo.trim()) { toast('先写点什么'); return; }
    Store.putDraft(v.shijian, v.shouhuo).then(function (res) {
      return refresh().then(function () { return res; });
    }).then(function (res) {
      formClear();
      go('home');
      if (res.dropped) toast('草稿箱满了，最老那条被换掉了');
      else toast('存进草稿箱了');
    });
  }

  /* ================= 事件委托 ================= */
  function onClick(ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');

    switch (act) {
      case 'go': go(el.getAttribute('data-route')); break;

      case 'back':
        if (S.route === 'event') go('trace');
        else go('home');
        break;

      case 'new-record': go('editor'); break;

      /* 取消：只是回到首页。
         框里写过的字**留着** —— 下次点「今日记录」还在。
         这个 App 不扔用户写过的任何一个字，「取消」也不例外。 */
      case 'cancel': go('home'); break;

      case 'save': save(); break;
      case 'save-draft': saveDraft(); break;

      case 'use-draft': {
        var d = null;
        S.drafts.forEach(function (x) { if (x.id === id) d = x; });
        if (!d) return;
        S.form.shijian = d.shijian || '';
        S.form.shouhuo = d.shouhuo || '';
        Store.deleteDraft(id).then(refresh).then(function () {
          go('editor');
          toast('拿出来了，接着写');
        });
        break;
      }

      case 'del-draft':
        Store.deleteDraft(id).then(refresh).then(function () {
          render();
          toast('草稿已删');
        });
        break;

      case 'sed-tab':
        S.sedimentTab = el.getAttribute('data-tab');
        render();
        window.scrollTo(0, 0);
        break;

      case 'open-event':
        S.openEvent = S.byId[id] || null;
        S.filling = null;
        go('event');
        break;

      /* 详情页里「未记录」那一块，点一下就地变成输入框 */
      case 'fill-field':
        S.filling = el.getAttribute('data-key');
        render();
        break;

      case 'delete-event':
        S.confirmDelete = id;
        render();
        break;
      case 'cancel-delete':
        S.confirmDelete = null;
        render();
        break;
      case 'do-delete':
        Store.trashById(id).then(refresh).then(function () {
          go('trace');
          toast('已删，回收站里能还原');
        });
        break;

      case 'restore-trash':
        Store.restoreTrash(id).then(refresh).then(function () {
          render();
          toast('已还原');
        });
        break;
      case 'empty-trash': S.confirmEmptyTrash = true; render(); break;
      case 'cancel-empty-trash': S.confirmEmptyTrash = false; render(); break;
      case 'do-empty-trash':
        Store.emptyTrash().then(refresh).then(function () {
          S.confirmEmptyTrash = false;
          render();
          toast('回收站已清空');
        });
        break;

      case 'toggle-picker':
        S.pickerOpen = !(S.pickerOpen === true);
        if (!S.pickerOpen && _themeSaveTimer) {
          /* 关面板时手头的改动立刻落库，不等防抖 */
          clearTimeout(_themeSaveTimer); _themeSaveTimer = 0;
          Store.putSettings(S.settings).then(function () {
            render();
            toast('主题已保存');
          });
        } else {
          render();
        }
        break;

      case 'set-theme':
        S.settings.theme = el.getAttribute('data-color');
        applyTheme(S.settings.theme);
        Store.putSettings(S.settings).then(refresh).then(function () {
          render();
          toast('主题已保存');
        });
        break;

      case 'set-mode':
        S.settings.mode = el.getAttribute('data-mode');
        applyMode(S.settings.mode);
        Store.putSettings(S.settings).then(refresh).then(function () {
          render();
          toast(_mode === 'dark' ? '深夜模式' : '白天模式');
        });
        break;

      case 'check-update': openReleases(); break;

      case 'export': doExport(); break;
      case 'import': doImport(); break;

      case 'shuffle-poem': shufflePoem(); break;

      case 'clear-form':
        formClear();
        render();
        break;
    }
  }

  /* 输入框失焦时把字存下来。
     首页两个框：存进本机临时区（不进库），关掉页面回来还在。
     详情页两个格子：直接写进库 —— 那是正经记录，改了就得落盘。 */
  function onBlur(ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) return;
    if (el.getAttribute('data-act') !== 'edit-field') return;

    var key = el.getAttribute('data-key');
    var val = String(el.value || '');
    var id = el.getAttribute('data-id');

    if (id) {
      var e = S.byId[id];
      if (!e || e[key] === val) return;
      e[key] = val;
      S.filling = null;
      Store.putEvent(e).then(refresh).then(function () { render(); });
    } else {
      S.form[key] = val;
      formSave();
    }
  }

  function bindSearch() {
    var el = $('#searchInput');
    if (!el) return;
    el.focus();
    var timer;
    el.addEventListener('input', function () {
      clearTimeout(timer);
      var q = el.value;
      timer = setTimeout(function () {
        S.query = q;
        Store.search(q).then(function (rs) {
          S.results = rs;
          var box = $('#searchResults');
          if (box) box.innerHTML = Views.searchResults(S);
        });
      }, 200);
    });
  }

  /* ================= 启动 ================= */
  var booted = false;
  /* ================= 键盘开着时：编辑页只留两个框 =================
     输入框拿到焦点、且键盘真的弹出来（可视高度比「没键盘时」矮了 100px 以上），
     就给 <body> 挂 kb 类 —— CSS 接手：保存 / 取消 / 草稿箱那排和底部导航
     全部沉下去，两个框占满整屏。点键盘下箭头收起键盘（焦点可能还在框上），
     可视高度弹回来，类自动摘掉，按钮滑回来。 */
  function bindKbAuto() {
    var vv = global.visualViewport;
    if (!vv) return;                        /* 没有可视视口的老浏览器：维持原样 */
    var focusTa = null;                     /* 当前拿到焦点的编辑框 */
    var lastBig = vv.height;                /* 最近一次「没键盘」的可视高度 */
    var raf = 0;
    function upd() {
      raf = 0;
      if (!focusTa) {
        if (vv.height > lastBig) lastBig = vv.height;   /* 重新校准基准 */
        document.body.classList.remove('kb');
        return;
      }
      document.body.classList.toggle('kb', vv.height < lastBig - 100);
    }
    function queue() { if (!raf) raf = global.requestAnimationFrame(upd); }
    stage.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t && t.tagName === 'TEXTAREA' && t.closest && t.closest('.page.editor')) {
        focusTa = t;
        queue();
      }
    });
    stage.addEventListener('focusout', function () {
      /* 80ms 后再看：从一个框跳到另一个框时中间会闪一次空档 */
      global.setTimeout(function () {
        var a = document.activeElement;
        if (!a || a.tagName !== 'TEXTAREA' || !a.closest || !a.closest('.page.editor')) {
          focusTa = null;
          lastBig = vv.height;              /* 焦点走了，基准重新记 */
          queue();
        }
      }, 80);
    });
    vv.addEventListener('resize', queue);
    vv.addEventListener('scroll', queue);
  }

  /* ================= 自定义取色面板 =================
     滑杆 / HEX 输入框一动就实时改主题（改 CSS 变量 + 顶部预览 + 面板自己），
     落库是防抖的 —— 拖一秒能触发几十次 input，不能每次都写库。 */
  var _themeSaveTimer = 0;

  function pickerRgb() {
    var out = {};
    [].forEach.call(stage.querySelectorAll('#pickerPanel input[data-rgb]'), function (r) {
      out[r.getAttribute('data-rgb')] = Math.max(0, Math.min(255, parseInt(r.value, 10) || 0));
    });
    return out;
  }

  function syncPickerUi(hex) {
    var c = hexToRgb(hex);
    function q(id) { return stage.querySelector('#' + id); }
    var eye = q('pickerEye'); if (eye) eye.style.background = toHex(c);
    var top = q('themeEye'); if (top) { top.style.background = toHex(c); top.style.boxShadow = '0 8px 20px -10px ' + toHex(c); }
    var txt = q('themeHexTxt'); if (txt) txt.textContent = toHex(c).toUpperCase();
    [].forEach.call(stage.querySelectorAll('#pickerPanel input[data-rgb]'), function (r) {
      var k = r.getAttribute('data-rgb');
      r.value = c[k];
      var v = r.parentNode.querySelector('.picker-v');
      if (v) v.textContent = c[k];
    });
    var hx = q('hexInput');
    if (hx && document.activeElement !== hx) hx.value = toHex(c).toUpperCase();
    /* 选中圈：颜色一旦不是预设色，圈就该挪到彩色轮盘上 */
    [].forEach.call(stage.querySelectorAll('.swatch.on'), function (s) {
      if (!s.classList.contains('custom')) s.classList.remove('on');
    });
    var cust = stage.querySelector('.swatch.custom');
    if (cust) cust.classList.add('on');
  }

  function themeLive(hex) {
    S.settings.theme = hex;
    applyTheme(hex);
    syncPickerUi(hex);
    if (_themeSaveTimer) clearTimeout(_themeSaveTimer);
    _themeSaveTimer = global.setTimeout(function () {
      _themeSaveTimer = 0;
      Store.putSettings(S.settings);        /* 静默落库，不 toast 不刷屏 */
    }, 500);
  }

  function bindPicker() {
    stage.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      if (t.getAttribute('data-rgb')) {                    /* 滑杆动了 */
        var rgb = pickerRgb();
        themeLive(toHex(rgb));
      } else if (t.id === 'hexInput') {                    /* 手输色号 */
        var v = String(t.value || '').trim().replace(/^#*/, '');
        if (/^[0-9a-fA-F]{6}$/.test(v)) themeLive('#' + v.toLowerCase());
      }
    });
  }

  function boot() {
    if (booted) return;
    booted = true;
    stage = $('#stage');
    topbar = $('#topbar');
    toastEl = $('#toast');
    navPill = $('#navPill');

    document.addEventListener('click', onClick);
    document.addEventListener('focusout', onBlur);
    global.addEventListener('resize', updateNavPill);
    bindKbAuto();
    bindPicker();

    $('#tabbar').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (b) go(b.getAttribute('data-route'));
    });

    /* 首页两个框边打边存，切后台、关页面都不丢字。
       顺手把框上的「事件 / 收获」两个提示字让位给真字：
       框空着它们浮在正中间，打了第一个字就淡出（CSS 里 .simple-box.has::before）。 */
    document.addEventListener('input', function (ev) {
      var el = ev.target;
      if (!el || !el.getAttribute || el.getAttribute('data-act') !== 'edit-field') return;
      if (el.getAttribute('data-id')) return;      /* 详情页的格子不在这儿存 */
      S.form[el.getAttribute('data-key')] = String(el.value || '');
      formSave();

      /* 框本身就是 .simple-box（提示字是它的 ::before），但也兼容外面包一层的情况 */
      var box = el.closest ? el.closest('.simple-box') : null;
      if (box) box.classList.toggle('has', String(el.value || '').length > 0);
    });

    formLoad();
    refresh().then(function () {
      applyMode(S.settings.mode || 'light');
      applyTheme(S.settings.theme || '#6E6BFE');
      watchSystemMode();
      render();
      setTimeout(updateNavPill, 60);
      /* 首屏先出来，再去后台挂 920 KB 的诗词库 */
      Poem.load();
      /* 离线缓存只给「用浏览器打开」这种情况。装进 App 壳里时文件本来就打包在包里，
         再套一层 Service Worker 只会让旧缓存跨版本留着。壳会给 UA 打 GBMShell 标记。 */
      var inShell = /GBMShell/.test(navigator.userAgent || '');
      if (!inShell && 'serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      }
    }).catch(function (err) {
      stage.innerHTML = '<div class="empty">本地存储没起来：' +
        Views.esc(err && err.message || err) + '</div>';
    });
  }

  /* 安卓壳的返回键 / iOS 边缘右滑会调这里。
     能自己消化就返回 true（先收起输入框 → 退回上一层 → 最后回首页）；
     已经在首页了返回 false，交给系统退出 App。 */
  global.GBM_BACK = function () {
    if (S.filling) { S.filling = null; render(); return true; }
    if (S.confirmDelete) { S.confirmDelete = null; render(); return true; }
    if (S.confirmEmptyTrash) { S.confirmEmptyTrash = false; render(); return true; }
    if (S.route === 'event') { go('trace'); return true; }
    if (S.route !== 'home') { go('home'); return true; }   /* 编辑页也走这条，字留着 */
    return false;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
