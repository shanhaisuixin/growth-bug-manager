/* 纯本地文本工具 —— 没有网络、没有模型、不花一分钱。
   归一化 / 清理差异 / 相似度 / 历史关联 / 合集聚类
   以前这些都放在 ai.js 里，现在 AI 整个拿掉了，单独成一个文件。 */
(function (global) {
  'use strict';

  /* ---------- 归一化：只留字，去标点空白 ---------- */
  function normalize(s) {
    return String(s || '')
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，。、；：？！「」『』（）()【】《》""''…—～·,.;:?!~\-—_"'\[\]{}]/g, '')
      .toLowerCase();
  }

  /* ---------- 清理差异：产出 {type:'keep'|'drop'|'kept', text}
     keep = 原样留下的正文
     drop = 建议删的口水词（还在删的那一档）
     kept = 你选择留下的口水词 —— 得单独标出来，
            不然界面上它跟正文没区别，想改回「删」都没地方点。
  ---------- */
  function buildDiff(text, fills, recoveredTerms) {
    var rec = recoveredTerms || [];

    /* 长的先切，免得短词把长词切碎（原来的顺序规则，照旧） */
    var marks = (fills || []).map(function (f) {
      return { term: f.term, type: rec.indexOf(f.term) < 0 ? 'drop' : 'kept' };
    }).sort(function (a, b) { return b.term.length - a.term.length; });

    if (!marks.length) return [{ type: 'keep', text: text }];

    /* 用占位符把文本切开，避免多次 replace 互相破坏 */
    var SEP = '\u0001';
    var marked = text;
    marks.forEach(function (m, i) {
      marked = marked.split(m.term).join(SEP + i + SEP);
    });

    var parts = [];
    marked.split(new RegExp(SEP + '(\\d+)' + SEP)).forEach(function (seg, idx) {
      if (idx % 2 === 1) {
        var m = marks[Number(seg)];
        if (m) { parts.push({ type: m.type, text: m.term }); return; }
      }
      if (seg) parts.push({ type: 'keep', text: seg });
    });

    var merged = [];
    parts.forEach(function (p) {
      var last = merged[merged.length - 1];
      /* 只合并相邻的正文，**不合并相邻的待删词/留下的词**。
         合并之后那一小段会变成「嗯，嗯」这样的拼接串，跟词表里的「嗯」对不上，
         界面点它就没反应了；分开摆还能一个一个点着留或不留。 */
      if (last && last.type === p.type && p.type === 'keep') last.text += p.text;
      else merged.push({ type: p.type, text: p.text });
    });
    return merged;
  }

  /* 清理之后真正剩下的正文 = 除了「建议删」以外的全部（含你选择留下的口水词）。
     「用清理后的版本」和页面上的预览都走这里，免得两处各写一遍对不上。 */
  function keptText(diff) {
    return (diff || []).filter(function (p) { return p.type !== 'drop'; })
      .map(function (p) { return p.text; }).join('');
  }

  /* ---------- 相似度：bigram Dice 系数 ---------- */
  function dice(a, b) {
    function grams(s) {
      var n = normalize(s), out = [], i;
      for (i = 0; i < n.length - 1; i++) out.push(n.substr(i, 2));
      return out;
    }
    var A = grams(a), B = grams(b);
    if (!A.length || !B.length) return 0;
    var setA = {}, hit = 0;
    A.forEach(function (g) { setA[g] = (setA[g] || 0) + 1; });
    B.forEach(function (g) {
      if (setA[g] > 0) { hit++; setA[g]--; }
    });
    return (2 * hit) / (A.length + B.length);
  }

  function corpusOf(evt) {
    var out = [evt.cleanText || evt.rawText || ''];
    ['yuanqi', 'zhaojian', 'xingchi'].forEach(function (k) {
      if (evt.blocks && evt.blocks[k] && evt.blocks[k].text) out.push(evt.blocks[k].text);
    });
    return out.join(' ');
  }

  /* ---------- 关联过去：内容像 + 标签同 ---------- */
  function findRelations(newEvt, allEvents) {
    var base = corpusOf(newEvt);
    return allEvents.filter(function (e) {
      return e.id !== newEvt.id;
    }).map(function (e) {
      var score = dice(base, corpusOf(e));
      var shared = 0;
      ['domain', 'mechanism', 'scene'].forEach(function (g) {
        (newEvt.tags[g] || []).forEach(function (t) {
          if ((e.tags[g] || []).indexOf(t) >= 0) shared++;
        });
      });
      score += shared * 0.06;
      return {
        eventId: e.id,
        score: Math.min(score, 0.99),
        reason: shared ? '标签相同且内容接近' : '内容接近'
      };
    }).filter(function (r) { return r.score >= 0.22; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 6);
  }

  /* ---------- 合集聚类：同一套标签 ≥2 条 → 候选合集 ---------- */
  function clusterCandidates(allEvents) {
    var groups = {};
    allEvents.forEach(function (e) {
      (e.tags && e.tags.mechanism ? e.tags.mechanism : []).forEach(function (m) {
        (groups[m] = groups[m] || []).push(e);
      });
    });
    return Object.keys(groups).map(function (m) {
      return { name: m, eventIds: groups[m].map(function (e) { return e.id; }), count: groups[m].length };
    }).filter(function (g) { return g.count >= 2; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  global.Text = {
    normalize: normalize,
    buildDiff: buildDiff,
    keptText: keptText,
    dice: dice,
    findRelations: findRelations,
    clusterCandidates: clusterCandidates
  };
})(window);
