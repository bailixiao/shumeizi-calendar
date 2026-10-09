// 常見問題的截圖：用電腦上的 Chrome（無畫面模式）打開本機示範版（tools/dev-server.js --mock --demo，書槑子的示範資料），
// 依下面的步驟操作後截圖，存到 img/help/*.png。截圖裡只有假名（測試甲、王小明⋯）。
// 執行：先開示範版（node tools/dev-server.js --mock --demo，port 5175），再 node tools/help-shots.js [只拍某幾張的名字⋯]
// 借場地、場地審核的截圖（venue-*、adm-venue）書槑子關掉了借場地，不重拍（留著舊圖）。
//       node tools/help-shots.js --sheet a.svg b.svg ⋯   把幾張圖排成一張存到暫存資料夾（檢查示意圖用）
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.SHOT_BASE || 'http://localhost:5175/';
const OUT = path.join(__dirname, '..', 'img', 'help');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => fs.existsSync(p));
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 示範資料的日期（和 tools/demo-data.js 同樣的算法）：下一個星期五（靈魂健身房）、下一個星期日（課館、植素園出攤＋志工）
const DEMO = require('./demo-data.js');
const TODAY = DEMO.taipeiToday();
const SUN = DEMO.nextWeekday(TODAY, 0);
const GYM = DEMO.nextWeekday(TODAY, 5);

async function launch() {
  if (!CHROME) throw new Error('找不到 Chrome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir, '--no-first-run', '--hide-scrollbars', '--lang=zh-TW', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, ws: page.webSocketDebuggerUrl };
    } catch (e) { /* 還沒好 */ }
    await sleep(200);
  }
  throw new Error('Chrome 沒有啟動');
}

function client(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let id = 0;
    const waiting = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && waiting.has(msg.id)) {
        const { ok, fail } = waiting.get(msg.id);
        waiting.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
      }
    };
    const send = (method, params = {}) => new Promise((ok, fail) => {
      id += 1;
      const my = id;
      const t = setTimeout(() => { waiting.delete(my); fail(new Error(method + ' 沒有回應')); }, 40000);
      waiting.set(my, { ok: (v) => { clearTimeout(t); ok(v); }, fail: (e) => { clearTimeout(t); fail(e); } });
      ws.send(JSON.stringify({ id: my, method, params }));
    });
    ws.onopen = () => resolve({ send, close: () => ws.close() });
  });
}

async function run(c, js) {
  const r = await Promise.race([
    c.send('Runtime.evaluate', { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true }),
    sleep(30000).then(() => { throw new Error('頁面裡的步驟超過 30 秒：' + js.slice(-120)); })
  ]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}

async function shot(c, file, clipJs) {
  let clip;
  if (clipJs) {
    const r = await run(c, clipJs);
    if (r) clip = { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.max(50, Math.round(r.width)), height: Math.max(50, Math.round(r.height)), scale: 1 };
  }
  const res = await c.send('Page.captureScreenshot', Object.assign({ format: 'png', captureBeyondViewport: !!clip }, clip ? { clip } : {}));
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
}

// ---------- 截圖步驟 ----------
// 每一張：{ name, hash, js（打開後在頁面裡做的事）, clip（回傳要截的範圍 {x,y,width,height}，沒有就截整個畫面） }
const PREP = `
  const api = location.origin + '/api';
  window.__p = (b) => fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(b) }).then((r) => r.json());
  window.__g = (q) => fetch(api + '?' + new URLSearchParams(q)).then((r) => r.json());
  window.__wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__box = (sel, pad = 8, extra = 0) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left - pad) + scrollX, y: Math.max(0, r.top - pad) + scrollY, width: Math.min(innerWidth, r.width + pad * 2), height: r.height + pad * 2 + extra }; };
`;

// 示範資料由 dev-server --demo 放好（tools/demo-data.js），這裡不用再加
const SEED = `window.__seeded = true;`;

const SHOTS = [
  { name: 'cal-day', hash: '#/', js: `document.querySelector('[data-view=month]').click(); await __wait(800);
`, tap: '.fc-daygrid-day[data-date="' + SUN + '"]',
    clip: `const a = document.querySelector('#fc').getBoundingClientRect(); const b = document.querySelector('#day-panel').getBoundingClientRect(); return { x: 0, y: a.top + scrollY - 8, width: innerWidth, height: Math.min(1500, b.bottom - a.top + 16) };` },
  { name: 'filter', hash: '#/', js: `document.querySelector('[data-view=recent]').click(); await __wait(600);`,
    clip: `return __box('#cat-filter', 10);` },
  { name: 'recent', hash: '#/', js: `document.querySelector('[data-view=recent]').click(); document.querySelector('[data-cat="全部"]')?.click(); await __wait(600);`,
    clip: `const a = document.querySelector('#cat-filter'); a.scrollIntoView(); const r = a.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: 900 };` },
  // 第一次來的朋友：名字下面問怎麼認識的、勾吃飯
  { name: 'signup-form', hash: null, js: `const d = (await __g({ action: 'getEvents', from: '${GYM}', to: '${GYM}' })).data.duties.find((x) => x.name.includes('靈魂健身房'));
      location.hash = '#/duty/' + encodeURIComponent(d.id) + '?date=${GYM}'; await __wait(2500);
      const inp = document.querySelector('[data-name-input]'); inp.value = '測試丁'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-add]').click(); await __wait(2500);
      const src = document.querySelector('input[data-source][value="朋友介紹"]'); if (src) { src.click(); await __wait(300); }
      const ref = document.querySelector('[data-referrer]'); if (ref) { ref.value = '測試甲'; ref.dispatchEvent(new Event('input', { bubbles: true })); ref.blur(); }
      const meal = document.querySelector('[data-meal]'); if (meal && !meal.checked) meal.click(); await __wait(300);`,
    clip: `const h = [...document.querySelectorAll('#view-duty h2')].find((x) => x.textContent.includes('我要報名')); h.scrollIntoView(); const r2 = h.getBoundingClientRect(); const end = document.querySelector('[data-submit]').getBoundingClientRect(); return { x: 0, y: r2.top + scrollY - 8, width: innerWidth, height: end.bottom - r2.top + 20 };` },
  { name: 'mine-list', hash: '#/mine', js: `localStorage.setItem('shumeizi:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);`,
    clip: `return { x: 0, y: 0, width: innerWidth, height: 1000 };` },
  { name: 'mine-multi', hash: '#/mine', js: `localStorage.setItem('shumeizi:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);
      const c = document.querySelectorAll('[data-pick]'); c[0].checked = true; c[1].checked = true; await __wait(100);`,
    clip: `const t = document.querySelector('.mine-title'); t.scrollIntoView(); const r = t.getBoundingClientRect(); const b = document.querySelector('[data-cancel-picked]').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: Math.min(1200, b.bottom - r.top + 16) };` },
  { name: 'resched', hash: '#/mine', js: `localStorage.setItem('shumeizi:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);
      const b = [...document.querySelectorAll('[data-reschedule]')].pop(); b.click(); await __wait(2000);`,
    clip: `return __box('.modal-box', 4);` },
  { name: 'push-panel', hash: '#/', js: `PushPage.openPanel(); await __wait(1200);`, clip: `return __box('.modal-box', 4);` },
  // 團購頁：選了兩樣商品（示範資料的團購）
  { name: 'shop-page', hash: '#/shop', js: `await __wait(2500); const p = document.querySelectorAll('[data-plus]'); p[0].click(); await __wait(200); document.querySelectorAll('[data-plus]')[0].click(); await __wait(200); document.querySelectorAll('[data-plus]')[1].click(); await __wait(300);`,
    clip: `const t = document.querySelector('#view-shop .page-title'); t.scrollIntoView(); const r = t.getBoundingClientRect(); const c = document.querySelectorAll('.shop-card'); const e = c[c.length - 1].getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: e.bottom - r.top + 20 };` },
  { name: 'venue-pick', hash: '#/venue', js: `await __wait(1500); const chip = [...document.querySelectorAll('#view-venue button, #view-venue label')].find((b) => /早上/.test(b.textContent)); if (chip) chip.click(); await __wait(300);`,
    clip: `const s = document.querySelector('#view-venue .venue-step, #view-venue section, #view-venue form'); return { x: 0, y: 0, width: innerWidth, height: 1100 };` },
  { name: 'venue-form', hash: '#/venue', js: `await __wait(1500); const f = document.querySelector('#view-venue form'); f.elements.name.value = '測試甲'; f.elements.phone.value = '0900-000000'; f.elements.purpose.value = '讀書會'; f.elements.people.value = '15'; f.elements.note.value = '要用投影機';`,
    clip: `const f = document.querySelector('#view-venue form'); const sec = f.closest('section') || f; return __box(f, 8);` },
  { name: 'venue-mine', hash: '#/venue', js: `await __wait(1500); const m = document.querySelector('[data-mine]'); m.elements.mname.value = '測試甲'; m.requestSubmit(); await __wait(1500);`,
    clip: `const m = document.querySelector('[data-mine]'); const sec = m.closest('section') || m.parentElement; return __box(sec, 8);` },
  { name: 'adm-recent', admin: true, hash: '#/admin', js: `await __wait(2000); const c = document.querySelectorAll('[data-invite-pick]'); c[0].checked = true; c[0].dispatchEvent(new Event('change')); c[1].checked = true; c[1].dispatchEvent(new Event('change')); await __wait(200);`,
    clip: `return { x: 0, y: 0, width: innerWidth, height: 1300 };` },
  { name: 'adm-roster', admin: true, hash: '#/admin/day', js: `await __wait(2000); document.querySelector('[data-all]').click(); await __wait(200);`,
    clip: `return { x: 0, y: 0, width: innerWidth, height: 1200 };` },
  { name: 'adm-push', admin: true, hash: '#/admin/push', js: `await __wait(2000); const sel = document.querySelector('select[name=duty]'); sel.selectedIndex = 1; sel.dispatchEvent(new Event('change')); await __wait(300); document.querySelector('[name=mode][value=later]').click(); await __wait(300); const q = document.querySelector('[data-quick]'); if (q) q.click(); await __wait(300);`,
    clip: `return __box('.push-form', 6);` },
  // 後台團購：總覽＋備貨清單
  { name: 'adm-shop', admin: true, hash: '#/admin/shop', js: `await __wait(2000); document.querySelector('.shop-group-card').click(); await __wait(2500);`,
    clip: `const a = document.querySelector('.shop-title'); a.scrollIntoView(); const r = a.getBoundingClientRect(); const b = document.querySelector('[data-copy-prep]').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: b.bottom - r.top + 16 };` },
  { name: 'adm-venue', admin: true, hash: '#/admin/venue', js: `await __wait(2000);`,
    clip: `const el = document.querySelector('.venue-reqs'); return __box(el.closest('[data-body]') || el, 4);` }
];

async function sheet(files) {
  const html = `<html><body style="margin:0;background:#bbb;display:flex;flex-wrap:wrap;gap:8px;padding:8px">${files.map((f) => `<div style="text-align:center;font:12px sans-serif"><img src="${BASE}img/help/${f}" style="height:520px;background:#fff"><br>${f}</div>`).join('')}</body></html>`;
  const tmp = path.join(os.tmpdir(), 'help-sheet.html');
  fs.writeFileSync(tmp, html);
  const { proc, ws } = await launch();
  const c = await client(ws);
  try {
    await c.send('Emulation.setDeviceMetricsOverride', { width: Math.min(2400, files.length * 300 + 40), height: 600, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: 'file:///' + tmp.replace(/\\/g, '/') });
    await sleep(1500);
    const out = path.join(os.tmpdir(), 'help-sheet.png');
    await shot(c, out);
    console.log(out);
  } finally { c.close(); proc.kill(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--sheet') return sheet(args.slice(1));
  const only = args;
  const { proc, ws } = await launch();
  const c = await client(ws);
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await c.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36' });
    await c.send('Page.navigate', { url: BASE });
    await sleep(4500); // 開場動畫
    await run(c, PREP + `localStorage.setItem('shumeizi:push-ask-later', String(Date.now())); localStorage.setItem('shumeizi:cat', '全部');`);
    await run(c, PREP + SEED);
    await c.send('Page.reload');
    await sleep(4500);
    let adminDone = false;
    for (const s of SHOTS) {
      if (only.length && only.indexOf(s.name) === -1) continue;
      if (/venue/.test(s.name) && !only.length) continue; // 書槑子沒有借場地
      if (s.admin && !adminDone) {
        await run(c, PREP + `location.hash = '#/admin'; await __wait(1500); const pw = document.querySelector('input[type=password]'); if (pw) { pw.value = 'test-pass'; pw.form.requestSubmit(); await __wait(2500); }`);
        adminDone = true;
      }
      await run(c, PREP + `for (let i = 0; i < 3; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
      await run(c, PREP + (s.hash ? `location.hash = '#/__'; await __wait(100); location.hash = ${JSON.stringify(s.hash)}; await __wait(1500); window.scrollTo(0, 0);` : '') + s.js);
      if (s.tap) {
        const p = await run(c, PREP + `const el = document.querySelector(${JSON.stringify(s.tap)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
        await sleep(900);
        await run(c, 'window.scrollTo(0, 0);');
      }
      await sleep(400);
      const file = path.join(OUT, s.name + '.png');
      await shot(c, file, PREP + s.clip);
      console.log('✓ ' + s.name);
    }
  } finally {
    c.close();
    proc.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
