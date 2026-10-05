/* 校验 poem.js 引用的诗词标签是否都在 poem-data.js 里真实存在。
   用法：node tools/check_poem_tags.js */
'use strict';
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
global.window = global;

require(path.join(root, 'web/js/poem-data.js'));
require(path.join(root, 'web/js/store.js'));
require(path.join(root, 'web/js/poem.js'));

var TAGS = window.POEM_DATA.tags;
var LINES = window.POEM_DATA.lines;

/* 每个标签的句量 */
var count = {};
LINES.forEach(function (l) {
  (l.g || []).forEach(function (i) {
    var t = TAGS[i];
    count[t] = (count[t] || 0) + 1;
  });
});

console.log('总句数 ' + LINES.length + '，标签数 ' + TAGS.length);
console.log('');
console.log('--- 各标签句量（低于 200 的标 * ）---');
TAGS.forEach(function (t) {
  var n = count[t] || 0;
  console.log('  ' + (n < 200 ? '*' : ' ') + ' ' + t + '  ' + n);
});

/* 把 poem.js 里的 TAG_MAP / EMOTION_WORDS 抠出来检查 */
var src = fs.readFileSync(path.join(root, 'web/js/poem.js'), 'utf8');
var bad = [];

/* TAG_MAP 里的所有诗词标签 */
var mapBlock = src.slice(src.indexOf('var TAG_MAP'), src.indexOf('var EMOTION_WORDS'));
mapBlock.replace(/\[([^\]]*)\]/g, function (_, inner) {
  inner.split(',').forEach(function (s) {
    var t = s.trim().replace(/^['"]|['"]$/g, '');
    if (t && TAGS.indexOf(t) < 0) bad.push('TAG_MAP → ' + t);
  });
  return _;
});

/* EMOTION_WORDS 里的 tag */
var emoBlock = src.slice(src.indexOf('var EMOTION_WORDS'), src.indexOf('function textOf'));
emoBlock.replace(/tag:\s*'([^']+)'/g, function (_, t) {
  if (TAGS.indexOf(t) < 0) bad.push('EMOTION_WORDS → ' + t);
  return _;
});

/* VOCAB（用户在界面上能点的分类）里每个词，在 TAG_MAP 里有没有对应 */
var miss = [];
['domain', 'mechanism', 'scene'].forEach(function (g) {
  (window.Store.VOCAB[g] || []).forEach(function (v) {
    if (v === '其他') return;
    if (mapBlock.indexOf("'" + v + "'") < 0) miss.push(g + ' / ' + v);
  });
});

console.log('');
if (bad.length) {
  console.log('!! 引用了不存在的诗词标签：');
  bad.forEach(function (b) { console.log('   ' + b); });
} else {
  console.log('OK  TAG_MAP / EMOTION_WORDS 引用的诗词标签全部存在');
}

if (miss.length) {
  console.log('!! 界面上能点、但没有映射到诗词标签：');
  miss.forEach(function (b) { console.log('   ' + b); });
} else {
  console.log('OK  界面上所有可点的分类词都有诗词映射');
}

/* 反查：哪些诗词标签永远用不上 */
var used = {};
mapBlock.replace(/\[([^\]]*)\]/g, function (_, inner) {
  inner.split(',').forEach(function (s) {
    var t = s.trim().replace(/^['"]|['"]$/g, '');
    if (t) used[t] = 1;
  });
  return _;
});
emoBlock.replace(/tag:\s*'([^']+)'/g, function (_, t) { used[t] = 1; return _; });

var dead = TAGS.filter(function (t) { return t !== '通用' && !used[t]; });
console.log('');
console.log(dead.length
  ? '未被打分引用的诗词标签（占体积）：' + dead.join('、')
  : 'OK  所有诗词标签都用得上');

process.exit(bad.length || miss.length ? 1 : 0);
