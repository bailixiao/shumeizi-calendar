// 訂餐重新設計（spec 0.5「訂餐重新設計」）：選項帶價錢、自己點（名稱、單價、份數）、訂餐截止、餐費付款、
// 補末五碼、後台訂餐統計與勾已付款。測試用的名字一律用假名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0); // 台北 10/1 10:00

function setup(duty) {
  const env = createEnv(OCT_1, { shumeizi: true });
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const c = call('adminCreateDuties', { duties: [Object.assign({ name: '槑子的靈魂健身房', category: '道務', nature: '課程', start: '2026-10-16', startTime: '19:30', location: '竹北', meal: true, positions: [{ name: '參加', min: '0' }] }, duty)] });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const d = env.get({ action: 'getEvents', from: '2026-10-16', to: '2026-10-16' }).data.duties.find((x) => x.name === '槑子的靈魂健身房');
  const signup = (entries, extra) => env.post(Object.assign({ action: 'signup', dutyId: d.id, positionId: d.positions[0].id, dates: ['2026-10-16'], entries }, extra));
  return { env, call, d, signup };
}

test('選項帶價錢：報名算餐費，要選付款方式；轉帳的回傳轉帳說明', () => {
  const { d, call, signup } = setup({ mealOptions: '主餐：素便當 $80、素麵$70\n飲料：紅茶 25元、不用', mealPayInfo: '測試銀行 000-123' });
  assert.deepEqual(d.mealOptions, [{ name: '主餐', options: ['素便當', '素麵'], prices: [80, 70] }, { name: '飲料', options: ['紅茶', '不用'], prices: [25, 0] }]);
  assert.equal(d.mealPayInfo, undefined, '轉帳說明不公開');
  assert.equal(call('adminDutyForEdit', { id: d.id }).data.duty.mealOptions, '主餐：素便當 $80、素麵 $70\n飲料：紅茶 $25、不用');

  const noPay = signup([{ name: '測試甲', source: '官網', meal: true, mealChoice: { 主餐: '素便當', 飲料: '紅茶' } }]);
  assert.equal(noPay.error.code, 'VALIDATION');
  assert.match(JSON.stringify(noPay.error.details), /餐費怎麼付/);

  const ok = signup([
    { name: '測試甲', source: '官網', meal: true, mealChoice: { 主餐: '素便當', 飲料: '紅茶' } },
    { name: '測試乙', source: '官網', meal: true, mealChoice: { 主餐: '素麵', 飲料: '不用' } }
  ], { mealPay: '轉帳', mealLast5: '12345' });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  assert.equal(ok.data.mealFee, 105 + 70);
  assert.equal(ok.data.mealPayInfo, '測試銀行 000-123');
  assert.equal(ok.data.created[0].fee, 105);

  // 0 元的不用選付款
  const free = signup([{ name: '測試丙', source: '官網', meal: true, mealChoice: { 主餐: '素便當', 飲料: '不用' } }].map((e) => Object.assign(e, { mealChoice: { 主餐: '素麵', 飲料: '不用' } })), { mealPay: '現場' });
  assert.equal(free.ok, true);
});

test('自己點：一行一行打名稱、單價、份數，算總額；格式不對擋下', () => {
  const { d, signup, call } = setup({ mealMode: '自己點', menuUrl: 'https://maps.example.test/abc', menuNote: '店名：測試素食', mealOptions: '主餐：素便當、素麵' });
  assert.equal(d.mealMode, '自己點');
  assert.deepEqual(d.mealOptions, [], '自己點不用選項');
  assert.equal(d.menuUrl, 'https://maps.example.test/abc');
  assert.deepEqual(d.mealCutoff, { days: 1, time: '12:00' });

  assert.match(JSON.stringify(signup([{ name: '測試甲', source: '官網', meal: true, mealOrder: [] }], { mealPay: '現場' }).error), /請填要吃什麼/);
  assert.match(JSON.stringify(signup([{ name: '測試甲', source: '官網', meal: true, mealOrder: [{ name: '素便當', price: '80', qty: '50' }] }], { mealPay: '現場' }).error), /份數/);

  const ok = signup([{ name: '測試甲', source: '官網', meal: true, mealOrder: [{ name: '素便當', price: '80', qty: '2' }, { name: '紅茶', price: 25, qty: 1 }, { name: '', price: '', qty: '' }], mealNote: '不要辣' }], { mealPay: '現場' });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  assert.equal(ok.data.mealFee, 185);
  assert.deepEqual(ok.data.created[0].mealOrder, [{ name: '素便當', price: 80, qty: 2 }, { name: '紅茶', price: 25, qty: 1 }]);

  const orders = call('adminMealOrders', {}).data;
  assert.equal(orders.selected.mode, '自己點');
  assert.deepEqual(orders.selected.items, [{ name: '素便當', qty: 2 }, { name: '紅茶', qty: 1 }]);
  assert.equal(orders.selected.fee, 185);
  assert.equal(orders.selected.unpaid, 185);
  assert.equal(orders.selected.people[0].label, '素便當×2・紅茶');
  assert.equal(orders.selected.notes[0].note, '不要辣');

  // 勾已付款
  const sid = orders.selected.people[0].signupId;
  assert.equal(call('adminMealPaid', { signupId: sid, paid: true }).ok, true);
  const after = call('adminMealOrders', { dutyId: d.id, date: '2026-10-16' }).data.selected;
  assert.equal(after.paid, 185);
  assert.equal(after.unpaid, 0);
  assert.equal(after.people[0].paid, true);
});

test('訂餐截止：過了還能報名，但不能點餐、不能自己改餐；末五碼還能補；管理者不限', () => {
  const { env, call, d, signup } = setup({ mealMode: '自己點', mealCutoff: '2|18:00' });
  assert.deepEqual(d.mealCutoff, { days: 2, time: '18:00' });
  const first = signup([{ name: '測試甲', source: '官網', meal: true, mealOrder: [{ name: '素便當', price: 80, qty: 1 }] }], { mealPay: '轉帳' });
  assert.equal(first.ok, true, JSON.stringify(first.error));
  const sid = first.data.created[0].id;

  env.clock.now = Date.UTC(2026, 9, 14, 10, 1, 0); // 台北 10/14 18:01，過了 10/14 18:00
  const late = signup([{ name: '測試乙', source: '官網', meal: true, mealOrder: [{ name: '素便當', price: 80, qty: 1 }] }], { mealPay: '現場' });
  assert.match(JSON.stringify(late.error), /訂餐已經截止/);
  assert.equal(signup([{ name: '測試乙', source: '官網' }]).ok, true, '不點餐就能報名');

  const mine = env.post({ action: 'mySignups', name: '測試甲' }).data.items[0];
  assert.equal(mine.mealOpen, false);
  assert.equal(mine.mealDeadline, '2026-10-14 18:00');
  assert.equal(mine.fee, 80);
  assert.equal(mine.pay, '轉帳');

  assert.equal(env.post({ action: 'updateMeal', signupId: sid, meal: false }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'mealSetLast5', signupId: sid, last5: '54321' }).ok, true);
  assert.equal(env.post({ action: 'mealSetLast5', signupId: sid, last5: '12' }).error.code, 'VALIDATION');
  assert.equal(call('adminUpdateMeal', { signupId: sid, meal: true, mealOrder: [{ name: '素麵', price: 70, qty: 1 }] }).ok, true);
  const p = call('adminMealOrders', { dutyId: d.id, date: '2026-10-16' }).data.selected.people.find((x) => x.name === '測試甲');
  assert.equal(p.fee, 70);
  assert.equal(p.last5, '54321');
});

test('菜單連結要是網址；沒開吃飯就不留菜單', () => {
  const env = createEnv(OCT_1, { shumeizi: true });
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const bad = env.post({ action: 'adminCreateDuties', token, duties: [{ name: '測試活動', category: '道務', nature: '課程', start: '2026-10-17', meal: true, menuUrl: '不是網址', positions: [{ name: '參加', min: '0' }] }] });
  assert.match(JSON.stringify(bad.error), /菜單連結/);
  const off = env.post({ action: 'adminCreateDuties', token, duties: [{ name: '測試活動', category: '道務', nature: '課程', start: '2026-10-17', meal: false, menuUrl: 'https://x.test', mealMode: '自己點', positions: [{ name: '參加', min: '0' }] }] });
  assert.equal(off.ok, true);
  const d = env.get({ action: 'getEvents', from: '2026-10-17', to: '2026-10-17' }).data.duties[0];
  assert.equal(d.menuUrl, '');
  assert.equal(d.mealMode, '');
});
