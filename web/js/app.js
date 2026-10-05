/* 控制器 —— 路由、状态、交互。
   交互纪律：回溯必须先让用户写下现在的想法，才允许看过去的答案。 */
(function (global) {
  'use strict';

  var stage = null, topbar = null, toastEl = null, navPill = null;

  var S = {
    route: 'home',
    events: [],
    byId: {},
    collections: [],
    settings: null,
    clusterCandidates: [],

    editingEvent: null,
    tidy: {},
    sedimentTab: 'zhaojian',
    openEvent: null,
    openCollection: null,
    query: '',
    results: [],

    /* 合集：自己新建 */
    creatingCol: false,
    pickingFor: null,
    /* 回溯：直接看过去的自己（不写想法也能看） */
    peeked: false,
    /* 删除的就地二次确认 */
    confirmDelete: null,
    /* 清空回收站的二次确认 */
    confirmEmptyTrash: false,
    /* 回收站（已删但还能还原的东西） */
    trash: [],
    /* 结尾那句：排好的一队 + 现在停在第几个 */
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
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(sel, fn) { var el = $(sel); if (el) el.addEventListener('click', fn); }

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
    function p(v) { var s = Math.max(0, Math.min(255, v)).toString(16); return s.length === 1 ? '0' + s : s; }
    return '#' + p(c.r) + p(c.g) + p(c.b);
  }

  function applyTheme(hex) {
    var c = hexToRgb(hex);
    var deep = mixRgb(c, { r: 0, g: 0, b: 0 }, 0.30);
    var t = mixRgb(c, { r: 255, g: 255, b: 255 }, 0.35);   /* 氛围用的更浅色 */
    var root = document.documentElement.style;
    root.setProperty('--accent', toHex(c));
    root.setProperty('--accent-deep', toHex(deep));
    root.setProperty('--accent-soft', rgba(c, 0.10));
    root.setProperty('--accent-line', rgba(c, 0.26));
    root.setProperty('--aura-1', rgba(t, 0.22));
    root.setProperty('--aura-2', rgba(t, 0.15));
    root.setProperty('--aura-3', rgba(t, 0.12));
    /* 让手机状态栏也跟上 */
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', toHex(mixRgb(c, { r: 255, g: 255, b: 255 }, 0.92)));
  }

  /* ================= 数据 ================= */
  function refresh() {
    return Promise.all([
      Store.listEvents(), Store.listCollections(), Store.getSettings(), Store.listTrash()
    ])
      .then(function (r) {
        S.events = r[0];
        S.byId = {};
        S.events.forEach(function (e) { S.byId[e.id] = e; });
        S.collections = r[1];
        S.settings = r[2];
        S.trash = r[3] || [];
        S.clusterCandidates = Text.clusterCandidates(S.events);

        /* 下面这一小段是「按 id 把缓存里的对象换成库里的新副本」。
           少了它就会出大事：刷新之后 S.byId 全是新对象，可
           正在整理的那条（S.editingEvent）还指着老副本，而界面上画的
           恰恰是 editingEvent —— 于是「刚写完上一条、再点下一条，
           上一条在屏幕上就变回空白」，看着像被删了，其实库里好好的。
           （用户 2026-10-04 报的两个 bug 都是这一个根因。） */
        if (S.openEvent) S.openEvent = S.byId[S.openEvent.id] || null;
        if (S.openCollection) {
          S.openCollection = S.collections.filter(function (c) { return c.id === S.openCollection.id; })[0] || null;
        }
        if (S.editingEvent) S.editingEvent = S.byId[S.editingEvent.id] || S.editingEvent;
      });
  }

  /* 屏幕上那几个「还没提交、也不写进库里」的输入框。
     render() 是把整块 HTML 重写一遍的 —— 框会被销毁重建，用户打到一半的字就跟着没了。
     这几个框在状态里没有对应字段（纯临时），所以只能在重画前后手动兜一下。
       tagInput    分类那步「＋ 其他」里现写的标签
       newColName  新建合集时起的名字
       thinkInput  回溯「现在我会…」写的想法
     「格子」和「自己改一遍」那两个是有状态字段的，走上面的 syncEditors()。 */
  var TRANSIENT_INPUTS = ['tagInput', 'newColName', 'thinkInput'];

  function keepTransient() {
    var snap = null;
    TRANSIENT_INPUTS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || !el.value) return;
      if (!snap) snap = {};
      snap[id] = el.value;
    });
    return snap;
  }

  function putTransient(snap) {
    if (!snap) return;
    Object.keys(snap).forEach(function (id) {
      var el = document.getElementById(id);
      /* 只在「重建出来的新框是空的」时补回去 ——
         万一哪次重画本来就是有意换掉内容的，别反手又盖回去。 */
      if (el && !el.value) el.value = snap[id];
    });
    syncReveal();
  }

  /* 「现在我会…」里一有字，「查看过去的自己」就该出来。
     这个按钮的显隐原来是靠 input 事件驱动的，而重画之后补值是程序写进去的、
     不会触发 input —— 所以补完要手动再对一次，不然用户写了字却按不到按钮。 */
  function syncReveal() {
    var el = document.getElementById('thinkInput');
    var b = document.getElementById('revealBtn');
    if (el && b) b.hidden = !String(el.value || '').trim();
  }

  /* ================= 顶栏 ================= */
  var TITLES = {
    home: '', editor: '写点东西', tidy: '整理',
    sediment: '沉淀', collection: '合集', event: '这条记录',
    trace: '轨迹', search: '搜索', settings: '设置', trash: '回收站'
  };

  function renderTopbar() {
    var bar = $('#topbar');
    var r = S.route;

    if (r === 'home') { bar.classList.remove('on'); bar.innerHTML = ''; return; }
    bar.classList.add('on');

    var html = '<div class="tb-row">';

    if (r === 'sediment' || r === 'collection') {
      html += '<h1 class="tb-title">' + TITLES[r] + '</h1>' +
        '<div class="tb-actions">' +
        '<button class="tb-btn" data-act="go" data-route="search" aria-label="搜索">' + Views.ICON.search + '</button>' +
        '</div>';
    } else if (r === 'trace') {
      html += '<h1 class="tb-title">轨迹</h1>' +
        '<div class="tb-actions">' +
        '<button class="tb-btn" data-act="go" data-route="settings" aria-label="设置">' + Views.ICON.gear + '</button>' +
        '</div>';
    } else {
      html += '<button class="tb-btn" data-act="back" aria-label="返回">' + Views.ICON.back + '</button>' +
        '<h1 class="tb-title" style="margin-left:2px">' + TITLES[r] + '</h1>';
    }

    bar.innerHTML = html + '</div>';
  }

  /* ================= 导航指示块 ================= */
  function updateNavPill() {
    if (!navPill) return;
    var bar = $('#tabbar');
    var tabs = $$('#tabbar .tab');
    var active = null;
    tabs.forEach(function (t) { if (t.classList.contains('on')) active = t; });
    if (!active) { navPill.style.opacity = '0'; return; }
    var br = bar.getBoundingClientRect();
    var tr = active.getBoundingClientRect();
    navPill.style.opacity = '1';
    navPill.style.width = Math.max(0, tr.width - 18) + 'px';
    navPill.style.transform = 'translateX(' + (tr.left - br.left + 9) + 'px)';
  }

  /* ================= 渲染 ================= */

  /* 重画之前，先把屏幕上输入框里现有的字收回状态里。
     浏览器只管 DOM：你打完字、焦点一离开，我们的状态对象还停在旧值上。
     只要这之后有一次 render()，用户刚打的字就会被旧值盖回去 ——
     看起来就是「我刚写的东西被删了」。这里在每次重画前对齐一遍：
     输入框里是什么，状态里就存什么。（只动用户自己手写的那些格子） */
  function syncEditors() {
    if (S.route !== 'tidy') return;

    /* 「自己改一遍」那个大输入框 */
    var ce = $('#cleanEdit');
    if (ce) S.tidy.edited = ce.value;

    $$('[data-act="edit-block"]').forEach(function (ta) {
      var id = ta.getAttribute('data-id');
      var key = ta.getAttribute('data-key');
      var obj = S.byId[id] || (S.editingEvent && S.editingEvent.id === id ? S.editingEvent : null);
      if (!obj || !obj.blocks) return;
      var val = String(ta.value || '').trim();
      var cur = obj.blocks[key];
      if (val === (cur ? String(cur.text || '') : '')) return;
      obj.blocks[key] = val ? { text: val, source: 'hand' } : null;
    });
  }

  /* 这次重画算不算「换了一屏」？
     算的：换页面、整理里换步骤、沉淀里换分段、回溯里解锁。
     不算的：点标签、换一句、展开输入框、就地二次确认 —— 这些只是原地刷新。

     为什么要分：render() 是整块重画 #stage 的，每画一次都会新建一个 .page，
     而 .page 上有淡入动画。不区分的话，点一下标签整屏就重新淡入一遍，
     视线被拽着走，很毛躁。（用户 2026-10-05 要「丝滑」，指的就是这个。）
     做法：把「换了就是新一屏」的几个状态拼成一个 key，跟上次比。 */
  var _screenKey = null;
  function screenKey() {
    var k = S.route;
    if (S.route === 'tidy') k += '·' + (S.tidy.step || 1);
    if (S.route === 'sediment' || S.route === 'collection') k += '·' + S.sedimentTab;
    if (S.route === 'event') k += '·' + (S.peeked ? 'peek' : 'lock');
    return k;
  }

  function render() {
    syncEditors();
    var kept = keepTransient();
    var html = '';
    switch (S.route) {
      case 'home': html = Views.home(S); break;
      case 'editor': html = Views.editor(S); break;
      case 'tidy': html = Views.tidy(S); break;
      case 'sediment': html = Views.sediment(S); break;
      case 'collection': html = S.openCollection ? Views.collection(S) : Views.sediment(S); break;
      case 'event':
        /* 记录不在库里时，只可能是它已经被删了，或者拿到的是旧界面上的 id。
           以前这里会悄悄渲染「轨迹」页，用户会以为点错了地方 —— 现在明确说清楚并退回沉淀页。 */
        if (S.openEvent) {
          preparePoem(S.openEvent);   /* 排好队，最合适的那一句放第一个 */
          html = Views.event(S);
        }
        else {
          S.route = 'sediment';
          html = Views.sediment(S);
          toast('这条记录找不到了');
        }
        break;
      case 'trace': html = Views.trace(S); break;
      case 'search': html = Views.search(S); break;
      case 'settings': html = Views.settings(S); break;
      case 'trash': html = Views.trash(S); break;
      default: html = Views.home(S);
    }
    /* 算这次要不要播「换了一屏」的动画（判断依据看上面 screenKey 的注释） */
    var key = screenKey();
    var fresh = key !== _screenKey;
    var prev = _screenKey;
    _screenKey = key;

    var cls = 'page';
    if (!fresh) {
      cls += ' still';          /* 原地刷新：不重播整屏动画 */
    } else if (prev && S.route === 'tidy' && prev.split('·')[0] === 'tidy') {
      /* 整理的下一步 / 上一步：滑入方向跟「前进、后退」对得上，别让人晕 */
      var a = Number(prev.split('·')[1] || 1);
      var b = Number(S.tidy.step || 1);
      cls += b >= a ? ' from-r' : ' from-l';
    }

    renderTopbar();
    stage.innerHTML = '<div class="' + cls + '">' + html + '</div>';

    $$('#tabbar .tab').forEach(function (b) {
      var r = b.getAttribute('data-route');
      var active =
        (r === 'home' && (S.route === 'home' || S.route === 'editor' || S.route === 'tidy')) ||
        (r === 'sediment' && (S.route === 'sediment' || S.route === 'collection')) ||
        (r === 'trace' && (S.route === 'trace' || S.route === 'event' ||
         S.route === 'settings' || S.route === 'trash'));
      b.classList.toggle('on', !!active);
    });
    updateNavPill();

    if (S.route === 'search') bindSearch();
    if (S.route === 'editor') {
      var ta = $('#rawInput');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); bindDraft(); }
    }
    if (S.route === 'settings') bindSettings();
    putTransient(kept);
  }

  /* 回到顶部。
     只有「换了一屏内容」才该这么做（换页面 / 换步骤 / 换分段）。
     在同一个页面里重画 —— 换一句、点标签、展开输入框、二次确认 —— 一律不动滚动条：
     用户刚翻到下面，一按就被弹回顶部，还得重新往下滑。
     （用户 2026-10-05 报的：「换一首」和「删除这条」点完页面会自己跳到最上面。） */
  function toTop() { window.scrollTo(0, 0); }

  function go(route) {
    S.route = route;
    if (route !== 'event') { S.peeked = false; S.confirmDelete = null; }
    if (route !== 'sediment') S.creatingCol = false;
    if (route !== 'collection') S.pickingFor = null;
    if (route !== 'trash') S.confirmEmptyTrash = false;
    render();
    toTop();
  }

  /* ================= 草稿 ================= */
  var DRAFT = 'gbm.draft';
  function bindDraft() {
    var ta = $('#rawInput');
    if (!ta) return;
    if (!S.editingEvent) {
      try { var d = localStorage.getItem(DRAFT); if (d && !ta.value) ta.value = d; } catch (e) {}
    }
    ta.addEventListener('input', function () {
      if (S.editingEvent) return;
      try { localStorage.setItem(DRAFT, ta.value); } catch (e) {}
    });
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT); } catch (e) {} }

  /* ================= 搜索 ================= */
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

  /* ================= 设置页 ================= */
  function bindSettings() {
    /* 设置页现在就一件事：主题色。别的一个都没有了。 */
    var cc = $('#customColor');
    if (cc) {
      cc.addEventListener('input', function () { applyTheme(cc.value); });
      cc.addEventListener('change', function () {
        S.settings.theme = cc.value;
        Store.putSettings(S.settings).then(function () {
          render();
          toast('主题已保存');
        });
      });
    }
  }

  /* ================= 整理流程 =================
     全程本机：不联网、不要 Key、不花一分钱、不上传一个字。
     清理只删口水词；拆开只从你的原话里划候选，点一下才采纳。 */
  function startTidy() {
    var ta = $('#rawInput');
    var text = ta ? ta.value.trim() : (S.editingEvent ? S.editingEvent.rawText : '');
    if (!text) { toast('先写点什么'); return; }

    var e = S.editingEvent || Store.newEvent(text);
    if (S.editingEvent) e.rawText = text;
    S.editingEvent = e;

    return Store.putEvent(e).then(refresh).then(function () {
      clearDraft();
      S.editingEvent = S.byId[e.id];
      S.tidy = { step: 1, recovered: [] };
      go('tidy');
      autoClean();
    }).catch(function (err) { toast('保存失败：' + (err && err.message || '')); });
  }

  function autoClean() {
    var e = S.editingEvent;
    if (!e) return;
    S.tidy.error = '';
    var res = LocalEngine.clean(e.rawText);
    S.tidy.fills = res.fills;
    S.tidy.diff = Text.buildDiff(e.rawText, res.fills, S.tidy.recovered || []);
    render();
  }

  function applyClean(accept) {
    var e = S.editingEvent;
    if (!accept) {
      e.cleanText = ''; e.cleanAccepted = false;
      return Store.putEvent(e).then(refresh).then(goStep2);
    }
    var kept = Text.keptText(S.tidy.diff);
    e.cleanText = kept;
    e.cleanAccepted = true;
    return Store.putEvent(e).then(refresh).then(function () { S.editingEvent = S.byId[e.id]; goStep2(); });
  }

  function goStep2() {
    S.tidy.step = 2;
    S.tidy.error = '';
    S.editingEvent = S.byId[S.editingEvent.id];
    S.tidy.unreliable = false;
    /* 这里以前会算一版「候选句」摆在上面（这可能是「下一次怎么做」…），
       用户 2026-10-04 说那块鸡肋，整块撤掉了 —— 格子里的字全部由你自己写，
       要参考原话就展开「对一下原文」。所以这一步不再需要算任何东西。 */
    render();
    toTop();
  }

  /* 分类：本机拿一张写死的对照表去撞你的原话，撞到哪个就把哪个标签摆出来。
     它不是替你想，只是把你可能想点的东西先挪到手边。点一下才算加上。 */
  function goStep3() {
    S.tidy.step = 3;
    S.editingEvent = S.byId[S.editingEvent.id];
    var e = S.editingEvent;
    var parts = [e.rawText || ''];
    Store.BLOCK_KEYS.forEach(function (k) {
      var b = e.blocks && e.blocks[k];
      if (b && b.text) parts.push(b.text);
    });
    S.tidy.suggestion = LocalEngine.suggestTags(parts.join('\n'));
    render();
    toTop();
  }

  function finishTidy(confirmTags) {
    var e = S.byId[S.editingEvent.id];
    e.tagState = confirmTags ? 'confirmed' : 'none';
    if (e.structState !== 'unreliably') e.structState = 'structured';
    Store.putEvent(e).then(function () {
      if (S.settings.autoAssociate !== false) {
        return Store.listEvents().then(function (all) {
          e.relations = Text.findRelations(e, all);
          return Store.putEvent(e);
        });
      }
    }).then(refresh).then(function () {
      S.openEvent = S.byId[e.id];
      S.editingEvent = null;
      S.tidy = {};
      go('event');
      toast('已保存');
    }).catch(function (err) { toast('保存失败：' + (err && err.message || '')); });
  }

  /* ================= 结尾那一句 =================
     全在本机：按你打的标签 + 你原话里的心情词，给库里每一句打分，从高到低排成一队。
     排在队里的每一句都是匹配你现在这件事的，所以「换一句」是顺着分数往下走，
     不是随便抓一句给你。同一条记录、同一句诗，位置永远固定，刷新不会乱跳。 */
  function preparePoem(evt) {
    if (!evt) { S.poemMatch = null; S.poemNow = null; return; }
    var m = Poem.match(evt);
    S.poemMatch = m;
    /* 你换过就接着换过的那句显示，否则从最合适的开始 */
    var at = evt.poem ? Poem.indexOfLine(m.items, evt.poem) : -1;
    S.poemIdx = at >= 0 ? at : 0;
    S.poemNow = m.items.length
      ? { line: m.items[S.poemIdx], confident: m.confident }
      : null;

    /* 词库还没挂上来（开机头几百毫秒会是这样，见 web/index.html 末尾的说明）：
       先空着不显示，等它到位再重画一次补上。
       如果你正好在打字，这一次就跳过 —— 不能为了补一句诗打断你写东西。 */
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
    /* 换过的那句记下来，下次打开还是它 */
    e.poem = { t: it.t, d: it.d, a: it.a, s: it.s };
    Store.putEvent(e).then(refresh).then(function () {
      S.openEvent = S.byId[e.id];
      render();
    });
  }

  /* ================= 去发布页看看 =================
     这里刻意**不发任何网络请求**。

     为什么：安卓壳里连「联网」权限都没申请（见 AndroidManifest.xml），所以 App
     自己根本查不了有没有新版本。改成「把发布页交给系统浏览器打开」——
     浏览器去联网，App 一个请求都不发，权限页里干干净净。

     壳那边已经有现成的接法：MainActivity 会把外链交给系统浏览器（handOff），
     网页这边只要 window.open 就行。 */
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
    /* 极少见的情况：浏览器把弹窗拦了。那就原地跳过去，效果一样。 */
    if (!w) global.location.href = url;
  }

  /* ================= 导出 / 导入 ================= */

  /* 装在 App 壳里吗？两个平台的接法不一样，这里统一成同一个形状，
     外面的代码就不用分平台了。
       安卓：壳用 @JavascriptInterface 直接挂 window.GBMShell
       iOS：壳是 WKScriptMessageHandler，只能走 webkit.messageHandlers 投递消息
     浏览器里两个都没有，返回 null，走原来的 <a download>。 */
  function shellOf() {
    var s = global.GBMShell;
    if (s && typeof s.saveZip === 'function') return s;

    var h = global.webkit && global.webkit.messageHandlers &&
            global.webkit.messageHandlers.gbmShell;
    if (h && typeof h.postMessage === 'function') {
      return {
        saveZip: function (b64, name) {
          h.postMessage({ op: 'saveZip', b64: b64, name: name });
        }
      };
    }
    return null;
  }

  /* Uint8Array → base64。壳那边只能收字符串，二进制得这么递过去。
     一次转 32 KB：String.fromCharCode.apply 参数一多就爆调用栈。 */
  function b64OfBytes(bytes) {
    var CH = 0x8000;
    var s = '';
    for (var i = 0; i < bytes.length; i += CH) {
      var end = Math.min(i + CH, bytes.length);
      var sub = bytes.subarray ? bytes.subarray(i, end) : Array.prototype.slice.call(bytes, i, end);
      s += String.fromCharCode.apply(null, sub);
    }
    return global.btoa(s);
  }

  /* 壳那边导出完（或者用户取消）会回头调这里。 */
  global.GBM_EXPORT_DONE = function (r) {
    var s = String(r || '');
    if (s === 'ok') {
      /* 存成功了才记下这次导出时间 —— 用来提醒「多久没备份了」 */
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

  function buildEventsMd(data) {
    var out = ['# 成长事件', '', '共 ' + data.events.length + ' 条', ''];
    data.events.forEach(function (e) {
      out.push('---', '', '## ' + e.createdAt.slice(0, 10));
      out.push('');
      out.push('**原始记录**', '', e.rawText || '（空）', '');
      var labels = Store.BLOCK_LABELS;
      Store.BLOCK_KEYS.forEach(function (k) {
        var b = e.blocks[k];
        out.push('**' + labels[k] + '**：' + (b && b.text ? b.text : '未记录'));
        out.push('');
      });
      var tags = [];
      ['domain', 'mechanism', 'scene'].forEach(function (g) {
        (e.tags[g] || []).forEach(function (t) { tags.push(t); });
      });
      if (tags.length) out.push('标签：' + tags.join('、'), '');
      if (e.outcome) {
        var om = { done: '这次做到了', again: '这次又犯了', unsure: '不确定' };
        out.push('实际结果：' + (om[e.outcome] || ''));
        out.push('');
      }
    });
    return out.join('\n');
  }

  function buildListMd(data, key, title) {
    var items = data.events.filter(function (e) { return e.blocks[key] && e.blocks[key].text; });
    var out = ['# ' + title, '', '共 ' + items.length + ' 条', ''];
    items.forEach(function (e) {
      out.push('- **' + e.createdAt.slice(0, 10) + '**：' + e.blocks[key].text);
    });
    return out.join('\n');
  }

  function aboutText(data) {
    return [
      '个人成长 Bug 管理器 — 数据备份',
      '',
      '导出时间：' + new Date().toLocaleString('zh-CN'),
      '成长事件：' + data.events.length + ' 条',
      '合集：' + data.collections.length + ' 个',
      '',
      '包含文件：',
      '  全部数据.json   完整数据，可在设置里「从备份恢复」导回来',
      '  成长事件.md     按时间排列，每条含原始记录与各字段',
      '  照见清单.md     所有「这件事让我看见了什么」',
      '  行持清单.md     所有「我得到什么、准备怎么做」',
      '',
      '注意：这里只有你自己的记录。这个版本不联网、不存任何密钥。',
      ''
    ].join('\n');
  }

  function doExport() {
    return Store.exportAll().then(function (data) {
      var ks = Store.BLOCK_KEYS;
      var out = JSON.parse(JSON.stringify(data));
      /* 老版本备份里可能残留 ai 字段，导出时统一抹掉（这个版本没有 AI） */
      if (out.settings) delete out.settings.ai;
      (out.events || []).forEach(function (e) { delete e.noAI; });

      var files = [
        { name: '全部数据.json', data: JSON.stringify(out, null, 2) },
        { name: '成长事件.md', data: buildEventsMd(data) },
        { name: '照见清单.md', data: buildListMd(data, 'zhaojian', '照见清单') },
        { name: '行持清单.md', data: buildListMd(data, 'xingchi', '行持清单') },
        { name: '关于.txt', data: aboutText(data) }
      ];
      var bytes = SimpleZip.zip(files);
      var fname = '成长Bug备份-' + stamp() + '.zip';

      var sh = shellOf();
      if (sh) {
        /* 装在 App 里：`<a download>` 那一套在 WebView 里是**不生效**的
           （blob: 链接不会触发下载，点了等于没点）。
           所以把字节交给壳，让壳去拉系统「保存到哪儿」的选择器。
           这条路同样一条权限都不用 —— 存哪儿是用户当场自己挑的。 */
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
      var method = u16(i + 8);
      var size = u32(i + 18);
      var nameLen = u16(i + 26);
      var extraLen = u16(i + 28);
      var nameStart = i + 30;
      var nameBytes = bytes.subarray(nameStart, nameStart + nameLen);
      var name = '';
      for (var k = 0; k < nameBytes.length; k++) name += String.fromCharCode(nameBytes[k]);
      try { name = decodeURIComponent(escape(name)); } catch (e) {}
      var dataStart = nameStart + nameLen + extraLen;
      var data = bytes.subarray(dataStart, dataStart + size);
      out.push({ name: name, method: method, data: data });
      i = dataStart + size;
    }
    return out;
  }

  function doImport() {
    /* 导入这边不分两条路 —— `<input type="file">` 在安卓壳里也能用，
       前提是壳那边把 onShowFileChooser 接住了（MainActivity 里有）。
       不接的话点下去什么都不弹，这也是它以前在 APK 里坏掉的原因。
       壳拿到结果 URI 之后是 WebView 自己去读的，用不着任何存储权限。 */
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
            var entries = unzip(new Uint8Array(buf));
            entries.forEach(function (en) {
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
          toast(res.added ? ('恢复了 ' + res.added + ' 条') : '备份里没有新内容');
          render();
        }).catch(function (err) {
          toast(err && err.message ? err.message : '导入失败');
        });
      };
      fr.readAsArrayBuffer(f);
    });
    inp.click();
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
        if (S.route === 'tidy' || S.route === 'editor') { S.editingEvent = null; S.tidy = {}; go('home'); }
        else if (S.route === 'event') go('trace');
        else if (S.route === 'collection') go('sediment');
        else if (S.route === 'trash') go('settings');
        else if (S.route === 'settings') go('trace');
        else go('home');
        break;
      case 'new-record': S.editingEvent = null; go('editor'); break;

      case 'save-raw': {
        var ta = $('#rawInput');
        var txt = ta ? ta.value.trim() : '';
        if (!txt) { toast('空的'); break; }
        var e2 = S.editingEvent || Store.newEvent(txt);
        if (S.editingEvent) e2.rawText = txt;
        Store.putEvent(e2).then(refresh).then(function () {
          clearDraft(); toast('已保存'); go('home');
        }).catch(function (err) { toast('保存失败：' + (err && err.message || '')); });
        break;
      }

      case 'start-tidy': startTidy(); break;
      case 'start-tidy-from': {
        S.editingEvent = S.byId[id] || null;
        if (!S.editingEvent) break;
        S.tidy = { step: 1, recovered: [] };
        go('tidy');
        autoClean();
        break;
      }

      case 'do-clean': autoClean(); break;
      case 'skip-clean': {
        var e3 = S.editingEvent;
        e3.cleanText = ''; e3.cleanAccepted = false;
        Store.putEvent(e3).then(refresh).then(function () { S.editingEvent = S.byId[e3.id]; goStep2(); });
        break;
      }
      case 'accept-clean-keep': {
        var e4 = S.editingEvent;
        e4.cleanText = ''; e4.cleanAccepted = false;
        Store.putEvent(e4).then(refresh).then(function () { S.editingEvent = S.byId[e4.id]; goStep2(); });
        break;
      }
      case 'toggle-drop': {
        var term = el.getAttribute('data-term');
        var rec = S.tidy.recovered || (S.tidy.recovered = []);
        var i2 = rec.indexOf(term);
        if (i2 >= 0) rec.splice(i2, 1); else rec.push(term);
        S.tidy.diff = Text.buildDiff(S.editingEvent.rawText, S.tidy.fills || [], rec);
        render();
        break;
      }
      case 'accept-clean': applyClean(true); break;
      case 'cancel-clean': applyClean(false); break;

      case 'accept-split': goStep3(); break;

      /* —— 清理那一步：自己动手改 —— */
      case 'start-edit-clean': {
        S.tidy.editing = true;
        S.tidy.edited = Text.keptText(S.tidy.diff);
        render();
        var box = $('#cleanEdit');
        if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
        break;
      }
      case 'cancel-edit-clean': S.tidy.editing = false; render(); break;
      case 'apply-clean-edited': {
        var eE = S.editingEvent;
        var box2e = $('#cleanEdit');
        var txt = box2e ? box2e.value.trim() : String(S.tidy.edited || '').trim();
        if (!txt) { toast('不能是空的'); break; }
        eE.cleanText = txt;
        eE.cleanAccepted = txt !== eE.rawText;
        S.tidy.editing = false;
        Store.putEvent(eE).then(refresh).then(function () {
          S.editingEvent = S.byId[eE.id];
          goStep2();
        }).catch(function (err) { toast('保存失败：' + (err && err.message || '')); });
        break;
      }
      case 'keep-as-raw': {
        var e5 = S.byId[S.editingEvent.id];
        e5.structState = 'unreliably';
        Store.putEvent(e5).then(refresh).then(function () { finishTidy(false); });
        break;
      }
      case 'manual-split': S.tidy.unreliable = false; render(); break;

      case 'fill-block': {
        var key = el.getAttribute('data-key');
        var e6 = S.byId[id] || S.editingEvent;
        if (!e6) break;
        e6.blocks[key] = { text: '', source: 'hand' };
        Store.putEvent(e6).then(refresh).then(function () {
          render();
          var box = document.querySelector('[data-act="edit-block"][data-key="' + key + '"]');
          if (box) box.focus();
        });
        break;
      }

      /* 分类标签：点一下选上，再点一下取消。位置固定，连点同一个地方不会跑到隔壁词上。 */
      case 'toggle-tag': {
        var gt = el.getAttribute('data-group'), vt = el.getAttribute('data-value');
        var e7 = S.byId[S.editingEvent.id] || S.editingEvent;
        var at = e7.tags[gt].indexOf(vt);
        if (at >= 0) e7.tags[gt].splice(at, 1); else e7.tags[gt].push(vt);
        Store.putEvent(e7).then(refresh).then(render);
        break;
      }
      /* 点「＋ 其他」→ 就地给出输入框（以前用系统弹窗，在手机上根本没反应） */
      case 'pick-tag': {
        S.tidy.addTagFor = el.getAttribute('data-group');
        render();
        var ti = $('#tagInput');
        if (ti) ti.focus();
        break;
      }
      case 'cancel-tag-custom': S.tidy.addTagFor = null; render(); break;
      case 'add-tag-custom': {
        var g3 = el.getAttribute('data-group');
        var box3 = $('#tagInput');
        var val = box3 ? box3.value.trim() : '';
        if (!val) { toast('先写一个'); if (box3) box3.focus(); break; }
        var e9 = S.byId[S.editingEvent.id] || S.editingEvent;
        if (e9.tags[g3].indexOf(val) < 0) e9.tags[g3].push(val);
        S.tidy.addTagFor = null;
        Store.putEvent(e9).then(refresh).then(render);
        break;
      }
      case 'confirm-tags': finishTidy(true); break;
      case 'skip-tags': finishTidy(false); break;
      case 'tidy-step': {
        var st = Number(el.getAttribute('data-step'));
        if (st === 1) { S.tidy.step = 1; render(); toTop(); }
        else if (st === 2) { if (S.tidy.diff || S.editingEvent.rawText) goStep2(); }
        else if (st === 3) goStep3();
        break;
      }

      /* 换分段＝换了一屏内容，回顶部（同一个列表里翻到一半的滚动位置留着没意义） */
      case 'sed-tab': S.sedimentTab = el.getAttribute('data-tab'); render(); toTop(); break;
      case 'open-event': S.openEvent = S.byId[id] || null; S.peeked = false; go('event'); break;
      case 'open-col': {
        S.openCollection = S.collections.filter(function (c) { return c.id === id; })[0] || null;
        go('collection');
        break;
      }
      case 'make-col': {
        var name = el.getAttribute('data-name');
        var cand = S.clusterCandidates.filter(function (c) { return c.name === name; })[0];
        var col = Store.newCollection(name);
        col.eventIds = cand ? cand.eventIds.slice() : [];
        col.accepted = true;
        Store.putCollection(col).then(refresh).then(function () {
          S.sedimentTab = 'col'; render(); toast('收好了，原记录都还在');
        });
        break;
      }
      case 'dissolve-col': {
        var col2 = S.collections.filter(function (c) { return c.id === id; })[0];
        if (!col2) break;
        Store.trashById(col2.id).then(refresh).then(function () {
          S.openCollection = null; go('sediment'); toast('合集已取消，记录没删');
        });
        break;
      }

      /* —— 自己新建合集 —— */
      case 'new-col': S.creatingCol = true; render(); break;
      case 'cancel-new-col': S.creatingCol = false; render(); break;
      case 'create-col': {
        var nameInput = $('#newColName');
        var cname = nameInput ? nameInput.value.trim() : '';
        if (!cname) { toast('先起个名字'); if (nameInput) nameInput.focus(); break; }
        var nc = Store.newCollection(cname);
        nc.accepted = true;
        nc.eventIds = [];
        Store.putCollection(nc).then(refresh).then(function () {
          S.creatingCol = false;
          S.openCollection = nc;
          S.pickingFor = nc.id;
          go('collection');
          toast('建好了，挑几条放进来');
        }).catch(function (err) { toast('建合集失败：' + (err && err.message || '')); });
        break;
      }
      case 'pick-for-col': S.pickingFor = id; render(); break;
      case 'done-pick': {
        S.pickingFor = null;
        render();
        toast('合集里现在有 ' + (S.openCollection ? S.openCollection.eventIds.length : 0) + ' 条');
        break;
      }
      case 'toggle-in-col': {
        var pc = S.collections.filter(function (c) { return c.id === S.openCollection.id; })[0];
        if (!pc) break;
        var at = pc.eventIds.indexOf(id);
        if (at >= 0) pc.eventIds.splice(at, 1); else pc.eventIds.push(id);
        pc.updatedAt = new Date().toISOString();
        Store.putCollection(pc).then(refresh).then(render);
        break;
      }
      case 'dismiss': toast('先放着'); break;

      case 'reveal-past': {
        var box2 = $('#thinkInput');
        var think = box2 ? box2.value.trim() : '';
        if (!think) { toast('先写一句你的想法'); if (box2) box2.focus(); break; }
        var ex = S.byId[id];
        if (!ex) break;
        ex.reflections = ex.reflections || [];
        ex.reflections.unshift({ at: new Date().toISOString(), thinking: think, revealed: true });
        Store.putEvent(ex).then(refresh).then(function () {
          S.openEvent = S.byId[id];
          render();
          var r = $('.reveal');
          try { if (r && r.scrollIntoView) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        });
        break;
      }
      case 'peek-past': {
        var ep = S.byId[id];
        if (!ep) break;
        S.openEvent = ep;
        S.peeked = true;
        render();
        var rv = $('.reveal');
        try { if (rv && rv.scrollIntoView) rv.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        break;
      }
      case 'outcome': {
        var eo = S.byId[S.openEvent.id];
        eo.outcome = el.getAttribute('data-v');
        Store.putEvent(eo).then(refresh).then(render);
        break;
      }
      case 'delete-event': S.confirmDelete = id; render(); break;
      case 'cancel-delete': S.confirmDelete = null; render(); break;
      case 'do-delete': {
        var ev10 = S.byId[id];
        S.confirmDelete = null;
        if (!ev10) { render(); break; }
        Store.trashById(id).then(refresh).then(function () {
          S.openEvent = null;
          go('sediment');
          /* 之前这里只说「在回收站里」，可界面上根本没有回收站 —— 现在有了，说清在哪 */
          toast('已删除，在「设置 → 回收站」里能还原');
        });
        break;
      }

      /* —— 回收站 —— */
      case 'restore-trash': {
        Store.restoreTrash(id).then(refresh).then(function (ok) {
          render();
          toast(ok ? '还原好了' : '这条找不到了');
        });
        break;
      }
      case 'empty-trash': S.confirmEmptyTrash = true; render(); break;
      case 'cancel-empty-trash': S.confirmEmptyTrash = false; render(); break;
      case 'do-empty-trash': {
        Store.emptyTrash().then(refresh).then(function (n) {
          S.confirmEmptyTrash = false;
          render();
          toast(n ? ('清空了 ' + n + ' 条') : '回收站本来就是空的');
        });
        break;
      }

      /* —— 设置 —— */
      case 'set-theme': {
        var c = el.getAttribute('data-color');
        applyTheme(c);
        S.settings.theme = c;
        Store.putSettings(S.settings).then(function () { render(); });
        break;
      }
      /* —— 诗词 —— */
      case 'shuffle-poem': shufflePoem(); break;

      /* —— 关于 —— */
      case 'check-update': openReleases(); break;
      case 'open-url': {
        var u = el.getAttribute('data-url');
        if (u && /^https:\/\//.test(u)) global.open(u, '_blank', 'noopener');
        break;
      }

      case 'export': doExport(); break;
      case 'import': doImport(); break;
    }
  }

  function onBlur(ev) {
    var el = ev.target;
    if (!el.getAttribute) return;
    if (el.getAttribute('data-act') !== 'edit-block') return;
    var id = el.getAttribute('data-id'), key = el.getAttribute('data-key');
    var obj = S.byId[id] || (S.editingEvent && S.editingEvent.id === id ? S.editingEvent : null);
    if (!obj) return;
    var val = el.value.trim();
    obj.blocks[key] = val ? { text: val, source: 'hand' } : null;
    Store.putEvent(obj).then(refresh);
  }

  /* ================= 启动 ================= */
  var booted = false;
  function boot() {
    if (booted) return;          /* 防止脚本被重复执行时注册两遍点击，导致一次点击跑两趟 */
    booted = true;
    stage = $('#stage');
    topbar = $('#topbar');
    toastEl = $('#toast');
    navPill = $('#navPill');

    document.addEventListener('click', onClick);
    document.addEventListener('focusout', onBlur);
    global.addEventListener('resize', updateNavPill);

    /* 输入框里按回车就等于点那个按钮 */
    document.addEventListener('keydown', function (ev) {
      var el = ev.target;
      if (!el || ev.key !== 'Enter') return;
      var pair = { tagInput: 'add-tag-custom', newColName: 'create-col' }[el.id];
      if (!pair) return;
      ev.preventDefault();
      var b = document.querySelector('[data-act="' + pair + '"]');
      if (b) b.click();
    });

    /* 回溯：写了字才把「查看过去的自己」给他 */
    document.addEventListener('input', function (ev) {
      var el = ev.target;
      if (!el || el.id !== 'thinkInput') return;
      syncReveal();
    });

    $('#tabbar').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (b) go(b.getAttribute('data-route'));
    });

    refresh().then(function () {
      applyTheme(S.settings.theme || '#6E6BFE');
      render();
      setTimeout(updateNavPill, 60);
      /* 首屏先出来，再去后台把 920 KB 的诗词库挂上（它不改首屏任何东西，
         真正用到是「写完一条配一句诗」那一步，那时候早挂好了）。 */
      Poem.load();
      /* 离线缓存只给「用浏览器打开」这种情况用。
         装进安卓 App 壳里时文件本来就打包在 APK 里、本来就离线可用，
         再套一层 Service Worker 只会让缓存跨版本留着，
         出现「装了新版却还是旧页面」。壳会给 UA 打 GBMShell 标记。 */
      var inShell = /GBMShell/.test(navigator.userAgent || '');
      if (!inShell && 'serviceWorker' in navigator &&
          location.protocol.indexOf('http') === 0) {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      }
    }).catch(function (err) {
      stage.innerHTML = '<div class="empty">本地存储没起来：' + Views.esc(err.message) + '</div>';
    });
  }

  /* 安卓壳的返回键会调这里：
     能自己消化就返回 true（先收弹窗 → 再退回上一层 → 最后回首页）；
     已经在首页了返回 false，交给系统退出 App。 */
  global.GBM_BACK = function () {
    if (S.confirmDelete) { S.confirmDelete = null; render(); return true; }
    if (S.confirmEmptyTrash) { S.confirmEmptyTrash = false; render(); return true; }
    if (S.creatingCol || S.pickingFor) {
      S.creatingCol = false; S.pickingFor = null; render(); return true;
    }
    if (S.route === 'tidy') { go(S.openEvent ? 'event' : 'home'); return true; }
    if (S.route === 'event' || S.route === 'collection') { go('home'); return true; }
    if (S.route !== 'home') {
      /* 编辑器里有草稿会自动存着，直接退回首页不会丢字 */
      go('home'); return true;
    }
    return false;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
