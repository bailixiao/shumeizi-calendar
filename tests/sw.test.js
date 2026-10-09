// sw.js 收到推播後顯示的通知：標題、內容（最多 4 項＋缺人提醒）、點了打開哪裡；問不到伺服器時顯示通用通知。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

function loadSw(summary) {
  const listeners = {};
  const shown = [];
  const self = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting() {},
    location: { origin: 'https://example.test' },
    registration: {
      scope: 'https://example.test/duty-calendar/',
      pushManager: { getSubscription: async () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }) },
      showNotification: async (title, opts) => { shown.push({ title, ...opts }); }
    },
    clients: { claim() {}, matchAll: async () => [] }
  };
  const fetchLog = [];
  const ctx = {
    self, caches: {}, crypto: webcrypto, TextEncoder, URL, console,
    importScripts: () => { self.SITE = { name: '教全區行事曆' }; self.APP_CONFIG = { API_URL: 'https://api.test/exec' }; },
    fetch: async (url) => { fetchLog.push(url); if (summary instanceof Error) throw summary; return { json: async () => summary }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), ctx);
  const push = async () => {
    let p;
    listeners.push({ waitUntil: (x) => { p = x; } });
    await p;
    return shown[0];
  };
  return { push, fetchLog };
}

test('明天有 5 項活動：顯示前 4 項、還有幾項、缺人提醒，點了打開「近期」', async () => {
  const items = [
    { id: 'D1', name: '初一十五打掃（宏宗）', time: '08:00', label: '缺 2 人', short: true },
    { id: 'D2', name: '彌勒山志工輪值', time: '', label: '人數足・3 人' },
    { id: 'D3', name: '烹飪團輪值', time: '09:00', label: '' },
    { id: 'D4', name: '敬老活動', nature: '活動', time: '10:00', label: '' },
    { id: 'D5', name: '拜香輪值', time: '', label: '輪值：第五組' }
  ];
  const { push, fetchLog } = loadSw({ ok: true, data: { when: 'tomorrow', date: '2026-10-10', items } });
  const n = await push();
  assert.equal(n.title, '🌱 明天的活動提醒（10/10 六）');
  const lines = n.body.split('\n');
  assert.equal(lines[0], '🧹 08:00 初一十五打掃（宏宗）　缺 2 人');
  assert.equal(lines[1], '🙌 彌勒山志工輪值　人數足・3 人');
  assert.equal(lines[4], '⋯還有 1 項');
  assert.equal(lines[5], '🙋 有志工排班還需要人手，歡迎一起來幫忙');
  assert.equal(lines[6], '到時候見 😊');
  assert.equal(n.data.url, '#/recent');
  assert.match(fetchLog[0], /^https:\/\/api\.test\/exec\?action=pushSummary&id=[0-9a-f]{16}$/);
});

test('只有一項：點了直接打開那個勤務；測試通知；問不到伺服器時用通用通知', async () => {
  let n = await loadSw({ ok: true, data: { when: 'today', date: '2026-10-24', items: [{ id: 'D9', name: '宏宗大掃除', time: '09:00', label: '' }] } }).push();
  assert.equal(n.title, '🌱 今天的活動提醒（10/24 六）');
  assert.equal(n.data.url, '#/duty/D9?date=2026-10-24');

  n = await loadSw({ ok: true, data: { when: 'today', date: '2026-10-24', items: [], test: true } }).push();
  assert.equal(n.title, '🔔 測試通知');

  n = await loadSw(new Error('offline')).push();
  assert.match(n.title, /^🌱 .*行事曆提醒$/);
  assert.equal(n.data.url, '#/recent');
});

test('團購取貨提醒：填了我是誰、明天要取貨 → 標題「記得取團購」，列品項、金額、付款、地點，點開到查我的報名', async () => {
  const pickups = [{ group: '十月團購', items: [{ name: '手工豆腐', qty: 2 }, { name: '果醬', qty: 1 }], total: 270, pay: '轉帳', paid: false, last5: '', location: '宏宗聖堂道學院', time: '09:00' }];
  const n = await loadSw({ ok: true, data: { when: 'tomorrow', date: '2026-10-18', items: [{ id: 'D1', name: '植素園出攤', time: '09:00', label: '' }], mine: [], shortItems: [], pickups } }).push();
  assert.equal(n.title, '🛒 明天記得取團購（10/18 日）');
  const lines = n.body.split('\n');
  assert.equal(lines[0], '📦 09:00 宏宗聖堂道學院');
  assert.equal(lines[1], '　手工豆腐×2、果醬×1｜270 元（轉帳，記得填末五碼）');
  assert.equal(n.data.url, '#/mine');
});
