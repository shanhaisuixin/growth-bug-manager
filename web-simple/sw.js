/* 离线缓存 —— 没网时照样能记录、查看。

   策略：**对所有东西都走「先联网，拿不到再用缓存」**。
   以前样式和脚本走「先用缓存、后台补新」，结果是改了 CSS 之后刷新一次还是旧样式。
   这套东西满打满算不到 1MB，联网时多花的那点时间根本感觉不到，
   而「改了就能立刻看到」比省那几十毫秒重要得多。没网时照样从缓存起，一样能用。 */
var CACHE = 'gbm-simple-v2';
var ASSETS = [
  './',
  './index.html',
  './assets/style.css',
  './assets/manifest.webmanifest',
  './assets/icon.svg',
  './js/store.js',
  './js/zip.js',
  './js/poem-data.js',
  './js/poem.js',
  './js/views.js',
  './js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    }).catch(function () { /* 部分资源失败也允许安装 */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    })
  );
  self.clients.claim();
});

function putInCache(req, res) {
  if (!res || !res.ok) return res;
  var clone = res.clone();
  caches.open(CACHE).then(function (c) { c.put(req, clone); }).catch(function () {});
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  /* 外部的一律不插手。这个 App 自己不发任何外部请求
     （「去发布页看看」是把链接交给浏览器，不经过这里）。 */
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) { return putInCache(req, res); })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      })
  );
});
