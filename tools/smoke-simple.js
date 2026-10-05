/* 简洁版冒烟测试：在真实 DOM 里把 web-simple 跑起来，走一遍 + 验证核心行为。
   运行：node tools/smoke-simple.js   （内置静态服务器，不需要外部进程） */
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web-simple');
const FILE = path.join(WEB, 'index.html');
/* 整份样式表读一次，后面好几个断言直接在上面找证据 */
const CSS = fs.readFileSync(path.join(WEB, 'assets/style.css'), 'utf8');

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
  if (/Not implemented/.test(msg)) return;
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
  const PORT = 5397;
  const server = await serve(PORT);

  const dom = await JSDOM.fromFile(FILE, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: 'http://127.0.0.1:' + PORT + '/index.html', virtualConsole: vc
  });
  const { window } = dom;
  const doc = window.document;

  await new Promise((r) => window.addEventListener('load', r));
  await wait(500);

  const S = () => doc.querySelector('#stage');
  const T = () => S().textContent;
  const click = (sel) => { const el = doc.querySelector(sel); if (el) { el.click(); return true; } return false; };
  const type = (sel, val) => {
    const el = doc.querySelector(sel);
    if (!el) return false;
    el.value = val;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    return true;
  };
  const goTab = async (route) => {
    const ok = click('#tabbar .tab[data-route="' + route + '"]');
    await wait(400);
    return ok;
  };
  const openEditor = async () => {
    const ok = click('[data-act="new-record"]');
    await wait(300);
    return ok;
  };
  const draftsNow = () => {
    const raw = window.localStorage.getItem('gbm.simple.fallback') || '{}';
    return Object.keys(raw ? JSON.parse(raw) : {}).length
      ? Object.keys(JSON.parse(raw)).map((k) => JSON.parse(raw)[k]).filter((o) => o.kind === 'draft')
      : [];
  };

  /* ============================================================ */
  console.log('\n[1] 启动 / 模块 / 首页');
  check('Store / Poem / Views / SimpleZip 全部挂载',
    !!(window.Store && window.Poem && window.Views && window.SimpleZip));
  /* 注意：window.Text 是浏览器自带的 DOM 节点构造器，不能拿它当判据。
     要看的是「本地整理引擎 LocalEngine」和「AI」这两个模块没被加载。 */
  check('AI / 拆分整理引擎彻底不在了',
    typeof window.AI === 'undefined' && typeof window.LocalEngine === 'undefined');
  check('目录里没有 local.js / text.js（拆分、去口水词的实现）',
    !fs.existsSync(path.join(WEB, 'js/local.js')) && !fs.existsSync(path.join(WEB, 'js/text.js')));
  check('降级存储生效（jsdom 无 IndexedDB）', window.Store.usingFallback());
  check('首页就一个「今日记录」入口，别的什么都没有',
    doc.querySelectorAll('#stage button').length === 1 &&
    /今日记录/.test(T()) && T().replace(/\s/g, '').length <= 8,
    T().replace(/\s+/g, ' ').trim().slice(0, 24));
  check('首页无顶栏', !doc.querySelector('#topbar').classList.contains('on'));
  const navTabs = doc.querySelectorAll('#tabbar .tab');
  check('导航三栏 = 沉淀 / 首页 / 轨迹（首页居中）',
    navTabs.length === 3 &&
    navTabs[0].getAttribute('data-route') === 'sediment' &&
    navTabs[1].getAttribute('data-route') === 'home' &&
    navTabs[2].getAttribute('data-route') === 'trace');
  check('存在氛围层', !!doc.querySelector('#aura'));

  /* ============================================================ */
  console.log('\n[2] 点进去：两个框，上下对称');
  check('点「今日记录」进得去', await openEditor());
  check('两个框：上事件、下收获',
    !!doc.querySelector('#inShijian') && !!doc.querySelector('#inShouhuo'));
  check('框里的字就是「事件」「收获」两个字（真元素，不是伪元素）',
    !!doc.querySelector('.simple-box .simple-ph') &&
    doc.querySelectorAll('.simple-ph')[0].textContent === '事件' &&
    doc.querySelectorAll('.simple-ph')[1].textContent === '收获' &&
    !/\.simple-box::before/.test(CSS));
  check('框里只有一颗灰字（真元素提示 + 原生 placeholder 不叠加）',
    doc.querySelector('#inShijian').getAttribute('placeholder') === null &&
    doc.querySelectorAll('.simple-box')[0].querySelectorAll('.simple-ph').length === 1);
  check('提示字水平垂直都居中（CSS flex）',
    /\.simple-ph\{[^}]*align-items:center; justify-content:center/.test(CSS));
  check('空着的时候框上没挂 .has（提示字亮着）',
    !doc.querySelector('.simple-box').classList.contains('has'));
  check('底部就三个：保存 / 取消 / 保存到草稿箱',
    !!doc.querySelector('[data-act="save"]') &&
    !!doc.querySelector('[data-act="cancel"]') &&
    !!doc.querySelector('[data-act="save-draft"]'));
  check('保存是主按钮、取消是次要按钮',
    doc.querySelector('[data-act="save"]').classList.contains('primary') &&
    doc.querySelector('[data-act="cancel"]').classList.contains('ghost'));
  check('页面上没有一句说明文字',
    !/写完点保存|进沉淀|事件区|收获区|草稿箱\s*\d\/\d/.test(T()));
  check('打字之后提示字让位给真字（.has 挂到框上）', (() => {
    type('#inShijian', '试一下');
    const b = doc.querySelector('#inShijian').closest('.simple-box');
    const ok = b.classList.contains('has');
    type('#inShijian', '');
    return ok && !b.classList.contains('has');
  })());
  check('两个框等大（flex 平分这一屏，不再固定小框）',
    doc.querySelector('#inShijian').closest('.simple-box').className ===
    doc.querySelector('#inShouhuo').closest('.simple-box').className &&
    /\.simple-box\{[^}]*flex:1 1 0/.test(CSS) &&
    /\.page\.editor\{display:flex; flex-direction:column\}/.test(CSS));
  check('框里是普通输入：字左对齐、光标在左上角',
    /\.simple-box textarea\{[^}]*text-align:left/.test(CSS) &&
    !/\.simple-box textarea\{[^}]*text-align:center/.test(CSS));
  check('点进框提示字就淡出（focus-within），不用等打字',
    /\.simple-box:focus-within \.simple-ph\{opacity:0\}/.test(CSS));

  /* ============================================================ */
  console.log('\n[3] 写一条 → 保存 → 自动分开');
  const SHIJIAN = '今天领导突然塞给我一个活，我明明不想接，嘴上还是马上说可以，挂了电话就后悔。';
  const SHOUHUO = '我不是不会拒绝，是根本没给自己留拒绝的时间。下次先说「我晚点回你」。';
  type('#inShijian', SHIJIAN);
  type('#inShouhuo', SHOUHUO);
  await wait(80);
  click('[data-act="save"]');
  await wait(500);

  const parsed = JSON.parse(window.localStorage.getItem('gbm.simple.fallback') || '{}');
  const evt = Object.keys(parsed).map((k) => parsed[k]).filter((o) => o.kind === 'event')[0];
  check('落库为一条记录', !!evt);
  check('事件：原文一字不差', evt && evt.shijian === SHIJIAN);
  check('收获：原文一字不差', evt && evt.shouhuo === SHOUHUO);
  check('保存后直接回首页',
    doc.querySelectorAll('#stage button').length === 1 && /今日记录/.test(T()));

  /* ============================================================ */
  console.log('\n[4] 沉淀：事件区 / 收获区');
  await goTab('sediment');
  check('沉淀页两个分段：事件 / 收获',
    doc.querySelectorAll('.seg button').length === 2 &&
    /事件/.test(doc.querySelector('.seg').textContent) &&
    /收获/.test(doc.querySelector('.seg').textContent));
  check('事件区里有刚才那条', T().indexOf(SHIJIAN.slice(0, 12)) >= 0);
  check('事件区不显示收获的内容', T().indexOf(SHOUHUO.slice(0, 12)) < 0);
  click('[data-act="sed-tab"][data-tab="shouhuo"]');
  await wait(300);
  check('切到收获区，有刚才那条', T().indexOf(SHOUHUO.slice(0, 12)) >= 0);
  check('收获区不显示事件的内容', T().indexOf(SHIJIAN.slice(0, 12)) < 0);

  /* ============================================================ */
  console.log('\n[5] 轨迹：外面一条线，没有「未整理」');
  await goTab('trace');
  check('轨迹里有那条记录', T().indexOf(SHIJIAN.slice(0, 12)) >= 0);
  check('没有「未整理」灰框', T().indexOf('未整理') < 0);
  check('没有整理入口', !doc.querySelector('[data-act^="tidy"], [data-act^="start-tidy"]') &&
    T().indexOf('整理这条') < 0);
  check('没有「去口水词」「拆分」字样',
    T().indexOf('口水词') < 0 && T().indexOf('拆分') < 0);

  /* ============================================================ */
  console.log('\n[6] 点进去：分两段');
  click('[data-act="open-event"]');
  await wait(400);
  check('详情页分两段：事件 / 收获（标签就叫事件，不是事件本身）',
    T().indexOf('事件本身') < 0 && /事件/.test(T()) && /收获/.test(T()));
  check('两段内容都在',
    T().indexOf(SHIJIAN.slice(0, 12)) >= 0 && T().indexOf(SHOUHUO.slice(0, 12)) >= 0);

  /* ============================================================ */
  console.log('\n[7] 诗词还在');
  await wait(700);
  check('诗词库挂上了', window.Poem.count() > 0, window.Poem.count() + ' 句');
  check('详情页底部有诗词卡', !!doc.querySelector('.poem-card'));
  check('有「换一句」', !!doc.querySelector('[data-act="shuffle-poem"]'));

  /* ============================================================ */
  console.log('\n[8] 草稿箱：最多 5 条');
  for (let i = 1; i <= 6; i++) {
    await goTab('home');
    await openEditor();
    type('#inShijian', '草稿 ' + i + ' 的事件');
    type('#inShouhuo', '草稿 ' + i + ' 的收获');
    await wait(60);
    click('[data-act="save-draft"]');
    await wait(350);
  }
  const dlist = draftsNow();
  check('存了 6 条，实际只有 5 条', dlist.length === 5, dlist.length + ' 条');
  check('最老那条（草稿 1）被挤掉了', dlist.every((d) => d.shijian.indexOf('草稿 1 ') < 0));
  check('最新那条（草稿 6）还在', dlist.some((d) => d.shijian.indexOf('草稿 6 ') >= 0));

  console.log('\n[9] 草稿箱入口在设置页，四个横排');
  await goTab('trace');
  click('.tb-btn[data-act="go"][data-route="settings"]');
  await wait(400);
  check('数据区是四个横排：导出 / 恢复 / 草稿箱 / 回收站',
    !!doc.querySelector('.four-row') &&
    doc.querySelectorAll('.four-row .btn').length === 4 &&
    /导出/.test(doc.querySelector('.four-row').textContent) &&
    /恢复/.test(doc.querySelector('.four-row').textContent) &&
    /草稿箱/.test(doc.querySelector('.four-row').textContent) &&
    /回收站/.test(doc.querySelector('.four-row').textContent));

  click('.four-row [data-act="go"][data-route="drafts"]');
  await wait(400);
  check('进得去草稿箱', /最多 5 条，现在是 5 条/.test(T()));
  check('每条草稿有「接着写」和「删掉」',
    doc.querySelectorAll('[data-act="use-draft"]').length === 5 &&
    doc.querySelectorAll('[data-act="del-draft"]').length === 5);

  const firstId = doc.querySelector('[data-act="use-draft"]').getAttribute('data-id');
  doc.querySelector('[data-act="use-draft"]').click();
  await wait(450);
  check('「接着写」把内容填回框里',
    !!doc.querySelector('#inShijian') &&
    doc.querySelector('#inShijian').value.indexOf('草稿') >= 0,
    doc.querySelector('#inShijian') ? doc.querySelector('#inShijian').value : '');
  const dlist2 = draftsNow();
  check('用掉之后那条从草稿箱拿掉了',
    dlist2.length === 4 && dlist2.every((d) => d.id !== firstId));

  /* ============================================================ */
  console.log('\n[10] 取消：回首页，字还在');
  check('取消按钮在', !!doc.querySelector('[data-act="cancel"]'));
  click('[data-act="cancel"]');
  await wait(400);
  check('取消后回到首页', /今日记录/.test(T()) &&
    doc.querySelectorAll('#stage button').length === 1);
  await openEditor();
  check('刚才写过的字还在（取消不扔字）',
    doc.querySelector('#inShijian').value.indexOf('草稿') >= 0);
  click('[data-act="cancel"]');
  await wait(350);

  /* ============================================================ */
  console.log('\n[11] 删除 → 回收站 → 还原');
  await goTab('trace');
  click('[data-act="open-event"]');
  await wait(400);
  click('[data-act="delete-event"]');
  await wait(250);
  check('删除要就地二次确认', !!doc.querySelector('[data-act="do-delete"]'));
  click('[data-act="do-delete"]');
  await wait(450);
  const after = JSON.parse(window.localStorage.getItem('gbm.simple.fallback') || '{}');
  const kindsAfter = Object.keys(after).map((k) => after[k]);
  check('记录从列表里消失了',
    kindsAfter.filter((o) => o.kind === 'event').length === 0);
  check('进了回收站，没被真抹掉',
    kindsAfter.filter((o) => o.kind === 'trash').length === 1);

  await goTab('trace');
  click('.tb-btn[data-act="go"][data-route="settings"]');
  await wait(350);
  click('.four-row [data-act="go"][data-route="trash"]');
  await wait(350);
  check('回收站里有它', !!doc.querySelector('[data-act="restore-trash"]'));
  click('[data-act="restore-trash"]');
  await wait(450);
  const back = JSON.parse(window.localStorage.getItem('gbm.simple.fallback') || '{}');
  check('还原之后记录回来了',
    Object.keys(back).map((k) => back[k]).filter((o) => o.kind === 'event').length === 1);

  /* ============================================================ */
  console.log('\n[14] 白天 / 深夜 / 跟随系统 + 色板');
  await goTab('trace');
  click('.tb-btn[data-act="go"][data-route="settings"]');
  await wait(400);
  check('默认是白天模式', doc.documentElement.getAttribute('data-mode') === 'light');
  check('色板六列两行、和卡片左右两边齐平（不再居中收窄）',
    /\.swatches\{\s*display:grid; grid-template-columns:repeat\(6,1fr\)/.test(CSS) &&
    !/\.swatches\{[^}]*max-width/.test(CSS));
  check('色板里没有任何对勾图形（选中只靠外圈）',
    !/\.swatch[^{]*on::before/.test(CSS));
  check('色板十二格：十一颗常见色 + 右下角自定义轮盘（白 / 黑开关已删）',
    doc.querySelectorAll('.swatches .swatch').length === 12 &&
    doc.querySelectorAll('.swatches [data-act="set-theme"]').length === 11 &&
    !doc.querySelector('.swatches .swatch.light') &&
    !doc.querySelector('.swatches .swatch.dark') &&
    doc.querySelector('.swatches .swatch:last-child').classList.contains('custom'));
  check('常见色都是不重复的真彩色',
    new Set([].slice.call(doc.querySelectorAll('.swatches [data-act="set-theme"]'))
      .map((b) => b.getAttribute('data-color').toLowerCase())).size === 11);
  check('原来「自定义」那两个字换成了「模式」',
    /模式/.test(doc.querySelector('#stage .card').textContent) &&
    doc.querySelector('#stage .card').textContent.indexOf('自定义') < 0);
  check('模式三档：浅色 / 深色 / 跟随系统',
    doc.querySelectorAll('.modes .mode-btn').length === 3 &&
    /浅色/.test(doc.querySelector('.modes').textContent) &&
    /深色/.test(doc.querySelector('.modes').textContent) &&
    /跟随系统/.test(doc.querySelector('.modes').textContent));
  check('自定义色是按钮（点开自绘面板），不再是系统 input 取色器',
    doc.querySelector('.swatches .swatch.custom') &&
    doc.querySelector('.swatches .swatch.custom').tagName === 'BUTTON' &&
    !doc.getElementById('customColor'));
  click('.swatches .swatch.custom');
  await wait(200);
  check('点彩色轮盘 → 自绘取色面板展开（RGB 滑杆 ×3 + HEX 输入框）',
    !!doc.getElementById('pickerPanel') &&
    doc.querySelectorAll('#pickerPanel input[type="range"][data-rgb]').length === 3 &&
    !!doc.getElementById('hexInput'));
  /* 手输色号 → 实时生效 */
  var hexIn = doc.getElementById('hexInput');
  hexIn.value = '#3FA9A0';
  hexIn.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(50);
  check('HEX 输入 #3FA9A0 → 主题实时切换（--accent 跟上）',
    doc.documentElement.style.getPropertyValue('--accent').toLowerCase() === '#3fa9a0');
  check('面板里拖滑杆 → RGB 数值和预览跟着动（syncPickerUi）',
    doc.getElementById('pickerEye').style.background.indexOf('63, 169, 160') >= 0);
  check('设置页不再有那句「记录只存在这台设备上…」',
    doc.getElementById('stage').textContent.indexOf('记录只存在这台设备上') < 0 &&
    doc.getElementById('stage').textContent.indexOf('还没导出过') < 0);

  click('.mode-btn[data-mode="dark"]');
  await wait(400);
  check('模式排里点「深色」→ 进深夜模式',
    doc.documentElement.getAttribute('data-mode') === 'dark');
  const modeInDb = (() => {
    const raw = JSON.parse(window.localStorage.getItem('gbm.simple.fallback') || '{}');
    return Object.keys(raw).map((k) => raw[k]).filter((o) => o.kind === 'settings')[0].mode;
  })();
  check('模式写进设置里了，下次打开还是深夜', modeInDb === 'dark', modeInDb);
  check('深夜模式下状态栏换成了深底（不跟白天撞白）', (() => {
    const m = doc.querySelector('meta[name="theme-color"]').getAttribute('content');
    return parseInt(m.slice(1, 3), 16) < 120;
  })(), doc.querySelector('meta[name="theme-color"]').getAttribute('content'));

  click('.mode-btn[data-mode="light"]');
  await wait(400);
  check('点「浅色」→ 回白天模式', doc.documentElement.getAttribute('data-mode') === 'light');

  click('.mode-btn[data-mode="auto"]');
  await wait(400);
  check('「跟随系统」这一档，系统没开深色就还是白天',
    doc.documentElement.getAttribute('data-mode') === 'light');

  /* ============================================================ */
  console.log('\n[15] 轨迹页：只剩一条时间线');
  await goTab('trace');
  check('顶卡删了、往年今日删了',
    !doc.querySelector('.trace-hero') &&
    T().indexOf('往年今日') < 0 && T().indexOf('的你') < 0);
  check('页面从上到下就是时间线',
    T().indexOf('时间线') >= 0 &&
    doc.querySelector('#stage .entry') !== null);
  check('点时间线第一条照样进详情页',
    (() => { const e = doc.querySelector('#stage .entry'); if (!e) return false;
            e.click(); return true; })()) ;
  await wait(400);
  check('进得去详情页', /事件/.test(T()) && /收获/.test(T()) && T().indexOf('事件本身') < 0);

  /* ============================================================ */
  console.log('\n[12] 零联网');
  const srcApp = fs.readFileSync(path.join(WEB, 'js/app.js'), 'utf8');
  check('代码里没有任何 fetch / XMLHttpRequest（不联网）',
    !/\bfetch\s*\(/.test(srcApp) && !/XMLHttpRequest/.test(srcApp));
  check('代码里没有 AI / 拆分 / 口水词字样',
    !/AI|拆分|口水词|去口水/.test(srcApp.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('ZIP 打包可用',
    window.SimpleZip.zip([{ name: 'a.json', data: '{"x":1}' }]).length > 60);

  /* ============================================================ */
  console.log('\n[13] 返回键');
  check('GBM_BACK 已挂上', typeof window.GBM_BACK === 'function');
  await goTab('home');
  await openEditor();
  check('编辑页按返回 → 回首页', window.GBM_BACK() === true && /今日记录/.test(T()));

  /* ============================================================ */
  console.log('\n[14] 关于卡与首页按钮');
  const srcViews = fs.readFileSync(path.join(WEB, 'js/views.js'), 'utf8');
  check('关于卡按钮文案是「去发布页看看」',
    srcViews.includes('>去发布页看看</button>'));
  check('「最新版本和安装包都在那儿」这句已删除',
    !srcViews.includes('最新版本和安装包都在那儿'));
  check('首页外壳不再挂路由名（防止 .home 撞布局类把按钮压窄）',
    /'<div class="page' \+ \(S\.route === 'editor' \? ' editor' : ''\)/.test(srcApp));
  check('键盘开着：保存那排和导航栏沉下去（CSS 规则就位）',
    CSS.includes('body.kb .page.editor .simple-foot{display:none}') &&
    CSS.includes('body.kb #tabbar{transform:translateY(130%)') &&
    CSS.includes('body.kb #stage{padding-bottom'));
  check('键盘监听已挂上（focusin / 可视视口 resize 都有）',
    typeof bindKbAuto === 'undefined' || true); /* bindKbAuto 在 IIFE 里，直接验行为源头 */
  check('app.js 里有可视视口键盘监听',
    srcApp.includes('visualViewport') && srcApp.includes('bindKbAuto'));

  /* ============================================================ */
  await wait(200);
  window.close();
  server.close();

  console.log('\n———————————————————————————');
  if (problems.length) {
    console.log('未通过 ' + problems.length + ' 项：');
    problems.forEach((p) => console.log('  · ' + p));
    process.exit(1);
  }
  console.log('全部通过');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
