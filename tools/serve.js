/* 本地预览服务器 —— 开发时用来在浏览器里看效果。
   Service Worker 需要 http 协议才会生效，所以不要直接双击 index.html。
   用法：node tools/serve.js  （默认 http://127.0.0.1:5173）
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

/* 默认起主版 web/；要看简洁版就 GBM_WEB=web-simple node tools/serve.js */
const WEB = path.resolve(__dirname, '..', process.env.GBM_WEB || 'web');
const PORT = Number(process.argv[2] || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const abs = path.join(WEB, rel);
  if (!abs.startsWith(WEB) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('找不到：' + rel);
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  res.end(fs.readFileSync(abs));
}).listen(PORT, '127.0.0.1', () => {
  console.log('预览地址： http://127.0.0.1:' + PORT);
});
