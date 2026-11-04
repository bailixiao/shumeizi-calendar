// 組出「植素園happy購」團購網頁（規格 0.6.1）：tools/shop-web 的外殼＋行事曆的 css、js（shop.js 的網頁模式）。
// 執行：node tools/build-shop-web.js [輸出資料夾]，預設 ../植素園團購（GitHub 儲存庫 bailixiao/zhisu-shop），之後到那裡 commit、push。
// 改了 js/shop.js、js/api.js、css/app.css 或 tools/shop-web 都要重新 build。
// 本機預覽：node tools/dev-server.js --mock --demo，開 http://localhost:5175/shop-web/
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const src = path.join(__dirname, 'shop-web');
const out = path.resolve(process.argv[2] || path.join(root, '..', '植素園團購'));
const JS = ['site', 'config', 'api', 'format', 'share', 'addcal', 'confirm', 'shop-member', 'shop'];

const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const ver = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);

copy(path.join(root, 'css', 'app.css'), path.join(out, 'css', 'app.css'));
JS.forEach((n) => copy(path.join(root, 'js', n + '.js'), path.join(out, 'js', n + '.js')));
['web.js', 'web.css', 'manifest.webmanifest', 'img/zhisu-logo.png', 'img/zhisu-head.png'].forEach((f) => copy(path.join(src, f), path.join(out, f)));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

// 每個 css、js 加 ?v=內容雜湊，改了手機才會拿到新的
let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8')
  .replace(/(href|src)="((?:css|js)\/[^"?]+|web\.(?:js|css))"/g, (m, attr, f) => `${attr}="${f}?v=${ver(path.join(out, f))}"`);
html = html.replace('這個檔案是原始碼，node tools/build-shop-web.js 組成網站（bailixiao/zhisu-shop）', '由書槑子行事曆的 node tools/build-shop-web.js 產生，不要直接改');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('植素園happy購 → ' + out);
