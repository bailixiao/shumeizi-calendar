// 產生暫時的 App 圖示（沒有正式標誌前用）：米色底、深藍綠「槑」字、下方橄欖綠波浪線（呼應官網）。
// 用法：node tools/make-icons.js（需要電腦上有 Chrome 或 Edge）。有正式標誌後直接換掉 icons/ 裡的檔案即可。
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

// pad：內容縮小的比例（maskable 圖示要留安全區）；round：要不要圓角（maskable 由系統裁切，不要圓角）
function svg({ round, pad }) {
  const s = 512 * pad, o = (512 - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${round ? 112 : 0}" fill="#fbf8f0"/>
  <g transform="translate(${o},${o}) scale(${pad})">
    <circle cx="256" cy="232" r="190" fill="#ffffff"/>
    <text x="256" y="318" text-anchor="middle" font-family="Microsoft JhengHei, PingFang TC, Noto Sans TC, sans-serif" font-weight="900" font-size="250" fill="#1f5664">槑</text>
    <path d="M96 440 Q136 412 176 440 T256 440 T336 440 T416 440" fill="none" stroke="#a8b741" stroke-width="22" stroke-linecap="round"/>
    <circle cx="112" cy="262" r="16" fill="#e2814e"/>
    <circle cx="400" cy="262" r="16" fill="#e2814e"/>
  </g>
</svg>`;
}

const OUT = path.join(__dirname, '..', 'icons');
const jobs = [
  ['icon-512.png', 512, { round: true, pad: 1 }],
  ['icon-192.png', 192, { round: true, pad: 1 }],
  ['icon-maskable-512.png', 512, { round: false, pad: 0.78 }],
  ['apple-touch-icon.png', 180, { round: false, pad: 0.9 }],
  ['favicon-32.png', 32, { round: true, pad: 1 }]
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
for (const [name, size, opt] of jobs) {
  const html = path.join(tmp, name + '.html');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(opt)}`);
  const r = spawnSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${size},${size}`, `--screenshot=${path.join(OUT, name)}`, 'file:///' + html.replace(/\\/g, '/')], { stdio: 'pipe' });
  if (r.status !== 0) { console.error(name, r.stderr.toString()); process.exit(1); }
  console.log('✓', name);
}
