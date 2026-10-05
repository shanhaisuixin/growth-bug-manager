/* 本机规则引擎 —— 不联网也能干活。
   三块能力：
   1) 语气词清理：只删口水词，一个字都不改写
   2) 拆开候选：把原话切成句子，逐句打分，告诉你这句像哪个格子。绝不自动填 —— 点一下才采纳
   3) 分类推荐：从固定的候选池里挑几个你可能想点的标签。同样是点了才算
   原则：宁可少标，不可乱标。标错等于替你思考了。 */
(function (global) {
  'use strict';

  /* ============ 一、语气词清理 ============ */

  /* 单字填充词：在长文本里几乎不携带信息 */
  var SINGLE_FILLERS = ['呃', '嗯', '唔', '诶', '唉', '哎', '嗷'];

  /* 口癖短语 */
  var PHRASE_FILLERS = [
    '那个那个', '这个这个', '就是就是', '然后然后', '对对对',
    '就是说呢', '怎么说呢', '那个啥', '我跟你讲', '你知道吧', '你懂吧',
    '反正就是', '然后就是', '所以说呢', '其实吧', '他妈的'
  ];

  /* 只有这些字被连着写两次，才可能是真口吃。
     别的字（比如「谈谈恋爱」的「谈」）连着两次多半就是正常叠词，
     所以**一律不动** —— 宁可少标，不可乱标。 */
  var STUTTER_CHARS = '我你他她它这那是不就都很在要有会能对好';

  /* 叠词白名单：这些重复是正常词汇，绝不能删 */
  var LEGIT_REDUP = [
    '刚刚', '偷偷', '慢慢', '渐渐', '常常', '往往', '好好', '天天', '年年', '人人',
    '个个', '多多', '早早', '远远', '紧紧', '轻轻', '悄悄', '静静', '深深', '高高',
    '小小', '大大', '种种', '件件', '事事', '家家', '次次', '句句', '字字', '步步',
    '点点', '丝丝', '阵阵', '片片', '朵朵', '条条', '层层', '等等', '渐渐', '默默',
    '匆匆', '缓缓', '淡淡', '满满', '空空', '暖暖', '冷冷', '热热', '甜甜', '苦苦',
    '想想', '看看', '说说', '走走', '试试', '聊聊', '坐坐', '歇歇', '等等', '谢谢',
    '爸爸', '妈妈', '哥哥', '姐姐', '弟弟', '妹妹', '爷爷', '奶奶', '叔叔', '阿姨',
    '宝宝', '娃娃', '星星', '泡泡', '心心', '咪咪', '汪汪', '喵喵', '哈哈', '呵呵'
  ];

  /* 标点：用于判断「孤立填充」 */
  var PUNC = '，。、；：？！,.;:?!…—\u3000 \n\r\t';

  function isPunc(ch) { return PUNC.indexOf(ch) >= 0; }

  /**
   * 本地清洗。
   * @returns {{fills: Array, notes: string[]}}
   */
  function clean(text) {
    var t = String(text || '');
    if (!t) return { fills: [], notes: [] };

    var found = {};   // term -> {term, count, kind}
    var notes = [];

    function mark(term, kind) {
      if (!term) return;
      if (!found[term]) found[term] = { term: term, count: 0, kind: kind };
      found[term].count++;
    }

    /* 1) 口癖短语（长的先处理，避免被短的抢先） */
    PHRASE_FILLERS.slice().sort(function (a, b) { return b.length - a.length; })
      .forEach(function (p) {
        if (t.indexOf(p) >= 0) mark(p, 'filler');
      });

    /* 2) 单字填充词。这些字几乎不会构成正常词语，所以不要求「被标点包围」，
          只排除少数固定搭配（唉声叹气、哎呀、哎哟…） */
    var EXCEPT_AFTER = { '唉': '声', '哎': '呀哟', '嗯': '嗯', '诶': '诶', '嗷': '嗷', '唔': '唔', '呃': '呃' };
    SINGLE_FILLERS.forEach(function (f) {
      var idx = -1, hit = false;
      while ((idx = t.indexOf(f, idx + 1)) >= 0) {
        var after = t.charAt(idx + 1);
        var except = EXCEPT_AFTER[f] || '';
        if (except && except.indexOf(after) >= 0) continue;
        hit = true;
      }
      if (hit) mark(f, 'filler');
    });

    /* 3) 结巴重复：同一个字连着 ≥3 次 → 一定口吃；连着 2 次要看是否正常叠词 */
    var covered = [];
    var re3 = /([\u4e00-\u9fa5])\1{2,}/g;
    var m;
    while ((m = re3.exec(t)) !== null) {
      mark(m[0], 'stutter');
      covered.push([m.index, m.index + m[0].length]);
    }

    var re2 = /([\u4e00-\u9fa5])\1/g;
    while ((m = re2.exec(t)) !== null) {
      var dup = m[0];
      if (LEGIT_REDUP.indexOf(dup) >= 0) continue;         // 正常叠词，跳过
      if (STUTTER_CHARS.indexOf(dup.charAt(0)) < 0) continue;  // 这个字叠起来是正常说法，不碰
      if (covered.some(function (r) { return m.index >= r[0] && m.index < r[1]; })) continue;
      /* 只在它确实读起来像口吃时才标：出现在句首或标点之后 */
      var p = m.index === 0 ? '' : t.charAt(m.index - 1);
      if (m.index === 0 || isPunc(p)) mark(dup, 'stutter');
    }

    var fills = Object.keys(found).map(function (k) { return found[k]; });
    if (!fills.length) notes.push('这一段很干净，没有发现需要删的口水词。');
    return { fills: fills, notes: notes };
  }


  /* ============ 二、分类推荐（本机，只从候选池里挑） ============

     它不是「替你想出该打什么标签」，而是拿一张写死的对照表去撞你的原话：
     撞到了就把那个标签摆出来。你点了才算加上，不点什么都没有。
     短词权重低（一个「说」字说明不了什么），长词权重大（「不好意思拒绝」就很明确）。 */

  var TAG_LEXICON = {
    domain: {
      '自我管理': ['自律', '习惯', '作息', '熬夜', '计划', '目标', '坚持', '规律'],
      '执行力': ['拖延', '拖到', '做不完', '截止', 'deadline', '一拖再拖', '拖到最后', '没执行'],
      '情绪': ['情绪', '难过', '生气', '焦虑', '委屈', '崩溃', '烦', '难受', '失落', 'emo',
        '开心', '高兴', '沮丧', '压力', '内耗'],
      '人际关系': ['朋友', '同学', '同事', '室友', '家人', '父母', '亲戚', '关系', '相处', '交往'],
      '沟通': ['沟通', '表达', '开口', '语气', '回复', '消息', '聊天', '解释', '说清楚'],
      '决策': ['决定', '选择', '要不要', '犹豫', '纠结', '取舍', '拿主意'],
      '工作': ['工作', '上班', '加班', '老板', '领导', '任务', '项目', '客户', '会议',
        '同事', '职场', '辞职', '面试', '汇报', '绩效'],
      '学习': ['学习', '考试', '复习', '作业', '看书', '读书', '知识', '背单词', '听课'],
      '金钱': ['工资', '花钱', '消费', '理财', '存款', '账单', '太贵', '便宜', '节省', '借钱'],
      '生活': ['睡觉', '吃饭', '做饭', '运动', '健身', '房间', '打扫', '家务', '作息'],
      '认知': ['认知', '思维', '观念', '看问题', '角度', '想问题', '理解方式']
    },
    mechanism: {
      '拖延': ['拖延', '拖到', '一直没', '晚点', '等一下', '再说吧', '推到明天', '明天再'],
      '逃避': ['逃避', '躲', '不敢面对', '不想面对', '绕开', '装作没看见'],
      '讨好': ['讨好', '不好意思', '迁就', '让着', '委屈自己', '怕别人不高兴'],
      '冲动': ['冲动', '一时', '没忍住', '直接说', '火了', '上头'],
      '情绪化': ['发脾气', '烦躁', '控制不住情绪', '生气', '情绪上来'],
      '过度思考': ['想太多', '反复想', '翻来覆去', '内耗', '想很久', '纠结'],
      '边界不足': ['没有边界', '不好意思拒绝', '说不出口', '没办法拒绝', '不会拒绝', '硬撑着答应'],
      '注意力分散': ['分心', '走神', '刷手机', '刷视频', '短视频', '专注不了', '注意力'],
      '判断错误': ['判断错', '看错了', '估计错', '误判', '想错了'],
      '信息不足': ['不知道', '没问清楚', '没搞清', '不清楚', '不了解', '没确认'],
      '执行断裂': ['中断', '半途', '没坚持', '放弃了', '停下来', '中途'],
      '知道但做不到': ['明知道', '知道但', '道理都懂', '还是控制不住', '做不到'],
      '事后才反应': ['事后', '后来才', '才反应', '反应过来', '当时没'],
      '害怕承担后果': ['害怕', '担心后果', '不敢担', '责任', '怕出错'],
      '自我合理化': ['找理由', '借口', '合理化', '反正', '算了'],
      '过度依赖经验': ['经验', '以前都是', '老办法', '习惯性']
    },
    scene: {
      '工作': ['工作', '上班', '加班', '领导', '老板', '同事', '会议', '任务', '项目', '客户'],
      '学习': ['学习', '考试', '复习', '作业', '看书', '听课'],
      '冲突': ['吵架', '冲突', '矛盾', '争执', '翻脸', '对着干'],
      '沟通': ['沟通', '表达', '回复', '消息', '聊天', '解释', '说清楚'],
      '拒绝别人': ['拒绝', '说不', '答应', '帮忙', '不好意思'],
      '做决定': ['决定', '选择', '要不要', '犹豫', '纠结'],
      '社交': ['聚会', '社交', '群里', '应酬', '见面', '约会', '朋友'],
      '金钱': ['钱', '工资', '花钱', '消费', '借', '还钱', '账单'],
      '项目执行': ['项目', '任务', '计划', '推进', '进度', '截止', 'deadline'],
      '时间管理': ['没时间', '来不及', '安排', '排期', '拖延', '刷手机'],
      '网络信息': ['手机', '刷', '视频', '微博', '小红书', '抖音', '信息', '新闻']
    }
  };

  /* 一个词命中几分：两字以上才够得上算数，一个字太容易误伤 */
  function lexScore(text, words) {
    var sc = 0, hits = [];
    words.forEach(function (w) {
      if (text.indexOf(w) < 0) return;
      sc += w.length >= 2 ? 1 : 0.4;
      hits.push(w);
    });
    return { score: sc, hits: hits };
  }

  /**
   * 分类推荐 —— 从固定候选池里挑，最多每组 3 个。
   * @returns {{domain: string[], mechanism: string[], scene: string[]}}
   */
  function suggestTags(text, opts) {
    opts = opts || {};
    var t = String(text || '');
    var out = { domain: [], mechanism: [], scene: [] };
    if (!t.trim()) return out;

    var max = opts.max || 3;
    Object.keys(TAG_LEXICON).forEach(function (g) {
      var scored = Object.keys(TAG_LEXICON[g]).map(function (tag) {
        var r = lexScore(t, TAG_LEXICON[g][tag]);
        return { tag: tag, score: r.score, hits: r.hits.length };
      }).filter(function (x) { return x.score >= 1; })
        .sort(function (a, b) { return b.score - a.score || b.hits - a.hits; });
      out[g] = scored.slice(0, max).map(function (x) { return x.tag; });
    });
    return out;
  }

  /* ============ 三、可以留意的地方 ============
     这一类**什么都不删**，只是把读起来可能别扭的地方指出来。
     语气、逻辑这类东西不能靠规则改 —— 改了就是替用户思考了。 */

  var VAGUE_WORDS = ['我觉得', '可能', '应该', '大概', '也许', '好像', '似乎', '差不多', '反正'];
  var TAIL_DANGLING = ['因为', '所以', '但是', '而且', '然后', '就是', '如果', '虽然', '不过', '还有', '或者'];

  function inspect(text) {
    var t = String(text || '');
    var out = [];
    if (!t.trim()) return out;

    /* 1) 结尾像没说完 */
    var tail = t.replace(/[\s。！？!?…、，,.]+$/, '');
    for (var i = 0; i < TAIL_DANGLING.length; i++) {
      if (tail.length >= 2 && tail.slice(-TAIL_DANGLING[i].length) === TAIL_DANGLING[i]) {
        out.push({ kind: 'dangling', text: '结尾停在「' + TAIL_DANGLING[i] + '」，这句好像还没写完。' });
        break;
      }
    }

    /* 2) 几乎没有句号 */
    var stops = (t.match(/[。！？!?；;]/g) || []).length;
    if (t.length > 60 && stops === 0) {
      out.push({ kind: 'punct', text: '整段没有一个句号，读的时候会找不到停顿。' });
    }

    /* 3) 两个标点之间太长 */
    var chunks = t.split(/[。！？!?；;\n]/);
    var longest = 0;
    chunks.forEach(function (c) { if (c.length > longest) longest = c.length; });
    if (longest > 70) {
      out.push({ kind: 'long', text: '有一句长到 ' + longest + ' 个字，可能要断一下才读得顺。' });
    }

    /* 4) 连接词用得太密 */
    ['然后', '就是', '其实', '反正'].forEach(function (w) {
      var n = t.split(w).length - 1;
      if (n >= 4) {
        out.push({ kind: 'repeat', text: '「' + w + '」出现了 ' + n + ' 次，可以考虑精简。' });
      }
    });

    /* 5) 语气太模糊 */
    var vagueHits = [];
    VAGUE_WORDS.forEach(function (w) {
      var n = t.split(w).length - 1;
      if (n > 0) for (var k = 0; k < n; k++) vagueHits.push(w);
    });
    if (vagueHits.length >= 4) {
      out.push({ kind: 'vague', text: '「' + vagueHits.slice(0, 4).join('、') + '」这类模糊说法出现了 ' +
        vagueHits.length + ' 次，也许可以写得更确定一点。' });
    }

    return out.slice(0, 5);
  }

  global.LocalEngine = {
    clean: clean,
    inspect: inspect,
    suggestTags: suggestTags,
    TAG_LEXICON: TAG_LEXICON,
    SINGLE_FILLERS: SINGLE_FILLERS,
    PHRASE_FILLERS: PHRASE_FILLERS,
    STUTTER_CHARS: STUTTER_CHARS,
    LEGIT_REDUP: LEGIT_REDUP
  };
})(window);
