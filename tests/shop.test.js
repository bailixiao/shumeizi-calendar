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
  const { orders, total, paid, unpaid, picked } = d.summary;
  assert.deepEqual({ orders, total, paid, unpaid, picked }, { orders: 2, total: 420, paid: 0, unpaid: 420, picked: 0 });
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

test('開團的檢查：名稱、截止時間、商品、限量格式（取貨場次可以不選）', () => {
  const { call, tofu, ids } = setup();
  const r = call('adminShopSaveGroup', { group: { name: '', deadline: '10/15', pickups: [], items: [{ id: tofu.id, limit: '0' }] } });
  const m = JSON.stringify(r.error);
  assert.match(m, /團購名稱/);
  assert.match(m, /截止時間/);
  assert.doesNotMatch(m, /取貨場次/); // 取貨場次可以不選（2026/10/10）
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

test('通知：開團自動排「明天截止」推播（截止前一天 20:00）；改截止時間會重排；結束、刪除就不送', () => {
  const { env, call, ok, gid, tofu, ids } = setup();
  env.fn('ensurePushKeys_')();
  const autos = () => env.fn('readTable_')(env.fn('SHEETS').PUSH_PLANS).filter((r) => r['建立帳號'] === '自動');
  assert.deepEqual(autos().map((r) => [r['預定時間'], r['網址'], r['狀態']]), [['2026-10-14 20:00', '#/shop/' + gid, '排定']]);
  const g = { id: gid, name: '十月植素園團購', deadline: '2026-10-16 22:00', pickups: ids, items: [{ id: tofu.id }] };
  assert.equal(ok(call('adminShopSaveGroup', { group: g })).remindAt, '2026-10-15 20:00');
  assert.deepEqual(autos().map((r) => r['預定時間']), ['2026-10-15 20:00'], '只留一則');
  // 到了時間送出
  env.clock.now = Date.UTC(2026, 9, 15, 12, 1); // 台北 10/15 20:01
  assert.equal(env.fn('runDuePushPlans_')().sent, 1);
  assert.equal(autos()[0]['狀態'], '已送出');
  // 再開一團、結束了才到時間：不送
  const g2 = ok(call('adminShopSaveGroup', { group: { name: '十一月團購', deadline: '2026-11-15 22:00', pickups: ids, items: [{ id: tofu.id }] } })).id;
  ok(call('adminShopSaveGroup', { group: { id: g2, name: '十一月團購', deadline: '2026-11-15 22:00', pickups: ids, items: [{ id: tofu.id }], status: '結束' } }));
  assert.equal(autos().filter((r) => r['網址'] === '#/shop/' + g2).length, 0, '結束的團購不排');
  const g3 = ok(call('adminShopSaveGroup', { group: { name: '十二月團購', deadline: '2026-12-15 22:00', pickups: ids, items: [{ id: tofu.id }] } })).id;
  ok(call('adminShopDeleteGroup', { id: g3 }));
  assert.equal(autos().filter((r) => r['網址'] === '#/shop/' + g3).length, 0, '刪除的團購一起刪');
});

test('通知：後台推播可以選團購（點了打開團購頁）；明天要取貨的人，每日提醒附上取貨內容', () => {
  const { env, call, ok, gid, tofu, ids, order } = setup();
  env.fn('ensurePushKeys_')();
  const r = ok(call('adminPushSave', { plan: { shopId: gid, title: '🛒 團購開跑了', body: '快來看看', now: true } }));
  const p = r.plans.find((x) => x.title === '🛒 團購開跑了');
  assert.equal(p.url, '#/shop/' + gid);
  assert.equal(p.shopId, gid);
  ok(order({ name: '測試甲', source: '官網', items: [{ id: tofu.id, qty: 2 }], pay: '轉帳' }));
  env.clock.now = Date.UTC(2026, 9, 17, 12, 0); // 台北 10/17 20:00，明天 10/18 取貨
  const A = 'https://fcm.googleapis.com/fcm/send/me-device-1';
  env.post({ action: 'pushSubscribe', endpoint: A });
  ok(env.post({ action: 'pushSetName', endpoint: A, name: '測試甲' }));
  assert.ok(env.fn('dailyPushEndpoints_')('tomorrow').includes(A));
  const s = ok(env.get({ action: 'pushSummary', id: env.fn('pushIdOf_')(A) }));
  assert.equal(s.pickups.length, 1);
  assert.deepEqual([s.pickups[0].group, s.pickups[0].total, s.pickups[0].location, s.pickups[0].items[0].qty], ['十月植素園團購', 120, '宏宗聖堂道學院', 2]);
  assert.ok(ids.length);
});

test('賣貨便團購：貼賣場連結就好，不用選商品、取貨場次；行事曆不收訂單；截止後不列出來', () => {
  const { env, call, ok } = setup();
  const bad = call('adminShopSaveGroup', { group: { mode: '賣貨便', name: '賣貨便團購', deadline: '2026-10-20 22:00', link: 'javascript:alert(1)' } });
  assert.equal(bad.error.code, 'VALIDATION');
  assert.match(JSON.stringify(bad.error), /賣場連結/);
  const id = ok(call('adminShopSaveGroup', { group: { mode: '賣貨便', name: '賣貨便團購', description: '7-11 取貨', deadline: '2026-10-20 22:00',
    link: 'https://myship.7-11.com.tw/general/detail/GM0000000000000', cover: 'F-test1', pickups: ['x'], items: [{ id: 'nope' }], payInfo: '不該存' } })).id;
  const g = ok(env.get({ action: 'getShop' })).groups.find((x) => x.id === id);
  assert.equal(g.link, 'https://myship.7-11.com.tw/general/detail/GM0000000000000');
  assert.equal(g.cover, 'F-test1');
  assert.deepEqual([g.pickups.length, g.items.length, g.hasPayInfo], [0, 0, false]);
  const r = env.post({ action: 'shopOrder', groupId: id, name: '測試甲', pickupId: 'x', pay: '現場', items: [] });
  assert.equal(r.ok, false);
  assert.match(JSON.stringify(r.error), /請到賣貨便下單/);
  assert.equal(ok(call('adminShop', {})).groups.find((x) => x.id === id).link, g.link);
  // 截止前一天的提醒照排
  assert.ok(env.sheets['推播排程'].data.some((row) => row.includes('#/shop/' + id)));
  // 截止後大家看不到
  env.clock.now = Date.UTC(2026, 9, 20, 15, 0, 0); // 台北 10/20 23:00
  assert.equal(ok(env.get({ action: 'getShop' })).groups.some((x) => x.id === id), false);
});

test('沒有取貨場次的團購：直接下單，備貨清單算全部，我的團購查得到', () => {
  const { env, call, ok, tofu } = setup();
  const id = ok(call('adminShopSaveGroup', { group: { name: '寄送團購', deadline: '2026-10-15 22:00', pickups: [], items: [{ id: tofu.id }] } })).id;
  const r = env.post({ action: 'shopOrder', groupId: id, name: '測試甲', source: '官網', pay: '轉帳', items: [{ id: tofu.id, qty: 2 }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const d = ok(call('adminShopGroup', { id }));
  assert.equal(d.prep.length, 1);
  assert.equal(d.prep[0].pickup, null);
  assert.deepEqual(d.prep[0].items.map((x) => [x.name, x.qty]), [['手工豆腐', 2]]);
  const mine = ok(env.post({ action: 'shopMyOrders', name: '測試甲' })).orders;
  assert.ok(mine.some((o) => o.groupId === id && o.pickupId === ''));
});

test('成本：只有後台看得到；團購頁算總成本、毛利，沒填成本的商品列出來', () => {
  const { env, call, ok, tofu, jam, gid, order } = setup();
  ok(call('adminShopSaveProduct', { product: Object.assign({}, tofu, { cost: '35' }) }));
  assert.equal(call('adminShopSaveProduct', { product: Object.assign({}, jam, { cost: 'abc' }) }).error.code, 'VALIDATION');
  assert.equal(ok(call('adminShop', {})).products.find((p) => p.id === tofu.id).cost, 35);
  assert.equal(order({ name: '測試甲', source: '官網', items: [{ id: tofu.id, qty: 2 }, { id: jam.id, qty: 1 }] }).ok, true);
  const pub = JSON.stringify(ok(env.get({ action: 'getShop' })));
  assert.ok(!pub.includes('"cost"'), '大家看不到成本');
  const s = ok(call('adminShopGroup', { id: gid })).summary;
  assert.equal(s.total, 60 * 2 + 120);
  assert.equal(s.cost, 70);
  assert.equal(s.profit, 240 - 70);
  assert.deepEqual(s.costMissing, ['果醬']);
});

test('規格、多張照片：商品有口味，每個口味可以有自己的價格；限量、每人上限照商品加總；備貨分口味算', () => {
  const { env, call, ok, ids } = setup();
  const bad = call('adminShopSaveProduct', { product: { name: '冰淇淋', price: 25, options: { label: '口味', options: [{ name: '荔枝' }, { name: '荔枝' }] } } });
  assert.match(JSON.stringify(bad.error), /重複/);
  const ice = ok(call('adminShopSaveProduct', { product: { name: '冰淇淋', price: 25, unit: '杯', photo: 'F-a1', photos: ['F-a2', 'F-a3'],
    options: { label: '口味', options: [{ name: '荔枝', price: '' }, { name: '芒果', price: '30' }] } } })).product;
  assert.deepEqual(ice.photos, ['F-a1', 'F-a2', 'F-a3']);
  assert.deepEqual(ice.options, { label: '口味', options: [{ name: '荔枝', price: null }, { name: '芒果', price: 30 }] });
  const gid = ok(call('adminShopSaveGroup', { group: { name: '冰品團', deadline: '2026-10-15 22:00', pickups: [ids[0]], items: [{ id: ice.id, limit: '5', perPerson: '3' }] } })).id;
  const g = ok(env.get({ action: 'getShop' })).groups.find((x) => x.id === gid);
  assert.equal(g.items[0].photos.length, 3);
  assert.equal(g.items[0].options.label, '口味');
  const post = (body) => env.post(Object.assign({ action: 'shopOrder', groupId: gid, pickupId: ids[0], pay: '現場', source: '官網' }, body));
  assert.match(JSON.stringify(post({ name: '測試甲', items: [{ id: ice.id, qty: 1 }] }).error), /請選口味/);
  assert.match(JSON.stringify(post({ name: '測試甲', items: [{ id: ice.id, option: '荔枝', qty: 2 }, { id: ice.id, option: '芒果', qty: 2 }] }).error), /每人最多 3/);
  const r = ok(post({ name: '測試甲', items: [{ id: ice.id, option: '荔枝', qty: 1 }, { id: ice.id, option: '芒果', qty: 2 }] }));
  assert.equal(r.order.total, 25 + 60);
  assert.deepEqual(r.order.items.map((x) => [x.name, x.qty, x.price]), [['冰淇淋（荔枝）', 1, 25], ['冰淇淋（芒果）', 2, 30]]);
  const prep = ok(call('adminShopGroup', { id: gid })).prep[0].items;
  assert.deepEqual(prep.map((x) => [x.name, x.qty]), [['冰淇淋（芒果）', 2], ['冰淇淋（荔枝）', 1]]);
  // 限量 5：已經賣 3，剩 2
  assert.match(JSON.stringify(post({ name: '測試乙', items: [{ id: ice.id, option: '芒果', qty: 3 }] }).error), /只剩 2/);
});

test('購物車結帳（mode＝add）：已經有訂單就加進原本那張；我的訂單（all）列出全部', () => {
  const { env, call, ok, tofu, jam, gid, order } = setup();
  ok(order({ name: '測試甲', source: '官網', items: [{ id: tofu.id, qty: 1 }] }));
  const r = ok(order({ name: '測試甲', mode: 'add', items: [{ id: tofu.id, qty: 2 }, { id: jam.id, qty: 1 }] }));
  assert.equal(r.merged, true);
  assert.deepEqual(r.order.items.map((x) => [x.name, x.qty]), [['手工豆腐', 3], ['果醬', 1]]);
  const mine = ok(env.post({ action: 'shopMyOrders', name: '測試甲', all: true })).orders;
  assert.equal(mine.length, 1);
  // 已取貨的也在 all 裡面，不在預設裡
  ok(call('adminShopOrderSet', { orderId: mine[0].id, picked: true }));
  assert.equal(ok(env.post({ action: 'shopMyOrders', name: '測試甲', all: true })).orders.length, 1);
  assert.equal(ok(env.post({ action: 'shopMyOrders', name: '測試甲' })).orders.length, 0);
});

test('庫存：進貨更新價格、出貨、目前庫存；編號自動給、不能重複；訂單取貨自動售出', () => {
  const { env, call, ok, tofu, jam, order } = setup();
  const st = () => ok(call('adminShopStock', {}));
  // 編號：前兩個商品自動 001、002
  assert.deepEqual(st().products.map((p) => p.code), ['001', '002']);
  assert.match(JSON.stringify(call('adminShopSaveProduct', { product: { name: '饅頭', price: 80, code: '001' } }).error), /編號「001」已經有/);
  assert.equal(ok(call('adminShopSaveProduct', { product: { name: '饅頭', price: 80 } })).product.code, '003');
  // 進貨：方式要選、數量要填
  assert.match(JSON.stringify(call('adminShopStockMove', { type: 'in', rows: [{ id: tofu.id, qty: '0', method: '偷來' }] }).error), /數量.*進貨方式/s);
  const r = ok(call('adminShopStockMove', { type: 'in', rows: [{ id: tofu.id, qty: 10, cost: 30, price: 65, method: '買進', note: '第一批' }, { id: jam.id, qty: 3, method: '了願' }] }));
  assert.equal(r.count, 2);
  let s = st();
  assert.equal(s.products.find((p) => p.id === tofu.id).stock, 10);
  assert.equal(s.products.find((p) => p.id === tofu.id).price, 65, '進貨的售價變成商品價格');
  assert.equal(s.products.find((p) => p.id === tofu.id).cost, 30);
  // 出貨超過庫存：照記，提醒
  const out = ok(call('adminShopStockMove', { type: 'out', rows: [{ id: jam.id, qty: 5, method: '損壞' }] }));
  assert.match(out.warnings.join(), /庫存會變成 -2/);
  // 訂單取貨 → 自動售出；取消打勾 → 還回去
  const o = ok(order({ name: '測試甲', source: '官網', items: [{ id: tofu.id, qty: 2 }] })).order;
  ok(call('adminShopOrderSet', { orderId: o.id, picked: true }));
  s = st();
  assert.equal(s.products.find((p) => p.id === tofu.id).stock, 8);
  const auto = s.records.find((x) => x.orderId === o.id);
  assert.equal(auto.method, '售出');
  assert.equal(call('adminShopStockDelete', { id: auto.id }).error.code, 'FORBIDDEN');
  ok(call('adminShopOrderSet', { orderId: o.id, picked: false }));
  assert.equal(st().products.find((p) => p.id === tofu.id).stock, 10);
  // 手動紀錄可以刪
  const manual = st().records.find((x) => x.method === '損壞');
  ok(call('adminShopStockDelete', { id: manual.id }));
  assert.equal(st().products.find((p) => p.id === jam.id).stock, 3);
  // 大家看不到庫存紀錄
  assert.equal(env.post({ action: 'adminShopStock' }).ok, false);
});

test('刪除商品：要先停用；還在開放中的團購裡不能刪；刪了以前的訂單不受影響', () => {
  const { env, call, ok, tofu, gid, order } = setup();
  const o = ok(order({ name: '測試甲', source: '官網', items: [{ id: tofu.id, qty: 1 }] })).order;
  assert.match(JSON.stringify(call('adminShopDeleteProduct', { id: tofu.id }).error), /先停用/);
  ok(call('adminShopSaveProduct', { product: Object.assign({}, tofu, { active: false }) }));
  assert.match(JSON.stringify(call('adminShopDeleteProduct', { id: tofu.id }).error), /還在賣/);
  const g = ok(call('adminShopGroup', { id: gid })).group;
  ok(call('adminShopSaveGroup', { group: { id: gid, name: g.name, deadline: g.deadline, pickups: g.pickupIds, items: g.itemSettings, payInfo: g.payInfo, status: '結束' } }));
  ok(call('adminShopDeleteProduct', { id: tofu.id }));
  assert.ok(!ok(call('adminShop', {})).products.some((p) => p.id === tofu.id));
  const mine = ok(env.post({ action: 'shopMyOrders', name: '測試甲', all: true })).orders.find((x) => x.id === o.id);
  assert.equal(mine.items[0].name, '手工豆腐', '以前的訂單照樣顯示');
});
