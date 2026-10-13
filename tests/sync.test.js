// Google 端的同步（Sync.gs）：每 10 分鐘的 syncFromWorker、記帳即時更新 ledgerPush_，真的跑一次（Cloudflare 用假的回應）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function setup() {
  const env = createEnv(OCT_1, { shumeizi: true });
  const props = env.fn('PropertiesService').getScriptProperties();
  props.setProperty('SYNC_KEY', 'k'.repeat(40));
  const asked = [];
  const ledger = [['紀錄ID', '日期', '類型', '類別', '金額', '備註'], ['L-1', '2026-10-01', '支出', '攤位費', '300', '出攤']];
  env.setFetch((url, opts) => {
    const body = JSON.parse(opts.payload);
    asked.push(body.action);
    if (body.password !== 'k'.repeat(40)) return { code: 200, body: { ok: false, error: { code: 'UNAUTHORIZED', message: '密碼不正確' } } };
    if (body.action === 'syncExport') return { code: 200, body: { ok: true, data: { sheets: { 收支記帳: ledger, 團購優惠: [] }, at: '' } } };
    if (body.action === 'ledgerExport') return { code: 200, body: { ok: true, data: { sheets: { 收支記帳: ledger }, at: '' } } };
    return { code: 200, body: { ok: true, data: {} } };
  });
  return { env, props, asked };
}

test('syncFromWorker：Cloudflare 的分頁整頁寫回試算表（沒有的分頁會建立）', () => {
  const { env, asked } = setup();
  env.fn('syncFromWorker')();
  assert.ok(asked.includes('syncExport'));
  assert.deepEqual(env.sheets['收支記帳'].data[1].slice(0, 4), ['L-1', '2026-10-01', '支出', '攤位費']);
  assert.ok(env.sheets['團購優惠'], '沒有的分頁會建立');
});

test('ledgerPush_：同步密鑰要對；只拿收支記帳、庫存、商品寫回', () => {
  const { env, asked } = setup();
  assert.throws(() => env.fn('ledgerPush_')({ key: 'wrong' }), (e) => e.code === 'UNAUTHORIZED');
  env.fn('ledgerPush_')({ key: 'k'.repeat(40) });
  assert.deepEqual(asked, ['ledgerExport']);
  assert.equal(env.sheets['收支記帳'].data[1][0], 'L-1');
});
