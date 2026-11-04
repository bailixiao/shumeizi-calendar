// 優惠碼（Coupon.gs，規格 0.6.5）：打折、折金額、買 N 送 M、滿額送；期間、次數、每人一次、限哪幾團；改單保留；後台權限。
// 名字一律用假名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0); // 台北 10/1 10:00

function setup() {
  const env = createEnv(OCT_1, { shumeizi: true });
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; };
  const bad = (r) => { assert.equal(r.ok, false, '應該失敗'); return [r.error.message].concat((r.error.details || []).map((d) => d.message)).join('｜'); };
  const tofu = ok(call('adminShopSaveProduct', { product: { name: '手工豆腐', price: '60', unit: '盒' } })).product;
  const jam = ok(call('adminShopSaveProduct', { product: { name: '果醬', price: 150, unit: '罐', options: { label: '口味', options: [{ name: '桑葚' }, { name: '鳳梨' }] } } })).product;
  const gid = ok(call('adminShopSaveGroup', { group: { name: '十月團購', deadline: '2026-10-15 22:00', pickups: [],
    items: [{ id: tofu.id, price: '', limit: '', perPerson: '' }, { id: jam.id, price: '', limit: '', perPerson: '' }] } })).id;
  const order = (body) => env.post(Object.assign({ action: 'shopOrder', groupId: gid, pay: '現場', name: '測試甲', phone: '0912000111', mode: 'add' }, body));
  const save = (c) => ok(call('adminShopSaveCoupon', { coupon: c }));
  return { env, call, ok, bad, tofu, jam, gid, order, save };
}

test('打折：9 折，折的錢分攤到品項；代碼不分大小寫', () => {
  const { ok, tofu, order, save } = setup();
  save({ code: 'happy90', kind: '打折', percent: 90 });
  const o = ok(order({ coupon: 'Happy90', items: [{ id: tofu.id, qty: 3 }] })).order;
  assert.equal(o.total, 162);
  assert.equal(o.coupon, 'HAPPY90');
  assert.deepEqual(o.discounts.map((d) => [d.code, d.discount]), [['HAPPY90', 18]]);
  assert.equal(o.items[0].discount, 18);
});

test('折金額＋滿額：不到滿額擋下來並說差多少；只算指定商品', () => {
  const { ok, bad, tofu, jam, order, save, env, gid } = setup();
  save({ code: 'OFF50', kind: '折金額', amount: 50, min: 200, productIds: [jam.id] });
  assert.match(bad(order({ coupon: 'OFF50', items: [{ id: tofu.id, qty: 5 }] })), /只能用在：果醬/);
  assert.match(bad(order({ coupon: 'OFF50', items: [{ id: jam.id, option: '桑葚', qty: 1 }] })), /還差 50 元/);
  // 結帳畫面先問
  const chk = ok(env.post({ action: 'shopCouponCheck', groupId: gid, coupon: 'off50', items: [{ id: jam.id, option: '桑葚', qty: 2 }, { id: tofu.id, qty: 1 }] }));
  assert.equal(chk.discount, 50);
  assert.equal(chk.total, 310);
  const o = ok(order({ coupon: 'OFF50', items: [{ id: jam.id, option: '桑葚', qty: 2 }, { id: tofu.id, qty: 1 }] })).order;
  assert.equal(o.total, 310);
  assert.equal(o.items.find((l) => l.id === tofu.id).discount, undefined, '豆腐不分攤');
});

test('買 N 送 M（同商品、別的商品）、滿額送：送的 0 元一行、庫存照扣', () => {
  const { ok, bad, tofu, jam, order, save, call } = setup();
  save({ code: 'B3G1', kind: '買送', buyIds: [tofu.id], buyQty: 3, get: { id: '', qty: 1 } });
  assert.match(bad(order({ coupon: 'B3G1', items: [{ id: tofu.id, qty: 2 }] })), /再買 1 件/);
  let o = ok(order({ coupon: 'B3G1', items: [{ id: tofu.id, qty: 6 }] })).order;
  const gift = o.items.find((l) => l.gift);
  assert.deepEqual([gift.id, gift.qty, gift.price], [tofu.id, 2, 0], '買 6 送 2');
  assert.equal(o.total, 360);
  // 送別的商品：有規格要選
  assert.match(bad(call('adminShopSaveCoupon', { coupon: { code: 'JAMGIFT', kind: '買送', buyIds: [tofu.id], buyQty: 2, get: { id: jam.id, qty: 1 } } })), /請選送哪一個/);
  save({ code: 'JAMGIFT', kind: '買送', buyIds: [tofu.id], buyQty: 2, get: { id: jam.id, option: '鳳梨', qty: 1 } });
  o = ok(order({ name: '測試乙', phone: '0912000222', coupon: 'JAMGIFT', items: [{ id: tofu.id, qty: 2 }] })).order;
  assert.deepEqual(o.items.filter((l) => l.gift).map((l) => l.name), ['果醬（鳳梨）']);
  save({ code: 'FULL300', kind: '滿額送', min: 300, get: { id: tofu.id, qty: 1 } });
  assert.match(bad(order({ name: '測試丙', phone: '0912000333', coupon: 'FULL300', items: [{ id: tofu.id, qty: 4 }] })), /還差 60 元/);
  o = ok(order({ name: '測試丙', phone: '0912000333', coupon: 'FULL300', items: [{ id: tofu.id, qty: 5 }] })).order;
  assert.equal(o.items.filter((l) => l.gift).length, 1);
  assert.equal(o.total, 300);
});

test('限制：期間、總次數、每人一次、限哪幾團、停用；取消的不算次數', () => {
  const { ok, bad, tofu, order, save, env, gid } = setup();
  save({ code: 'LATER', kind: '折金額', amount: 10, start: '2026-10-05' });
  assert.match(bad(order({ coupon: 'LATER', items: [{ id: tofu.id, qty: 1 }] })), /10\/5 才開始/);
  save({ code: 'OLD', kind: '折金額', amount: 10, end: '2026-09-30' });
  assert.match(bad(order({ coupon: 'OLD', items: [{ id: tofu.id, qty: 1 }] })), /過期/);
  save({ code: 'OTHER', kind: '折金額', amount: 10, groupIds: ['B-不是這團'] });
  assert.match(bad(order({ coupon: 'OTHER', items: [{ id: tofu.id, qty: 1 }] })), /不能用在這一團/);
  save({ code: 'OFFX', kind: '折金額', amount: 10, active: false });
  assert.match(bad(order({ coupon: 'OFFX', items: [{ id: tofu.id, qty: 1 }] })), /沒有開放/);
  assert.match(bad(order({ coupon: 'NOPE', items: [{ id: tofu.id, qty: 1 }] })), /找不到優惠碼/);
  save({ code: 'ONE', kind: '折金額', amount: 10, maxUses: 1, once: true });
  const a = ok(order({ coupon: 'ONE', items: [{ id: tofu.id, qty: 1 }] })).order;
  assert.match(bad(order({ name: '測試乙', phone: '0912000222', coupon: 'ONE', items: [{ id: tofu.id, qty: 1 }] })), /用完/);
  ok(env.post({ action: 'shopCancel', groupId: gid, orderId: a.id, name: '測試甲', phone: '0912000111' }));
  ok(order({ name: '測試乙', phone: '0912000222', coupon: 'ONE', items: [{ id: tofu.id, qty: 1 }] }));
});

test('每人一次：同一個人第二張單不能再用', () => {
  const { ok, bad, tofu, order, save } = setup();
  save({ code: 'ONCE', kind: '折金額', amount: 10, once: true });
  ok(order({ coupon: 'ONCE', items: [{ id: tofu.id, qty: 1 }] }));
  assert.match(bad(order({ pay: '轉帳', coupon: 'ONCE', items: [{ id: tofu.id, qty: 1 }] })), /已經用過/);
});

test('購物車加進原本那張：沒打碼保留原本的、照新內容重算；送的不會被當成買的', () => {
  const { ok, tofu, order, save, env } = setup();
  save({ code: 'B3G1', kind: '買送', buyIds: [tofu.id], buyQty: 3, get: { id: '', qty: 1 } });
  ok(order({ coupon: 'B3G1', items: [{ id: tofu.id, qty: 3 }] }));
  const o = ok(order({ items: [{ id: tofu.id, qty: 3 }] })).order;
  assert.equal(o.coupon, 'B3G1');
  assert.deepEqual(o.items.map((l) => [l.qty, !!l.gift]), [[6, false], [2, true]]);
  assert.equal(o.total, 360);
  // 我的訂單改數量（畫面把整張送回來，含送的那行）：送的照新數量重算
  const o2 = ok(env.post({ action: 'shopOrder', groupId: o.groupId, orderId: o.id, name: '測試甲', phone: '0912000111', pay: '現場', items: o.items.map((l) => ({ id: l.id, option: l.option, qty: l.id === tofu.id && !l.gift ? 2 : l.qty, gift: l.gift })) })).order;
  assert.deepEqual(o2.items.map((l) => [l.qty, !!l.gift]), [[2, false]], '不到 3 件不送，但碼留著');
  assert.equal(o2.coupon, 'B3G1');
});

test('後台：列表看得到用了幾次；代碼不能重複；植素帳號可以改，大家不能', () => {
  const { ok, bad, tofu, order, save, call, env } = setup();
  save({ code: 'HAPPY', kind: '打折', percent: 85 });
  assert.match(bad(call('adminShopSaveCoupon', { coupon: { code: 'happy', kind: '折金額', amount: 5 } })), /已經有了/);
  assert.match(bad(call('adminShopSaveCoupon', { coupon: { code: '好', kind: '折金額', amount: 5 } })), /英文字母、數字/);
  ok(order({ coupon: 'HAPPY', items: [{ id: tofu.id, qty: 1 }] }));
  const list = ok(call('adminShopCoupons', {})).coupons;
  assert.deepEqual(list.map((c) => [c.code, c.label, c.used]), [['HAPPY', '85 折', 1]]);
  assert.equal(env.post({ action: 'adminShopSaveCoupon', coupon: { code: 'X1', kind: '打折', percent: 90 } }).ok, false, '沒登入不能存');
  ok(call('adminShopDeleteCoupon', { id: list[0].id }));
  assert.equal(ok(call('adminShopCoupons', {})).coupons.length, 0);
});
