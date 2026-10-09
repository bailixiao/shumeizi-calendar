// 吃飯的餐點選項＋備註（spec 第 0.5 節）：後台填「組名：選項、選項」，報名勾吃飯時每組選一個、可寫備註；
// 統計只在後台；查我的報名可以改吃飯。測試用的名字一律用假名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function setup(mealOptions) {
  const env = createEnv(OCT_1, { shumeizi: true });
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const c = call('adminCreateDuties', { duties: [{ name: '槑子的靈魂健身房', category: '道務', nature: '課程', start: '2026-10-16', startTime: '19:30', location: '竹北', meal: true, mealOptions, positions: [{ name: '參加', min: '0' }] }] });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const d = env.get({ action: 'getEvents', from: '2026-10-16', to: '2026-10-16' }).data.duties.find((x) => x.name === '槑子的靈魂健身房');
  const signup = (entries) => env.post({ action: 'signup', dutyId: d.id, positionId: d.positions[0].id, dates: ['2026-10-16'], entries });
  return { env, call, d, signup };
}

test('餐點選項：一行一組，整理格式；不合格的擋下', () => {
  const { d, call } = setup('主餐：素便當、素麵\n飲料: 紅茶，綠茶，不用');
  assert.deepEqual(d.mealOptions, [{ name: '主餐', options: ['素便當', '素麵'] }, { name: '飲料', options: ['紅茶', '綠茶', '不用'] }]);
  assert.equal(call('adminDutyForEdit', { id: d.id }).data.duty.mealOptions, '主餐：素便當、素麵\n飲料：紅茶、綠茶、不用');
  const bad = call('adminCreateDuties', { duties: [{ name: '測試活動', category: '道務', nature: '課程', start: '2026-10-17', meal: true, mealOptions: '主餐：素便當', positions: [{ name: '參加', min: '0' }] }] });
  assert.equal(bad.ok, false);
  assert.match(JSON.stringify(bad.error), /至少要有 2 個選項/);
  // 沒寫組名＝餐點；沒開吃飯就不留
  const { d: d2 } = setup('素便當、素麵');
  assert.deepEqual(d2.mealOptions, [{ name: '餐點', options: ['素便當', '素麵'] }]);
});

test('報名勾吃飯：每組要選一個，備註選填；後台看得到統計，大家看不到各人選什麼', () => {
  const { env, call, d, signup } = setup('主餐：素便當、素麵\n飲料：紅茶、綠茶、不用');
  const miss = signup([{ name: '測試甲', source: '官網', meal: true, mealChoice: { 主餐: '素便當' } }]);
  assert.equal(miss.error.code, 'VALIDATION');
  assert.match(miss.error.details[0].message, /請選「飲料」/);
  assert.equal(signup([{ name: '測試甲', source: '官網', meal: true, mealChoice: { 主餐: '漢堡', 飲料: '紅茶' } }]).error.code, 'VALIDATION');

  const ok = signup([
    { name: '測試甲', source: '官網', meal: true, mealChoice: { 主餐: '素便當', 飲料: '紅茶' }, mealNote: '不吃辣' },
    { name: '測試乙', source: '官網', meal: true, mealChoice: { 主餐: '素便當', 飲料: '不用' } },
    { name: '測試丙', source: '官網', mealChoice: { 主餐: '素麵', 飲料: '紅茶' } } // 沒勾吃飯：選的不記
  ]);
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const rows = env.sheets['報名'].data;
  const h = rows[0];
  const byName = (n) => { const r = rows.find((x) => x[h.indexOf('姓名')] === n); return { meal: r[h.indexOf('吃飯')], choice: r[h.indexOf('餐點')], note: r[h.indexOf('餐點備註')] || '' }; };
  assert.deepEqual(byName('測試甲'), { meal: '是', choice: '主餐：素便當；飲料：紅茶', note: '不吃辣' });
  assert.deepEqual(byName('測試丙'), { meal: '', choice: '', note: '' });

  const pub = env.get({ action: 'getDuty', id: d.id }).data;
  assert.equal(pub.days['2026-10-16'].meals, 2);
  assert.ok(!JSON.stringify(pub.signups).includes('素便當'), '大家看不到各人選什麼');
  assert.ok(!JSON.stringify(pub.signups).includes('不吃辣'));

  const adm = call('adminDuty', { id: d.id }).data;
  const st = adm.mealStats['2026-10-16'];
  assert.equal(st.total, 2);
  assert.deepEqual(st.groups[0], { name: '主餐', counts: [{ option: '素便當', count: 2 }, { option: '素麵', count: 0 }] });
  assert.deepEqual(st.groups[1].counts.map((x) => x.count), [1, 0, 1]);
  assert.deepEqual(st.notes, [{ name: '測試甲', note: '不吃辣' }]);
  assert.deepEqual(adm.signups.find((s) => s.name === '測試甲').mealChoice, { 主餐: '素便當', 飲料: '紅茶' });
});

test('沒有餐點選項：跟原本一樣只勾吃不吃，可以寫備註', () => {
  const { env, signup } = setup('');
  const ok = signup([{ name: '測試甲', source: '官網', meal: true, mealNote: '少飯' }]);
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const rows = env.sheets['報名'].data;
  assert.equal(rows[1][rows[0].indexOf('餐點備註')], '少飯');
});

test('查我的報名改吃飯：改選項、改成不吃；當天以後不能自己改，管理者可以', () => {
  const { env, call, signup } = setup('主餐：素便當、素麵');
  const id = signup([{ name: '測試甲', source: '官網', meal: true, mealChoice: { 主餐: '素便當' } }]).data.created[0].id;
  const mine = env.post({ action: 'mySignups', name: '測試甲' }).data.items[0];
  assert.equal(mine.mealOn, true);
  assert.deepEqual(mine.mealChoice, { 主餐: '素便當' });
  assert.deepEqual(mine.mealOptions, [{ name: '主餐', options: ['素便當', '素麵'] }]);

  assert.equal(env.post({ action: 'updateMeal', signupId: id, meal: true, mealChoice: { 主餐: '漢堡' } }).error.code, 'VALIDATION');
  const r = env.post({ action: 'updateMeal', signupId: id, meal: true, mealChoice: { 主餐: '素麵' }, mealNote: '大碗' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(env.post({ action: 'mySignups', name: '測試甲' }).data.items[0].mealChoice, { 主餐: '素麵' });
  assert.equal(env.post({ action: 'updateMeal', signupId: id, meal: false }).ok, true);
  assert.equal(env.get({ action: 'getDuty', id: mine.dutyId }).data.days['2026-10-16'].meals, 0);
  assert.equal(env.sheets['操作紀錄'].data.filter((x) => x.includes('改吃飯')).length, 2);

  env.clock.now = Date.UTC(2026, 9, 16, 2, 0, 0); // 台北 10/16（當天）
  assert.equal(env.post({ action: 'updateMeal', signupId: id, meal: true, mealChoice: { 主餐: '素麵' } }).error.code, 'FORBIDDEN');
  assert.equal(call('adminUpdateMeal', { signupId: id, meal: true, mealChoice: { 主餐: '素麵' } }).ok, true);
});

test('後台幫人報名可以選餐點；改期時餐點跟著原本的', () => {
  const { env, call, d } = setup('主餐：素便當、素麵');
  const bad = call('adminAddAttendee', { dutyId: d.id, positionId: d.positions[0].id, date: '2026-10-16', name: '測試甲', source: '不確定', meal: true });
  assert.equal(bad.error.code, 'VALIDATION');
  const r = call('adminAddAttendee', { dutyId: d.id, positionId: d.positions[0].id, date: '2026-10-16', name: '測試甲', source: '不確定', meal: true, mealChoice: { 主餐: '素麵' }, mealNote: '加辣' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const st = call('adminDuty', { id: d.id }).data.mealStats['2026-10-16'];
  assert.equal(st.groups[0].counts[1].count, 1);
  assert.deepEqual(st.notes, [{ name: '測試甲', note: '加辣' }]);
});
