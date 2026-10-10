// 圖解教學的圖（img/tutorial/*.jpg）：用電腦上的 Chrome（無畫面模式）打開本機示範版（tools/dev-server.js --mock --demo），
// 一步一步操作，每一步在畫面上方加「步驟數字＋標題＋說明」、用紅框圈出要按的地方，截成 540×1170 的 JPEG。
// 把網站放到桌面、手機問允許、收到通知這幾步是示意圖（img/help/home-*.svg 或畫在頁面上的手機畫面）。
// 步驟與標題在 js/tutorial.js（STEPS、DIFF、CHAPTERS），這裡的編號要和它一致。名字一律是假名。
// 執行：先開示範版（node tools/dev-server.js --mock --demo，port 5175），再 node tools/tutorial-shots.js
// 每次拍之前要重開示範版（第 17 步會真的送出報名，資料留在示範版裡，第二次就會「同一天已報名」）。
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../js/tutorial.js');
const DEMO = require('./demo-data.js');

const BASE = process.env.SHOT_BASE || 'http://localhost:5175/';
const OUT = path.join(__dirname, '..', 'img', 'tutorial');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => fs.existsSync(p));
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TODAY = DEMO.taipeiToday();
const SUN = DEMO.nextWeekday(TODAY, 0);
const GYM = DEMO.nextWeekday(TODAY, 5);
const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36'
};

async function launch() {
  if (!CHROME) throw new Error('找不到 Chrome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-'));
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
  const r = await c.send('Runtime.evaluate', { expression: `(async () => { ${HELPERS} ${js} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}

// 頁面裡用的小工具：等待、打字、按按鈕、加上標題列與紅框
const HELPERS = `
  const W = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const btn = (text, root) => [...(root || document).querySelectorAll('button, a, label')].find((b) => b.textContent.trim().indexOf(text) !== -1);
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const addName = async (name, src, ref) => {
    type($('[data-name-input]'), name); await W(300); $('[data-add]').click(); await W(2200);
    if (src) { const r = [...document.querySelectorAll('input[data-source][value="' + src + '"]')].pop(); if (r) { r.click(); await W(300); } } // 最後一張名字卡
    if (ref) { const i = [...document.querySelectorAll('[data-referrer]')].pop(); if (i) { type(i, ref); i.blur(); } }
  };
  window.__frame = (o) => {
    document.querySelectorAll('.tut-x').forEach((x) => x.remove());
    const head = document.createElement('div');
    head.className = 'tut-x';
    head.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#1f5664;color:#fff;padding:14px 16px 16px;font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25)';
    head.innerHTML = '<div style="display:flex;align-items:flex-start;gap:10px"><span style="flex:none;width:34px;height:34px;border-radius:50%;background:#fff;color:#1f5664;font-weight:900;font-size:19px;display:flex;align-items:center;justify-content:center">' + o.n + '</span><span style="font-weight:900;font-size:23px;line-height:1.35">' + o.title + '</span></div>' +
      (o.sub ? '<div style="margin-top:8px;font-size:16px;line-height:1.55;opacity:.95">' + o.sub + '</div>' : '') +
      '<svg width="100%" height="10" style="position:absolute;left:0;bottom:-9px" preserveAspectRatio="none" viewBox="0 0 40 10"><path d="M0 0 H40 V4 Q30 10 20 4 T0 4 Z" fill="#1f5664"/></svg>';
    document.body.appendChild(head);
    const hh = head.getBoundingClientRect().height;
    if (!o.target) return;
    const el = typeof o.target === 'string' ? document.querySelector(o.target) : o.target;
    if (!el) throw new Error('找不到 ' + o.target);
    const r0 = el.getBoundingClientRect();
    const room = innerHeight - hh;
    window.scrollBy(0, r0.top - hh - Math.max(24, (room - r0.height) / 2));
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'tut-x';
    const p = o.pad === undefined ? 6 : o.pad;
    box.style.cssText = 'position:fixed;z-index:2147482999;border:4px solid #e0262b;border-radius:16px;box-shadow:0 0 0 3px rgba(255,255,255,.8);pointer-events:none;left:' + (r.left - p) + 'px;top:' + (r.top - p) + 'px;width:' + (r.width + p * 2) + 'px;height:' + (r.height + p * 2) + 'px';
    document.body.appendChild(box);
  };
  // 示意圖：整頁換成 img/help 的手機畫面
  window.__art = (src) => {
    document.body.innerHTML = '<div style="position:fixed;inset:0;background:#e9eef0;display:flex;justify-content:center;padding-top:150px"><img src="' + src + '" style="width:340px;height:auto"></div>';
    return new Promise((r) => { const im = document.querySelector('img'); im.onload = () => r(); setTimeout(r, 1500); });
  };
`;

async function go(c, hash) {
  await c.send('Page.navigate', { url: 'about:blank' }); // 只換 # 後面不會重新載入，先到空白頁
  await sleep(200);
  await c.send('Page.navigate', { url: BASE + (hash || '#/') });
  await sleep(2500);
  await run(c, `localStorage.setItem('shumeizi:push-ask-later', String(Date.now())); localStorage.setItem('shumeizi:cat', '全部'); localStorage.removeItem('shumeizi:mine-name');`);
}

async function shoot(c, n, dev) {
  const file = path.join(OUT, (T.DIFF.indexOf(n) !== -1 ? dev + '-' : '') + n + '.jpg');
  const res = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('✓ ' + path.basename(file));
}

const cap = (n, dev) => { const s = T.STEPS[n]; return Array.isArray(s) ? s[dev === 'ios' ? 0 : 1] : s; };
const SUB = {
  '01': 'LINE 裡面加不到主畫面、也收不到提醒，要先改用手機的瀏覽器',
  '02': '有的手機寫「以 Safari 開啟」或「以其他應用程式開啟」',
  '03': ['方框加一個向上箭頭的按鈕', '三星手機：按右下「≡」→「新增頁面至」→「主畫面」，不要按「安裝」'],
  '04': ['沒看到的話，滑到最下面點「編輯動作⋯」打開它', '有的手機寫「安裝應用程式」，哪一個都可以'],
  '05': ['名字已經幫你填好了', '有的手機會再問一次，按「新增」'],
  '06': '以後都從這個圖示打開，就像一般的 App 一樣 📲',
  '07': '今天起一個月的活動，一天一天列出來',
  '08': '志工排班還缺人的會列在這裡，點進去就能報名',
  '09': '點日期，下面會列出那天的活動，點你想去的',
  '10': '志工排班有好幾個項目，先選一個（灰色的是額滿）',
  '11': '打一兩個字，跳出名字就點它；沒有就打完整名字按「加入」',
  '12': '只有第一次要選；朋友介紹的話，填一下介紹人',
  '13': '靈魂健身房、槑青韜課館、植素園工作坊不用選項目',
  '14': '有一起吃飯的活動才會出現；有選項的話每組選一個，有特別需求寫在備註',
  '15': '想揪朋友？名字一個一個加進來就好',
  '16': '名字都加好了，按這裡送出',
  '17': '可以按「加到手機行事曆」，前一天會提醒你',
  '18': '在行事曆最上面',
  '19': '打你的名字，點跳出來的名字就會查',
  '20': '「改吃飯」可以改吃不吃、選的餐點、備註；活動當天（含）之後就不能自己改，請跟小編說',
  '21': '看一下資料對不對，按「確定取消」才會取消',
  '22': '有活動時，前一天晚上 8 點、當天早上 7 點提醒你',
  '23': '開好後，下面可以填「我是誰」，只提醒你報名的',
  '24': '一定要按「允許」才收得到喔',
  '25': '點一下就打開活動 😊',
  '26': '在行事曆最上面；沒有開放中的團購時不會出現',
  '27': '照片下面有價格、已經賣了幾份；有寫「剩 N」的是限量',
  '28': '照片可以左右滑；有口味、大小的要先選一個',
  '29': '下面「🛒 購物車」的數字是放了幾件；轉帳的送出後會看到帳號',
  '30': '在下面「📋 我的訂單」可以改數量、取消、補轉帳末五碼'
};
const sub = (n, dev) => { const s = SUB[n]; return Array.isArray(s) ? s[dev === 'ios' ? 0 : 1] : (s || ''); };
// target：CSS 選擇器字串，或「$(」開頭的一段程式（直接放進頁面裡算）
const frame = (n, dev, target) => `window.__frame({ n: ${Number(n)}, title: ${JSON.stringify(cap(n, dev))}, sub: ${JSON.stringify(sub(n, dev))}, target: ${target && target.indexOf('$(') === 0 ? target : JSON.stringify(target || null)} });`;

// 手機問允許、收到通知（畫在頁面上的示意畫面）
const PERMISSION = {
  ios: `<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147482990;display:flex;align-items:center;justify-content:center"><div id="tut-dlg" style="width:270px;background:rgba(242,242,247,.97);border-radius:14px;text-align:center;font-family:-apple-system,'PingFang TC','Noto Sans TC',sans-serif;overflow:hidden"><div style="padding:18px 16px 14px"><b style="font-size:17px">「書槑子行事曆」想要傳送通知</b><p style="margin:6px 0 0;font-size:13px;color:#333">通知可能包括提示、聲音和圖像標記。</p></div><div style="display:flex;border-top:1px solid #c6c6c8"><span style="flex:1;padding:11px;color:#0a7aff;font-size:17px;border-right:1px solid #c6c6c8">不允許</span><span id="tut-allow" style="flex:1;padding:11px;color:#0a7aff;font-size:17px;font-weight:600">允許</span></div></div></div>`,
  android: `<div style="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147482990"><div id="tut-dlg" style="position:absolute;left:12px;right:12px;bottom:24px;background:#fff;border-radius:24px;padding:22px 20px 14px;font-family:Roboto,'Noto Sans TC',sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)"><b style="font-size:18px">要允許「bailixiao.github.io」傳送通知嗎？</b><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:22px"><span style="padding:10px 16px;color:#0b57d0;font-weight:600">封鎖</span><span id="tut-allow" style="padding:10px 18px;color:#fff;background:#0b57d0;border-radius:20px;font-weight:600">允許</span></div></div></div>`
};
const NOTICE = (dev) => `<div style="position:fixed;inset:0;background:linear-gradient(#5b7c8a,#2f4b57);z-index:2147482990;font-family:-apple-system,Roboto,'Noto Sans TC',sans-serif"><div style="text-align:center;color:#fff;margin-top:${dev === 'ios' ? 190 : 170}px;font-size:${dev === 'ios' ? 64 : 52}px;font-weight:300">19:00</div><div id="tut-note" style="margin:30px 12px 0;background:rgba(255,255,255,.92);border-radius:${dev === 'ios' ? 20 : 26}px;padding:14px 16px;display:flex;gap:12px"><img src="icons/icon-192.png" style="width:38px;height:38px;border-radius:9px"><div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;font-size:13px;color:#666"><span>書槑子行事曆</span><span>現在</span></div><b style="display:block;font-size:15px;margin-top:2px">🌱 明天的活動提醒</b><div style="font-size:14px;color:#222;line-height:1.45">🧡 19:30 槑子的靈魂健身房（竹北）　已報 3 人<br>到時候見 😊</div></div></div></div>`;

async function main() {
  const { proc, ws } = await launch();
  const c = await client(ws);
  fs.mkdirSync(OUT, { recursive: true });
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1.5, mobile: true });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

    // ---------- 把網站放到桌面（示意圖）＋手機問允許、收到通知：iPhone、Android 各一次 ----------
    const ART = { ios: { '03': 'home-ios-1', '04': 'home-ios-2', '05': 'home-ios-3' }, android: { '03': 'home-android-1', '04': 'home-android-2', '05': 'home-android-3' } };
    for (const dev of ['ios', 'android']) {
      await c.send('Emulation.setUserAgentOverride', { userAgent: UA[dev] });
      for (const [n, art] of [['01', 'home-line-1'], ['02', 'home-line-2'], ['03'], ['04'], ['05'], ['06', 'home-ios-4']]) {
        if (dev === 'android' && T.DIFF.indexOf(n) === -1) continue; // 兩種手機一樣的只拍一次
        await go(c);
        await run(c, `await window.__art('img/help/${art || ART[dev][n]}.svg'); ${frame(n, dev)}`);
        await sleep(300);
        await shoot(c, n, dev);
      }
      await go(c);
      await run(c, `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(PERMISSION[dev])}); ${frame('24', dev, '#tut-allow')}`);
      await shoot(c, '24', dev);
      await go(c);
      await run(c, `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(NOTICE(dev))}); ${frame('25', dev, '#tut-note')}`);
      await shoot(c, '25', dev);
    }
    await c.send('Emulation.setUserAgentOverride', { userAgent: UA.android });

    // ---------- 報名活動 ----------
    await go(c);
    await run(c, `$('[data-view=recent]').click(); await W(800); ${frame('07', '', '[data-view=recent]')}`);
    await shoot(c, '07');
    await run(c, `${frame('08', '', '.recent-alert')}`);
    await shoot(c, '08');
    await run(c, `$('[data-view=month]').click(); await W(800); window.scrollTo(0, 0);`);
    const p = await run(c, `const el = document.querySelector('.fc-daygrid-day[data-date="${SUN}"]'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
    for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type: t, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(900);
    await run(c, `${frame('09', '', '#day-panel')}`);
    await shoot(c, '09');

    const ids = await run(c, `const g = async (d) => (await (await fetch('/api?action=getEvents&from=' + d + '&to=' + d)).json()).data.duties;
      const a = await g('${SUN}'); const b = await g('${GYM}');
      return { vol: a.find((x) => x.name === '植素園出攤志工').id, gym: b.find((x) => x.name.includes('靈魂健身房')).id };`);
    await go(c, '#/duty/' + encodeURIComponent(ids.vol) + '?date=' + SUN + '&go=signup');
    await sleep(800);
    await run(c, `const r = document.querySelector('[data-positions] input'); r.click(); await W(300); ${frame('10', '', '[data-positions]')}`);
    await shoot(c, '10');
    await run(c, `type($('[data-name-input]'), '測試'); await W(2500); ${frame('11', '', "$('[data-name-input]').closest('fieldset')")}`);
    await shoot(c, '11');
    await run(c, `type($('[data-name-input]'), ''); await W(200); await addName('測試戊', '朋友介紹', '測試甲'); ${frame('12', '', '.name-item')}`);
    await shoot(c, '12');

    await go(c, '#/duty/' + encodeURIComponent(ids.gym) + '?date=' + GYM + '&go=signup');
    await sleep(800);
    await run(c, `${frame('13', '', '.signup-form')}`);
    await shoot(c, '13');
    await run(c, `await addName('測試戊', '官方 LINE'); const m = $('[data-meal]'); if (!m.checked) m.click(); await W(300); const pk = (g, o) => { const r = document.querySelector('input[data-meal-group="' + g + '"][value="' + o + '"]'); if (r) r.click(); }; pk('主餐', '素便當'); await W(200); pk('飲料', '紅茶'); await W(300); ${frame('14', '', '.meal-row')}`);
    await shoot(c, '14');
    await run(c, `await addName('測試己', '朋友介紹', '測試戊'); ${frame('15', '', '[data-names]')}`);
    await shoot(c, '15');
    await run(c, `${frame('16', '', '[data-submit]')}`);
    await shoot(c, '16');
    await run(c, `document.querySelectorAll('.tut-x').forEach((x) => x.remove()); $('[data-submit]').click(); for (let i = 0; i < 30 && !$('.notice-success'); i++) await W(500); if (!$('.notice-success')) throw new Error('報名沒有成功：' + (($('[data-error]') || {}).textContent || '')); await W(500); ${frame('17', '', '.notice-success')}`);
    await shoot(c, '17');

    // ---------- 查我的報名、取消、改期 ----------
    await go(c);
    await run(c, `${frame('18', '', '.mine-link')}`);
    await shoot(c, '18');
    await go(c, '#/mine');
    await run(c, `type($('#mine-name'), '測試甲'); await W(2500); ${frame('19', '', "$('#mine-name').closest('form').parentElement")}`);
    await shoot(c, '19');
    await run(c, `$('#mine-name').closest('form').requestSubmit(); await W(3000); ${frame('20', '', '.mine-actions')}`);
    await shoot(c, '20');
    await run(c, `document.querySelectorAll('.tut-x').forEach((x) => x.remove()); document.querySelector('[data-cancel]').click(); await W(1200); ${frame('21', '', '.modal-box')}`);
    await shoot(c, '21');

    // ---------- 開啟手機提醒 ----------
    await go(c);
    await run(c, `${frame('22', '', '#push-open')}`);
    await shoot(c, '22');
    await run(c, `document.querySelectorAll('.tut-x').forEach((x) => x.remove()); PushPage.openPanel(); await W(1500); ${frame('23', '', '[data-on]')}`);
    await shoot(c, '23');

    // ---------- 團購 ----------
    await go(c);
    await sleep(1500);
    await run(c, `${frame('26', '', '#shop-link')}`);
    await shoot(c, '26');
    await go(c, '#/shop');
    await sleep(1500);
    await run(c, `${frame('27', '', '.shop-grid')}`);
    await shoot(c, '27');
    // 商品頁：手工果醬（有口味），選桑葚、加入購物車
    await run(c, `document.querySelectorAll('.tut-x').forEach((x) => x.remove()); document.querySelectorAll('.shop-tile')[1].click(); await W(1500);
      document.querySelector('input[data-opt][value="桑葚"]').click(); await W(400); ${frame('28', '', '.shop-opt')}`);
    await shoot(c, '28');
    await run(c, `document.querySelectorAll('.tut-x').forEach((x) => x.remove()); $('[data-add]').click(); await W(500);
      document.querySelector('.shop-tab[href$="/cart"]').click(); await W(1500);
      const pk = document.querySelector('input[name=pickup]'); if (pk) { pk.click(); await W(400); }
      const n = $('[data-name]'); type(n, '測試庚'); n.dispatchEvent(new Event('change', { bubbles: true })); await W(2500);
      const s = document.querySelector('input[data-src][value="官方 LINE"]'); if (s) { s.click(); await W(300); }
      ${frame('29', '', '.shop-total-bar')}`);
    await shoot(c, '29');
    await run(c, `document.querySelectorAll('.tut-x').forEach((x) => x.remove()); $('form.shop-order-form').requestSubmit(); for (let i = 0; i < 30 && !$('.notice-success'); i++) await W(500); if (!$('.notice-success')) throw new Error('團購沒有送出：' + (($('[data-error]') || {}).textContent || '')); ${frame('30', '', '.notice-success')}`);
    await shoot(c, '30');
  } finally {
    c.close();
    proc.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
