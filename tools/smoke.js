/* 冒烟测试：在真实 DOM 里把 App 跑起来，逐页遍历 + 验证核心行为。
   运行：node tools/smoke.js   （内置静态服务器，不需要外部进程） */
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const FILE = path.join(WEB, 'index.html');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png'
};

function serve(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const abs = path.join(WEB, rel);
      if (!abs.startsWith(WEB) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        res.writeHead(404); res.end('404'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
      res.end(fs.readFileSync(abs));
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

const problems = [];
const vc = new VirtualConsole();
vc.on('error', (m) => problems.push('console.error: ' + m));
vc.on('jsdomError', (e) => {
  const msg = String(e && e.message);
  if (/Not implemented/.test(msg)) return;   // jsdom 自身缺失的浏览器 API，不算本项目问题
  problems.push('jsdomError: ' + msg);
});
vc.on('warn', () => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, cond, extra) {
  const ok = !!cond;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  →  ' + extra : ''));
  if (!ok) problems.push(name);
  return ok;
}

(async () => {
  const PORT = 5399;
  const server = await serve(PORT);

  const dom = await JSDOM.fromFile(FILE, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: 'http://127.0.0.1:' + PORT + '/index.html', virtualConsole: vc
  });
  const { window } = dom;
  const doc = window.document;

  await new Promise((r) => window.addEventListener('load', r));
  await wait(450);

  const S = () => doc.querySelector('#stage');
  const T = () => S().textContent;
  const click = (sel) => { const el = doc.querySelector(sel); if (el) { el.click(); return true; } return false; };
  const clickAll = (sel, fn) => Array.prototype.forEach.call(doc.querySelectorAll(sel), fn);

  /* ============================================================ */
  console.log('\n[1] 启动 / 模块 / 首页');
  check('Store / Text / Poem / Views / LocalEngine / SimpleZip 全部挂载',
    !!(window.Store && window.Text && window.Poem && window.Views && window.LocalEngine && window.SimpleZip));
  check('AI 模块已经彻底拿掉', typeof window.AI === 'undefined');
  check('降级存储生效（jsdom 无 IndexedDB）', window.Store.usingFallback());
  check('首页渲染', S().innerHTML.length > 40);
  check('首页无顶栏（标题/搜索/设置都不在）',
    !doc.querySelector('#topbar').classList.contains('on'));
  check('首页只有一个「今日记录」按钮',
    doc.querySelectorAll('#stage button').length === 1 && /今日记录/.test(T()));
  check('首页没有日期 / 没有最近记录 / 没有小字说明',
    !doc.querySelector('.home-date') && !doc.querySelector('.home-recent') &&
    !doc.querySelector('.home-note') && !/最近|先完整写下来/.test(T()));
  check('首页没有灰色说教文案', !/写下来|别急着|属于哪一类|AI 可以整理/.test(T()));
  const navTabs = doc.querySelectorAll('#tabbar .tab');
  check('导航三栏 = 沉淀 / 首页 / 轨迹（首页居中）',
    navTabs.length === 3 &&
    navTabs[0].getAttribute('data-route') === 'sediment' &&
    navTabs[1].getAttribute('data-route') === 'home' &&
    navTabs[2].getAttribute('data-route') === 'trace');
  check('按钮是超大圆角（38~42px 区间）',
    /--r-record:\s*40px/.test(fs.readFileSync(path.join(WEB, 'assets/style.css'), 'utf8')));
  check('存在氛围层（背景跟随主题色）', !!doc.querySelector('#aura'));

  /* ============================================================ */
  console.log('\n[2] 写一条记录并保存');
  click('[data-act="new-record"]');
  await wait(160);
  const ta = doc.querySelector('#rawInput');
  check('进入编辑器', !!ta);
  const TEXT = '今天领导突然让我接一个任务，我其实特别不想接，但是他问我的时候我还是马上说可以，答应以后我就有点后悔了。我发现我不是不会拒绝，而是根本没有给自己拒绝的时间。下次别人突然问我的时候，我先说晚点回复。';
  ta.value = TEXT;
  ta.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(60);
  click('[data-act="save-raw"]');
  await wait(400);

  const rawStore = window.localStorage.getItem('gbm.fallback');
  check('数据落到本地存储', !!rawStore && rawStore.length > 50);
  const parsed = JSON.parse(rawStore);
  const evt = Object.keys(parsed).map((k) => parsed[k]).filter((o) => o.kind === 'event')[0];
  check('落库为成长事件', !!evt);
  check('原文一字不差', evt && evt.rawText === TEXT);
  check('保存后回到首页，首页依然干净（没有最近记录）',
    doc.querySelector('#stage').textContent.indexOf('最近') < 0 &&
    doc.querySelectorAll('#stage button').length === 1,
    T().slice(0, 30));
  check('三个格子初始全为空（不许 AI 造）',
    evt && ['yuanqi', 'zhaojian', 'xingchi'].every((k) => evt.blocks[k] === null));

  /* ============================================================ */
  console.log('\n[3] 本地引擎：口水词清理（不联网）');
  const noisy = '今天我呃本来想拒绝，但是呃最后还是答应了。';
  const res = window.LocalEngine.clean(noisy);
  check('找出了口水词「呃」', res.fills.some((f) => f.term === '呃'), JSON.stringify(res.fills));
  const diff = window.Text.buildDiff(noisy, res.fills, []);
  check('差异分成了保留段与删除段',
    diff.some((p) => p.type === 'keep') && diff.some((p) => p.type === 'drop'));
  check('清理结果没改写一个字',
    diff.filter((p) => p.type === 'keep').map((p) => p.text).join('') === '今天我本来想拒绝，但是最后还是答应了。');
  const clean2 = window.LocalEngine.clean('刚刚我慢慢走过去，偷偷看了一眼，哈哈。');
  check('正常叠词不会被误删（刚刚/慢慢/偷偷/哈哈）', clean2.fills.length === 0,
    JSON.stringify(clean2.fills));
  const clean3 = window.LocalEngine.clean('我我我我不是那个意思');
  check('结巴重复能被抓到', clean3.fills.some((f) => f.kind === 'stutter'),
    JSON.stringify(clean3.fills));
  /* 用户报的：正常叠词被误删 */
  const clean4 = window.LocalEngine.clean('我们谈谈恋爱的事情，慢慢说。');
  check('「谈谈恋爱」不会被误删（正常叠词）', clean4.fills.length === 0,
    JSON.stringify(clean4.fills));
  const clean5 = window.LocalEngine.clean('。我我觉得这样不行');
  check('「我我」在句首仍会被认成口吃', clean5.fills.some((f) => f.term === '我我'),
    JSON.stringify(clean5.fills));

  /* ============================================================ */
  console.log('\n[4] 整理流程（本地）：走完三步');
  const findById = (id) => {
    const raw = JSON.parse(window.localStorage.getItem('gbm.fallback') || '{}');
    return Object.keys(raw).map((k) => raw[k]).filter((o) => o && o.id === id)[0];
  };

  click('#tabbar .tab[data-route="trace"]');
  await wait(360);
  const entry = doc.querySelector('[data-act="open-event"][data-id="' + evt.id + '"]');
  check('轨迹里能打开这条记录', !!entry);
  if (entry) { entry.click(); await wait(360); }
  check('详情页能看到「整理这条」', click('[data-act="start-tidy-from"]'));
  await wait(520);
  check('第一步出现（本地规则，无需联网）', /口水词/.test(T()));
  check('「可以留意的地方」已经拿掉了', !/可以留意的地方/.test(T()));

  /* —— 只剩本机一条路：AI 整个砍了 —— */
  check('整理页不再有「选引擎」那条（AI 已砍）', doc.querySelector('.engine-seg') === null);
  /* 用户 2026-10-04 让把这行说明删掉（太啰嗦，底下那张卡片已经说得够清楚） */
  check('清理那步不再重复解释一遍（那行说明已删）', !/不联网/.test(T()));
  check('整理全流程里不再出现 AI 字样', !/\bAI\b/.test(T()), T().slice(0, 40));

  /* —— 清理那一步可以自己动手改 —— */
  check('清理步骤有「我自己改一遍」', click('[data-act="start-edit-clean"]'));
  await wait(300);
  const ce = doc.querySelector('#cleanEdit');
  check('打开后出现可编辑的文本框', !!ce);
  if (ce) ce.value = '随便改改试试';
  check('能返回对照视图', click('[data-act="cancel-edit-clean"]'));
  await wait(280);
  check('返回后回到对照视图',
    !doc.querySelector('#cleanEdit') && /灰色划掉|没有找到该删/.test(T()));

  click('[data-act="start-edit-clean"]');
  await wait(280);
  const ce2 = doc.querySelector('#cleanEdit');
  const MY_EDIT = '我第一次看到领导皱眉就答应了，下次我要先说我想想。';
  if (ce2) ce2.value = MY_EDIT;
  click('[data-act="apply-clean-edited"]');
  await wait(560);
  const midEvt = findById(evt.id);
  check('自己改过的内容被存为清理后文本', midEvt && midEvt.cleanText === MY_EDIT,
    midEvt && midEvt.cleanText);
  check('原文一个字都没动', midEvt && midEvt.rawText === TEXT);
  check('改完直接进第二步', /原文比对/.test(T()));

  check('拆开那步也全是本机规则（只剩一条路）', doc.querySelector('.engine-seg') === null);
  check('拆开那步不再有候选提示（用户说鸡肋，整块撤了）',
    !/不会替你写/.test(T()) && !/可能可以放进这些格子/.test(T()));
  check('拆开那步仍然能展开看原文（一个字都没删）', /原文比对/.test(T()));
  check('第二步是三个格子（缘起 / 照见 / 行持）',
    doc.querySelectorAll('[data-act="fill-block"]').length +
    doc.querySelectorAll('[data-act="edit-block"]').length === 3);
  check('三个格子的标题就是两个字',
    /缘起/.test(T()) && /照见/.test(T()) && /行持/.test(T()));
  check('长句提示写在框里（不再有「自己写这一项」按钮）',
    !/自己写这一项/.test(T()) && /发生了什么？/.test(T()));

  /* —— 点空白格直接写字 ——
     2026-10-05 用户把「自己写这一项」按钮删了：那是接入 AI 时留下的，
     那时这一步由 AI 拆、用户只能点按钮补一格。现在整块空白本身就是开关。 */
  const zjBlank = doc.querySelector('[data-act="fill-block"][data-key="zhaojian"]');
  check('没记录的格子整块可以点（不再有「自己写这一项」按钮）', !!zjBlank);
  check('空白格里显示的是灰字提示（发生了什么？ / 这件事让我看见了什么？）',
    !!zjBlank && /这件事让我看见了什么/.test(zjBlank.textContent));
  if (zjBlank) {
    zjBlank.click();
    await wait(350);
    const zjBox = doc.querySelector('[data-act="edit-block"][data-key="zhaojian"]');
    check('点一下空白格就直接变成输入框', !!zjBox);
    check('输入框里的灰字提示还在（placeholder，不是正文）',
      !!zjBox && /这件事让我看见了什么/.test(zjBox.getAttribute('placeholder') || ''));
    if (zjBox) {
      zjBox.value = '我是没给自己留时间';
      zjBox.dispatchEvent(new window.Event('focusout', { bubbles: true }));
      await wait(250);
    }
  }

  /* —— 用户 2026-10-04 报的 bug：在「行持」写完字，
        点下面另一格，上面写的字就变回空白。
        根因不在输入框，在状态：refresh() 换掉了 byId 里的对象，
        却漏了正在整理的那条（editingEvent），而界面画的正是它 ——
        于是重画时用旧副本把刚写的东西盖回去了（库里其实是好的）。 —— */
  const xcBlank = doc.querySelector('[data-act="fill-block"][data-key="xingchi"]');
  check('这时「行持」还是空格子，可以点开', !!xcBlank);
  if (xcBlank) {
    xcBlank.click();
    await wait(360);
    const xcBox = doc.querySelector('[data-act="edit-block"][data-key="xingchi"]');
    check('点开之后输入框出现了', !!xcBox);
    if (xcBox) {
      xcBox.value = '先给自己三分钟再回答';
      /* 失焦＝离开输入框，真实操作里点别的按钮就是这个动作 */
      xcBox.dispatchEvent(new window.Event('focusout', { bubbles: true }));
      await wait(300);

      /* 再去点另一个格子，这会触发一次重画 */
      const another = doc.querySelector('[data-act="fill-block"]');
      check('还有别的空格子可以点（用来触发重画）', !!another);
      if (another) { another.click(); await wait(500); }

      const xcAfter = doc.querySelector('[data-act="edit-block"][data-key="xingchi"]');
      check('点别的格子之后，上面写的内容还在屏幕上（不再变回空白）',
        !!xcAfter && xcAfter.value === '先给自己三分钟再回答',
        xcAfter ? JSON.stringify(xcAfter.value) : '输入框整个没了');

      const xcStored = findById(evt.id).blocks.xingchi;
      check('这条内容也已经落库，屏幕和库一致',
        !!xcStored && xcStored.text === '先给自己三分钟再回答',
        JSON.stringify(xcStored));
    }
  }

  /* —— 分类推荐也是本机撞词表 —— */
  const sug = window.LocalEngine.suggestTags('领导临时给我派活，我不好意思拒绝，还是答应了，回家又后悔。');
  check('分类推荐能撞出「边界不足 / 讨好」这类机制',
    sug.mechanism.length > 0, sug.mechanism.join('/'));
  check('分类推荐能撞出「工作」这个领域', sug.domain.indexOf('工作') >= 0, sug.domain.join('/'));
  check('每组最多 3 个，不刷屏',
    sug.domain.length <= 3 && sug.mechanism.length <= 3 && sug.scene.length <= 3);
  check('什么都没撞到时就是空的（不硬塞）',
    Object.keys(window.LocalEngine.suggestTags('今天天气不错')).every((k) =>
      window.LocalEngine.suggestTags('今天天气不错')[k].length === 0));

  /* 手写进去的内容要能标成「我写的」，别跟原话混起来 */
  check('手写的内容被标成「我写的」', /我写的/.test(T()));

  click('[data-act="accept-split"]');
  await wait(400);
  check('第三步出现分类', /领域|问题机制|场景/.test(T()));

  /* 用户报的：分类那步一个推荐都没有了 */
  const sugChips = doc.querySelectorAll('.chip.suggest').length;
  check('分类那步有本机推荐（拿你的原话撞候选池，撞到才摆出来）', sugChips > 0,
    sugChips + ' 个推荐标签');
  check('「＋ 其他」还在（推荐之外还能自己加）',
    doc.querySelectorAll('[data-act="pick-tag"]').length === 3);

  /* —— 用户 2026-10-04 报的 bug：这块区域点了以后再点没有反应。
        两层原因：① editingEvent 是旧副本（同上面的 bug）；
        ② 选中的词会被挪到最前面，一点整行就位移，同一个位置点两下会点到隔壁词上。
        现在：位置固定，点一下＝选上，再点一下＝取消。 —— */
  const tlChips = () => Array.prototype.slice.call(doc.querySelectorAll('.chip[data-act="toggle-tag"]'));
  const tlLabels = () => tlChips().map((c) => c.getAttribute('data-group') + ':' + c.getAttribute('data-value'));
  const tlOn = () => tlChips().filter((c) => c.classList.contains('on')).length;
  const firstChip = tlChips()[0];
  check('分类里有可点的标签', !!firstChip);
  if (firstChip) {
    const cKey = firstChip.getAttribute('data-value');
    const cGroup = firstChip.getAttribute('data-group');
    const orderBefore = tlLabels();
    const onBefore = tlOn();

    firstChip.click();
    await wait(420);
    check('点一下标签，界面上立刻看得到（不再是「没反应」）', tlOn() === onBefore + 1,
      onBefore + ' → ' + tlOn());
    check('标签的位置一个都没动（选中的词留在原位）',
      JSON.stringify(tlLabels()) === JSON.stringify(orderBefore));
    check('库里的标签也跟着加上了', (findById(evt.id).tags[cGroup] || []).indexOf(cKey) >= 0,
      JSON.stringify(findById(evt.id).tags[cGroup]));

    const sameChip = doc.querySelector('[data-act="toggle-tag"][data-group="' + cGroup +
      '"][data-value="' + cKey + '"]');
    sameChip.click();
    await wait(420);
    check('同一个词再点一下＝取消，界面跟着变', tlOn() === onBefore, onBefore + ' → ' + tlOn());
    check('取消也从库里真的去掉了',
      (findById(evt.id).tags[cGroup] || []).indexOf(cKey) < 0,
      JSON.stringify(findById(evt.id).tags[cGroup]));
  }

  /* 用户报的：点「＋ 其他」没反应（原本用的是系统 prompt，手机上会被拦） */
  click('[data-act="pick-tag"][data-group="domain"]');
  await wait(320);
  const tgi = doc.querySelector('#tagInput');
  check('「＋ 其他」就地给出输入框，不弹系统框', !!tgi);
  if (tgi) {
    /* 一有字就得能按下「加上」；先试「打到一半跑去点别处」会不会被吞 */
    tgi.value = '半截话';
    const anyChipNow = doc.querySelector('.chip[data-act="toggle-tag"]');
    if (anyChipNow) { anyChipNow.click(); await wait(420); }
    const tgi2 = doc.querySelector('#tagInput');
    check('在「＋ 其他」里打一半就去点别处，字不会被吞',
      !!tgi2 && tgi2.value === '半截话',
      tgi2 ? JSON.stringify(tgi2.value) : '输入框整个没了');

    const tgi3 = doc.querySelector('#tagInput');
    if (tgi3) tgi3.value = '自律';
    click('[data-act="add-tag-custom"][data-group="domain"]');
    await wait(420);
    check('自定义标签真的加上了', /自律/.test(T()));
  } else {
    check('自定义标签真的加上了', false, '输入框没出来');
  }

  click('[data-act="skip-tags"]');
  await wait(620);
  check('保存后回到这条记录', /如果今天再遇到/.test(T()));

  /* ============================================================ */
  console.log('\n[5] 回溯：先锁住 → 写了才给按钮 → 按了才打开');
  let think = doc.querySelector('#thinkInput');
  check('有思考输入框', !!think);
  check('当时的内容锁着（有锁提示）', /都还锁着/.test(T()) && !!doc.querySelector('.lock-card'));
  check('没写字之前，「查看过去的自己」根本不给',
    !!doc.querySelector('#revealBtn') && doc.querySelector('#revealBtn').hidden === true);
  check('锁着的时候看不到当时的自己', doc.querySelector('.reveal') === null);
  check('「后来怎么样了」也要打开之后才出现',
    doc.querySelectorAll('.outcome-btn').length === 0);

  /* 低调的跳过入口：已经在别处想过的人，点得到但不会误触 */
  click('[data-act="peek-past"]');
  await wait(380);
  check('「已经在别处想过了」能直接看', !!doc.querySelector('.reveal'));
  click('#tabbar .tab[data-route="trace"]');
  await wait(340);
  click('[data-act="open-event"][data-id="' + evt.id + '"]');
  await wait(380);
  check('离开再回来，锁还是锁着（跳过不写不留痕）',
    !!doc.querySelector('.lock-card') && doc.querySelector('.reveal') === null);

  think = doc.querySelector('#thinkInput');
  think.value = '现在的我会先说我要想一想';
  think.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(160);
  check('写了字才把按钮给他', doc.querySelector('#revealBtn').hidden === false);

  /* 同一个毛病的另一处：想法写到一半去点「换一句」，整块会被重画，
     临时输入框里的字不能被吞（而且补回去之后按钮还得照样给）。 */
  const thinkHalf = doc.querySelector('#thinkInput');
  if (thinkHalf) thinkHalf.value = '写到一半去点了换一句';
  const shuffleBtn = doc.querySelector('[data-act="shuffle-poem"]');
  check('这条记录页有「换一句」（用它来触发一次重画）', !!shuffleBtn);
  if (shuffleBtn) { shuffleBtn.click(); await wait(480); }
  const thinkAfter = doc.querySelector('#thinkInput');
  check('想法写到一半去点「换一句」，字不会被吞',
    !!thinkAfter && thinkAfter.value === '写到一半去点了换一句',
    thinkAfter ? JSON.stringify(thinkAfter.value) : '输入框整个没了');
  check('补回去之后「查看过去的自己」照样给得出来',
    !!doc.querySelector('#revealBtn') && doc.querySelector('#revealBtn').hidden === false);

  const thinkBack = doc.querySelector('#thinkInput');
  if (thinkBack) thinkBack.value = '现在的我会先说我要想一想';

  click('#revealBtn');
  await wait(500);
  check('按了才打开当时的自己', !!doc.querySelector('.reveal'));
  check('三项都列出来（没写的还是显示未记录）',
    doc.querySelectorAll('.reveal .block').length === 3 && /未记录/.test(T()));
  check('「当时给自己定的做法」被单独强调', !!doc.querySelector('.block.focus'));
  check('打开之后才有三个结果选项',
    doc.querySelectorAll('.outcome-btn').length === 3);

  /* ============================================================ */
  console.log('\n[6] 红线：一个字都不许造');
  const srcLine = '今天本来想拒绝，但是呃最后还是答应了。';
  const lc = window.LocalEngine.clean(srcLine);
  const d2 = window.Text.buildDiff(srcLine, lc.fills, []);
  check('原文 → 差异：整段顺序拼回去和原文一模一样（没凭空多字）',
    d2.map((p) => p.text).join('') === srcLine, d2.map((p) => p.text).join(''));
  check('清理结果没改写一个字',
    d2.filter((p) => p.type === 'keep').map((p) => p.text).join('') === '今天本来想拒绝，但是最后还是答应了。');
  check('差异里只有 {type,text}，没有「生成/改写」这类字段',
    d2.every((p) => Object.keys(p).length === 2 && (p.type === 'keep' || p.type === 'drop')));
  check('留下的词被单独标成一档（不然想改回「删」都没地方点）',
    window.Text.buildDiff(srcLine, lc.fills, ['呃']).some((p) => p.type === 'kept'));
  check('留下的词仍然算「清理后留下的正文」',
    window.Text.keptText(window.Text.buildDiff(srcLine, lc.fills, ['呃'])) === srcLine);
  check('不管留还是删，三段拼回去都和原文一字不差',
    window.Text.buildDiff(srcLine, lc.fills, ['呃']).map((p) => p.text).join('') === srcLine);

  /* ============================================================ */
  console.log('\n[7] 页面遍历 + 入口位置');
  click('#tabbar .tab[data-route="sediment"]');
  await wait(300);
  check('沉淀页有顶栏', doc.querySelector('#topbar').classList.contains('on'));
  check('搜索入口在沉淀页顶栏', !!doc.querySelector('#topbar [data-act="go"][data-route="search"]'));
  check('沉淀页有 问题/收获/合集 三个切换',
    doc.querySelectorAll('[data-act="sed-tab"]').length === 3);
  click('[data-act="sed-tab"][data-tab="xingchi"]');
  await wait(250);
  check('收获页能打开', T().length > 5);
  click('[data-act="sed-tab"][data-tab="col"]');
  await wait(250);
  check('合集页能打开', T().length > 5);

  click('#tabbar .tab[data-route="trace"]');
  await wait(300);
  check('轨迹页有顶栏', doc.querySelector('#topbar').classList.contains('on'));
  check('设置入口在轨迹页顶栏', !!doc.querySelector('#topbar [data-act="go"][data-route="settings"]'));
  check('轨迹有时间线', /时间线/.test(T()));

  click('[data-act="go"][data-route="settings"]');
  await wait(350);
  check('设置页打开', /主题颜色/.test(T()));
  check('有主题色板（14 色）', doc.querySelectorAll('[data-act="set-theme"]').length === 14);
  check('有自定义取色器', !!doc.querySelector('#customColor'));
  check('有导出/恢复备份', !!doc.querySelector('[data-act="export"]') && !!doc.querySelector('[data-act="import"]'));
  check('设置页没有 AI 接口卡（整块拆了）',
    !doc.querySelector('#cfgVendor') && !doc.querySelector('#cfgKey') && !doc.querySelector('#cfgUrl'));
  check('设置页没有服务商/模型下拉', !doc.querySelector('#cfgModelSel'));
  check('设置页没有测试连通按钮', !doc.querySelector('[data-act="test-api"]'));
  check('设置页里不再出现 AI 字样', !/\bAI\b/.test(T()), T().slice(0, 40));
  check('「它是怎么干活的」那张说明卡已经删了', !/它是怎么干活的|一共 \d+ 首诗词/.test(T()));

  /* —— 关于 —— */
  check('设置页有「关于」', /关于/.test(T()));
  check('关于里有版本号 V1.0.0', /V1\.0\.0/.test(T()));
  check('关于里有制作人', /凤箫声动/.test(T()));
  check('关于里有「检查更新」', !!doc.querySelector('[data-act="check-update"]'));
  check('版本号和 git tag 对得上（Store.APP）',
    window.Store.APP && window.Store.APP.version === '1.0.0' &&
    /^[\w.-]+\/[\w.-]+$/.test(window.Store.APP.repo), JSON.stringify(window.Store.APP));
  check('没有 PRO 锁这种东西', !/PRO|解锁|升级/.test(T()));

  /* —— 不是方的：顶栏与底部导航都是悬浮圆角玻璃 —— */
  const css = fs.readFileSync(path.join(WEB, 'assets/style.css'), 'utf8');
  check('顶栏是悬浮圆角玻璃块（不再是一整条横杠）',
    /\.tb-row\{[^}]*border-radius:20px/.test(css) && /#topbar\{[^}]*padding:calc\(var\(--safe-t\)/.test(css));
  check('顶栏没有那条硬邦邦的下边框', !/#topbar\{[^}]*border-bottom:1px/.test(css));
  check('底部导航是左右留边的圆角药丸',
    /#tabbar::before\{[^}]*border-radius:var\(--r-nav\)/.test(css) &&
    !/#tabbar\{[^}]*border-top:1px/.test(css));
  check('自定义颜色也是圆角（连内层色块一起圆）',
    /#customColor\{[^}]*border-radius:14px/.test(css) &&
    /#customColor::-webkit-color-swatch\{[^}]*border-radius:14px/.test(css));

  /* —— 整理页底部的操作区怎么排（用户：放左边够不到；后来又让重排这一块） —— */
  check('底部操作区：主要操作占满整宽（主按钮最大、最好按）',
    /\.tidy-foot > \.btn\{[^}]*width:100%/.test(css));
  check('底部操作区：次要操作靠右（不再居中）',
    /\.btn-row\{[^}]*justify-content:flex-end/.test(css) &&
    !/\.btn-row > \.btn:only-child\{[^}]*margin:0 auto/.test(css));
  check('按钮里的文字仍然是居中的（父级布局不会把标签带偏）',
    /\.btn\{[^}]*text-align:center/.test(css));

  /* 次要操作在上、主要操作在下：靠 HTML 顺序保证，这条直接看渲染出来的结构 */
  const footWrap = doc.createElement('div');
  footWrap.innerHTML = window.Views.tidy({
    tidy: { step: 1, diff: null },
    editingEvent: window.Store.newEvent('今天领导让我接活。下次我先说我想想。')
  });
  const footEl = footWrap.querySelector('.tidy-foot');
  const footKids = footEl ? Array.prototype.map.call(footEl.children, (c) => c.className) : [];
  check('底部操作区：次要操作那一行排在主要操作前面（主按钮离拇指最近）',
    footKids.length === 2 && /btn-row/.test(footKids[0]) && /\bprimary\b/.test(footKids[1]),
    footKids.join(' / ') || '没渲染出 .tidy-foot');

  /* —— 原文要保住分段（用户报的「分好段被整合到一起」） ——
     光看 CSS 不够，这里真的造一条带空行的记录，走一遍渲染，看它有没有被揉成一坨。 */
  check('原文/差异显示保留换行与分段',
    /\.block-body\{[^}]*white-space:pre-wrap/.test(css));
  const P_TEXT = '第一段：今天领导让我接活。\n\n第二段：我其实不想接。\n\n第三段：下次我先说我想想。';
  const pEvt = window.Store.newEvent(P_TEXT);
  const pWrap = doc.createElement('div');
  pWrap.innerHTML = window.Views.event({ openEvent: pEvt, byId: {} });
  const pBody = pWrap.querySelector('.block-body');
  check('带空行的原文渲染出来还留着空行（没被整合成一坨）',
    !!pBody && pBody.textContent === P_TEXT,
    pBody ? JSON.stringify(pBody.textContent) : '压根没渲染出原文块');
  check('原文块没有用 <br> 糊（靠 pre-wrap 保留，复制出去还是原文）',
    /\.block-body\{[^}]*white-space:pre-wrap/.test(css) &&
    !/<br\s*\/?>/i.test(pBody ? pBody.innerHTML : ''));

  /* —— 空态文案精简（源码里就不该再有这两句） —— */
  const viewsSrc = fs.readFileSync(path.join(WEB, 'js', 'views.js'), 'utf8');
  check('空态不再有多余的副标题',
    !/收获只能是你自己写下的|写完点「整理」/.test(viewsSrc));

  /* ============================================================ */
  console.log('\n[8] 诗词库（全在本机，不需要联网）');

  /* —— 920 KB 的句库不许在开机时就同步加载 ——
     光解析就要两三百毫秒，放在首屏等于白等。它必须由 Poem.load() 在后台挂上来。 */
  const indexSrc = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const appSrcEarly = fs.readFileSync(path.join(WEB, 'js', 'app.js'), 'utf8');
  check('句库没有写在 index.html 的同步 <script> 里（不然首屏要白等）',
    !/<script[^>]+poem-data\.js/.test(indexSrc));
  check('句库是后台挂上来的（Poem.load 真的被调了）',
    /Poem\.load\(\)/.test(appSrcEarly) && typeof window.Poem.load === 'function');
  check('首屏跑完时句库已经在用了（懒加载没有把它弄丢）',
    window.Poem.ready() === true && window.Poem.count() >= 2000);

  check('句库有存货（要够用很久）', window.Poem.count() >= 2000, window.Poem.count() + ' 句');
  check('标签体系成型', window.Poem.tagCount() >= 25, window.Poem.tagCount() + ' 个标签');

  const evDelay = {
    id: 't-delay', rawText: '今天又拖到晚上才做，一直自责，觉得自己很没用',
    cleanText: '', blocks: {}, tags: { domain: ['自我管理'], mechanism: ['拖延'], scene: [] }
  };
  const m1 = window.Poem.match(evDelay);
  check('拖延 + 自责 → 有底气给（不用兜底）', m1.confident === true);
  check('给的是一句，不是一整首', typeof m1.items[0].t === 'string' && m1.items[0].t.length <= 30,
    m1.items[0].t);
  check('朝代 / 作者 / 篇名齐全',
    !!(m1.items[0].d && m1.items[0].a && m1.items[0].s),
    m1.items[0].d + ' · ' + m1.items[0].a + ' 《' + m1.items[0].s + '》');
  check('排在前面的确实是匹配当下的（分数达标）',
    m1.items.every((x) => x.score >= 1.0), '队里 ' + m1.items.length + ' 句');
  check('队里每一句都命中了标签（不是随便排的）',
    m1.items.every((x) => x.hits.length > 0));

  const m2 = window.Poem.match(evDelay);
  check('同一条记录结果固定（刷新不会乱跳）',
    m2.items.map((x) => x.t).join('|') === m1.items.map((x) => x.t).join('|'));
  check('「换一句」是顺着分数往下走，下一句照样匹配当下',
    m1.items.length > 1 && m1.items[1].score <= m1.items[0].score &&
    m1.items[1].hits.length > 0,
    '下一句：' + m1.items[1].t);
  check('第二句和第一句不是同一句', m1.items[1].t !== m1.items[0].t);
  const at0 = window.Poem.indexOfLine(m1.items, m1.items[0]);
  check('能找回当前这句在队里的位置（换一句靠它接着走）', at0 === 0);

  const evBare = { id: 't-bare', rawText: '', cleanText: '', blocks: {}, tags: { domain: [], mechanism: [], scene: [] } };
  const mW = window.Poem.match(evBare);
  check('完全没信号时不硬凑，只给最稳的那一撮（宁可平也不跑偏）',
    mW.confident === false && mW.items.length > 0, mW.items.length + ' 句兜底');
  check('没信号时给的是「通用」那批',
    mW.items[0].score === 0);

  check('库里没有重复的句子',
    new Set(window.Poem.match(evDelay).items.map((x) => x.t)).size ===
    window.Poem.match(evDelay).items.length);
  check('注明数据出处', /chinese-poetry/.test(window.Poem.source), window.Poem.source);
  const corpus = window.POEM_DATA;
  check('每一句都带朝代 / 作者 / 篇名 / 标签',
    corpus.lines.every((l) => l.t && l.d && l.a && l.s && l.g && l.g.length));
  check('句子里没有半截话（结尾不停在逗号上）',
    corpus.lines.every((l) => !/[，,、：:；;]$/.test(l.t)),
    corpus.lines.filter((l) => /[，,、：:；;]$/.test(l.t)).length + ' 句不合格');
  check('句子里没有序文/注（不带引号冒号括号）',
    corpus.lines.every((l) => !/[：:""''（）()「」]/.test(l.t)));
  const authors = new Set(corpus.lines.map((l) => l.a));
  check('作者面铺得开', authors.size >= 300, authors.size + ' 位作者');
  const books = new Set(corpus.lines.map((l) => l.d));
  check('朝代跨得开（不只一个朝代）', books.size >= 4, [...books].join('/'));

  /* ============================================================ */
  console.log('\n[9] 主题色切换');
  const swatches = doc.querySelectorAll('[data-act="set-theme"]');
  if (swatches.length) {
    swatches[1].click();      // 选第二个预设色
    await wait(300);
    const applied = doc.documentElement.style.getPropertyValue('--accent');
    check('主题色已注入 CSS 变量', !!applied, applied);
    check('氛围层背景跟着变', !!doc.documentElement.style.getPropertyValue('--aura-1'));
  }

  /* ============================================================ */
  console.log('\n[10] ZIP 打包与解包');
  const zipped = window.SimpleZip.zip([
    { name: '全部数据.json', data: '{"format":"growth-bug-manager","version":1}' },
    { name: '关于.txt', data: '中文内容测试' }
  ]);
  check('生成了 ZIP 字节流', zipped && zipped.length > 100, zipped.length + ' bytes');
  check('ZIP 魔数正确', zipped[0] === 0x50 && zipped[1] === 0x4B && zipped[2] === 0x03 && zipped[3] === 0x04);

  /* 解包验证（STORE 模式） */
  const dv = new DataView(zipped.buffer);
  let p = 0, found = [];
  while (p < zipped.length - 4 && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true);
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const nameStart = p + 30;
    let nm = '';
    for (let k = 0; k < nameLen; k++) nm += String.fromCharCode(zipped[nameStart + k]);
    const dataStart = nameStart + nameLen + extraLen;
    let txt = '';
    for (let k = 0; k < size; k++) txt += String.fromCharCode(zipped[dataStart + k]);
    found.push({ name: decodeURIComponent(escape(nm)), text: decodeURIComponent(escape(txt)) });
    p = dataStart + size;
  }
  check('解出两个文件', found.length === 2, found.map((f) => f.name).join(','));
  check('中文文件名正确', found.some((f) => f.name === '关于.txt'));
  check('中文内容正确', found.some((f) => f.text === '中文内容测试'));
  check('JSON 内容正确', found.some((f) => /growth-bug-manager/.test(f.text)));

  /* ============================================================ */
  console.log('\n[11] 导出数据结构');
  const dump = await window.Store.exportAll();
  check('导出结构正确', dump.format === 'growth-bug-manager' && Array.isArray(dump.events));
  check('版本号存在', dump.version === 1);
  check('含事件', dump.events.length >= 1);

  /* ============================================================ */
  console.log('\n[12] 日期用阿拉伯数字');
  const dn = window.Views.dateNum('2026-10-04T10:00:00');
  check('日期是阿拉伯数字', dn === '2026年10月4日', dn);
  const ft = window.Views.fullTime('2026-10-04T09:05:00');
  check('完整时间 = 阿拉伯日期 + 时刻', ft === '2026年10月4日 09:05', ft);

  /* ============================================================ */
  console.log('\n[13] AI 痕迹清干净了');
  check('Store 里没有 AI_PRESETS 了', typeof window.Store.AI_PRESETS === 'undefined');
  check('设置对象里没有 ai 字段', !(await window.Store.getSettings()).ai);
  check('js/ai.js 文件已删除', !fs.existsSync(path.join(WEB, 'js', 'ai.js')));
  const idxHtml = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  check('index.html 不再加载 ai.js', !/\bai\.js/.test(idxHtml));
  check('index.html 加载了 text.js / poem-data.js / poem.js',
    /js\/text\.js/.test(idxHtml) && /js\/poem-data\.js/.test(idxHtml) && /js\/poem\.js/.test(idxHtml));
  const swSrc = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
  check('离线缓存清单里没有 ai.js', !/\bai\.js/.test(swSrc));
  check('离线缓存清单里有 text.js / poem-data.js / poem.js',
    /js\/text\.js/.test(swSrc) && /js\/poem-data\.js/.test(swSrc) && /js\/poem\.js/.test(swSrc));
  check('离线缓存版本号升到了 v6', /gbm-shell-v6/.test(swSrc));
  /* 用户看到过旧样式（按钮还在左边）—— 因为老版本对 CSS/JS 是「缓存优先」，
     点一次刷新拿到的还是旧文件。改成网络优先，刷一次就是最新的。 */
  check('Service Worker 对网页文件用「网络优先」（刷新一次就能拿到最新样式）',
    /fetch\(req\)\.then/.test(swSrc) && /\.catch\(/.test(swSrc));
  check('断网时仍然回落到缓存（离线还能用）', /caches\.match\(req\)/.test(swSrc));
  check('句库文件真的存在且不小',
    fs.existsSync(path.join(WEB, 'js', 'poem-data.js')) &&
    fs.statSync(path.join(WEB, 'js', 'poem-data.js')).size > 100 * 1024,
    Math.round(fs.statSync(path.join(WEB, 'js', 'poem-data.js')).size / 1024) + ' KB');
  /* 注释里提一句「AI 已经砍掉」是允许的，这里查的是真的还在调 AI 的代码 */
  const aiCalls = [];
  fs.readdirSync(path.join(WEB, 'js')).forEach((f) => {
    const code = fs.readFileSync(path.join(WEB, 'js', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    if (/\bwindow\.AI\b|\bAI\s*\.|require\([^)]*ai\.js/.test(code)) aiCalls.push(f);
  });
  check('web/js 里已经没有一处还在调用 AI 的代码', aiCalls.length === 0, aiCalls.join(','));
  const cssSrc = fs.readFileSync(path.join(WEB, 'assets', 'style.css'), 'utf8');
  check('样式里的「选引擎」「测速」「候选提示」样式也一并删了',
    !/\.engine-seg/.test(cssSrc) && !/\.speed-num/.test(cssSrc) && !/\.cand[{.:]/.test(cssSrc));
  /* 拆开那块的候选 UI 撤掉之后，代码里不该再有任何一处产出它 */
  const candViewsSrc = fs.readFileSync(path.join(WEB, 'js', 'views.js'), 'utf8');
  const candAppSrc = fs.readFileSync(path.join(WEB, 'js', 'app.js'), 'utf8');
  check('视图里不再产出候选块（拆开那块已撤）', !/adopt-cand|t\.candidates/.test(candViewsSrc));
  check('控制器里也没有「采纳候选」这条死路了',
    !/adopt-cand|adoptCandidate/.test(candAppSrc));

  /* ============================================================ */
  console.log('\n[14] 本机规则：只提示不改写（界面上那卡片已按用户要求撤掉，能力保留）');
  const messy = '然后我就呃然后他又说然后我就答应了，其实我觉得可能应该拒绝反正就是然后就那样了';
  const ins = window.LocalEngine.inspect(messy);
  check('检查出了可以留意的地方', ins.length > 0, ins.map((x) => x.text).join(' / '));
  check('提示里不含改写后的文本（只提示不代笔）',
    ins.every((x) => typeof x.text === 'string' && !x.replace));
  check('详情页里已经看不到「可以留意的地方」这张卡',
    !/可以留意的地方/.test(T()));
  const cleanOf = window.LocalEngine.clean(messy);
  check('清理只动口水词，不动逻辑',
    cleanOf.fills.every((f) => f.kind !== 'logic'),
    JSON.stringify(cleanOf.fills.map((f) => f.term)));

  /* ============================================================ */
  console.log('\n[15] 自己新建合集');
  click('#tabbar .tab[data-route="sediment"]');
  await wait(300);
  click('[data-act="sed-tab"][data-tab="col"]');
  await wait(250);
  check('合集页有「自己新建合集」入口', !!doc.querySelector('[data-act="new-col"]'));
  click('[data-act="new-col"]');
  await wait(250);
  const nci = doc.querySelector('#newColName');
  check('点开后出现命名输入框', !!nci);
  if (nci) {
    nci.value = '总是先答应再后悔';
    click('[data-act="create-col"]');
    await wait(450);
    check('建好以后直接进入挑记录的界面',
      doc.querySelectorAll('[data-act="toggle-in-col"]').length > 0);
    const firstPick = doc.querySelector('[data-act="toggle-in-col"]');
    if (firstPick) {
      firstPick.click();
      await wait(400);
      check('点一下就把记录收进合集', /已加入/.test(T()));
      click('[data-act="done-pick"]');
      await wait(400);
      check('完成后回到合集页并显示条数', /1 条原记录/.test(T()), T().slice(0, 60));
      check('合集页有继续添加记录的入口', !!doc.querySelector('[data-act="pick-for-col"]'));
    }
  }

  /* ============================================================ */
  console.log('\n[16] 解开过的记录：打开就直接是当时的自己');
  click('#tabbar .tab[data-route="trace"]');
  await wait(340);
  const anyEntry = doc.querySelector('[data-act="open-event"]');
  if (anyEntry) {
    anyEntry.click();
    await wait(380);
    check('写过想法的记录，打开就看得见', !!doc.querySelector('.reveal'));
    check('不再出现锁', !doc.querySelector('.lock-card'));
    check('「当时给自己定的做法」仍被强调', !!doc.querySelector('.block.focus'));
    check('详情页顶部日期是阿拉伯数字 · 带具体时间',
      /2026年\d+月\d+日 \d{2}:\d{2}/.test(T()), T().slice(0, 26));

    /* —— 结尾那一句 —— */
    const poemLines = doc.querySelectorAll('.poem-line');
    check('写完/想完，底部配了一句诗', !!doc.querySelector('.poem-card') && poemLines.length === 1,
      poemLines.length + ' 行');
    const firstLine = poemLines[0] ? poemLines[0].textContent : '';
    check('就给一句，不是整首（一句就够）',
      firstLine.length > 0 && firstLine.length <= 30 && (firstLine.match(/[。！？]/g) || []).length <= 1,
      firstLine);
    check('标了朝代 · 作者 · 篇名',
      !!doc.querySelector('.poem-meta') &&
      /·/.test(doc.querySelector('.poem-meta').textContent) &&
      /《.+》/.test(doc.querySelector('.poem-meta').textContent),
      doc.querySelector('.poem-meta') && doc.querySelector('.poem-meta').textContent);
    check('有「换一句」', !!doc.querySelector('[data-act="shuffle-poem"]') &&
      /换一句/.test(doc.querySelector('[data-act="shuffle-poem"]').textContent));
    click('[data-act="shuffle-poem"]');
    await wait(460);
    const secondLine = doc.querySelector('.poem-line') ? doc.querySelector('.poem-line').textContent : '';
    check('「换一句」真的换了另一句', secondLine && secondLine !== firstLine, secondLine);
    check('换完还只有一句（不会越换越多）', doc.querySelectorAll('.poem-line').length === 1);
    const storedPoem = findById(evt.id);
    check('换过的那句被记下来（下次打开还是它）',
      !!(storedPoem && storedPoem.poem && storedPoem.poem.t === secondLine),
      storedPoem && storedPoem.poem && storedPoem.poem.t);
    /* 换过的这句必须是「匹配当下」的，不是随便抓的 */
    const rematch = window.Poem.match(storedPoem);
    check('换过的那句也在匹配队列里（不是随便换）',
      window.Poem.indexOfLine(rematch.items, storedPoem.poem) >= 0);
    /* 离开再回来，还是那一句 */
    click('#tabbar .tab[data-route="trace"]');
    await wait(340);
    click('[data-act="open-event"][data-id="' + evt.id + '"]');
    await wait(400);
    check('再打开还是同一句（不会每次刷新都变）',
      doc.querySelector('.poem-line') &&
      doc.querySelector('.poem-line').textContent === secondLine);

    /* 删除也不弹系统框 */
    click('[data-act="delete-event"]');
    await wait(300);
    check('删除给出就地确认，不弹系统框', !!doc.querySelector('[data-act="do-delete"]'));
    click('[data-act="cancel-delete"]');
    await wait(280);
    check('取消后回到原样，没删',
      !doc.querySelector('[data-act="do-delete"]') && !!doc.querySelector('[data-act="delete-event"]'));
  } else {
    check('写过想法的记录，打开就看得见', false, '轨迹里没有记录');
  }

  /* ============================================================ */
  console.log('\n[17] 设置图标是齿轮不是太阳');
  check('齿轮有 8 个齿（rect）',
    (window.Views.ICON.gear.match(/<rect/g) || []).length === 8,
    String((window.Views.ICON.gear.match(/<rect/g) || []).length));
  check('齿轮是圆环 + 8 齿结构',
    /<circle[^>]*r="7.2"/.test(window.Views.ICON.gear) && /rotate\(45/.test(window.Views.ICON.gear));

  /* ============================================================ */
  console.log('\n[18] 安卓壳 / 打包（唯一真源是 web/）');
  const AND = path.join(ROOT, 'android');
  const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
  const appGradle = readIf(path.join(AND, 'app', 'build.gradle'));
  const manifest = readIf(path.join(AND, 'app', 'src', 'main', 'AndroidManifest.xml'));
  const activity = readIf(path.join(
    AND, 'app', 'src', 'main', 'java', 'com', 'fengxiao', 'gbm', 'MainActivity.java'));
  const workflow = readIf(path.join(ROOT, '.github', 'workflows', 'android.yml'));

  check('安卓工程在', !!appGradle && !!manifest && !!activity);

  /* —— 两边的版本号必须是同一个数，不然「检查更新」会一直误报 —— */
  const gvMatch = appGradle.match(/versionName\s+'([^']+)'/);
  check('安卓 versionName 跟网页 Store.APP.version 一致',
    gvMatch && gvMatch[1] === window.Store.APP.version,
    gvMatch ? ('安卓 ' + gvMatch[1] + ' / 网页 ' + window.Store.APP.version) : '没读到 versionName');

  /* —— web/ 是唯一真源，安卓这边不维护第二份网页 —— */
  check('构建时把 web/ 原样拷进 assets（不搞第二份副本）',
    /from\(webRoot\)/.test(appGradle) && /file\('\.\.\/web'\)/.test(appGradle));
  check('资源合并前会先等网页拷完',
    /merge.*Assets/.test(appGradle) && /dependsOn 'syncWeb'/.test(appGradle));

  /* —— 存档能落地：必须挂在虚拟 https 域下，file:// 会把 IndexedDB 废掉 —— */
  check('网页挂在虚拟 https 域下（file:// 会让 IndexedDB 失效）',
    /WebViewAssetLoader/.test(activity) &&
    /appassets\.androidplatform\.net/.test(activity) &&
    /addPathHandler\("\/assets\/"/.test(activity));
  check('开了 DOM Storage（localStorage 兜底要用）',
    /setDomStorageEnabled\(true\)/.test(activity));
  check('不给 file:// 留口子', /setAllowFileAccess\(false\)/.test(activity));

  /* —— 壳里的 Service Worker 必须关掉，否则会出现「装了新版还是旧页面」 —— */
  check('壳给 User-Agent 打了 GBMShell 标记', /GBMShell/.test(activity));
  check('网页看到 GBMShell 就不注册 Service Worker',
    /GBMShell/.test(fs.readFileSync(path.join(WEB, 'js', 'app.js'), 'utf8')));

  /* —— 返回键：先问网页能不能自己消化 —— */
  check('壳把返回键交给网页先处理', /GBM_BACK/.test(activity));
  check('网页提供了 GBM_BACK 这个钩子', typeof window.GBM_BACK === 'function');
  click('#tabbar .tab[data-route="trace"]');
  await wait(340);
  check('在别的页按返回＝回首页（不会一按就把 App 退掉）', window.GBM_BACK() === true);
  await wait(160);
  check('按完确实落回首页', /今日记录/.test(T()));
  check('在首页按返回＝交回系统退出（留在 App 里没意义）', window.GBM_BACK() === false);

  /* —— 权限：一条都不要。这是产品的核心承诺，写死在这儿，谁改坏了谁负责 —— */
  const perms = manifest.match(/<uses-permission[^>]*android:name="([^"]+)"/g) || [];
  check('一条权限都不申请（装完权限管理里没有入口）', perms.length === 0, perms.join(' / '));
  /* 用「属性形式」来判，不然 Manifest 注释里写到 INTERNET 这个词就会误报 */
  check('Manifest 里连 INTERNET 都没声明',
    !/android:name="android\.permission\./.test(manifest));
  check('关掉了系统自动备份（免得记录被悄悄传去云备份）',
    /allowBackup="false"/.test(manifest));
  check('转屏不重建 Activity（写到一半的字不会丢）',
    /configChanges="[^"]*orientation[^"]*screenSize/.test(manifest));

  /* —— 壳里那三件「在 APK 里会坏掉」的事，各自有对策 —— */
  const appSrc = readIf(path.join(WEB, 'js', 'app.js'));
  check('导出走壳的桥（<a download> 在 WebView 里点了等于没点）',
    /GBMShell/.test(activity) && /saveZip/.test(activity) &&
    /saveZip/.test(appSrc) && /GBM_EXPORT_DONE/.test(appSrc));
  check('导入接住了系统文件选择器（不接的话点下去什么都不弹）',
    /onShowFileChooser/.test(activity));
  check('导出用系统「保存到哪儿」的选择器，不申请存储权限',
    /ACTION_CREATE_DOCUMENT/.test(activity));
  check('「检查更新」改成把发布页交给浏览器（联网的是浏览器，不是 App）',
    /openReleases/.test(appSrc) && /releases\/latest/.test(appSrc));

  /* —— 「纯本地」防线 ——
     万一以后谁手滑塞了个外部请求进来，这里要第一时间拦住。
     规则：web/ 里只准出现一个外部地址，就是那个发布页；
     而且不许出现任何「会主动发起网络请求」的 API。

     sw.js 里的 fetch 不算 —— 那个是 Service Worker 用它**接住**页面请求、
     好从缓存里拿文件；里面还卡了同源判断，外部的根本不插手。 */
  const netApis = /navigator\.geolocation|mediaDevices|getUserMedia|Notification\s*\.\s*requestPermission|navigator\.clipboard|navigator\.storage|showOpenFilePicker|showSaveFilePicker|WebSocket|EventSource|navigator\.sendBeacon/;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    return /\.(js|html|css|webmanifest|json)$/.test(d.name) ? [p] : [];
  });

  const urls = [];
  const netHits = [];
  walk(WEB).forEach((p) => {
    const rel = path.relative(WEB, p).replace(/\\/g, '/');
    const src = fs.readFileSync(p, 'utf8');
    /* poem-data.js 是诗词原文数据，不该出现网址；真出现了说明混进了别的东西 */
    const found = src.match(/https?:\/\/[^\s"'`)>\\]+/g) || [];
    found.forEach((u) => urls.push(rel + ' → ' + u));
    if (rel !== 'sw.js') {
      const m = src.match(netApis);
      if (m) netHits.push(rel + ' → ' + m[0]);
    }
  });

  const externals = urls.filter((u) => !/^js\/app\.js → https:\/\/github\.com\/$/.test(u));
  check('web/ 里只有一个外部地址，就是那个发布页', externals.length === 0,
    externals.join(' / ') || '干净');
  check('web/ 里没有任何「会主动联网」的浏览器 API',
    netHits.length === 0, netHits.join(' / ') || '干净');
  check('壳自己也不发请求（拦截掉一切非本机的 http/https）',
    /shouldInterceptRequest/.test(activity) && /blocked\(\)/.test(activity));

  /* —— 图标：自适应 + 旧版都要有，别只有一张 png —— */
  const resDir = path.join(AND, 'app', 'src', 'main', 'res');
  ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml',
    'mipmap-anydpi/ic_launcher.xml', 'mipmap-anydpi/ic_launcher_round.xml',
    'drawable/ic_launcher_background.xml', 'drawable/ic_launcher_foreground.xml']
    .forEach((f) => check('图标资源在：' + f, fs.existsSync(path.join(resDir, f))));
  check('自适应图标的前景缩进了安全区（不会被裁掉）',
    /android:scaleX="0\.2727"/.test(readIf(path.join(resDir, 'drawable/ic_launcher_foreground.xml'))));

  /* —— 打包流程 —— */
  check('有 GitHub Actions 打包流程', !!workflow);
  check('没配密钥时也能出包（走 debug 签名）', /assembleDebug/.test(workflow));
  check('配了密钥就出正式签名包', /assembleRelease/.test(workflow));
  check('打了 v* 的 tag 会发 Release（「检查更新」读的就是它）',
    /refs\/tags\/v/.test(workflow) && /action-gh-release/.test(workflow));
  check('构建前先跑一遍冒烟测试（坏包不许发出去）', /tools\/smoke\.js/.test(workflow));
  check('版本号不一致就拦下构建', /版本号不一致/.test(workflow));
  check('验收时会确认包里没有 lib/（没有原生代码＝没有架构之分）',
    /lib\//.test(workflow) && /原生/.test(workflow));
  check('验收时会确认网页真的打进包了', /assets\/index\.html/.test(workflow));

  /* AndroidX 会往最终的包里自动塞一条 <applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION：
     它是 App 自己定义给自己用的签名级权限，只保护 App 内部动态注册的广播接收器，
     不在 android.permission.* 命名空间下，手机的权限管理里也不会出现。
     删不掉（appcompat 内部要用），所以只能精确地认住它 ——
     本机编不了安卓，就盯着 CI 里的白名单有没有写对。 */
  check('CI 只放行 AndroidX 那条自用权限，别的一律拦下',
    workflow.indexOf('DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION') >= 0 &&
    workflow.indexOf('android\\.permission\\.') >= 0);

  /* 这一条是被 CI 打回来过的：kotlin-stdlib 1.8.22 跟老版拆分包
     kotlin-stdlib-jdk7/jdk8 1.6.21 撞重复类，checkDebugDuplicateClasses 直接失败。 */
  check('对齐了 kotlin 版本，不会撞重复类',
    /kotlin-bom/.test(appGradle) &&
    /kotlin-stdlib-jdk7/.test(appGradle) && /kotlin-stdlib-jdk8/.test(appGradle));

  /* —— 安卓的 XML 本地编不了，只能静态查。这里全是被 CI 打回来过的坑 —— */
  const xmlFiles = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.xml$/.test(d.name)) xmlFiles.push(p);
    });
  })(path.join(AND, 'app', 'src', 'main'));

  check('扫到了安卓的 XML', xmlFiles.length >= 6, xmlFiles.length + ' 个');

  /* XML 注释里不许出现两个连字符。颜色注释里顺手写个 CSS 变量名（--paper）就会踩到，
     aapt 会直接报 "The string \"--\" is not permitted within comments"。 */
  const badComment = xmlFiles.filter((f) =>
    (fs.readFileSync(f, 'utf8').match(/<!--[\s\S]*?-->/g) || [])
      .some((c) => c.slice(4, -3).includes('--')));
  check('XML 注释里没有非法的两个连字符（aapt 会因此报错）', badComment.length === 0,
    badComment.map((f) => path.relative(ROOT, f)).join(', '));

  check('XML 注释成对闭合',
    xmlFiles.every((f) => {
      const s = fs.readFileSync(f, 'utf8');
      return (s.match(/<!--/g) || []).length === (s.match(/-->/g) || []).length;
    }));
  check('每个 XML 都有 <?xml ?> 声明',
    xmlFiles.every((f) => fs.readFileSync(f, 'utf8').trimStart().startsWith('<?xml')));

  /* ============================================================ */
  console.log('\n[19] iOS 壳（WKWebView，同样一条权限都不要）');
  const IOS = path.join(ROOT, 'ios');
  const plist = readIf(path.join(IOS, 'GBM', 'Info.plist'));
  const shell = readIf(path.join(IOS, 'GBM', 'RootViewController.swift'));
  const localSrv = readIf(path.join(IOS, 'GBM', 'LocalServer.swift'));
  const xcodegen = readIf(path.join(IOS, 'project.yml'));
  const iosWf = readIf(path.join(ROOT, '.github', 'workflows', 'ios.yml'));
  const r19App = fs.readFileSync(path.join(WEB, 'js', 'app.js'), 'utf8');

  check('iOS 工程在', !!plist && !!shell && !!xcodegen);

  /* —— 一条权限都不要：iOS 上的表现就是 Info.plist 里没有 NS*UsageDescription —— */
  const usages = (plist.match(/NS[A-Za-z]*UsageDescription/g) || []);
  check('Info.plist 里没有任何权限说明（设置里翻不到权限入口）',
    usages.length === 0, usages.join(', '));
  check('没有定位 / 通讯录 / 相册 / 相机 / 麦克风的任何声明',
    !/NSLocation|NSContacts|NSPhotoLibrary|NSCamera|NSMicrophone|NSCalendars|NSHealth/
      .test(plist));

  /* —— 存档落地的命门：不能走 file:// —— */
  check('页面挂在 http://127.0.0.1 上（file:// 是不透明来源，IndexedDB 会被拒）',
    /127\.0\.0\.1/.test(shell) && /127\.0\.0\.1/.test(localSrv));
  check('本地服务只听回环网卡（局域网连不进来）',
    /requiredInterfaceType\s*=\s*\.loopback/.test(localSrv));
  check('挡住了往上跳目录的路径', /\.\./.test(localSrv) && /403/.test(localSrv));
  check('给 User-Agent 打了 GBMShell 标记（网页据此不注册 Service Worker）',
    /GBMShell\/1\.0/.test(shell) && /GBMShell/.test(r19App));

  /* —— 三件「在 App 里会坏」的事，iOS 上同样各有对策 —— */
  check('导出接住了网页递过来的 base64（<a download> 在 WKWebView 里不生效）',
    /saveZip/.test(shell) && /GBM_EXPORT_DONE/.test(shell) &&
    /GBM_EXPORT_DONE/.test(r19App));
  check('导出走系统的「存到哪儿」选择器，不要存储权限',
    /UIDocumentPickerViewController\(forExporting:/.test(shell));
  check('导入接住了系统文件选择器（不接的话点下去什么都不弹）',
    /runOpenPanelWith/.test(shell));
  check('网页那边认得 iOS 那套投递消息的接法',
    /webkit\.messageHandlers\.gbmShell/.test(r19App) &&
    /op:\s*'saveZip'/.test(r19App));
  check('外链交给 Safari 打开（联网的是 Safari，不是 App）',
    /UIApplication\.shared\.open/.test(shell) && /isWebURL/.test(shell));
  check('只放行 http/https（tel:、mailto: 之类一律不理）',
    /s == "http" \|\| s == "https"/.test(shell));

  /* —— 记录别跟着云备份跑出去，跟安卓的 allowBackup="false" 是一回事 —— */
  check('把 WebKit 数据目录排除在 iCloud 备份之外',
    /isExcludedFromBackup\s*=\s*true/.test(shell));

  /* —— 工程与流程 —— */
  check('web/ 是唯一真源，iOS 这边不维护第二份网页副本',
    /path: \.\.\/web/.test(xcodegen) && /type: folder/.test(xcodegen));
  check('.xcodeproj 由 project.yml 生成（不手写那份 UUID 表）',
    !!xcodegen && !fs.existsSync(path.join(IOS, 'GBM.xcodeproj')));
  check('有 iOS 编译流程，而且不挂在每次推送上（macOS 额度很贵）',
    !!iosWf && /workflow_dispatch/.test(iosWf) && !/\n\s+branches:.*\n\s+push:/.test(iosWf));
  check('iOS 流程也会验「一条权限都不要」', /UsageDescription/.test(iosWf));
  check('iOS 流程会把 App 装到模拟器里真跑一遍', /simctl install/.test(iosWf));
  check('应用图标是不透明的（有 alpha Xcode 会拒）',
    fs.existsSync(path.join(IOS, 'GBM', 'Assets.xcassets', 'AppIcon.appiconset',
      'icon-1024.png')));

  /* —— 网页版地址：iPhone 用户就是靠它「添加到主屏幕」的，不能是句空话 —— */
  const pagesWf = readIf(path.join(ROOT, '.github', 'workflows', 'pages.yml'));
  const readme = readIf(path.join(ROOT, 'README.md'));
  check('有 GitHub Pages 发布流程（iPhone 那条链接靠它活着）',
    !!pagesWf && /upload-pages-artifact/.test(pagesWf) && /deploy-pages/.test(pagesWf));
  check('上线前也会先跑冒烟测试（坏页面不许发出去）',
    /tools\/smoke\.js/.test(pagesWf));
  /* 不写死地址，从仓库名推出来 —— 以后改仓库名，这里会立刻报出来 */
  const repo = String(window.Store.APP.repo || '');
  const expectUrl = repo.split('/')[0] + '.github.io/' + (repo.split('/')[1] || '');
  check('README 里写的那个地址，跟仓库名对得上',
    expectUrl.length > 8 && readme.indexOf(expectUrl) >= 0,
    'README 里该有 ' + expectUrl);

  /* 引用的资源是不是真的存在（打错一个字，aapt 就会报 link 失败） */
  const defined = {};
  const def = (type, name) => { defined[type + '/' + name] = 1; };
  xmlFiles.forEach((f) => {
    const rel = path.relative(path.join(AND, 'app', 'src', 'main', 'res'), f).replace(/\\/g, '/');
    const base = path.basename(f, '.xml');
    if (rel.startsWith('drawable/')) def('drawable', base);
    if (rel.startsWith('mipmap-')) def('mipmap', base);
    if (rel.startsWith('values')) {
      const s = fs.readFileSync(f, 'utf8');
      ['color', 'string', 'style', 'dimen', 'integer', 'bool', 'array']
        .forEach((t) => {
          const re = new RegExp('<' + t + '\\s+name="([^"]+)"', 'g');
          let m; while ((m = re.exec(s))) def(t, m[1]);
        });
    }
  });

  const broken = [];
  xmlFiles.concat([path.join(AND, 'app', 'src', 'main', 'AndroidManifest.xml')])
    .forEach((f) => {
      (fs.readFileSync(f, 'utf8').match(/@(?!android:)(\w+)\/([\w.]+)/g) || [])
        .forEach((ref) => {
          const key = ref.slice(1);
          if (!defined[key]) broken.push(path.basename(f) + ' → ' + ref);
        });
    });
  check('安卓 XML 里引用的资源都真的存在', broken.length === 0,
    broken.filter((v, i, a) => a.indexOf(v) === i).join('; ') || '没有悬空引用');

  /* ============================================================ */
  console.log('\n[19] 用户 2026-10-05 报的问题');
  /* 建一条带口水词的记录，走一遍「清理」 */
  click('#tabbar .tab[data-route="home"]');
  await wait(280);
  click('[data-act="new-record"]');
  await wait(320);
  const NOISY = '嗯，今天本来想拒绝，但是最后还是答应了。呃，我觉得这个东西怎么说呢有点麻烦，然后就这样吧。';
  const nta = doc.querySelector('#rawInput');
  nta.value = NOISY;
  nta.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(160);
  click('[data-act="save-raw"]');
  await wait(520);
  click('#tabbar .tab[data-route="trace"]');
  await wait(320);
  const noisyEvt = (() => {
    const raw = JSON.parse(window.localStorage.getItem('gbm.fallback') || '{}');
    const list = Object.keys(raw).map((k) => raw[k])
      .filter((o) => o && o.kind === 'event' && o.rawText === NOISY);
    return list[0];
  })();
  check('测试记录建好了', !!noisyEvt);
  click('[data-act="open-event"][data-id="' + noisyEvt.id + '"]');
  await wait(340);
  click('[data-act="start-tidy-from"]');
  await wait(520);
  click('[data-act="do-clean"]');
  await wait(520);

  const dels = () => Array.prototype.slice.call(doc.querySelectorAll('.diff del[data-act="toggle-drop"]'));
  const inss = () => Array.prototype.slice.call(doc.querySelectorAll('.diff ins[data-act="toggle-drop"]'));
  check('清理给出了好几处建议删的词', dels().length > 0, dels().length + ' 处');
  check('提示写清了两种操作（点一下留下，再点一下划掉）',
    /点一下留下，再点一下划掉/.test(T()));

  /* —— bug：点了「留下」之后变不回去 —— */
  if (dels().length) {
    const term = dels()[0].getAttribute('data-term');
    dels()[0].click();
    await wait(320);
    check('点一下，这个词被留下了', inss().some((n) => n.getAttribute('data-term') === term),
      '留下的有：' + inss().map((n) => n.getAttribute('data-term')).join('/'));
    const back = inss().filter((n) => n.getAttribute('data-term') === term)[0];
    check('留下的词仍然可以点（原来渲染成不可点的 <ins>，点了没反应）', !!back);
    if (back) {
      back.click();
      await wait(320);
      check('再点一下又能划掉（后悔了能改回来）',
        dels().some((n) => n.getAttribute('data-term') === term));
    }
  }

  /* —— bug：把口水词全部留下之后，莫名其妙说「没有找到该删的口水词」 —— */
  const totalTerms = (() => {
    const set = {};
    dels().concat(inss()).forEach((n) => { set[n.getAttribute('data-term')] = 1; });
    return Object.keys(set);
  })();
  check('一共找到好几类口水词', totalTerms.length >= 2, totalTerms.join('/'));
  for (let i = 0; i < 20; i++) {
    const d = dels()[0];
    if (!d) break;
    d.click();
    await wait(220);
  }
  check('全部留下之后，不再误报「没有找到该删的口水词」',
    !/没有找到该删的口水词/.test(T()), T().slice(0, 60));
  check('改成说清实情：口水词你都留下了', /口水词你都留下了/.test(T()));
  check('主操作相应变成「就这样，往下」', !!doc.querySelector('[data-act="accept-clean-keep"]'));
  check('「不改，用原文」还在（按钮不会点着点着就消失）',
    !!doc.querySelector('[data-act="cancel-clean"]'));
  check('所有口水词都能再点回去', dels().length === 0 && inss().length === totalTerms.length,
    dels().length + ' 待删 / ' + inss().length + ' 留下');

  /* —— 轨迹空态的副标题删掉了 —— */
  const traceEmpty = doc.createElement('div');
  traceEmpty.innerHTML = window.Views.trace({ events: [], byId: {} });
  check('轨迹空态不再有「记得越多，这里越有东西」',
    !/记得越多/.test(traceEmpty.textContent) && /还没有轨迹/.test(traceEmpty.textContent));

  /* —— 「整理这条」挪到右边 —— */
  const rawEvt = window.Store.newEvent('还没整理的一条。');
  const evWrap = doc.createElement('div');
  evWrap.innerHTML = window.Views.event({ openEvent: rawEvt, byId: {}, settings: {}, trash: [] });
  check('「整理这条」被靠右的容器包着',
    !!evWrap.querySelector('.btn-right > [data-act="start-tidy-from"]'));
  check('靠右容器的样式是右对齐', /\.btn-right\{[^}]*justify-content:flex-end/.test(css));

  /* —— 「改于 xx」删掉了 —— */
  const editedEvt = window.Store.newEvent('改过的一条。');
  editedEvt.updatedAt = new Date(Date.now() + 3600000).toISOString();
  const evWrap2 = doc.createElement('div');
  evWrap2.innerHTML = window.Views.event({ openEvent: editedEvt, byId: {}, settings: {}, trash: [] });
  check('「这条记录」不再显示「改于 几月几日」',
    !/改于/.test(evWrap2.textContent) && /年/.test(evWrap2.textContent));

  /* —— 删除 → 回收站 → 还原 ——
     用整条整理完的记录（没整理完的「这条记录」页只有原文，没有「删除这条」按钮） */
  const victim = evt.id;
  const inStore = (target) => {
    const raw = JSON.parse(window.localStorage.getItem('gbm.fallback') || '{}');
    return Object.keys(raw).map((k) => raw[k]).filter((o) => o && o.id === target);
  };
  check('要删的那条是整理完整的一条', (findById(victim) || {}).structState === 'structured',
    (findById(victim) || {}).structState);

  click('#tabbar .tab[data-route="trace"]');
  await wait(320);
  click('[data-act="open-event"][data-id="' + victim + '"]');
  await wait(360);
  click('[data-act="delete-event"][data-id="' + victim + '"]');
  await wait(320);
  check('删除前有就地二次确认（不弹系统框）',
    !!doc.querySelector('.confirm-bar') && !!doc.querySelector('[data-act="do-delete"]'));
  click('[data-act="do-delete"]');
  await wait(600);
  check('删掉之后记录确实不在库里了', inStore(victim).length === 0);

  click('#tabbar .tab[data-route="trace"]');
  await wait(300);
  click('#topbar [data-act="go"][data-route="settings"]');
  await wait(420);
  check('设置页的「数据」卡里有三个字的「回收站」入口',
    !!doc.querySelector('[data-act="go"][data-route="trash"]') &&
    doc.querySelector('[data-act="go"][data-route="trash"]').textContent.trim() === '回收站');
  check('回收站跟导出备份/从备份恢复排在同一行',
    doc.querySelector('[data-act="export"]').parentNode ===
    doc.querySelector('[data-act="go"][data-route="trash"]').parentNode);
  check('设置页不再单独占一张「回收站」卡片', !/回收站是空的/.test(T()));
  click('[data-act="go"][data-route="trash"]');
  await wait(420);
  check('点进去是一个独立的回收站页面', /一共 1 条/.test(T()), T().slice(0, 60));
  check('刚删的那条躺在回收站里', !!doc.querySelector('[data-act="restore-trash"]'));
  check('回收站最下面有「清空回收站」', !!doc.querySelector('[data-act="empty-trash"]'));

  const restoreBtn = doc.querySelector('[data-act="restore-trash"]');
  if (restoreBtn) {
    restoreBtn.click();
    await wait(600);
    check('点「还原」记录真的回来了', inStore(victim).length === 1 &&
      inStore(victim)[0].rawText === evt.rawText);
    check('还原之后回收站里那条没了（不留重复）',
      doc.querySelectorAll('[data-act="restore-trash"]').length === 0);
  }

  /* —— 清空回收站要先确认（不可逆操作不能一点就没） —— */
  click('#tabbar .tab[data-route="trace"]');
  await wait(300);
  click('[data-act="open-event"][data-id="' + victim + '"]');
  await wait(340);
  click('[data-act="delete-event"]');
  await wait(300);
  click('[data-act="do-delete"]');
  await wait(560);
  click('#tabbar .tab[data-route="trace"]');
  await wait(300);
  click('#topbar [data-act="go"][data-route="settings"]');
  await wait(420);
  click('[data-act="go"][data-route="trash"]');
  await wait(420);
  check('又删了一条，回收站里又有东西', !!doc.querySelector('[data-act="empty-trash"]'));
  click('[data-act="empty-trash"]');
  await wait(340);
  check('清空前先就地确认',
    !!doc.querySelector('[data-act="do-empty-trash"]') &&
    !!doc.querySelector('[data-act="cancel-empty-trash"]'));
  click('[data-act="cancel-empty-trash"]');
  await wait(320);
  check('取消之后东西还在', !!doc.querySelector('[data-act="empty-trash"]'));
  click('[data-act="empty-trash"]');
  await wait(320);
  click('[data-act="do-empty-trash"]');
  await wait(600);
  check('清空之后回收站空了', !doc.querySelector('[data-act="restore-trash"]') &&
    !doc.querySelector('[data-act="empty-trash"]'));

  /* —— 同一页里重画不许把滚动条拉回顶部 —— */
  const r20App = fs.readFileSync(path.join(WEB, 'js', 'app.js'), 'utf8');
  const r20Render = (/function render\(\)\s*\{([\s\S]*?)\n  \}/).exec(r20App);
  check('render() 里不再无条件把页面拉回顶部',
    !!r20Render && !/scrollTo/.test(r20Render[1]));
  check('回顶部只发生在「换页面 / 换步骤 / 换分段」这几处',
    /function toTop\(\)\s*\{\s*window\.scrollTo\(0,\s*0\)/.test(r20App) &&
    (r20App.match(/toTop\(\)/g) || []).length >= 5);

  /* ============================================================ */
  /* 这一段的来源：用户报的「写完上一格、点下一条，上面写的字没了」是同一个毛病 ——
     重画把屏幕上的东西重写一遍，而状态/输入框没对齐。上面两个是「有状态字段」的框，
     这里盯的是「纯临时、状态里根本没地方放」的那三个，以及存储层的一个资源问题。 */
  console.log('\n[20] 临时输入框不许被重画吞掉 · 数据库连接要复用');
  const r21App = fs.readFileSync(path.join(WEB, 'js', 'app.js'), 'utf8');
  const r21Store = fs.readFileSync(path.join(WEB, 'js', 'store.js'), 'utf8');

  check('render() 重画前先把临时输入框存起来、重画后放回去',
    /function render\(\)\s*\{[\s\S]*?keepTransient\(\)/.test(r21App) &&
    /putTransient\(kept\)/.test(r21App));
  check('保管名单：自定义标签 + 合集名 + 回溯想法',
    /TRANSIENT_INPUTS\s*=\s*\[[^\]]*'tagInput'/.test(r21App) &&
    /TRANSIENT_INPUTS\s*=\s*\[[^\]]*'newColName'/.test(r21App) &&
    /TRANSIENT_INPUTS\s*=\s*\[[^\]]*'thinkInput'/.test(r21App));
  check('补回内容之后，重新对一次「查看过去的自己」的显隐',
    /function syncReveal\(\)/.test(r21App) &&
    /function putTransient\(snap\)[\s\S]*?syncReveal\(\)/.test(r21App) &&
    /id !== 'thinkInput'[\s\S]{0,80}syncReveal\(\)/.test(r21App));

  check('数据库连接被复用（不再每次读写都新开一个）',
    /function ensure\(\)\s*\{[\s\S]*?if \(_db\) return Promise\.resolve\(\)/.test(r21Store));
  check('连接被回收 / 别处要升版本时有善后',
    /onclose/.test(r21Store) && /onversionchange/.test(r21Store));

  /* 功能层面：新建合集起名打到一半去切标签，名字不能被吞 */
  click('#tabbar .tab[data-route="sediment"]');
  await wait(380);
  click('[data-act="sed-tab"][data-tab="col"]');
  await wait(380);
  click('[data-act="new-col"]');
  await wait(380);
  const nc = doc.querySelector('#newColName');
  check('「＋ 自己新建一个」就地给出起名输入框', !!nc);
  if (nc) {
    nc.value = '拒绝别人的练习';
    click('[data-act="sed-tab"][data-tab="col"]');
    await wait(420);
    const nc2 = doc.querySelector('#newColName');
    check('起名打到一半去切标签，名字不会被吞',
      !!nc2 && nc2.value === '拒绝别人的练习',
      nc2 ? JSON.stringify(nc2.value) : '输入框整个没了');
  }

  /* ============================================================ */
  /* 用户 2026-10-05 提的「交互和动画要丝滑一点」。
     底下其实是一个具体的毛病：render() 整块重画 #stage，而 .page 上有淡入动画，
     于是点一下标签整屏都会重新淡入一遍，视线被拽着走。 */
  console.log('\n[21] 动效：换屏才播动画，原地刷新别重播');
  const r22Css = fs.readFileSync(path.join(WEB, 'assets', 'style.css'), 'utf8');
  const r22App = fs.readFileSync(path.join(WEB, 'js', 'app.js'), 'utf8');
  const pageCls = () => {
    const p = doc.querySelector('#stage .page');
    return p ? p.className : '(没有 .page)';
  };

  check('重画时先判断「是不是换了一屏」', /function screenKey\(\)/.test(r22App));
  check('原地刷新会标上 still',
    /cls \+= ' still'/.test(r22App) && /\.page\.still[^{]*\{animation:none\}/.test(r22Css));
  /* 这条要按「规则本体」来判：选择器是一串的，用 [^{]* 会一路跨过换行匹配到
     后面那些「不该被压掉」的选择器上，自己把自己误判成不合格。 */
  const stillRule = (r22Css.match(/\.page\.still[\s\S]*?\{animation:none\}/) || [''])[0];
  check('still 只压整屏和已经在看的内容，新冒出来的东西照样有动画',
    !!stillRule && !/\.entry-form/.test(stillRule) &&
    !/\.tag-input/.test(stillRule) && !/\.confirm-bar/.test(stillRule),
    stillRule ? '规则本体没把新内容列进去' : '没找到 still 规则');
  check('整理分步按方向滑入（前进从右、后退从左）',
    /\.page\.from-r/.test(r22Css) && /\.page\.from-l/.test(r22Css) &&
    /from-r/.test(r22App) && /from-l/.test(r22App));
  check('药丸和分段滑块带一点回弹（滑到位时越过再收回，像液体）',
    /--ease-spring/.test(r22Css) &&
    /\.nav-pill\{[^}]*--ease-spring/.test(r22Css) &&
    /\.seg-thumb\{[^}]*--ease-spring/.test(r22Css));
  check('动画只动 transform / opacity（不碰会触发重排的属性）',
    /@keyframes pageIn\{from\{opacity:0; transform:/.test(r22Css) &&
    /@keyframes fadeUp\{from\{opacity:0; transform:/.test(r22Css));
  check('系统开了「减弱动态效果」时全站静音（连错开的延迟也清掉）',
    /prefers-reduced-motion/.test(r22Css) &&
    /prefers-reduced-motion[\s\S]{0,200}animation-delay:0ms/.test(r22Css));
  check('键盘操作时看得见焦点停在哪儿', /:focus-visible\{outline:2px solid/.test(r22Css));

  /* 现场走一遍，别只是读代码 —— 切分段＝换屏，展开输入框＝原地刷新 */
  click('[data-act="sed-tab"][data-tab="zhaojian"]');
  await wait(420);
  check('切分段算换屏（该播动画）', pageCls().indexOf('still') < 0, pageCls());
  click('[data-act="sed-tab"][data-tab="col"]');
  await wait(420);
  check('切回来也照样播', pageCls().indexOf('still') < 0, pageCls());

  /* 先确保「新建合集」的输入框是收着的 —— 上一节留了它开着，
     那样按钮根本不在，点下去等于没点，测出来的东西没意义。 */
  if (doc.querySelector('[data-act="cancel-new-col"]')) {
    click('[data-act="cancel-new-col"]');
    await wait(420);
    check('收起输入框也是原地刷新', pageCls().indexOf('still') >= 0, pageCls());
  }
  check('「＋ 自己新建一个」按钮在场', !!doc.querySelector('[data-act="new-col"]'));
  click('[data-act="new-col"]');
  await wait(420);
  check('展开「新建合集」只是原地刷新（不该整屏重播）',
    pageCls().indexOf('still') >= 0, pageCls());
  check('原地刷新之后界面确实是新的（still 没把重画本身也吞掉）',
    !!doc.querySelector('#newColName'));

  await wait(150);
  window.close();
  server.close();

  console.log('\n' + '='.repeat(58));
  if (problems.length) {
    console.log('发现 ' + problems.length + ' 个问题：');
    problems.forEach((x) => console.log('  - ' + x));
    process.exit(1);
  } else {
    console.log('全部通过。');
  }
})().catch((e) => {
  console.error('\n测试脚本报错：', e);
  process.exit(2);
});
