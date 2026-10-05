/* 真实点击复现器 —— 专门用来钉死「点一下就把上面写的东西弄丢了」这类 bug。

   为什么不用 element.click()：
     · JS 的 .click() 不会转移焦点，textarea 不会触发 focusout，
       而「写完字 → 点别的地方」这条链正是 bug 出没的地方。复现不出来等于白测。
     · 所以这里用 CDP 的 Input 域派发真实指针事件，坐标取自元素中心，
       跟人手指点下去是同一条路径（含 mousedown → blur/focusout → mouseup → click）。

   用法：
     node tools/serve.js 5183 &            # 先把页面起起来
     node tools/repro.js http://127.0.0.1:5183/
  检查项：
     [A] 在「我的解决方案」写完字后点「我的收获」的『自己写这一项』，上面那句会不会丢
     [B] 分类页反复点同一块区域，第二次还有没有反应
*/
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const BASE = process.argv[2] || 'http://127.0.0.1:5183/';
const PORT = 9336;

const CHROME_CANDIDATES = [
  process.env.GBM_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

function findBrowser() {
  for (const p of CHROME_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 忽略 */ }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    sock.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
      }
    });
    sock.addEventListener('error', reject);
    sock.addEventListener('open', () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { resolve: res, reject: rej });
          sock.send(JSON.stringify({ id, method, params: params || {} }));
        });
      },
      close() { try { sock.close(); } catch (e) { /* 忽略 */ } }
    }));
  });
}

let pass = 0, fail = 0;
function check(ok, label, extra) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '\n      ' + extra : '')); }
}

(async () => {
  const browser = findBrowser();
  if (!browser) {
    console.error('没找到 Chrome / Edge，用 GBM_CHROME 环境变量指过去。');
    process.exit(1);
  }
  console.log('用浏览器：' + browser);

  const profile = path.join(os.tmpdir(), 'gbm-repro-profile');
  if (path.basename(profile) === 'gbm-repro-profile' && fs.existsSync(profile)) {
    fs.rmSync(profile, { recursive: true, force: true });
  }

  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + PORT,
    BASE
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(250);
      try {
        const list = await getJSON('http://127.0.0.1:' + PORT + '/json/list');
        target = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)[0];
      } catch (e) { /* 还没起来 */ }
    }
    if (!target) throw new Error('Chrome 调试端口没就绪');

    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    await cdp.send('Page.navigate', { url: BASE });
    await sleep(1500);

    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception
          ? r.exceptionDetails.exception.description
          : JSON.stringify(r.exceptionDetails));
      }
      return r.result.value;
    };

    /* ---- 真实点击：坐标取元素中心，派发完整指针序列 ----
       注意 tap() 会先把元素 scrollIntoView 到屏幕中间（保证点得到）。
       所以**测「滚动位置有没有被改」的时候不能用它** ——
       它自己就会挪页面，测出来的是它挪的，不是页面挪的。那种场合用下面的 tapNoScroll。 */
    const centerOf = (sel) => evaluate(`(function(){
      var e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null;
      e.scrollIntoView({ block: 'center' });
      var r = e.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`);

    const tapPoint = async (x, y) => {
      const common = { x, y, button: 'left', clickCount: 1, pointerType: 'mouse' };
      await cdp.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved' }, common));
      await cdp.send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, common));
      await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, common));
      await sleep(320);
    };

    const tap = async (sel) => {
      const raw = await centerOf(sel);
      if (!raw) return false;
      const p = JSON.parse(raw);
      await tapPoint(p.x, p.y);
      return true;
    };

    /* 不带滚动定位的点击：元素现在在屏幕里就直接点，不在就返回 false。
       专门给「测滚动位置」用。 */
    const tapNoScroll = async (sel) => {
      const raw = await evaluate(`(function(){
        var e = document.querySelector(${JSON.stringify(sel)});
        if (!e) return null;
        var r = e.getBoundingClientRect();
        if (r.bottom < 10 || r.top > innerHeight - 10) {
          return JSON.stringify({ off: true, top: Math.round(r.top), bottom: Math.round(r.bottom) });
        }
        return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
      })()`);
      if (!raw) return false;
      const p = JSON.parse(raw);
      if (p.off) return false;
      await tapPoint(p.x, p.y);
      return true;
    };

    /* ---- 从库里读回这条记录，看真正存了什么 ---- */
    const readStored = () => evaluate(`(function(){
      return Store.listEvents().then(function (list) {
        var e = list[0];
        if (!e) return JSON.stringify(null);
        var out = {};
        Object.keys(e.blocks).forEach(function (k) {
          out[k] = e.blocks[k] ? e.blocks[k].text : null;
        });
        return JSON.stringify({ id: e.id, blocks: out, tags: e.tags });
      });
    })()`);

    const readDom = () => evaluate(`(function(){
      var out = {};
      Array.prototype.forEach.call(document.querySelectorAll('[data-act="edit-block"]'), function (ta) {
        out[ta.getAttribute('data-key')] = ta.value;
      });
      return JSON.stringify(out);
    })()`);

    /* ---------------- 走到整理第二步 ---------------- */
    console.log('\n准备数据：写一条记录并进到「拆开」这一步');
    await tap('[data-act="new-record"]');
    await sleep(400);
    /* 故意写得长一点、并且塞几个口水词：
       ① 事件页够高，才测得出「点完是不是被弹回顶部」；
       ② 「清理」那步会真的出现灰划掉的建议删，才点得着。 */
    const TEXT = '嗯，今天领导让我接了个急活。呃，我发现我不是不会拒绝，是没有给自己拒绝的时间。\n\n' +
      '怎么说呢，其实每次都是这样，嘴上答应了，心里一百个不愿意。然后就是回家以后又后悔。\n\n' +
      '下次别人突然问我，我先说晚点回复，给自己留一段想清楚的时间，再答复他。';
    await evaluate(`(function(){
      var ta = document.querySelector('#rawInput');
      ta.value = ${JSON.stringify(TEXT)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value.length;
    })()`);
    await sleep(200);
    await tap('[data-act="save-raw"]');
    await sleep(800);
    await tap('#tabbar .tab[data-route="trace"]');
    await sleep(700);
    await tap('[data-act="open-event"]');
    await sleep(700);
    await tap('[data-act="start-tidy-from"]');
    await sleep(900);

    /* ================= [0] 清理：点一下留下，再点一下划掉 ================= */
    console.log('\n[0] 清理：灰划掉的词能不能点回去');
    const diffState = () => evaluate(`(function(){
      var out = [];
      Array.prototype.forEach.call(document.querySelectorAll('.diff del[data-act], .diff ins[data-act]'), function (n) {
        out.push({ tag: n.tagName.toLowerCase(), term: n.getAttribute('data-term') });
      });
      return JSON.stringify(out);
    })()`);
    await sleep(300);

    const hasDrops = await evaluate('document.querySelectorAll(".diff del[data-act]").length');
    console.log('  灰划掉的词：' + hasDrops + ' 处');
    if (hasDrops) {
      const target = await evaluate(`(function(){
        var n = document.querySelector('.diff del[data-act]');
        n.scrollIntoView({ block: 'center' });
        var r = n.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
                                term: n.getAttribute('data-term') });
      })()`);
      const tg = JSON.parse(target);
      console.log('  点第一处：' + tg.term);
      await tapPoint(tg.x, tg.y);
      await sleep(500);
      const afterOne = JSON.parse(await diffState());
      const keptNow = afterOne.filter((n) => n.tag === 'ins' && n.term === tg.term).length;
      console.log('  点完 → ' + JSON.stringify(afterOne));
      check(keptNow > 0, '点一下这个词就变成了「留下」', '留下 ' + keptNow + ' 处');
      check(afterOne.filter((n) => n.tag === 'ins').every((n) => !!n.term),
        '留下的词身上还带着 data-act（还能再点）');

      /* 再点同一坐标 —— 位置固定的话还是同一个词 */
      await tapPoint(tg.x, tg.y);
      await sleep(500);
      const afterTwo = JSON.parse(await diffState());
      console.log('  再点同一坐标 → ' + JSON.stringify(afterTwo));
      check(afterTwo.filter((n) => n.tag === 'del' && n.term === tg.term).length > 0,
        '再点一下又划回去了（后悔了能改回来）',
        'del 里还有 ' + tg.term + '：' + afterTwo.filter((n) => n.tag === 'del').length);

      /* 全部留下，看会不会误报「没有找到该删的口水词」 */
      for (let i = 0; i < 12; i++) {
        const left = await evaluate('document.querySelectorAll(".diff del[data-act]").length');
        if (!left) break;
        await evaluate('document.querySelector(".diff del[data-act]").click()');
        await sleep(320);
      }
      const bodyText = await evaluate('document.querySelector("#stage").textContent');
      console.log('  全部留下之后的提示：' + (bodyText.match(/口水词[^。]*。|没有找到[^。]*。/) || ['(没匹配到)'])[0]);
      check(bodyText.indexOf('没有找到该删的口水词') < 0,
        '全部留下之后不再误报「没有找到该删的口水词」');
      check(bodyText.indexOf('口水词你都留下了') >= 0, '而是说清了实情');
      const allKept = JSON.parse(await diffState());
      check(allKept.length > 0 && allKept.every((n) => n.tag === 'ins'),
        '所有口水词都还能点回去', JSON.stringify(allKept));
    } else {
      console.log('  （这段没有可删的口水词，跳过）');
    }

    let n = await tap('[data-act="accept-clean-keep"]');
    if (!n) await tap('[data-act="accept-clean"]');
    await sleep(1000);

    const step = await evaluate('(function(){var b=document.querySelector(".seg button.on");return b?b.textContent:"?";})()');
    console.log('  当前步骤：' + step);

    /* ================= [A] 写完之后点下一块会不会丢 ================= */
    console.log('\n[A] 「行持」写完字 → 点「照见」那块空白');

    /* 先把「行持」变成可输入状态（真实点击，模拟用户先点了它） */
    await tap('[data-key="xingchi"]');
    await sleep(500);

    /* 在「行持」里输入文字 —— 走真实键盘输入，才会触发正常事件 */
    await tap('[data-act="edit-block"][data-key="xingchi"]');
    await sleep(200);
    await cdp.send('Input.insertText', { text: '先给自己三分钟再回答' });
    await sleep(250);

    const beforeDom = JSON.parse(await readDom());
    console.log('  写完后 DOM 里 xingchi = ' + JSON.stringify(beforeDom.xingchi));

    /* 现在点上面那块空白：「照见」没记录，整块都可以点 */
    const hit = await tap('.block:nth-of-type(2) [data-act="fill-block"]');
    if (!hit) {
      /* 退而求其次：按 key 精确找 */
      await tap('[data-act="fill-block"][data-key="zhaojian"]');
    }
    await sleep(900);

    const afterDom = JSON.parse(await readDom());
    const afterStore = JSON.parse(await readStored());
    console.log('  点击后 DOM 里 xingchi = ' + JSON.stringify(afterDom.xingchi));
    console.log('  点击后库里 xingchi = ' + JSON.stringify(afterStore.blocks.xingchi));
    check(afterDom.xingchi === '先给自己三分钟再回答',
      '点上面那块之后，写的内容还留在输入框里', '实际 = ' + JSON.stringify(afterDom.xingchi));
    check(afterStore.blocks.xingchi === '先给自己三分钟再回答',
      '点上面那块之后，写的内容已经存进库里', '实际 = ' + JSON.stringify(afterStore.blocks.xingchi));

    /* 只点一次就丢，还是要点两次？再补一次「点别处」的动作 */
    await tap('.block:first-of-type [data-act="edit-block"]');
    await sleep(600);
    const afterBlur = JSON.parse(await readDom());
    check(afterBlur.xingchi === '先给自己三分钟再回答',
      '再点一次别的地方，内容依然在', '实际 = ' + JSON.stringify(afterBlur.xingchi));

    /* ================= [B] 分类页反复点同一块区域 ================= */
    console.log('\n[B] 分类页：同一块区域点两次，第二次还有没有反应');
    await tap('[data-act="accept-split"]');
    await sleep(1000);

    const readTags = () => evaluate(`(function(){
      return Store.listEvents().then(function (list) {
        return JSON.stringify(list[0] ? list[0].tags : null);
      });
    })()`);
    /* DOM 上数一遍已选中的 chip：现在是「选中的带 .on」，位置固定不再挪动 */
    const chipState = () => evaluate(`(function(){
      var picked = Array.prototype.map.call(
        document.querySelectorAll('.chip[data-act="toggle-tag"].on'), function (c) {
          return c.textContent.replace('✕', '').trim();
        }).filter(Boolean);
      var suggest = Array.prototype.map.call(
        document.querySelectorAll('.chip[data-act="toggle-tag"]:not(.on)'), function (c) {
          var r = c.getBoundingClientRect();
          return { v: c.getAttribute('data-value'),
                   x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
      return JSON.stringify({ picked: picked, suggest: suggest });
    })()`);

    const s0 = JSON.parse(await chipState());
    console.log('  初始已选：' + JSON.stringify(s0.picked));

    /* 在同一块区域里连点两下（同一个候选 chip 的中心点）。
       位置固定之后，同一个坐标第二下点到的还是同一个词 —— 所以要变成「取消」。 */
    const first = s0.suggest.filter((c) => c.v === '工作')[0] || s0.suggest[0];
    if (!first) {
      console.log('  （这一页没有候选 chip，跳过）');
    } else {
      console.log('  第一下点：' + first.v + ' @ ' + first.x + ',' + first.y);
      await tapPoint(first.x, first.y);
      await sleep(600);
      const s1 = JSON.parse(await chipState());
      const t1 = JSON.parse(await readTags());
      console.log('  点完第一下 → 已选 ' + JSON.stringify(s1.picked) + ' / 库里 ' + JSON.stringify(t1));

      console.log('  第二下点同一坐标：' + first.x + ',' + first.y);
      await tapPoint(first.x, first.y);
      await sleep(600);
      const s2 = JSON.parse(await chipState());
      const t2 = JSON.parse(await readTags());
      console.log('  点完第二下 → 已选 ' + JSON.stringify(s2.picked) + ' / 库里 ' + JSON.stringify(t2));

      check(s1.picked.indexOf(first.v) >= 0,
        '第一下点下去就选上了，界面上立刻看得到', JSON.stringify(s0.picked) + ' → ' + JSON.stringify(s1.picked));
      check(s2.picked.indexOf(first.v) < 0 && s2.picked.length === s0.picked.length,
        '第二下点同一坐标＝取消原来那个词（位置固定，不会点到隔壁词上）',
        JSON.stringify(s1.picked) + ' → ' + JSON.stringify(s2.picked));
      check(JSON.stringify(s2.picked) === JSON.stringify(s0.picked),
        '一来一回之后回到原样（界面不会自己乱）',
        JSON.stringify(s0.picked) + ' vs ' + JSON.stringify(s2.picked));
    }

    /* 顺带看一下「＋ 其他」：连续点两次会不会卡住 */
    console.log('\n[B2] 「＋ 其他」连点两次');
    const pickSels = await evaluate(`(function(){
      var e = document.querySelector('.chip.add');
      if (!e) return null;
      var r = e.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) });
    })()`);
    if (pickSels) {
      const p = JSON.parse(pickSels);
      await tapPoint(p.x, p.y);
      await sleep(400);
      const has1 = await evaluate('!!document.querySelector("#tagInput")');
      if (!has1) { console.log('  没找到输入框，尝试按选择器点'); await tap('[data-act="pick-tag"]'); await sleep(400); }
      await tapPoint(p.x, p.y);
      await sleep(400);
      const has2 = await evaluate('!!document.querySelector("#tagInput")');
      const focused = await evaluate('(document.activeElement&&document.activeElement.id)||""');
      console.log('  第一次点后出现输入框：' + has1 + ' / 第二次点后仍在：' + has2 + ' / 焦点在：' + focused);
      check(has2 === true, '连点两次「＋ 其他」输入框还在（没有把自己关掉）');
      check(focused === 'tagInput', '连点两次之后光标还在输入框里', '实际焦点 = ' + focused);
    }

    /* ================= [F] 一次点击到底开了几个 IndexedDB 连接 =================
       探针只包一层 indexedDB.open 的计数，不改行为。
       数量明显大于 1 就说明连接没被复用 —— 每次读写都重开一个。 */
    console.log('\n[F] 一次「点标签」会开几次 IndexedDB 连接');
    await evaluate(`(function(){
      if (!window.__idbSpy) {
        var real = indexedDB.open.bind(indexedDB);
        window.__idbOpens = 0;
        window.__idbSpy = true;
        indexedDB.open = function () { window.__idbOpens++; return real.apply(null, arguments); };
      }
      window.__idbOpens = 0;
      return 'spy-ready';
    })()`);
    {
      const c = await evaluate(`(function(){
        var e = document.querySelector('.chip[data-act="toggle-tag"]:not(.on)');
        if (!e) return null;
        var r = e.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) });
      })()`);
      if (c) {
        const p = JSON.parse(c);
        await tapPoint(p.x, p.y);
        await sleep(900);
        const opens = await evaluate('window.__idbOpens');
        console.log('  一次点击（1 次写 + 3 次读）= ' + opens + ' 次 indexedDB.open');
        check(opens <= 1,
          '一次点击最多只开 1 个数据库连接（连接被复用）', '实际 ' + opens + ' 次');
      } else {
        console.log('  （没有可点的标签，跳过）');
      }
    }

    /* ================= [E1] 临时输入框：打字打到一半被重画会不会吞掉 =================
       这类框（自定义标签 / 合集名 / 回溯想法）不写进库里，纯粹是屏幕上的临时输入。
       而 render() 是把整块 HTML 重写一遍、输入框会被销毁重建 ——
       只要中间发生一次重画，用户刚打的字就没了。 */
    console.log('\n[E1] 「＋ 其他」里打一半的字，点别处之后还在不在');
    if (await evaluate('!!document.querySelector("#tagInput")')) {
      await tap('#tagInput');
      await sleep(150);
      await cdp.send('Input.insertText', { text: '半夜想事情' });
      await sleep(250);
      const typed = await evaluate('(document.querySelector("#tagInput")||{}).value || ""');
      console.log('  输入框里现在是：' + JSON.stringify(typed));

      /* 点一个候选标签 —— 这会触发一次重画（正是「点别处」这个动作） */
      const chip = await evaluate(`(function(){
        var c = document.querySelector('.chip[data-act="toggle-tag"]');
        if (!c) return null;
        var r = c.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) });
      })()`);
      if (chip) {
        const p = JSON.parse(chip);
        await tapPoint(p.x, p.y);
        await sleep(700);
      }
      const left = await evaluate('(document.querySelector("#tagInput")||{}).value');
      console.log('  点完别处之后：' + JSON.stringify(left));
      check(left === typed,
        '打字打到一半跑去点别的，输入框里的字还在', '期望 ' + JSON.stringify(typed) + '，实际 ' + JSON.stringify(left));
      /* 收尾：把这个框关掉，免得影响后面的步骤 */
      if (await evaluate('!!document.querySelector("#tagInput")')) {
        await tap('[data-act="cancel-tag-custom"]');
        await sleep(400);
      }
    } else {
      check(false, '打字打到一半跑去点别的，输入框里的字还在', '压根没打开「＋ 其他」的输入框');
    }

    /* ================= [C] 换一句 / 删除这条 之后不许被弹回顶部 =================
       只有真浏览器测得出：jsdom 里没有滚动，window.scrollTo 也不产生位移。 */
    console.log('\n[C] 点完「换一句」「删除这条」之后，滚动位置应该留在原地');
    await tap('[data-act="skip-tags"]');
    await sleep(900);

    const scrollProbe = () => evaluate(`(function(){
      var sc = document.scrollingElement || document.documentElement;
      return JSON.stringify({
        y: Math.round(sc.scrollTop),
        max: Math.round(sc.scrollHeight - innerHeight)
      });
    })()`);
    /* 把目标定位到视口的某个高度上（不用 scrollIntoView，免得带平滑动画和居中），
       返回定位之后的 scrollTop。 */
    const parkAt = (sel, ratio) => evaluate(`(function(){
      var e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null;
      var sc = document.scrollingElement || document.documentElement;
      var abs = e.getBoundingClientRect().top + sc.scrollTop;
      sc.scrollTop = Math.max(0, Math.min(sc.scrollHeight - innerHeight,
        Math.round(abs - innerHeight * ${ratio})));
      return Math.round(sc.scrollTop);
    })()`);

    const geo = JSON.parse(await scrollProbe());
    console.log('  这条记录页的滚动余量：' + geo.max + 'px');
    if (geo.max < 80) {
      console.log('  （页面不够高，滚不动，跳过这一段）');
    } else {
      /* —— 换一句 —— */
      const y1 = await parkAt('[data-act="shuffle-poem"]', 0.55);
      await sleep(400);
      console.log('  把「换一句」停到视口 55% 处，scrollTop = ' + y1);
      const g1 = JSON.parse(await scrollProbe());
      check(await tapNoScroll('[data-act="shuffle-poem"]'),
        '「换一句」在屏幕里，点得到（并且点之前没有动滚动条）');
      await sleep(900);
      const g2 = JSON.parse(await scrollProbe());
      /* 换一句之后诗句长短会变，页面总高就跟着变。
         所以要分清两种「变了」：
           · 页面变短 → 浏览器把 scrollTop 夹到新的余量上，这是对的；
           · 被 render() 里的 scrollTo(0,0) 弹回顶部 → 这是错的。
         判定：scrollTop 应该正好等于 min(原来的位置, 新的余量)。 */
      const want = Math.min(g1.y, g2.max);
      console.log('  scrollTop ' + g1.y + ' → ' + g2.y + '；可滚余量 ' + g1.max + ' → ' + g2.max);
      check(Math.abs(g2.y - want) <= 4,
        '点「换一句」之后没有被弹走（页面变短就贴到底，不会跳回顶部）',
        '期望约 ' + want + '，实际 ' + g2.y);
      check(g2.y > 0, '而且确实没有跳回顶部', 'scrollTop = ' + g2.y);

      /* —— 删除这条 —— */
      const y3 = await parkAt('[data-act="delete-event"]', 0.55);
      await sleep(400);
      console.log('  把「删除这条」停到视口 55% 处，scrollTop = ' + y3);
      check(await tapNoScroll('[data-act="delete-event"]'), '「删除这条」点得到');
      await sleep(900);
      const y4 = JSON.parse(await scrollProbe()).y;
      check(await evaluate('!!document.querySelector(".confirm-bar")'), '删除的确认条确实弹出来了');
      check(Math.abs(y4 - y3) <= 4,
        '弹出确认条时也没跳回顶部', y3 + ' → ' + y4);
      await tap('[data-act="cancel-delete"]');
      await sleep(600);
      check((await evaluate('!!document.querySelector(".confirm-bar")')) === false, '取消之后确认条收起来了');
    }

    /* ================= [E2] 回溯那个想法框，点「换一句」之后会不会被吞 ================= */
    console.log('\n[E2] 回溯「现在我会…」打一半，点「换一句」之后还在不在');
    {
      const think = await evaluate('!!document.querySelector("#thinkInput")');
      if (think) {
        await tap('#thinkInput');
        await sleep(150);
        await cdp.send('Input.insertText', { text: '先问自己到底想不想接' });
        await sleep(250);
        const t1 = await evaluate('document.querySelector("#thinkInput").value');
        await tap('[data-act="shuffle-poem"]');
        await sleep(800);
        const t2 = await evaluate('(document.querySelector("#thinkInput")||{}).value');
        console.log('  写完后 = ' + JSON.stringify(t1) + ' → 点完「换一句」= ' + JSON.stringify(t2));
        check(t2 === t1, '点「换一句」之后，上面写的想法还在',
          '期望 ' + JSON.stringify(t1) + '，实际 ' + JSON.stringify(t2));
      } else {
        console.log('  （这条记录已经解锁了，没有「现在我会…」输入框，跳过）');
      }
    }

    /* ================= [D] 回收站：删掉 → 设置里看得见 → 能还原 ================= */
    console.log('\n[D] 回收站');
    await tap('[data-act="delete-event"]');
    await sleep(600);
    await tap('[data-act="do-delete"]');
    await sleep(1000);
    await tap('#tabbar .tab[data-route="trace"]');
    await sleep(700);
    await tap('#topbar [data-act="go"][data-route="settings"]');
    await sleep(900);

    const shot = async (name) => {
      const dir = path.resolve(__dirname, '..', 'shots-round7');
      fs.mkdirSync(dir, { recursive: true });
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(dir, name + '.png');
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      console.log('  截图 → ' + f);
    };
    /* 设置页本身也留一张 —— 「数据」卡里那三个字「回收站」得看得见 */
    await shot('05-设置-数据卡');

    await tap('[data-act="go"][data-route="trash"]');
    await sleep(900);
    await shot('05b-设置-回收站');

    const trash = JSON.parse(await evaluate(`(function(){
      return JSON.stringify({
        rows: document.querySelectorAll('[data-act="restore-trash"]').length,
        hasEmpty: !!document.querySelector('[data-act="empty-trash"]'),
        card: /回收站/.test(document.querySelector('#stage').textContent)
      });
    })()`));
    console.log('  设置页回收站：' + JSON.stringify(trash));
    check(trash.card, '回收站页面标题是「回收站」');
    check(trash.rows === 1, '刚删的那条躺在里面', '实际 ' + trash.rows + ' 条');
    check(trash.hasEmpty, '回收站最下面有「清空回收站」');

    if (trash.rows) {
      await tap('[data-act="restore-trash"]');
      await sleep(1000);
      const after = await evaluate('document.querySelectorAll("[data-act=\\"restore-trash\\"]").length');
      check(after === 0, '点「还原」之后回收站空了', '还剩 ' + after + ' 条');
      check(/回收站是空的/.test(await evaluate('document.querySelector("#stage").textContent')),
        '并且说明了回收站是空的');
    }
    /* ================= [E3] 新建合集时打字打到一半，切个标签会不会被吞 ================= */
    console.log('\n[E3] 新建合集「给这个合集起个名字」打一半，切标签之后还在不在');
    {
      await tap('#tabbar .tab[data-route="sediment"]');
      await sleep(700);
      await tap('[data-act="sed-tab"][data-tab="col"]');
      await sleep(700);
      const opened = await tap('[data-act="new-col"]');
      await sleep(600);
      if (opened && await evaluate('!!document.querySelector("#newColName")')) {
        await tap('#newColName');
        await sleep(150);
        await cdp.send('Input.insertText', { text: '拒绝别人的练习' });
        await sleep(250);
        const n1 = await evaluate('document.querySelector("#newColName").value');
        /* 原地切一下标签 —— 这会重画整块 */
        await tap('[data-act="sed-tab"][data-tab="col"]');
        await sleep(700);
        const n2 = await evaluate('(document.querySelector("#newColName")||{}).value');
        console.log('  写完后 = ' + JSON.stringify(n1) + ' → 切完标签 = ' + JSON.stringify(n2));
        check(n2 === n1, '切个标签回来，刚起的名字还在',
          '期望 ' + JSON.stringify(n1) + '，实际 ' + JSON.stringify(n2));
        /* 收尾 */
        if (await evaluate('!!document.querySelector("[data-act=\\"cancel-new-col\\"]")')) {
          await tap('[data-act="cancel-new-col"]');
          await sleep(400);
        }
      } else {
        check(false, '切个标签回来，刚起的名字还在', '没打开「＋ 自己新建一个」');
      }
    }
  } finally {
    if (cdp) cdp.close();
    try { child.kill(); } catch (e) { /* 忽略 */ }
  }

  console.log('\n—— 复现结果：' + pass + ' 通过 / ' + fail + ' 失败 ——');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\n出错了：' + (e && e.message));
  process.exit(1);
});
