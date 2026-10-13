// 產生 App 圖示（2026/10/14 起用正式標誌：書槑子青年坊logo.png）。
// 用法：node tools/make-icons.js [標誌檔]（需要電腦上有 Chrome 或 Edge）；也會產生官網用的 logo（第二個參數給官網的 img 資料夾就一起寫）。
//   大圖示（主畫面、開場、登入）：整個標誌（人像＋書槑子 SHUMEIZI），白底；favicon（32×32）只放人像頭部，字太小看不到。
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];
const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) { console.error('找不到 Chrome 或 Edge'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const LOGO = path.resolve(process.argv[2] || path.join(ROOT, '書槑子青年坊logo.png'));
const SITE_IMG = process.argv[3] ? path.resolve(process.argv[3]) : '';
if (!fs.existsSync(LOGO)) { console.error('找不到標誌：' + LOGO); process.exit(1); }
const logoUrl = 'data:image/png;base64,' + fs.readFileSync(LOGO).toString('base64');
const W = 1890; // 標誌原檔寬（1890×1417）
// 裁切範圍（原檔的像素）：full＝人像＋字，head＝只有人像
const CROPS = { full: { x: 345, y: 140, s: 1180 }, head: { x: 585, y: 140, s: 700 } };

// size：輸出邊長；crop：裁哪裡；pad：內容佔的比例（maskable 要留安全區）；round：圓角
function html({ size, crop, pad, round, bg }) {
  const c = CROPS[crop];
  const inner = size * pad;
  const k = inner / c.s;
  const off = (size - inner) / 2;
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style>
<div style="width:${size}px;height:${size}px;border-radius:${round ? size * 0.22 : 0}px;background:${bg};overflow:hidden;position:relative">
  <div style="position:absolute;left:${off}px;top:${off}px;width:${inner}px;height:${inner}px;background:url(${logoUrl}) no-repeat;background-size:${W * k}px auto;background-position:${-c.x * k}px ${-c.y * k}px"></div>
</div>`;
}

const jobs = [
  [path.join(ROOT, 'icons', 'icon-512.png'), { size: 512, crop: 'full', pad: 0.92, round: true, bg: '#ffffff' }],
  [path.join(ROOT, 'icons', 'icon-192.png'), { size: 192, crop: 'full', pad: 0.92, round: true, bg: '#ffffff' }],
  [path.join(ROOT, 'icons', 'icon-maskable-512.png'), { size: 512, crop: 'full', pad: 0.72, round: false, bg: '#ffffff' }],
  [path.join(ROOT, 'icons', 'apple-touch-icon.png'), { size: 180, crop: 'full', pad: 0.86, round: false, bg: '#ffffff' }],
  [path.join(ROOT, 'icons', 'favicon-32.png'), { size: 32, crop: 'head', pad: 1, round: false, bg: 'transparent' }],
  [path.join(ROOT, 'icons', 'logo-head.png'), { size: 96, crop: 'head', pad: 1, round: false, bg: 'transparent' }] // 頁首標題左邊的小標誌
];
if (SITE_IMG) {
  jobs.push([path.join(SITE_IMG, 'logo.png'), { size: 600, crop: 'full', pad: 1, round: false, bg: 'transparent' }]);
  jobs.push([path.join(SITE_IMG, 'logo-head.png'), { size: 64, crop: 'head', pad: 1, round: false, bg: 'transparent' }]);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
for (const [out, opt] of jobs) {
  const file = path.join(tmp, path.basename(out) + '.html');
  fs.writeFileSync(file, html(opt));
  const r = spawnSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${opt.size},${opt.size}`, `--screenshot=${out}`, 'file:///' + file.replace(/\\/g, '/')], { stdio: 'pipe' });
  if (r.status !== 0) { console.error(out, r.stderr.toString()); process.exit(1); }
  console.log('✓', out);
}
