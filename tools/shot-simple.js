/* 简洁版截图：用本机已装好的 Chrome / Edge 无头模式，按手机尺寸把 web-simple 渲染出来截图。
   不弹窗口、不动鼠标、不抢前台，纯离屏渲染。

   用法：
     GBM_WEB=web-simple node tools/serve.js 5174      # 先把页面起起来
     node tools/shot-simple.js http://127.0.0.1:5174/ shots-simple
*/
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const BASE = process.argv[2] || 'http://127.0.0.1:5174/';
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'shots-simple'));
const PORT = Number(process.env.GBM_CDP_PORT || 9335);

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

  const profile = path.join(os.tmpdir(), 'gbm-simple-shot-profile');
  /* 每次跑都从干净 profile 开始。这里只删自己建的这个临时目录 ——
     加个名字守卫，防止路径被改错时误删别的目录。 */
  if (path.basename(profile) === 'gbm-simple-shot-profile' && fs.existsSync(profile)) {
    fs.rmSync(profile, { recursive: true, force: true });
  }

  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--force-device-scale-factor=2',
    /* 系统代理会把 127.0.0.1 的请求也拦一道，页面就变成一片空白。
       截图只连本机，直接把代理关掉。 */
    '--no-proxy-server', '--proxy-bypass-list=*',
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
      } catch (e) { /* 还没起来，接着等 */ }
    }
    if (!target) throw new Error('Chrome 的调试端口一直没就绪');

    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    await cdp.send('Page.navigate', { url: BASE });

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
    /* 等页面真的起来：#tabbar 出现 + 首页两个框出现，最多等 20 秒。
       光 sleep 一个固定值不稳 —— 机器忙的时候 1.6 秒根本不够，
       页面还没渲染就开始点，所有点击都会落空。 */
    let booted = false;
    for (let i = 0; i < 40 && !booted; i++) {
      await sleep(500);
      try {
        booted = await evaluate(
          "!!(document.querySelector('#tabbar') && document.querySelector('#inShijian'))");
      } catch (e) { /* 导航还没完成，接着等 */ }
    }
    if (!booted) throw new Error('页面一直没渲染出来（检查 ' + BASE + ' 起没起来）');
    console.log('页面已就绪');
    /* 诗词库是开机之后后台挂的，等它到位再开始，不然详情页那句诗是空的 */
    await sleep(1200);

    const click = (sel) => evaluate(
      '(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');' +
      'if(!e)return "NO:"+' + JSON.stringify(sel) + ';e.click();return "OK";})()');
    const type = (sel, val) => evaluate(
      '(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');' +
      'if(!e)return "NO:"+' + JSON.stringify(sel) + ';' +
      'e.value=' + JSON.stringify(val) + ';' +
      "e.dispatchEvent(new Event('input',{bubbles:true}));return 'OK';})()");

    const shot = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('  截图 → ' + path.relative(path.join(__dirname, '..'), file));
    };

    const goTab = async (route) => {
      const r = await click('#tabbar .tab[data-route="' + route + '"]');
      await sleep(700);
      return r;
    };

    console.log('\n[1] 首页（空）');
    await shot('1-首页-空');

    console.log('\n[2] 首页（写完）');
    await type('#inShijian',
      '今天领导突然塞给我一个活，我明明不想接，嘴上还是马上说可以，挂了电话就后悔。');
    await type('#inShouhuo',
      '我不是不会拒绝，是根本没给自己留拒绝的时间。下次先说「我晚点回你」。');
    await sleep(300);
    await shot('2-首页-写完');

    console.log('\n[3] 保存');
    console.log('  ' + await click('[data-act="save"]'));
    await sleep(900);
    await shot('3-保存后');

    console.log('\n[4] 沉淀 · 事件区');
    console.log('  ' + await goTab('sediment'));
    await shot('4-沉淀-事件区');

    console.log('\n[5] 沉淀 · 收获区');
    console.log('  ' + await click('[data-act="sed-tab"][data-tab="shouhuo"]'));
    await sleep(600);
    await shot('5-沉淀-收获区');

    console.log('\n[6] 轨迹');
    console.log('  ' + await goTab('trace'));
    await shot('6-轨迹');

    console.log('\n[7] 详情（分两段）');
    console.log('  ' + await click('[data-act="open-event"]'));
    await sleep(1200);
    await shot('7-详情-两段');

    console.log('\n[8] 详情往下滚（诗词）');
    await evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(500);
    await shot('8-详情-诗词');

    console.log('\n[9] 草稿箱（存 3 条）');
    console.log('  ' + await goTab('home'));
    for (let i = 1; i <= 3; i++) {
      await type('#inShijian', '写到一半先搁着 ' + i);
      await type('#inShouhuo', '这条还没想清楚 ' + i);
      await sleep(150);
      await click('[data-act="save-draft"]');
      await sleep(500);
    }
    console.log('  ' + await click('[data-act="go"][data-route="drafts"]'));
    await sleep(700);
    await shot('9-草稿箱');

    console.log('\n[10] 设置页');
    console.log('  ' + await goTab('trace'));
    console.log('  ' + await click('.tb-btn[data-act="go"][data-route="settings"]'));
    await sleep(700);
    await shot('10-设置');

    /* 顺手量一下底部导航三栏是不是等宽居中 */
    const nav = await evaluate(`(function () {
      var tabs = Array.prototype.map.call(
        document.querySelectorAll('#tabbar .tab'), function (t) {
          var r = t.getBoundingClientRect();
          return { route: t.getAttribute('data-route'),
                   left: Math.round(r.left), width: Math.round(r.width) };
        });
      return JSON.stringify(tabs);
    })()`);
    console.log('\n底部导航：' + nav);

    const overlap = await evaluate(`(function () {
      var nav = document.querySelector('#tabbar').getBoundingClientRect();
      var stage = document.querySelector('#stage').getBoundingClientRect();
      return JSON.stringify({ navTop: Math.round(nav.top),
                              stageBottom: Math.round(stage.bottom) });
    })()`);
    console.log('导航与内容区：' + overlap);

  } finally {
    if (cdp) cdp.close();
    try { child.kill(); } catch (e) { /* 忽略 */ }
  }
  console.log('\n完成。图在 ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
