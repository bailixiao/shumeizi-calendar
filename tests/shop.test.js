// 團購（Shop.gs，規格 0.6）：商品庫、開團、下單與改單、限量與每人上限、截止、我的團購、後台的備貨清單與取貨名單、權限。
// 執行：在專案根目錄執行 node --test。名字一律用假名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0); // 台北 10/1 10:00

function setup() {
  const env = createEnv(OCT_1, { shumeizi: true });
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; };
  // 取貨場次：兩場植素園出攤
  const ids = ok(call('adminCreateDuties', { duties: [
    { name: '植素園出攤', category: '植素', nature: '出攤', start: '2026-10-18', startTime: '09:00', location: '宏宗聖堂道學院', positions: [{ name: '參加', min: '0' }] },
    { name: '植素園出攤', category: '植素', nature: '出攤', start: '2026-10-25', startTime: '09:00', location: '安東彌勒山', positions: [{ name: '參加', min: '0' }] }
  ] })).ids;
  const tofu = ok(call('adminShopSaveProduct', { product: { name: '手工豆腐', price: '60', unit: '盒', description: '當天現做' } })).product;
  const jam = ok(call('adminShopSaveProduct', { product: { name: '果醬', price: 150, unit: '罐' } })).product;
  const gid = ok(call('adminShopSaveGroup', { group: {
    name: '十月植素園團購', description: '歡迎大家', deadline: '2026-10-15 22:00', pickups: ids, payInfo: '轉帳：測試銀行 000-000000',
    items: [{ id: tofu.id, price: '', limit: '', perPerson: '' }, { id: jam.id, price: '120', limit: '5', perPerson: '2' }]
  } })).id;
  const order = (body) => env.post(Object.assign({ action: 'shopOrder', groupId: gid, pickupId: ids[0], pay: '現場' }, body));
  return { env, call, ok, ids, tofu, jam, gid, order };
}

test('開團後大家看得到：商品、價格（這次的價格）、剩幾份；看不到付款說明', () => {
  const { env, ok, tofu, jam } = setup();
  const shop = ok(env.get({ action: 'getShop' }));
  assert.equal(shop.groups.length, 1);
  const g = shop.groups[0];
  assert.equal(g.name, '十月植素園團購');
  assert.equal(g.closed, false);
  assert.equal(g.pickups.length, 2);
  assert.deepEqual(g.items.map((x) => [x.id, x.price, x.left]), [[tofu.id, 60, null], [jam.id, 120, 5]]);
  assert.equal(g.payInfo, undefined, '公開資料不帶付款說明');
  assert.equal(g.hasPayInfo, true);
});

test('下單：第一次來要選管道；算金額；轉帳顯示付款說明；同一個人再下單＝修改同一張', () => {
  const { env, ok, tofu, jam, order } = setup();
  assert.match(JSON.stringify(order({ name: '王小明', items: [{ id: tofu.id, qty: 2 }] }).error), /怎麼認識/);
  const a = ok(order({ name: '王小明', source: '官方 LINE', items: [{ id: tofu.id, qty: 2 }, { id: jam.id, qty: 1 }], pay: '轉帳' }));
  assert.equal(a.updated, false);
  assert.equal(a.order.total, 2 * 60 + 120);
  assert.equal(a.order.payInfo, '轉帳：測試銀行 000-000000');
  assert.equal(a.order.pickup.location, '宏宗聖堂道學院');
  // 再下一次＝改同一張（不用再選管道）
  const b = ok(order({ name: '王小明', items: [{ id: tofu.id, qty: 1 }], pay: '現場' }));
  assert.equal(b.updated, true);
  assert.equal(b.order.id, a.order.id);
  assert.equal(b.order.total, 60);
  assert.equal(b.order.payInfo, undefined, '現場付款不顯示轉帳資訊');
  assert.equal(env.sheets['團購訂單'].data.length, 2, '只有一張訂單');
  // 第一次下單的人記進成員（待確認、管道）
  const m = env.sheets['成員'].data.find((r) => r[0] === '王小明');
  assert.ok(m.includes('官方 LINE'));
});

test('規則：至少一樣、數量是整數、限量（所有訂單加總）、每人上限、取貨場次要是這次的、付款方式', () => {
  const { env, ok, tofu, jam, order } = setup();
  const msg = (r) => JSON.stringify(r.error);
  assert.match(msg(order({ name: '測試甲', source: '官網', items: [{ id: tofu.id, qty: 0 }] })), /至少選一樣/);
  assert.match(msg(order({ name: '測試甲', source: '官網', items: [{ id: tofu.id, qty: 1.5 }] })), /數量不對/);
  assert.match(msg(order({ name: '測試甲', source: '官網', items: [{ id: jam.id, qty: 3 }] })), /每人最多 2 罐/);
  assert.match(msg(order({ name: '測試甲', source: '官網', pickupId: 'D-x', items: [{ id: tofu.id, qty: 1 }] })), /取貨場次/);
  assert.match(msg(order({ name: '測試甲', source: '官網', pay: '刷卡', items: [{ id: tofu.id, qty: 1 }] })), /付款方式/);
  assert.match(msg(order({ name: '測試甲', source: '官網', pay: '轉帳', last5: '12a', items: [{ id: tofu.id, qty: 1 }] })), /末五碼/);
  ok(order({ name: '測試甲', source: '官網', items: [{ id: jam.id, qty: 2 }] }));
  ok(order({ name: '測試乙', source: '官網', items: [{ id: jam.id, qty: 2 }] }));
  assert.match(msg(order({ name: '測試丙', source: '官網', items: [{ id: jam.id, qty: 2 }] })), /只剩 1 罐/);
  ok(order({ name: '測試丙', source: '官網', items: [{ id: jam.id, qty: 1 }] }));
  assert.match(msg(order({ name: '測試丁', source: '官網', items: [{ id: jam.id, qty: 1 }] })), /賣完/);
  assert.equal(ok(env.get({ action: 'getShop' })).groups[0].items[1].left, 0);
  // 改自己的單：自己原本的份數不算在別人那邊
  ok(order({ name: '測試甲', items: [{ id: jam.id, qty: 2 }, { id: tofu.id, qty: 1 }] }));
});

test('我的團購、取消（份數還回去）、補末五碼；名字不對不能動別人的', () => {
  const { env, ok, jam, order } = setup();
  const o = ok(order({ name: '測試甲', source: '官網', items: [{ id: jam.id, qty: 2 }], pay: '轉帳' })).order;
  const mine = ok(env.post({ action: 'shopMyOrders', name: '測試甲' }));
  assert.equal(mine.orders.length, 1);
  assert.equal(mine.orders[0].groupName, '十月植素園團購');
  assert.equal(mine.orders[0].payInfo, '轉帳：測試銀行 000-000000');
  assert.equal(env.post({ action: 'shopSetLast5', orderId: o.id, name: '測試乙', last5: '12345' }).error.code, 'FORBIDDEN');
  assert.equal(ok(env.post({ action: 'shopSetLast5', orderId: o.id, name: '測試甲', last5: '12345' })).last5, '12345');
  assert.equal(env.post({ action: 'shopCancel', orderId: o.id, name: '測試乙' }).error.code, 'FORBIDDEN');
  const c = ok(env.post({ action: 'shopCancel', orderId: o.id, name: '測試甲' }));
  assert.equal(c.paidByTransfer, true, '轉帳過的取消要提醒退款');
  assert.equal(ok(env.get({ action: 'getShop' })).groups[0].items[1].left, 5);
  assert.equal(ok(env.post({ action: 'shopMyOrders', name: '測試甲' })).orders.length, 0);
});

test('截止後：大家不能下單、改單、取消；管理者可以幫人下單；補末五碼還可以', () => {
  const { env, call, ok, tofu, gid, ids, order } = setup();
  const o = ok(order({ name: '測試甲', source: '官網', items: [{ id: tofu.id, qty: 1 }], pay: '轉帳' })).order;
  env.clock.now = Date.UTC(2026, 9, 15, 14, 1); // 台北 10/15 22:01
  assert.equal(ok(env.get({ action: 'getShop' })).groups[0].closed, true);
  assert.match(JSON.stringify(order({ name: '測試乙', source: '官網', items: [{ id: tofu.id, qty: 1 }] }).error), /截止時間/);
  assert.match(JSON.stringify(order({ name: '測試甲', items: [{ id: tofu.id, qty: 3 }] }).error), /截止時間/);
  assert.equal(env.post({ action: 'shopCancel', orderId: o.id, name: '測試甲' }).error.code, 'FORBIDDEN');
  ok(env.post({ action: 'shopSetLast5', orderId: o.id, name: '測試甲', last5: '54321' }));
  const a = ok(call('adminShopOrder', { groupId: gid, name: '測試乙', source: '不確定', pickupId: ids[1], items: [{ id: tofu.id, qty: 4 }], pay: '現場', note: '電話訂的' }));
  assert.equal(a.order.total, 240);
});

test('後台：備貨清單（每場每項幾份）、總覽、取貨與付款打勾、恢復要看限量；有訂單不能刪團', () => {
  const { call, ok, tofu, jam, gid, ids, order } = setup();
  const a = ok(order({ name: '測試甲', source: '官網', items: [{ id: tofu.id, qty: 2 }, { id: jam.id, qty: 1 }] })).order;
  ok(order({ name: '測試乙', source: '官網', items: [{ id: tofu.id, qty: 3 }], pickupId: ids[1], pay: '轉帳' }));
  const d = ok(call('adminShopGroup', { id: gid }));
  assert.equal(d.group.payInfo, '轉帳：測試銀行 000-000000');
  assert.deepEqual(d.prep.map((p) => [p.pickup.date, p.orders, p.total, p.items.map((i) => i.name + i.qty).join()]),
    [['2026-10-18', 1, 240, '手工豆腐2,果醬1'], ['2026-10-25', 1, 180, '手工豆腐3']]);
  assert.deepEqual(d.summary, { orders: 2, total: 420, paid: 0, unpaid: 420, picked: 0 });
  ok(call('adminShopOrderSet', { orderId: a.id, picked: true, paid: true, note: '已取' }));
  const d2 = ok(call('adminShopGroup', { id: gid }));
  assert.deepEqual([d2.summary.paid, d2.summary.picked], [240, 1]);
  assert.equal(call('adminShopDeleteGroup', { id: gid }).error.code, 'FORBIDDEN');
  // 取消後再恢復：限量不夠就不能恢復
  ok(call('adminShopOrderSet', { orderId: a.id, cancel: true }));
  ok(order({ name: '測試丙', source: '官網', items: [{ id: jam.id, qty: 2 }] }));
  ok(order({ name: '測試丁', source: '官網', items: [{ id: jam.id, qty: 2 }] }));
  ok(order({ name: '測試戊', source: '官網', items: [{ id: jam.id, qty: 1 }] }));
  assert.match(JSON.stringify(call('adminShopOrderSet', { orderId: a.id, cancel: false }).error), /賣完/);
  // 管理者看得到所有團購與可以選的取貨場次
  const all = ok(call('adminShop', {}));
  assert.equal(all.groups[0].orders, 4);
  assert.ok(all.duties.some((x) => x.id === ids[0]));
  assert.equal(all.products.length, 2);
});

test('開團的檢查：名稱、截止時間、取貨場次、商品、限量格式', () => {
  const { call, tofu, ids } = setup();
  const r = call('adminShopSaveGroup', { group: { name: '', deadline: '10/15', pickups: [], items: [{ id: tofu.id, limit: '0' }] } });
  const m = JSON.stringify(r.error);
  assert.match(m, /團購名稱/);
  assert.match(m, /截止時間/);
  assert.match(m, /取貨場次/);
  assert.match(m, /限量/);
  assert.match(JSON.stringify(call('adminShopSaveGroup', { group: { name: 'x', deadline: '2026-10-15 22:00', pickups: ids, items: [] } }).error), /至少選一樣商品/);
  assert.match(JSON.stringify(call('adminShopSaveProduct', { product: { name: '', price: 'abc' } }).error), /商品名稱.*價格|價格.*商品名稱/s);
});

test('權限：植素帳號可以開團、管訂單；志工帳號不行；唯讀只能看', () => {
  const { env, call, ok, tofu, ids } = setup();
  const save = (account, role) => ok(call('adminSaveAccount', { account: { account, role, password: 'abc12345' } }));
  save('植素組', '植素');
  save('志工組', '勤務');
  save('查看用', '唯讀');
  const login = (a) => env.post({ action: 'adminLogin', account: a, password: 'abc12345' }).data.token;
  const as = (tok, action, body) => env.post(Object.assign({ action, token: tok }, body));
  const zs = login('植素組');
  const vol = login('志工組');
  const ro = login('查看用');
  const g = { name: '十一月團購', deadline: '2026-11-15 22:00', pickups: ids, items: [{ id: tofu.id }] };
  assert.equal(as(zs, 'adminShopSaveGroup', { group: g }).ok, true);
  assert.equal(as(vol, 'adminShopSaveGroup', { group: g }).error.code, 'FORBIDDEN');
  assert.equal(as(ro, 'adminShopSaveProduct', { product: { name: 'x', price: 1 } }).error.code, 'FORBIDDEN');
  assert.equal(as(ro, 'adminShop', {}).ok, true);
});
