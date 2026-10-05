/* 视图层 —— 只负责把状态拼成 HTML，交互一律交给 app.js 用 data-act 委托。
   文案纪律：只写必要的功能说明，不写说教句、不写格言、不写「你该…」。 */
(function (global) {
  'use strict';

  var ICON = {
    search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
      '<circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
      '<g fill="currentColor" stroke="none">' +
      '<rect x="10.7" y="1.4" width="2.6" height="3.4" rx="1"/>' +
      '<rect x="10.7" y="19.2" width="2.6" height="3.4" rx="1"/>' +
      '<rect x="1.4" y="10.7" width="3.4" height="2.6" rx="1"/>' +
      '<rect x="19.2" y="10.7" width="3.4" height="2.6" rx="1"/>' +
      '<rect x="10.7" y="1.4" width="2.6" height="3.4" rx="1" transform="rotate(45 12 12)"/>' +
      '<rect x="10.7" y="19.2" width="2.6" height="3.4" rx="1" transform="rotate(45 12 12)"/>' +
      '<rect x="1.4" y="10.7" width="3.4" height="2.6" rx="1" transform="rotate(45 12 12)"/>' +
      '<rect x="19.2" y="10.7" width="3.4" height="2.6" rx="1" transform="rotate(45 12 12)"/>' +
      '</g></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M14.5 5 7.5 12l7 7"/></svg>',
    pen: '<svg class="pen" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14.5 5.5 18 2l4 4-3.5 3.5"/></svg>',
    plus: '<svg class="pen" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 8.4v7.2"/><path d="M8.4 12h7.2"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function dateNum(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function fullTime(iso) {
    var d = new Date(iso);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return dateNum(iso) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function dayShort(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }
  function firstLine(s, n) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > (n || 60) ? t.slice(0, n || 60) + '…' : t;
  }

  var Views = { esc: esc, dateNum: dateNum, dayShort: dayShort, fullTime: fullTime, ICON: ICON };


  function emptyBox(text, sub) {
    return '<div class="empty">' + esc(text) +
      (sub ? '<div class="tiny dim" style="margin-top:6px">' + esc(sub) + '</div>' : '') + '</div>';
  }

  /* ============ 首页 ============
     就一个入口。别的什么都不放 —— 不放日期、不放最近记录、不放一句说明。 */
  Views.home = function (ctx) {
    return '<div class="home">' +
      '<button class="record-btn" data-act="new-record">' +
        ICON.plus + '<span>今日记录</span>' +
      '</button>' +
      '</div>';
  };

  /* ============ 今日记录 ============
     两个框，上下等大、对称、居中。
     「事件」「收获」这四个字就是框正中间的那行灰字，点进去才开始写。
     框里框外一个多余的字都没有。 */
  Views.editor = function (ctx) {
    /* 一个框 = 外层 .simple-box（框这张皮） + 里头两样东西：
       .simple-ph 是「事件」「收获」那两个字，flex 一横一竖都居中；
       textarea 是真正打字的地方，透明底盖在字上面。
       提示字必须是真元素 —— textarea 是替换元素，它自己的 ::before 不渲染，
       上一版把它写在伪元素上，字直接消失了。 */
    function box(id, key, label) {
      var val = ctx.form[key] || '';
      return '<div class="simple-box' + (val ? ' has' : '') + '">' +
        '<span class="simple-ph" aria-hidden="true">' + esc(label) + '</span>' +
        '<textarea id="' + id + '" data-act="edit-field" data-key="' + key + '" ' +
          'aria-label="' + esc(label) + '">' + esc(val) + '</textarea>' +
        '</div>';
    }
    return '<div class="simple-editor">' +
      box('inShijian', 'shijian', '事件') +
      box('inShouhuo', 'shouhuo', '收获') +

      '<div class="editor-foot simple-foot">' +
        '<div class="btn-row">' +
          '<button class="btn primary" data-act="save">保存</button>' +
          '<button class="btn ghost simple-cancel" data-act="cancel">取消</button>' +
        '</div>' +
        '<div class="center">' +
          '<button class="link-btn tiny dim" data-act="save-draft">保存到草稿箱</button>' +
        '</div>' +
      '</div>' +
      '</div>';
  };

  /* ============ 草稿箱 ============ */
  Views.drafts = function (ctx) {
    var list = ctx.drafts || [];
    var max = Store.DRAFT_MAX;
    if (!list.length) {
      return emptyBox('草稿箱是空的', '写到一半点「保存到草稿箱」，最多存 ' + max + ' 条');
    }
    var out = '<div class="hint" style="margin:2px 0 12px">' +
      '最多 ' + max + ' 条，现在是 ' + list.length + ' 条。存第 ' + (max + 1) + ' 条时，最老那条会让位。</div>';

    out += list.map(function (d) {
      var a = firstLine(d.shijian, 46) || '（没写事件）';
      var b = firstLine(d.shouhuo, 46);
      return '<div class="card mb" style="margin-bottom:12px">' +
        '<div class="entry-day">' + esc(fullTime(d.savedAt)) + '</div>' +
        '<div class="entry-line">' + esc(a) + '</div>' +
        (b ? '<div class="tiny dim" style="margin-top:4px">' + esc(b) + '</div>' : '') +
        '<div class="btn-row mt-s">' +
          '<button class="btn btn-sm primary" data-act="use-draft" data-id="' + d.id + '">接着写</button>' +
          '<button class="btn btn-sm ghost" data-act="del-draft" data-id="' + d.id + '">删掉</button>' +
        '</div>' +
        '</div>';
    }).join('');

    return out;
  };

  /* ============ 沉淀：事件区 / 收获区 ============ */
  Views.sediment = function (ctx) {
    var tab = ctx.sedimentTab || 'shijian';
    var tabs = [['shijian', '事件'], ['shouhuo', '收获']];
    var idx = 0;
    tabs.forEach(function (t, i) { if (t[0] === tab) idx = i; });

    var out = '<div class="seg">' +
      '<span class="seg-thumb" style="width:calc(50% - 4px);transform:translateX(calc(' + idx +
        ' * (100% + 4px)))"></span>' +
      tabs.map(function (t) {
        return '<button class="' + (t[0] === tab ? 'on' : '') + '" data-act="sed-tab" data-tab="' +
          t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>';

    var items = ctx.events.filter(function (e) { return String(e[tab] || '').trim(); });
    if (!items.length) {
      return out + emptyBox(tab === 'shijian' ? '还没记过事件' : '还没写过收获');
    }

    return out + items.map(function (e) {
      return '<button class="entry" data-act="open-event" data-id="' + e.id + '">' +
        '<div class="entry-day">' + esc(dayShort(e.createdAt)) + '</div>' +
        '<div class="entry-line">' + esc(firstLine(e[tab], 80)) + '</div>' +
        '</button>';
    }).join('');
  };

  /* ============ 轨迹：只剩一条时间线 ============
     顶卡、往年今日都删了 —— 一页从上到下就是一条按时间排下来的线，
     点进去才分两段。简洁、清晰、明了。 */
  Views.trace = function (ctx) {
    var evts = ctx.events;
    if (!evts.length) return emptyBox('还没有轨迹', '在首页写第一条吧');

    var out = '<div class="sec" style="margin-top:4px"><h2>时间线</h2></div>';
    var lastMonth = '';
    out += evts.map(function (e) {
      var m = e.createdAt.slice(0, 7);
      var head = '';
      if (m !== lastMonth) {
        lastMonth = m;
        head = '<div class="mono-date" style="padding:12px 0 8px">' +
          esc(e.createdAt.slice(0, 4) + ' 年 ' + Number(e.createdAt.slice(5, 7)) + ' 月') + '</div>';
      }
      var line = e.shijian || e.shouhuo;
      return head + '<div class="tl-item">' +
        '<div class="mono-date">' + esc(dayShort(e.createdAt)) + '</div>' +
        '<button class="entry" data-act="open-event" data-id="' + e.id + '" style="margin-top:6px">' +
        '<div class="entry-line">' + esc(firstLine(line, 90)) + '</div>' +
        (e.shijian && e.shouhuo
          ? '<div class="tiny dim" style="margin-top:4px">' + esc(firstLine(e.shouhuo, 46)) + '</div>'
          : '') +
        '</button>' +
        '</div>';
    }).join('');

    return out;
  };

  /* ============ 单条记录：分两段 ============ */
  Views.event = function (ctx) {
    var e = ctx.openEvent;
    var out = '<div class="tiny dim">' + esc(fullTime(e.createdAt)) + '</div>';

    out += '<div class="mt">' +
      segBlock('事件', 'shijian', e.shijian, e.id, '发生了什么？') +
      segBlock('收获', 'shouhuo', e.shouhuo, e.id, '未来会怎么做') +
      '</div>';

    /* 写完、想完，最后给它一句诗。 */
    out += poemCard(ctx);

    if (ctx.confirmDelete === e.id) {
      out += '<div class="confirm-bar">' +
        '删掉这条？会进回收站，之后还能恢复。' +
        '<div class="btn-row mt-s">' +
          '<button class="btn btn-sm primary" data-act="do-delete" data-id="' + e.id + '">删除</button>' +
          '<button class="btn btn-sm ghost" data-act="cancel-delete">取消</button>' +
        '</div></div>';
    } else {
      out += '<div class="mt center">' +
        '<button class="link-btn" data-act="delete-event" data-id="' + e.id + '">删除这条</button>' +
        '</div>';
    }
    return out;
  };

  /* 一段。没写就是「未记录」，点一下变成输入框 —— 不催、不标红、不挂按钮。 */
  function segBlock(label, key, text, evtId, hint) {
    var has = String(text || '').trim() !== '';
    var data = ' data-id="' + evtId + '" data-key="' + key + '"';
    var body = has
      ? '<textarea data-act="edit-field"' + data + ' rows="3" placeholder="' + esc(hint) +
        '" aria-label="' + esc(label) + '">' + esc(text) + '</textarea>'
      : '<button type="button" class="block-blank" data-act="fill-field"' + data + '>' +
        esc(hint) + '</button>';

    return '<div class="block">' +
      '<div class="block-head"><span class="block-label">' + esc(label) + '</span></div>' +
      '<div class="block-body' + (has ? '' : ' nil') + '">' + body + '</div>' +
      '</div>';
  }

  function poemCard(ctx) {
    var cur = ctx.poemNow;
    if (!cur || !cur.line) return '';
    var l = cur.line;
    var meta = (l.d ? l.d + ' · ' : '') + l.a + ' 《' + l.s + '》';
    return '<div class="card poem-card mt">' +
      '<div class="poem-line">' + esc(l.t) + '</div>' +
      '<div class="poem-meta">' + esc(meta) + '</div>' +
      '<div class="poem-foot"><span></span>' +
      '<button class="link-btn" data-act="shuffle-poem">换一句</button>' +
      '</div></div>';
  }

  /* ============ 搜索 ============ */
  Views.search = function (ctx) {
    var q = ctx.query || '';
    return '<input class="inp" id="searchInput" placeholder="搜事件、收获…" value="' + esc(q) + '">' +
      '<div class="mt" id="searchResults">' + (q ? Views.searchResults(ctx) : '') + '</div>';
  };
  Views.searchResults = function (ctx) {
    if (!ctx.results.length) return emptyBox('没找到', '换个词试试');
    return ctx.results.map(function (e) {
      return '<button class="entry" data-act="open-event" data-id="' + e.id + '">' +
        '<div class="entry-day">' + esc(dayShort(e.createdAt)) + '</div>' +
        '<div class="entry-line">' + esc(firstLine(e.shijian || e.shouhuo, 60)) + '</div>' +
        '</button>';
    }).join('');
  };

  /* ============ 设置 ============ */

  /* 色板：六列铺满，正好两行十二格 —— 十一颗常见色 + 右下角那颗自定义彩色轮盘。
     浅色 / 深色不在这儿切，走下面「模式」那一排。 */
  /* 「#6E6BFE」→ {r,g,b}。解析不了就返回 null，调用方自己兜底。 */
  function rgbOf(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /* 自绘取色面板：手机上系统取色器没法精确输入 RGB / 十六进制色号，
     所以这颗彩色轮盘点开的是自己画的面板 —— 三个滑杆 + 一个 HEX 输入框，
     拖一下、输一个色号都行，改了立即生效，落库是防抖的（见 app.js）。 */
  function pickerPanel(theme) {
    var c = rgbOf(theme) || { r: 110, g: 107, b: 254 };
    var sl = function (k, label, v, trk) {
      return '<label class="picker-sl">' +
        '<span class="picker-k">' + label + '</span>' +
        '<input type="range" min="0" max="255" step="1" value="' + v + '" data-rgb="' + k + '"' +
        ' style="--trk:' + trk + '" aria-label="' + label + ' 通道">' +
        '<span class="picker-v">' + v + '</span></label>';
    };
    return '<div class="picker" id="pickerPanel">' +
      '<div class="picker-top">' +
        '<span class="picker-eye" id="pickerEye" style="background:' + esc(theme) + '"></span>' +
        '<input type="text" class="picker-hex" id="hexInput" value="' + esc(String(theme).toUpperCase()) +
        '" maxlength="7" spellcheck="false" autocomplete="off" aria-label="十六进制颜色值">' +
        '<button class="picker-done" data-act="toggle-picker">完成</button>' +
      '</div>' +
      sl('r', 'R', c.r, 'linear-gradient(90deg,#000,#f00)') +
      sl('g', 'G', c.g, 'linear-gradient(90deg,#000,#0f0)') +
      sl('b', 'B', c.b, 'linear-gradient(90deg,#000,#00f)') +
      '</div>';
  }

  function swatchGrid(theme, pickerOpen) {
    var hex = String(theme).toLowerCase();
    var isPreset = Store.THEME_PRESETS.some(function (c) { return c.toLowerCase() === hex; });
    var cells = Store.THEME_PRESETS.map(function (c) {
      return '<button class="swatch' + (c.toLowerCase() === hex ? ' on' : '') +
        '" data-act="set-theme" data-color="' + esc(c) + '" style="background:' + esc(c) +
        '" aria-label="' + esc(c) + '"></button>';
    }).join('');
    /* 最后一格：彩色轮盘按钮，点开/收起下面的自绘取色面板。 */
    cells += '<button class="swatch custom' + (isPreset ? '' : ' on') +
      '" data-act="toggle-picker" aria-label="自定义颜色"></button>';
    return '<div class="swatches">' + cells + '</div>' +
      (pickerOpen ? pickerPanel(theme) : '');
  }

  /* 模式开关：浅色 / 深色 / 跟随系统。 */
  function modeRow(pref) {
    var items = [['light', '浅色'], ['dark', '深色'], ['auto', '跟随系统']];
    return '<div class="modes">' + items.map(function (it) {
      return '<button class="mode-btn' + (it[0] === pref ? ' on' : '') +
        '" data-act="set-mode" data-mode="' + it[0] + '">' + it[1] + '</button>';
    }).join('') + '</div>';
  }

  Views.settings = function (ctx) {
    var s = ctx.settings;
    var theme = s.theme || '#6E6BFE';
    var mode = ctx.mode || 'light';   /* 已经解出来的实际模式（跟随系统时是解出来的那个） */

    var themeCard = '<div class="card">' +
      '<div class="block-label">主题颜色</div>' +
      '<div style="display:flex;align-items:center;gap:14px;margin:14px 0 4px">' +
        '<div id="themeEye" style="width:52px;height:52px;border-radius:16px;background:' + esc(theme) +
          ';box-shadow:0 8px 20px -10px ' + esc(theme) + '"></div>' +
        '<div><div style="font-size:14.5px">当前主题</div>' +
        '<div class="tiny dim" id="themeHexTxt">' + esc(theme.toUpperCase()) + '</div></div>' +
      '</div>' +
      swatchGrid(theme, ctx.pickerOpen === true) +
      '<div class="row-between mt">' +
        '<span class="tiny dim">模式</span>' +
        modeRow(s.mode || 'light') +
      '</div></div>';

    /* 「检查更新」不发任何网络请求：App 连联网权限都不要，
       改成把发布页交给系统浏览器打开。 */
    var app = Store.APP || {};
    var aboutCard = '<div class="card mt">' +
      '<div class="block-label">关于</div>' +
      '<div class="about-row"><span>版本</span><b>V' + esc(app.version || '') + '</b></div>' +
      '<div class="about-row"><span>制作</span><b>' + esc(app.maker || '') + '</b></div>' +
      '<button class="btn btn-sm mt-s" data-act="check-update" style="width:100%">去发布页看看</button>' +
      '<div id="updateBox"></div>' +
      '</div>';

    var dataCard = '<div class="card mt">' +
      '<div class="block-label">数据</div>' +
      '<div class="four-row">' +
        '<button class="btn btn-sm" data-act="export">导出</button>' +
        '<button class="btn btn-sm" data-act="import">恢复</button>' +
        '<button class="btn btn-sm" data-act="go" data-route="drafts">草稿箱</button>' +
        '<button class="btn btn-sm" data-act="go" data-route="trash">回收站</button>' +
      '</div>' +
      '</div>';

    return themeCard + dataCard + aboutCard +
      '<div class="hint center" style="margin:18px 0 6px">' +
      ctx.events.length + ' 条记录 · ' +
      (Store.usingFallback() ? '本地降级存储' : '本地数据库') +
      '</div>';
  };

  /* ============ 回收站 ============ */
  Views.trash = function (ctx) {
    var trash = ctx.trash || [];
    if (!trash.length) {
      return emptyBox('回收站是空的', '删掉的记录会先放到这儿，随时能还原');
    }
    var out = '<div class="card"><div class="trash-list">' + trash.map(function (r) {
      var d = r.data || {};
      var label = d.shijian || d.shouhuo || d.rawText || '（没有内容）';
      return '<div class="trash-row">' +
        '<div class="trash-info">' +
          '<div class="trash-line">' + esc(firstLine(label, 42)) + '</div>' +
          '<div class="tiny dim">' + esc(dayShort(r.deletedAt)) + ' 删的</div>' +
        '</div>' +
        '<button class="btn btn-sm" data-act="restore-trash" data-id="' + esc(r.id) + '">还原</button>' +
        '</div>';
    }).join('') + '</div></div>';

    out += '<div class="hint" style="margin:12px 0">一共 ' + trash.length +
      ' 条。还原了就回到原来的位置。</div>';

    out += ctx.confirmEmptyTrash
      ? '<div class="confirm-bar">清空回收站？这些就真的没了，不能还原。' +
        '<div class="btn-row mt-s">' +
        '<button class="btn btn-sm primary" data-act="do-empty-trash">清空</button>' +
        '<button class="btn btn-sm ghost" data-act="cancel-empty-trash">取消</button>' +
        '</div></div>'
      : '<button class="btn btn-sm ghost" data-act="empty-trash" style="width:100%">清空回收站</button>';

    return out;
  };

  global.Views = Views;
})(window);
