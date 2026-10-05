/* 诗词句库的匹配引擎 —— 全在本机，不联网、不生成。

   库是 poem-data.js（由 tools/build_poems.py 从公开语料筛出来的句子）。
   这里的活儿只有三件：
     1) 从你的记录里读出「信号」：你打的标签 + 你原话里出现的心情词
     2) 拿信号去给每一句诗打分
     3) 把打分从高到低排成一队交出去

   几个刻意的选择：
     · 给的是「一句」，不是整首。你写完东西，抬头看到一句就够了。
     · 「换一首」不是随便换 —— 它是顺着打分往下走，下一句照样是匹配你现在这件事的。
     · 分数不够就老实说没底气，这时只从「通用」那一小撮里给，不乱凑。

   它做不到什么也说清楚：这是标签层面的匹配，不是真的读懂了你的心情。 */
(function (global) {
  'use strict';

  /* 词库是懒加载的。
     实测这份 920 KB 的库光解析就要 60 ms（台式机 node 上量的），手机大概要
     两三百毫秒 —— 放在开机读，等于首屏白等这么久。
     而它真正被用到，是「你写完一条、底下给你配一句诗」那一步，那时候早读完了。
     所以这里不抓值，改成用到时再看：poem-data.js 什么时候进来都认。 */
  var DATA = null, TAGS = [], POOL = [], GENERAL = [];
  var loadPromise = null;

  function build() {
    if (DATA) return true;
    var d = global.POEM_DATA;
    if (!d) return false;
    DATA = d;
    TAGS = d.tags || [];
    /* 把索引化的标签先展开，省得每次匹配都换算。
       f 是「名句度」：3 = 点名表里的名句，2 = 唐诗三百首/千家诗/水墨唐诗这类选本，
       1 = 诗经/楚辞这类老选本，0 = 全唐诗全宋词里的一般句子。
       它只影响排序，不参与「有没有底气」的判断 —— 见下面 ranked()。 */
    POOL = (d.lines || []).map(function (l) {
      return {
        t: l.t, d: l.d, a: l.a, s: l.s, f: l.f || 0,
        tags: (l.g || []).map(function (x) { return TAGS[x]; }).filter(Boolean)
      };
    });
    /* 兜底池：「通用」是一批读起来最平、放到哪种心情下都不违和的句子 */
    GENERAL = POOL.filter(function (p) { return p.tags.indexOf('通用') >= 0; });
    return true;
  }

  /** 库进来了吗。没进来就返回 false，上头会如实说「没有」，不硬凑。 */
  function ready() { return build(); }

  /** 需要时把 poem-data.js 挂上来。挂一次就够，重复调用共用同一个 promise。 */
  function load() {
    if (build()) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (resolve) {
      var s = global.document.createElement('script');
      s.src = 'js/poem-data.js';
      s.async = true;
      s.onload = function () { resolve(build()); };
      s.onerror = function () { loadPromise = null; resolve(false); };
      global.document.head.appendChild(s);
    });
    return loadPromise;
  }

  /* ---------- 一、你打的标签 → 诗词标签 ----------
     标签名是 app 里的候选池，值是对应的诗词标签。命中权重比关键词高。 */
  var TAG_MAP = {
    mechanism: {
      '拖延': ['拖延', '时间', '行动', '自律'],
      '逃避': ['低谷', '想放弃', '迷茫'],
      '讨好': ['人际', '委屈', '付出'],
      '冲动': ['愤怒', '遗憾'],
      '情绪化': ['焦虑', '愤怒', '失落'],
      '过度思考': ['焦虑', '迷茫', '自我价值'],
      '边界不足': ['人际', '委屈', '自我价值'],
      '注意力分散': ['学习', '拖延', '自律'],
      '判断错误': ['遗憾', '顿悟'],
      '信息不足': ['迷茫', '顿悟'],
      '执行断裂': ['想放弃', '低谷', '坚持', '重来'],
      '知道但做不到': ['行动', '自律', '顿悟', '学习'],
      '事后才反应': ['遗憾', '顿悟'],
      '害怕承担后果': ['焦虑', '不甘', '自我价值'],
      '自我合理化': ['释怀', '无常'],
      '过度依赖经验': ['顿悟', '重来']
    },
    domain: {
      '自我管理': ['自律', '时间', '拖延'],
      '执行力': ['行动', '拖延', '迷茫'],
      '情绪': ['焦虑', '失落', '开心', '委屈', '平静'],
      '人际关系': ['人际', '友谊', '离别', '被误解'],
      '沟通': ['被误解', '人际'],
      '决策': ['迷茫', '不甘', '行动'],
      '工作': ['工作', '不甘', '努力有回报', '时间'],
      '学习': ['学习', '自律', '行动', '坚持'],
      '金钱': ['金钱', '自我价值', '无常'],
      '生活': ['当下', '平静', '身体'],
      '认知': ['顿悟', '无常', '释怀']
    },
    scene: {
      '工作': ['工作', '不甘', '时间'],
      '学习': ['学习', '自律', '坚持'],
      '冲突': ['愤怒', '被误解', '委屈'],
      '沟通': ['被误解', '人际'],
      '拒绝别人': ['人际', '委屈', '自我价值'],
      '做决定': ['迷茫', '行动'],
      '社交': ['人际', '友谊', '孤独'],
      '金钱': ['金钱', '无常'],
      '项目执行': ['工作', '坚持', '行动'],
      '时间管理': ['时间', '拖延', '行动', '当下'],
      '网络信息': ['学习', '迷茫', '拖延']
    }
  };

  /* ---------- 二、你原话里的心情词 ----------
     你什么都没打标签的时候，就靠这个读你的原话。 */
  var EMOTION_WORDS = [
    { tag: '坚持', words: ['坚持', '撑住', '顶住', '熬过去', '不放弃', '继续做', '硬撑', '扛'] },
    { tag: '想放弃', words: ['不想干', '放弃', '算了', '没意义', '撑不住', '想退出', '不想做', '受够'] },
    { tag: '重来', words: ['重新开始', '再来一次', '从头', '重启', '重新做', '再来'] },
    { tag: '低谷', words: ['低谷', '状态差', '一塌糊涂', '倒霉', '失败', '搞砸', '跌到', '崩'] },
    { tag: '不甘', words: ['不甘', '不服', '凭什么', '不甘心', '为什么是我'] },
    { tag: '努力有回报', words: ['有回报', '值得', '没白费', '有进步', '见效', '成了'] },
    { tag: '成功', words: ['成功', '顺利完成', '搞定', '拿下了', '通过了', '赢了'] },
    { tag: '希望', words: ['有希望', '会好的', '慢慢来', '有转机', '期待', '盼'] },
    { tag: '自我价值', words: ['没用', '没价值', '配不上', '不够好', '自卑', '看不起自己', '很差'] },
    { tag: '迷茫', words: ['迷茫', '不知道怎么办', '没有方向', '看不清', '不知道要什么', '茫然'] },
    { tag: '顿悟', words: ['想通了', '意识到', '原来', '发现', '懂了', '看清了', '才知道'] },
    { tag: '行动', words: ['开始做', '动起来', '马上去', '别想了', '先去', '赶紧'] },
    { tag: '自律', words: ['自律', '管住', '控制自己', '克制', '忍住', '不刷'] },
    { tag: '拖延', words: ['拖延', '拖到', '一直没做', '晚点再说', '明天再', '推到'] },
    { tag: '学习', words: ['学习', '看书', '读书', '复习', '考试', '作业', '学不会'] },
    { tag: '焦虑', words: ['焦虑', '担心', '紧张', '心慌', '睡不好', '睡不着', '压力大', '来不及'] },
    { tag: '失落', words: ['失落', '难过', '沮丧', '低落', '没劲', '空落落', '提不起劲', '消沉'] },
    { tag: '孤独', words: ['孤独', '一个人', '没人懂', '孤单', '孤立'] },
    { tag: '委屈', words: ['委屈', '冤枉', '想哭', '不公平', '白费'] },
    { tag: '愤怒', words: ['生气', '愤怒', '火大', '气死', '受不了', '太过分', '恼火'] },
    { tag: '被误解', words: ['被误会', '没人理解', '误解', '不是这个意思', '被当成'] },
    { tag: '自责', words: ['自责', '后悔', '怪自己', '不该', '内疚', '愧疚', '对不起'] },
    { tag: '平静', words: ['平静', '还好', '放下', '安静', '不急'] },
    { tag: '开心', words: ['开心', '高兴', '快乐', '舒服', '太好了', '满足', '幸福'] },
    { tag: '离别', words: ['离开', '告别', '分开', '走了', '再见', '毕业', '离职'] },
    { tag: '思念', words: ['想念', '思念', '怀念', '挂念', '回忆'] },
    { tag: '感情', words: ['喜欢', '恋爱', '感情', '在一起', '分手', '心动'] },
    { tag: '遗憾', words: ['遗憾', '错过', '可惜', '当初', '如果当时', '本来可以'] },
    { tag: '人际', words: ['关系', '相处', '朋友', '同事', '同学', '家人', '父母', '室友'] },
    { tag: '友谊', words: ['哥们', '姐妹', '一起玩', '陪伴', '好朋友'] },
    { tag: '付出', words: ['付出', '牺牲', '白付出', '做了很多', '为他', '为她'] },
    { tag: '时间', words: ['时间', '来不及', '一晃', '过了好久', '太快了', '岁月', '年纪'] },
    { tag: '无常', words: ['世事', '计划赶不上', '一切都变了', '突然就'] },
    { tag: '金钱', words: ['工资', '花销', '存款', '没钱', '太贵', '省钱', '预算', '买不起'] },
    { tag: '工作', words: ['工作', '上班', '加班', '领导', '老板', '项目', '任务', '客户', '会议', '职场'] },
    { tag: '身体', words: ['身体', '生病', '熬夜', '失眠', '头疼', '健康', '运动', '减肥'] },
    { tag: '当下', words: ['当下', '此刻', '及时', '珍惜', '别等了', '就现在'] },
    { tag: '释怀', words: ['放下', '不纠结', '无所谓', '看开', '接受', '随它'] }
  ];

  /* ---------- 三、读数：从这条记录里收集信号 ---------- */
  function textOf(evt) {
    var parts = [evt.rawText || '', evt.cleanText || ''];
    if (evt.blocks) {
      ['yuanqi', 'zhaojian', 'xingchi'].forEach(function (k) {
        var b = evt.blocks[k];
        if (b && b.text) parts.push(b.text);
      });
    }
    return parts.join('\n');
  }

  function signalsOf(evt) {
    var sig = {};
    function add(tag, w) {
      if (!tag) return;
      if (!(tag in sig) || sig[tag] < w) sig[tag] = w;   /* 取最强的那一路 */
    }

    /* 你亲手打的标签，权重最高 */
    ['mechanism', 'domain', 'scene'].forEach(function (g) {
      var weight = g === 'mechanism' ? 1.0 : 0.7;
      var picked = (evt.tags && evt.tags[g]) || [];
      picked.forEach(function (v) {
        ((TAG_MAP[g] || {})[v] || []).forEach(function (t) { add(t, weight); });
      });
    });

    /* 你原话里的词。越具体（词越长）越算数 */
    var body = textOf(evt);
    EMOTION_WORDS.forEach(function (rule) {
      rule.words.forEach(function (w) {
        if (body.indexOf(w) >= 0) add(rule.tag, w.length >= 4 ? 0.9 : 0.6);
      });
    });

    return sig;
  }

  /* 稳定散列：同一条记录、同一句诗，排出来的位置永远一样，不随刷新变 */
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }

  /* ---------- 四、打分排序 ----------
     两件事分开算：
       score  = 贴合度（你打的标签 + 你原话里的词），只有它决定「有没有底气」
       bonus  = 名句度，只在分数接近时把耳熟能详的那句往前挪
     用户 2026-10-05 的要求：「顺便优先名句，但整体还是要贴合我写的内容」。
     0.12 这个系数就是照这个分寸定的 —— 最大加权 0.36，比最弱的一档信号
     （0.6）还小，所以名句永远压不过一句真正贴题的普通句子。 */
  var FAMOUS_BONUS = 0.12;

  function ranked(evt, sig) {
    var seed = (evt && evt.id) || '';
    var out = [];
    for (var i = 0; i < POOL.length; i++) {
      var p = POOL[i], score = 0, hits = [];
      for (var k = 0; k < p.tags.length; k++) {
        var t = p.tags[k];
        if (t === '通用' || !sig[t]) continue;
        /* 每句的第一个标签是它最像的那一面，命中它更算数 */
        score += sig[t] * (k === 0 ? 1.35 : 1);
        hits.push(t);
      }
      if (score > 0) {
        out.push({ p: p, score: score, bonus: p.f * FAMOUS_BONUS, hits: hits });
      }
    }
    out.sort(function (a, b) {
      var sa = a.score + a.bonus, sb = b.score + b.bonus;
      if (sb !== sa) return sb - sa;
      return hash(seed + a.p.t) - hash(seed + b.p.t);
    });
    return out;
  }

  /* 有没有「底气」：至少得有一句真的撞上了你的事 */
  var CONFIDENT_AT = 1.0;

  /**
   * 排队。返回的一整队都是「匹配当下」的，可以一直往下换。
   * @returns {{items: Array, confident: boolean}}
   *          items 里每一项是 {t, d, a, s, score, hits}
   *          confident=false 表示信号太弱，给的是「通用」那一撮
   */
  function match(evt) {
    /* 库还没进来（开机头几百毫秒会这样）：如实返回空队，不硬凑一句糊弄人。
       上头等库到位后会重画一次，那时就是正常结果了。 */
    if (!build()) return { confident: false, items: [], pending: true };
    var sig = signalsOf(evt || {});
    var all = ranked(evt, sig);
    /* 用 score（不是 score+bonus）判底气：名句度不许把「其实没贴合」说成贴合 */
    var good = all.filter(function (x) { return x.score >= CONFIDENT_AT; });

    if (good.length) {
      return {
        confident: true,
        items: good.map(function (x) {
          return { t: x.p.t, d: x.p.d, a: x.p.a, s: x.p.s, score: x.score, hits: x.hits };
        })
      };
    }

    /* 信号太弱：不硬凑，只从最稳的那一撮里给。
       这一撮里优先给名句 —— 说不出所以然的时候，给一句眼熟的最稳。 */
    var pool = GENERAL.length ? GENERAL : POOL;
    var seed = (evt && evt.id) || '';
    var ordered = pool.slice().sort(function (a, b) {
      if ((b.f || 0) !== (a.f || 0)) return (b.f || 0) - (a.f || 0);
      return hash(seed + a.t) - hash(seed + b.t);
    });
    return {
      confident: false,
      items: ordered.map(function (p) {
        return { t: p.t, d: p.d, a: p.a, s: p.s, score: 0, hits: [] };
      })
    };
  }

  /* 找到这一句在队里的位置 —— 「换一首」就靠它接着往下走 */
  function indexOfLine(items, line) {
    if (!line || !items || !items.length) return -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].t === line.t) return i;
    }
    return -1;
  }

  global.Poem = {
    match: match,
    indexOfLine: indexOfLine,
    signalsOf: signalsOf,
    ready: ready,
    load: load,
    count: function () { return build() ? POOL.length : 0; },
    tagCount: function () { return build() ? TAGS.length : 0; },
    /* 出处这一栏要等库进来了才有。写成取值函数，别在模块初始化那一刻抓空值。 */
    get source() { return (DATA && DATA.src) || ''; }
  };
})(window);
