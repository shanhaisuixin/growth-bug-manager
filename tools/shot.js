/* 用本机已经装好的 Chrome / Edge 无头模式，把网页按手机尺寸渲染出来截图 + 量坐标。

   为什么要有这个：
   · 冒烟测试跑在 jsdom 里，算不了 flex 布局 —— 「按钮到底靠不靠右」这种问题它答不了。
   · agent-browser 之类的方案要先下 ~500MB 的 Chromium，没必要（而且本机 C 盘很紧）。
   · 无头 Chrome 不弹窗口、不动鼠标、不抢前台，纯粹离屏渲染，不会打扰正在用电脑的人。

   用法：
     node tools/shot.js http://127.0.0.1:5183 shots
   先跑 tools/serve.js 把页面起起来。

   它会走一遍：今日记录 → 写文字 → 保存 → 轨迹 → 打开 → 整理，
   在整理的三步各量一次底部按钮的位置并截一张图（390×844，模拟手机）。 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const BASE = process.argv[2] || 'http://127.0.0.1:5183/';
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'shots'));
const PORT = 9334;

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

/* 极简 CDP 客户端：Node 22 自带 WebSocket，不用装 ws */
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

(async () => {
  const browser = findBrowser();
  if (!browser) {
    console.error('没找到 Chrome / Edge。装的不是常规路径的话，用 GBM_CHROME 环境变量指过去。');
    process.exit(1);
  }
  console.log('用浏览器：' + browser);

  fs.mkdirSync(OUT, { recursive: true });

  const profile = path.join(os.tmpdir(), 'gbm-shot-profile');

  /* 每次跑都从干净的 profile 开始，不然上一条记录还在库里，
     打开的可能不是这次新写的那条，量出来的东西就对不上了。
     这里只删自己建的这个临时目录 —— 加个名字守卫，防止路径被改错时误删别的目录。 */
  if (path.basename(profile) === 'gbm-shot-profile' && fs.existsSync(profile)) {
    fs.rmSync(profile, { recursive: true, force: true });
  }

  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + PORT,
    BASE
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    /* 等 devtools 端口起来，再挑出页面 target */
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(250);
      try {
        const list = await getJSON('http://127.0.0.1:' + PORT + '/json/list');
        target = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)[0];
      } catch (e) { /* 还没起来，接着等 */ }
    }
    if (!target) throw new Error('Chrome 的调试端口一直没就绪');

    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    /* 手机视口。用 dvh 的页面会按这个高度排版 */
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    /* 别把我们的无头访问当成壳（壳会跳过 Service Worker，这里反而想要干净的一次性会话） */
    await cdp.send('Page.navigate', { url: BASE });
    await sleep(1400);

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

    const click = (sel) => evaluate(
      '(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');' +
      'if(!e)return "NO:"+' + JSON.stringify(sel) + ';e.click();return "OK";})()');

    const shot = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('  截图 → ' + file);
    };

    /* 量底部操作按钮到底靠哪边。
       注意别用 scrollIntoView({block:'end'}) —— 那会把元素怼到滚动口最底边，
       被悬浮的底部导航盖住，看着像被压住了，其实是测量方式的问题。
       这里直接把滚动容器拉到底，等同于用户自己滑到底看到的样子。 */
    const measure = () => evaluate(`(function () {
      [document.scrollingElement, document.querySelector('#stage'),
       document.body, document.documentElement].forEach(function (el) {
        if (el) el.scrollTop = el.scrollHeight;
      });
      window.scrollTo(0, document.body.scrollHeight);

      var foot = document.querySelector('.tidy-foot');
      if (!foot) return JSON.stringify({ error: '这一页没有 .tidy-foot' });
      var fr = foot.getBoundingClientRect();
      var nav = document.querySelector('#tabbar');
      var nr = nav ? nav.getBoundingClientRect() : null;
      var btns = Array.prototype.map.call(foot.querySelectorAll('.btn'), function (b) {
        var r = b.getBoundingClientRect();
        return {
          text: b.textContent.trim(),
          left: Math.round(r.left), right: Math.round(r.right),
          top: Math.round(r.top),
          width: Math.round(r.width),
          /** 离容器右边缘还有多远（0 左右＝贴右） */
          gapRight: Math.round(fr.right - r.right),
          /** 下边缘离底部导航顶边还有多远，负数就是被导航盖住了 */
          gapNav: nr ? Math.round(nr.top - r.bottom) : null,
          textAlign: getComputedStyle(b).textAlign,
          isPrimary: b.classList.contains('primary')
        };
      });
      var row = foot.querySelector('.btn-row');
      var rowR = row ? row.getBoundingClientRect() : null;
      var prim = btns.filter(function (b) { return b.isPrimary; })[0] || null;
      return JSON.stringify({
        viewport: innerWidth,
        container: { left: Math.round(fr.left), right: Math.round(fr.right), width: Math.round(fr.width) },
        buttons: btns,
        rowJustify: row ? getComputedStyle(row).justifyContent : null,
        /** 主按钮是不是占满整宽（留一点点误差） */
        primaryFullWidth: prim ? Math.abs(prim.width - Math.round(fr.width)) <= 2 : null,
        /** 次要操作那一行是不是排在主按钮上面 */
        secondariesOnTop: (rowR && prim) ? rowR.top < prim.top : null
      });
    })()`);

    const report = async (label) => {
      const raw = await measure();
      const m = JSON.parse(raw);
      await sleep(200);
      await shot(label);
      return m;
    };

    /* ---------------- 走一遍流程 ---------------- */
    console.log('走流程：今日记录 → 保存 → 轨迹 → 打开 → 整理');

    if ((await click('[data-act="new-record"]')).indexOf('NO') === 0) {
      throw new Error('首页没找到「今日记录」按钮');
    }
    await sleep(350);

    /* 默认这段故意不带口水词，好走到「清理那步只有一个次要按钮」的分支
       —— 也就是用户截图里「就这样，往下 + 我自己改一遍」的那个布局。
       想测有口水词的分支（两个次要按钮平均分一行），设 GBM_TEXT 覆盖。 */
    const TEXT = process.env.GBM_TEXT ||
      '今天本来想拒绝，最后还是答应了。\n\n' +
      '我发现我不是不会拒绝，是没有给自己拒绝的时间。\n\n' +
      '下次别人突然问我，我先说晚点回复。';
    await evaluate(`(function(){
      var ta = document.querySelector('#rawInput');
      ta.value = ${JSON.stringify(TEXT)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value.length;
    })()`);
    await sleep(200);

    await click('[data-act="save-raw"]');
    await sleep(600);

    await click('#tabbar .tab[data-route="trace"]');
    await sleep(600);

    await click('[data-act="open-event"]');
    await sleep(600);

    /* 「这条记录」页（还没整理）：看「整理这条」是不是靠右 */
    await shot('00-记录-未整理');
    const tidyBtn = await evaluate(`(function(){
      var b = document.querySelector('[data-act="start-tidy-from"]');
      if (!b) return JSON.stringify({ error: '没找到「整理这条」' });
      var r = b.getBoundingClientRect();
      var host = b.parentElement.getBoundingClientRect();
      return JSON.stringify({
        text: b.textContent.trim(),
        left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
        hostRight: Math.round(host.right),
        gapRight: Math.round(host.right - r.right),
        justify: getComputedStyle(b.parentElement).justifyContent
      });
    })()`);
    console.log('「整理这条」的位置：' + tidyBtn);

    await click('[data-act="start-tidy-from"]');
    await sleep(900);

    /* 第 1 步：清理 */
    console.log('\n【第一步 清理】');
    console.log(JSON.stringify(await report('01-整理-清理'), null, 2));

    /* 把建议删的词全部点成「留下」：看留下的样子是不是一眼能认出「还能再点」，
       顺便确认不会再误报「没有找到该删的口水词」。 */
    const keptCount = await evaluate(`(function(){
      var ds = document.querySelectorAll('.diff del[data-act]');
      var n = ds.length;
      Array.prototype.forEach.call(ds, function (d) { d.click(); });
      return n;
    })()`);
    if (keptCount) {
      await sleep(900);
      const keptState = await evaluate(`(function(){
        return JSON.stringify({
          ins: document.querySelectorAll('.diff ins[data-act]').length,
          del: document.querySelectorAll('.diff del[data-act]').length,
          said: /没有找到该删的口水词/.test(document.querySelector('#stage').textContent) ? '误报' : '正常',
          label: (document.querySelector('.card .block-label') || {}).textContent || ''
        });
      })()`);
      console.log('  全部留下之后：' + keptState + '（点了 ' + keptCount + ' 处）');
      await shot('01b-清理-全部留下');
    }

    /* 顺带验一下原文分段有没有被揉掉 */
    const paraCheck = await evaluate(`(function(){
      var d = document.querySelector('details .block-body') ||
              document.querySelector('.block-body');
      if (!d) return '没有原文块';
      var t = d.textContent;
      var cs = getComputedStyle(d);
      return JSON.stringify({
        whiteSpace: cs.whiteSpace,
        hasBlankLine: t.indexOf('\\n\\n') >= 0,
        head: t.slice(0, 24)
      });
    })()`);
    console.log('原文分段：' + paraCheck);

    /* 进第 2 步 */
    let next = await click('[data-act="accept-clean-keep"]');
    if (next.indexOf('NO') === 0) next = await click('[data-act="accept-clean"]');
    if (next.indexOf('NO') === 0) throw new Error('清理这步没找到「往下」的按钮');
    await sleep(900);

    console.log('\n【第二步 拆开】');
    console.log(JSON.stringify(await report('02-整理-拆开'), null, 2));

    /* 进第 3 步 */
    next = await click('[data-act="accept-split"]');
    if (next.indexOf('NO') === 0) throw new Error('拆开这步没找到「就这样」');
    await sleep(900);

    console.log('\n【第三步 分类】');
    console.log(JSON.stringify(await report('03-整理-分类'), null, 2));

    /* 再点一下第一个标签，看看「选上」的样子（实线 + 光晕）是不是一眼能认出来 */
    const tapped = await evaluate(`(function(){
      var c = document.querySelector('.chip[data-act="toggle-tag"]');
      if (!c) return 'NO';
      c.click();
      return c.getAttribute('data-value');
    })()`);
    await sleep(600);
    const onCount = await evaluate('document.querySelectorAll(".chip[data-act=\\"toggle-tag\\"].on").length');
    console.log('  点了一下「' + tapped + '」→ 选中的有 ' + onCount + ' 个');
    await shot('04-整理-分类-选中一个');

    console.log('\n截图都在：' + OUT);
  } finally {
    if (cdp) cdp.close();
    try { child.kill(); } catch (e) { /* 忽略 */ }
  }
})().catch((e) => {
  console.error('\n出错了：' + (e && e.message));
  process.exit(1);
});
