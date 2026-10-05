/* 视图层 —— 返回 HTML 字符串，交互由 app.js 统一委托 data-act 处理。
   文案纪律：只留必要的功能说明，不写说教句、不写格言。 */
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
    plus: '<svg class="pen" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 8.4v7.2"/><path d="M8.4 12h7.2"/></svg>',
    lock: '<svg class="lock" viewBox="0 0 24 24"><rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.6"/>' +
      '<path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6"/><circle cx="12" cy="15.6" r="1.1"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.6 9.8 17 19 7.6"/></svg>',
    cross: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/></svg>',
    dunno: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/>' +
      '<path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.6"/><circle cx="12" cy="16.6" r="1"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 20h14"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M12 20V9"/><path d="M7.5 13.5 12 9l4.5 4.5"/><path d="M5 4h14"/></svg>',
    palette: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="9.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="14.5" r="1.1" fill="currentColor" stroke="none"/></svg>',
    db: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* 日期一律阿拉伯数字：2026年10月4日 */
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

  /* 该不该提醒备份。
     记录只在这台设备上，浏览器清数据、卸载重装、换手机都会带走它。
     但也只在设置页这一处说一句 —— 不弹窗、不加红点、不催命：
     这个 App 的原则是不给人添压力，提醒到位就够了。 */
  function backupHint(last) {
    if (!last) return '还没导出过。';
    var days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    if (days >= 30) return '上次导出是 ' + esc(dayShort(last)) + '，快一个月了，存一份吧。';
    if (days >= 10) return '上次导出 ' + esc(dayShort(last)) + '，隔几天存一份更稳妥。';
    return '上次导出 ' + esc(dayShort(last)) + '。';
  }
  function mdOf(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + '-' + d.getDate();
  }
  function firstLine(s, n) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > (n || 60) ? t.slice(0, n || 60) + '…' : t;
  }
  function timeAgo(iso) {
    var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d < 1) return '今天';
    if (d < 30) return d + ' 天前';
    if (d < 365) return Math.floor(d / 30) + ' 个月前';
    return Math.floor(d / 365) + ' 年前';
  }

  var Views = { esc: esc, dateNum: dateNum, dayShort: dayShort, fullTime: fullTime, ICON: ICON };

  function emptyBox(text, sub) {
    return '<div class="empty">' + esc(text) +
      (sub ? '<div class="tiny dim" style="margin-top:6px">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function flagsOf(e) {
    var out = [];
    (e.tags.mechanism || []).forEach(function (t) { out.push('<span class="flag">' + esc(t) + '</span>'); });
    if (e.tagState === 'suggested') out.push('<span class="flag warn">待确认</span>');
    if (e.structState === 'raw') out.push('<span class="flag grey">未整理</span>');
    return out.length ? '<div class="entry-flags">' + out.join('') + '</div>' : '';
  }

  /* 拆开的格子。标题只两个字（缘起 / 照见 / 行持），长的那句是灰字提示，
     写在框里当 placeholder —— 用户 2026-10-05 的要求。

     block 为 null 表示「还没记录」：这时框里就是那行灰字提示，
     整块都可以点，点一下直接变成输入框。
     以前这里挂着一个「自己写这一项」按钮 —— 那是接入 AI 时留下的：
     原来这一步由 AI 拆，用户只能点按钮补一格。现在 AI 整个砍掉了，
     按钮也就没有存在的理由，用户说直接删掉、点「未记录」那块自己写。 */
  function blockRow(label, block, key, evtId) {
    var exists = !!block;
    var text = exists ? String(block.text || '') : '';
    var hint = (Store.BLOCK_HINTS && Store.BLOCK_HINTS[key]) || '';
    var srcTag = '';
    if (exists && text) {
      if (block.source === 'hand') srcTag = '<span class="src-mark local">我写的</span>';
      else if (block.source === 'user') srcTag = '<span class="src-mark pick">你的原话</span>';
      else srcTag = '<span class="src-mark">原文</span>';
    }
    var data = ' data-id="' + evtId + '" data-key="' + key + '"';
    var body;
    if (exists) {
      body = '<textarea data-act="edit-block"' + data +
        '" rows="2" placeholder="' + esc(hint) + '" aria-label="' + esc(label) + '">' +
        esc(text) + '</textarea>';
    } else {
      /* 没记录：整块可点。灰字就是提示本身，不再多一行说明。 */
      body = '<button type="button" class="block-blank" data-act="fill-block"' + data + '>' +
        esc(hint) + '</button>';
    }
    return '' +
      '<div class="block">' +
        '<div class="block-head"><span class="block-label">' + esc(label) + '</span>' + srcTag + '</div>' +
        '<div class="block-body' + (exists ? '' : ' nil') + '">' + body + '</div>' +
      '</div>';
  }

  /* ============ 首页 ============
     只有一件事：记今天。不放日期、不放最近记录、不放任何解释文字。
     写完之后要看，去「沉淀」和「轨迹」。 */
  Views.home = function (ctx) {
    return '<div class="home">' +
      '<button class="record-btn" data-act="new-record">' +
        ICON.plus + '<span>今日记录</span>' +
      '</button>' +
      '</div>';
  };

  /* ============ 编辑器 ============ */
  Views.editor = function (ctx) {
    var e = ctx.editingEvent;
    return '' +
      '<textarea class="editor-area" id="rawInput" placeholder="想到什么就写什么。一句话也行。">' +
        esc(e ? e.rawText : '') +
      '</textarea>' +
      '<div class="editor-foot">' +
        '<button class="btn primary" data-act="save-raw">保存</button>' +
        '<button class="btn" data-act="start-tidy">整理</button>' +
      '</div>';
  };

/* 整理每一步底部的操作区：次要操作在上面一行，主要操作独占下面一行。
   顺序是按「手指」排的 —— 主按钮放最下面，离拇指最近、又占满整宽，最好按。
   次要按钮在上面一行靠右（单手拿手机时拇指落在右下角，摆左边够不到）。 */
function tidyFoot(primary, secondaries) {
  return '<div class="tidy-foot">' +
    (secondaries ? '<div class="btn-row">' + secondaries + '</div>' : '') +
    primary +
    '</div>';
}

  /* ============ 整理 ============ */
  Views.tidy = function (ctx) {
    var t = ctx.tidy || {};
    var e = ctx.editingEvent;
    var step = t.step || 1;
    var out = '<div class="seg">' +
      '<span class="seg-thumb" style="width:calc(33.33% - 6px);transform:translateX(calc(' + (step - 1) + ' * (100% + 4px)))"></span>' +
      '<button class="' + (step >= 1 ? 'on' : '') + '" data-act="tidy-step" data-step="1">清理</button>' +
      '<button class="' + (step >= 2 ? 'on' : '') + '" data-act="tidy-step" data-step="2">拆开</button>' +
      '<button class="' + (step >= 3 ? 'on' : '') + '" data-act="tidy-step" data-step="3">分类</button>' +
      '</div>';

    if (t.error) out += '<div class="notice warn">' + esc(t.error) + '</div>';

    /* ---- 第一步：清理 ---- */
    if (step === 1) {
      var drops = (t.diff || []).filter(function (p) { return p.type === 'drop'; });
      /* 「清理后的文本」＝ 除了建议删的那些，其余全留下（含你选择留下的口水词） */
      var cleanedText = Text.keptText(t.diff);

      /* —— 自己动手改：整段文本直接编辑，想怎么改就怎么改 —— */
      if (t.editing) {
        out += '<div class="card">' +
          '<div class="block-label">你自己改一遍 · 文字随你改，原文不动</div>' +
          '<textarea class="inp edit-area" id="cleanEdit" rows="7">' +
            esc(t.edited != null ? t.edited : cleanedText) + '</textarea>' +
          '</div>';
        out += tidyFoot(
          '<button class="btn primary" data-act="apply-clean-edited">就用我改的这段</button>',
          '<button class="btn ghost" data-act="cancel-edit-clean">回到对照视图</button>'
        );
        return out;
      }

      /* 这一步原来有一行说明：「只删口水词。不联网、不上传、不花钱。」
         用户 2026-10-04 让删掉。确实多余 —— 改完之后底下那张卡片
         自己就写着「灰色划掉的建议删 · 点一下可以留下」，不用再解释一遍。 */

      if (!t.diff) {
        out += '<div class="card-quiet">' +
          '<div class="block-label">原始记录</div>' +
          '<div class="block-body" style="margin-top:8px">' + esc(e.rawText) + '</div>' +
          '</div>';
        out += tidyFoot(
          '<button class="btn primary" data-act="do-clean">检查一遍</button>',
          '<button class="btn ghost" data-act="skip-clean">跳过，直接往下</button>'
        );
      } else {
        /* 「建议删的词一共几个」和「现在还留着几个没删」得分开算。
           以前一律拿 drops.length 判断，于是你把口水词**全部**点成「留下」之后，
           界面会误报「没有找到该删的口水词。」——
           明明找到了一堆，只是你决定都留。（用户 2026-10-05 报的「莫名其妙说没有口水词要删」。） */
        var rec = t.recovered || [];
        var total = (t.fills || []).length;
        var left = drops.length;

        if (total) {
          var html = t.diff.map(function (p) {
            if (p.type === 'keep') return esc(p.text);
            /* drop（建议删）和 kept（你选择留下的）都带 data-act，都能点：
               点一下留下，再点一下又划掉 —— 后悔了随时能改回来。
               以前「留下」之后渲染成没有 data-act 的 <ins>，就再也点不动了。 */
            var tag = p.type === 'kept' ? 'ins' : 'del';
            return '<' + tag + ' data-act="toggle-drop" data-term="' + esc(p.text) + '">' +
              esc(p.text) + '</' + tag + '>';
          }).join('');
          out += '<div class="card">' +
            '<div class="block-label">' +
            (left ? '灰色划掉的建议删 · 点一下留下，再点一下划掉'
                  : '口水词你都留下了 · 点一下可以重新划掉') +
            '</div>' +
            '<div class="block-body diff" style="margin-top:10px">' + html + '</div>' +
            '</div>';
        } else {
          out += '<div class="card-quiet center">没有找到该删的口水词。</div>';
        }

        out += tidyFoot(
          left
            ? '<button class="btn primary" data-act="accept-clean">用清理后的版本</button>'
            : '<button class="btn primary" data-act="accept-clean-keep">就这样，往下</button>',
          (total ? '<button class="btn ghost" data-act="cancel-clean">不改，用原文</button>' : '') +
            '<button class="btn ghost" data-act="start-edit-clean">我自己改一遍</button>'
        );
      }
    }

    /* ---- 第二步：拆开 ---- */
    if (step === 2) {
      if (t.busy) {
        out += '<div class="card center dim">正在拆…</div>';
        return out;
      }
      var keys = Store.BLOCK_KEYS;

      if (t.unreliable) {
        out += '<div class="notice">' + esc(t.reliableReason || '这段暂时拆不开。') + '</div>';
        out += '<div class="card-quiet mt">' +
          '<div class="block-label">原始记录</div>' +
          '<div class="block-body">' + esc(e.rawText) + '</div></div>';
        out += tidyFoot(
          '<button class="btn primary" data-act="keep-as-raw">保持原样</button>',
          '<button class="btn ghost" data-act="manual-split">我自己拆</button>'
        );
        return out;
      }

      /* 这一步原来有一行说明（「从你的原话里划句子，点一下才放进去…」），
         还有一块「可能放进这些格子」的候选句。用户 2026-10-04 说候选那块鸡肋，
         整块撤掉了 —— 现在这一步只做两件事：想看原话就展开，格子里的字自己写。
         没有候选也就没什么要解释的了，那行说明一并去掉。 */

      /* 原文对照：随时可以核对「一个字都没被删」 */
      out += '<details class="card-quiet" style="margin-bottom:12px">' +
        '<summary class="tiny dim" style="cursor:pointer">原文比对</summary>' +
        '<div class="block-body mt-s">' + esc(e.rawText || '') + '</div></details>';

      out += '<div class="mt">' + keys.map(function (k) {
        return blockRow(Store.BLOCK_LABELS[k], e.blocks[k], k, e.id);
      }).join('') + '</div>';

      out += tidyFoot('<button class="btn primary" data-act="accept-split">就这样</button>');
    }

    /* ---- 第三步：分类 ---- */
    if (step === 3) {
      var sug = t.suggestion || { domain: [], mechanism: [], scene: [] };
      out += '<div class="card">';
      ['domain', 'mechanism', 'scene'].forEach(function (g) {
        var picked = (e.tags[g] || []);

        /* 候选词的顺序定下来就不再变：先按推荐顺序摆，你自己加的词接在后面。
           以前把「已选的」挪到最前面，点一下整行就位移，
           同一个位置连点两下会点到隔壁那个词上 —— 看着就像「点了没反应」。
           现在每个词位置固定：点一下＝选上，再点一下＝取消。 */
        var order = [];
        (sug[g] || []).forEach(function (v) { if (order.indexOf(v) < 0) order.push(v); });
        picked.forEach(function (v) { if (order.indexOf(v) < 0) order.push(v); });

        out += '<div style="margin-bottom:14px">' +
          '<div class="tiny dim">' + esc(Store.TAG_LABELS[g]) + '</div>' +
          '<div class="chips">';
        order.forEach(function (v) {
          var on = picked.indexOf(v) >= 0;
          out += '<span class="chip' + (on ? ' on' : ' suggest') +
            '" data-act="toggle-tag" data-group="' + g + '" data-value="' + esc(v) + '">' +
            (on ? esc(v) + '<span class="x">✕</span>' : '+ ' + esc(v)) +
            '</span>';
        });
        out += '<span class="chip add" data-act="pick-tag" data-group="' + g + '">＋ 其他</span>';
        out += '</div>';

        /* 点「＋ 其他」就在这里直接输入，不再弹系统对话框 */
        if (t.addTagFor === g) {
          out += '<div class="tag-input">' +
            '<input class="inp" id="tagInput" maxlength="12" placeholder="写一个' +
              esc(Store.TAG_LABELS[g]) + '，回车也行">' +
            '<button class="btn btn-sm primary" data-act="add-tag-custom" data-group="' + g + '">加上</button>' +
            '<button class="btn btn-sm ghost" data-act="cancel-tag-custom">取消</button>' +
            '</div>';
        }

        out += '</div>';
      });
      out += '</div>';
      out += tidyFoot(
        '<button class="btn primary" data-act="confirm-tags">完成</button>',
        '<button class="btn ghost" data-act="skip-tags">跳过分类</button>'
      );
    }

    return out;
  };

  /* ============ 沉淀 ============ */
  Views.sediment = function (ctx) {
    var tab = ctx.sedimentTab || 'zhaojian';
    var tabs = [['zhaojian', '照见'], ['xingchi', '行持'], ['col', '合集']];
    var idx = 0;
    tabs.forEach(function (t, i) { if (t[0] === tab) idx = i; });

    var out = '<div class="seg">' +
      '<span class="seg-thumb" style="width:calc(33.33% - 6px);transform:translateX(calc(' + idx + ' * (100% + 4px)))"></span>' +
      tabs.map(function (t) {
        return '<button class="' + (t[0] === tab ? 'on' : '') + '" data-act="sed-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>';

    function listBy(key, emptyText, sub) {
      var items = ctx.events.filter(function (e) { return e.blocks[key] && e.blocks[key].text; });
      if (!items.length) return out + emptyBox(emptyText, sub);
      return out + items.map(function (e) {
        return '<button class="entry" data-act="open-event" data-id="' + e.id + '">' +
          '<div class="entry-day">' + esc(dayShort(e.createdAt)) + '</div>' +
          '<div class="entry-line">' + esc(firstLine(e.blocks[key].text, 80)) + '</div>' +
          flagsOf(e) + '</button>';
      }).join('');
    }

    if (tab === 'zhaojian') return listBy('zhaojian', '还没有照见过什么');
    if (tab === 'xingchi') return listBy('xingchi', '还没有记下收获和做法');

    var cols = ctx.collections || [];
    var cands = ctx.clusterCandidates || [];
    var html = '';

    cands.forEach(function (c) {
      if (cols.some(function (x) { return x.name === c.name; })) return;
      html += '<div class="card mb" style="margin-bottom:12px">' +
        '<div class="tiny dim">' + c.count + ' 条记录可能是同一个问题</div>' +
        '<div style="margin:6px 0 12px;font-size:16px;font-weight:600">' + esc(c.name) + '</div>' +
        '<div class="row-between">' +
          '<button class="btn btn-sm primary" data-act="make-col" data-name="' + esc(c.name) + '">收进合集</button>' +
          '<button class="btn btn-sm ghost" data-act="dismiss">先不管</button>' +
        '</div>' +
        '<div class="hint">原记录各自保留，随时可以取消</div>' +
        '</div>';
    });
    cols.forEach(function (c) {
      html += '<button class="entry" data-act="open-col" data-id="' + c.id + '">' +
        '<div class="entry-day">合集 · ' + c.eventIds.length + ' 条</div>' +
        '<div class="entry-line">' + esc(c.name) + '</div>' +
        '</button>';
    });

    /* 新建入口跟列表是一个样式，不抢眼；点开就地变成起名输入框 */
    if (ctx.creatingCol) {
      html += '<div class="entry-form">' +
        '<input class="inp" id="newColName" maxlength="24" placeholder="给这个合集起个名字">' +
        '<div class="btn-row mt-s">' +
          '<button class="btn btn-sm primary" data-act="create-col">建好</button>' +
          '<button class="btn btn-sm ghost" data-act="cancel-new-col">取消</button>' +
        '</div></div>';
    } else {
      html += '<button class="entry entry-new" data-act="new-col">' +
        '<div class="entry-day">合集</div>' +
        '<div class="entry-line">＋ 自己新建一个</div>' +
        '</button>';
    }

    return out + html;
  };

  Views.collection = function (ctx) {
    var c = ctx.openCollection;

    /* —— 挑记录放进合集 —— */
    if (ctx.pickingFor === c.id) {
      var all = ctx.events.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
      var pick = all.map(function (e) {
        var on = c.eventIds.indexOf(e.id) >= 0;
        return '<button class="entry" data-act="toggle-in-col" data-id="' + e.id + '">' +
          '<div class="entry-day">' + (on ? '✓ 已加入 · ' : '') + esc(dayShort(e.createdAt)) + '</div>' +
          '<div class="entry-line">' +
            esc(firstLine(e.blocks.zhaojian ? e.blocks.zhaojian.text : (e.cleanText || e.rawText), 70)) + '</div>' +
          '</button>';
      }).join('') || emptyBox('还没有记录可以放');

      return '' +
        '<div class="trace-hero">' +
          '<div class="th-when">挑记录放进</div>' +
          '<div class="th-text">' + esc(c.name) + '</div>' +
          '<div class="th-foot"><span>已经选了 ' + c.eventIds.length + ' 条</span>' +
          '<span class="link-btn" data-act="done-pick">完成</span></div>' +
        '</div>' +
        pick +
        '<div class="center mt"><button class="btn primary" data-act="done-pick">完成</button></div>';
    }

    var list = c.eventIds.map(function (id) {
      var e = ctx.byId[id];
      if (!e) return '';
      return '<button class="entry" data-act="open-event" data-id="' + e.id + '">' +
        '<div class="entry-day">' + esc(dayShort(e.createdAt)) + '</div>' +
        '<div class="entry-line">' +
          esc(firstLine(e.blocks.zhaojian ? e.blocks.zhaojian.text : (e.cleanText || e.rawText), 80)) + '</div>' +
        '</button>';
    }).join('') || emptyBox('这个合集还是空的');

    return '' +
      '<div class="trace-hero">' +
        '<div class="th-when">合集</div>' +
        '<div class="th-text">' + esc(c.name) + '</div>' +
        '<div class="th-foot"><span>' + c.eventIds.length + ' 条原记录</span>' +
        '<span class="link-btn" data-act="dissolve-col" data-id="' + c.id + '">取消合集</span></div>' +
      '</div>' +
      '<button class="btn mt-s" data-act="pick-for-col" data-id="' + c.id + '" style="margin-bottom:14px">＋ 把记录加进这个合集</button>' +
      list;
  };

  /* —— 结尾那一句 ——
     就一句。出处标清楚：朝代 · 作者 《篇名》。不满意点「换一句」。
     换了还是匹配你现在这件事的，只是分值排下来下一等的那个。 */
  function poemCard(ctx) {
    var cur = ctx.poemNow;
    if (!cur || !cur.line) return '';
    var l = cur.line;
    var meta = (l.d ? l.d + ' · ' : '') + l.a + ' 《' + l.s + '》';
    return '<div class="card poem-card mt">' +
      '<div class="poem-line">' + esc(l.t) + '</div>' +
      '<div class="poem-meta">' + esc(meta) + '</div>' +
      '<div class="poem-foot">' +
        '<span></span>' +
        '<button class="link-btn" data-act="shuffle-poem">换一句</button>' +
      '</div>' +
      '</div>';
  }

  /* ============ 单条成长事件 ============ */
  Views.event = function (ctx) {
    var e = ctx.openEvent;
    var keys = Store.BLOCK_KEYS;
    /* 只有创建时间。原来还会显示「改于 xxxx」——
       回看一条记录时那个时间没什么意义，用户 2026-10-05 让删掉。 */
    var out = '<div class="tiny dim">' + esc(fullTime(e.createdAt)) + '</div>';

    if (e.structState === 'raw' || e.structState === 'unreliably') {
      out += '<div class="card-quiet mt-s" style="margin-top:10px">' +
        '<div class="block-body">' + esc(e.rawText || '') + '</div></div>' +
        /* 靠右：单手拿手机时拇指落在右下角，摆左边要横跨屏幕才够得到 */
        '<div class="btn-right">' +
        '<button class="btn" data-act="start-tidy-from" data-id="' + e.id + '">整理这条</button>' +
        '</div>';
      return out;
    }

    if (e.rawText && e.cleanAccepted && e.cleanText !== e.rawText) {
      out += '<details class="card-quiet" style="margin-top:10px">' +
        '<summary class="tiny dim" style="cursor:pointer">未清理的原文</summary>' +
        '<div class="block-body mt-s">' + esc(e.rawText) + '</div></details>';
    }

    out += '<div class="mt">' + keys.map(function (k) {
      return blockRow(Store.BLOCK_LABELS[k], e.blocks[k], k, e.id);
    }).join('') + '</div>';

    if ((e.relations || []).length) {
      var rel = e.relations.slice(0, 3).map(function (r) {
        var t = ctx.byId[r.eventId];
        if (!t) return '';
        return '<button class="entry" data-act="open-event" data-id="' + t.id + '">' +
          '<div class="entry-day">' + esc(dayShort(t.createdAt)) + ' · ' + esc(r.reason) + '</div>' +
          '<div class="entry-line">' +
            esc(firstLine(t.blocks.zhaojian ? t.blocks.zhaojian.text : (t.cleanText || t.rawText), 60)) + '</div>' +
          '</button>';
      }).join('');
      if (rel) out += '<div class="sec"><h2>相关的过去</h2></div>' + rel;
    }

    /* —— 回溯 ——
       没写自己的想法之前，当时的答案一律锁着。
       写了才给按钮，按了才打开，而且是当场展开。 */
    var opened = (e.reflections || []).length > 0 || ctx.peeked;

    out += '<div class="quiz mt">' +
      '<h3>如果今天再遇到这件事，你会怎么处理？</h3>';

    if (!opened) {
      out += '<textarea class="inp" id="thinkInput" rows="4" placeholder="现在我会…"></textarea>' +
        '<button class="btn primary mt-s" id="revealBtn" data-act="reveal-past" data-id="' + e.id + '" hidden>查看过去的自己</button>' +
        '<div class="lock-card mt-s">' + ICON.lock +
          '<span>当时的 Bug、解决方案、收获都还锁着。写上面的内容就能打开。' +
          '<span class="link-btn" data-act="peek-past" data-id="' + e.id + '" style="display:block;margin-top:6px">已经在别处想过了</span>' +
          '</span></div>';
    } else {
      out += Views.reveal(ctx);
    }

    out += '</div>';

    /* 写完、想完，最后给它一首。跟回溯那把锁无关，永远都在。 */
    out += poemCard(ctx);

    /* 删除不用系统弹窗（手机上会没反应），就地二次确认 */
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

  /* 打开之后的「当时的自己」——整段都是当年原话，不做任何加工 */
  Views.reveal = function (ctx) {
    var e = ctx.openEvent;
    var keys = Store.BLOCK_KEYS;
    var body = keys.map(function (k) {
      var b = e.blocks[k];
      return '<div class="block' + (k === 'xingchi' ? ' focus' : '') + '">' +
        '<div class="block-label">' + esc(Store.BLOCK_LABELS[k]) +
        (k === 'xingchi' ? ' · 当时你给自己定的做法' : '') + '</div>' +
        '<div class="block-body' + (b && b.text ? '' : ' nil') + '">' +
        (b && b.text ? esc(b.text) : '未记录') + '</div></div>';
    }).join('');

    return '<div class="reveal">' +
      '<div class="card reveal-card">' +
        '<div class="reveal-head">' +
          '<span class="block-label">当时的自己</span>' +
          '<span class="tiny dim">' + esc(dateNum(e.createdAt)) + '</span>' +
        '</div>' +
        '<div class="mt-s">' + body + '</div>' +
      '</div>' +

      '<div class="card mt">' +
        '<div class="block-label">后来怎么样了</div>' +
        '<div class="outcome-row">' +
          '<button class="outcome-btn' + (e.outcome === 'done' ? ' on' : '') + '" data-act="outcome" data-v="done">' +
            ICON.check + '<span>这次做到了</span></button>' +
          '<button class="outcome-btn' + (e.outcome === 'again' ? ' on' : '') + '" data-act="outcome" data-v="again">' +
            ICON.cross + '<span>这次又犯了</span></button>' +
          '<button class="outcome-btn' + (e.outcome === 'unsure' ? ' on' : '') + '" data-act="outcome" data-v="unsure">' +
            ICON.dunno + '<span>不确定</span></button>' +
        '</div>' +
      '</div>' +
      '</div>';
  };

  /* ============ 轨迹 ============ */
  Views.trace = function (ctx) {
    var evts = ctx.events;
    if (!evts.length) return emptyBox('还没有轨迹');

    var today = new Date().toISOString();
    var onThisDay = evts.filter(function (e) {
      return mdOf(e.createdAt) === mdOf(today) && e.createdAt.slice(0, 4) !== today.slice(0, 4);
    });

    var out = '';
    var oldest = evts.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; })[0];
    if (oldest) {
      out += '<div class="trace-hero">' +
        '<div class="th-when">' + esc(dayShort(oldest.createdAt)) + ' 的你</div>' +
        '<div class="th-text">' +
          esc(firstLine(oldest.blocks.yuanqi ? oldest.blocks.yuanqi.text : (oldest.cleanText || oldest.rawText), 110)) +
        '</div>' +
        '<div class="th-foot"><span>' + esc(timeAgo(oldest.createdAt)) + '</span>' +
        '<button class="link-btn" data-act="open-event" data-id="' + oldest.id + '">看完整</button></div>' +
        '</div>';
    }

    if (onThisDay.length) {
      out += '<div class="sec"><h2>往年今日</h2></div>';
      out += onThisDay.map(function (e) {
        return '<button class="entry" data-act="open-event" data-id="' + e.id + '">' +
          '<div class="entry-day">' + esc(e.createdAt.slice(0, 4)) + ' 年</div>' +
          '<div class="entry-line">' +
            esc(firstLine(e.blocks.yuanqi ? e.blocks.yuanqi.text : (e.cleanText || e.rawText), 70)) + '</div>' +
          flagsOf(e) + '</button>';
      }).join('');
    }

    out += '<div class="sec"><h2>时间线</h2></div>';
    var lastMonth = '';
    out += evts.map(function (e) {
      var m = e.createdAt.slice(0, 7);
      var head = '';
      if (m !== lastMonth) {
        lastMonth = m;
        head = '<div class="mono-date" style="padding:12px 0 8px">' +
          esc(e.createdAt.slice(0, 4) + ' 年 ' + Number(e.createdAt.slice(5, 7)) + ' 月') + '</div>';
      }
      var line = e.blocks.yuanqi ? e.blocks.yuanqi.text : (e.cleanText || e.rawText);
      return head + '<div class="tl-item">' +
        '<div class="mono-date">' + esc(dayShort(e.createdAt)) + '</div>' +
        '<button class="entry" data-act="open-event" data-id="' + e.id + '" style="margin-top:6px">' +
        '<div class="entry-line">' + esc(firstLine(line, 90)) + '</div>' + flagsOf(e) + '</button>' +
        '</div>';
    }).join('');

    return out;
  };

  /* ============ 搜索 ============ */
  Views.search = function (ctx) {
    var q = ctx.query || '';
    return '<input class="inp" id="searchInput" placeholder="搜原文、问题、收获、标签…" value="' + esc(q) + '">' +
      '<div class="mt" id="searchResults">' + (q ? Views.searchResults(ctx) : '') + '</div>';
  };

  Views.searchResults = function (ctx) {
    if (!ctx.results.length) return emptyBox('没找到', '换个词试试');
    return ctx.results.map(function (e) {
      var hits = [];
      if (e.blocks.zhaojian && e.blocks.zhaojian.text) hits.push('照见：' + firstLine(e.blocks.zhaojian.text, 40));
      if (e.blocks.xingchi && e.blocks.xingchi.text) hits.push('行持：' + firstLine(e.blocks.xingchi.text, 40));
      if (!hits.length) hits.push(firstLine(e.cleanText || e.rawText, 60));
      return '<button class="entry" data-act="open-event" data-id="' + e.id + '">' +
        '<div class="entry-day">' + esc(dayShort(e.createdAt)) + '</div>' +
        '<div class="entry-line">' + esc(hits[0]) + '</div>' +
        (hits[1] ? '<div class="tiny dim" style="margin-top:3px">' + esc(hits[1]) + '</div>' : '') +
        '</button>';
    }).join('');
  };

  /* ============ 设置 ============ */
  Views.settings = function (ctx) {
    var s = ctx.settings;
    var theme = s.theme || '#6E6BFE';

    /* —— 主题颜色 —— */
    var themeCard = '<div class="card">' +
      '<div class="block-label">主题颜色</div>' +
      '<div style="display:flex;align-items:center;gap:14px;margin:14px 0 4px">' +
        '<div id="themePreview" style="width:52px;height:52px;border-radius:16px;background:' + esc(theme) +
          ';box-shadow:0 8px 20px -10px ' + esc(theme) + '"></div>' +
        '<div>' +
          '<div style="font-size:14.5px">当前主题</div>' +
          '<div class="tiny dim" id="themeValue">' + esc(theme.toUpperCase()) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="swatches">' + Store.THEME_PRESETS.map(function (c) {
        return '<button class="swatch' + (c.toLowerCase() === theme.toLowerCase() ? ' on' : '') +
          '" data-act="set-theme" data-color="' + esc(c) + '" style="background:' + esc(c) +
          '" aria-label="' + esc(c) + '"></button>';
      }).join('') + '</div>' +
      '<div class="row-between mt">' +
        '<span class="tiny dim">自定义</span>' +
        '<input type="color" id="customColor" value="' + esc(theme) + '" data-act="custom-theme" ' +
          'style="width:52px;height:34px;background:none;cursor:pointer">' +
      '</div>' +
      '</div>';

    /* —— 关于 ——
       「检查更新」不做成 App 自己联网去查了 —— 这个 App 连「联网」权限都不要
       （见 android/app/src/main/AndroidManifest.xml）。改成把发布页交给系统浏览器，
       那儿写着最新版本号和安装包。用户 2026-10-05：支持做成跳转，要完全零权限。 */
    var app = Store.APP || {};
    var aboutCard = '<div class="card mt">' +
      '<div class="block-label">关于</div>' +
      '<div class="about-row"><span>版本</span><b>V' + esc(app.version || '1.0.0') + '</b></div>' +
      '<div class="about-row"><span>制作</span><b>' + esc(app.maker || '') + '</b></div>' +
      '<button class="btn btn-sm mt-s" data-act="check-update" style="width:100%">去发布页看看</button>' +
      '<div class="tiny dim mt-s">最新版本和安装包都在那儿，用浏览器打开。</div>' +
      '<div id="updateBox"></div>' +
      '</div>';

    /* —— 数据 ——
       回收站不做成单独一块卡片了：它就是三个字，跟在导出/恢复旁边。
       用户 2026-10-05：「回收站部分弄成三个字，放到导出备份恢复备份那个位置并排」。 */
    var dataCard = '<div class="card mt">' +
      '<div class="block-label">数据</div>' +
      '<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn" data-act="export">导出备份</button>' +
        '<button class="btn" data-act="import">从备份恢复</button>' +
        '<button class="btn" data-act="go" data-route="trash">回收站</button>' +
      '</div>' +
      '<div class="hint" id="exportInfo">' + backupHint(s.lastExportAt) +
      '<br>记录只存在这台设备上。清理浏览器数据、卸载重装、换手机都会把它带走 ——' +
      '导出来的那个 ZIP 才是你的底。</div>' +
      '</div>';

    return themeCard + dataCard + aboutCard +
      '<div class="hint center" style="margin:18px 0 6px">' +
      ctx.events.length + ' 条记录 · ' +
      (Store.usingFallback() ? '本地降级存储' : '本地数据库') +
      '</div>';
  };

  /* ============ 回收站 ============
     删掉的东西都先落到这儿，能还原；最下面是一次清空。
     （以前删完只提示「在设置 → 回收站里能还原」，可那时候界面上根本没有回收站。） */
  Views.trash = function (ctx) {
    var trash = ctx.trash || [];
    if (!trash.length) {
      return emptyBox('回收站是空的', '删掉的记录会先放到这儿，随时能还原');
    }
    var out = '<div class="card">' +
      '<div class="trash-list">' + trash.map(function (r) {
        var d = r.data || {};
        var label = d.rawText || d.name || '（没有内容）';
        return '<div class="trash-row">' +
          '<div class="trash-info">' +
            '<div class="trash-line">' + esc(firstLine(label, 42)) + '</div>' +
            '<div class="tiny dim">' + esc(dayShort(r.deletedAt)) + ' 删的' +
              (r.originalKind === 'collection' ? ' · 合集' : '') + '</div>' +
          '</div>' +
          '<button class="btn btn-sm" data-act="restore-trash" data-id="' + esc(r.id) + '">还原</button>' +
          '</div>';
      }).join('') + '</div></div>';

    out += '<div class="hint" style="margin:12px 0">' +
      '一共 ' + trash.length + ' 条。还原了就回到原来的位置。' +
      '这里的记录不再出现在沉淀和轨迹里。</div>';

    out += ctx.confirmEmptyTrash
      ? '<div class="confirm-bar">' +
        '清空回收站？这些就真的没了，不能还原。' +
        '<div class="btn-row mt-s">' +
          '<button class="btn btn-sm primary" data-act="do-empty-trash">清空</button>' +
          '<button class="btn btn-sm ghost" data-act="cancel-empty-trash">取消</button>' +
        '</div></div>'
      : '<button class="btn btn-sm ghost" data-act="empty-trash" ' +
        'style="width:100%">清空回收站</button>';

    return out;
  };

  global.Views = Views;
})(window);
