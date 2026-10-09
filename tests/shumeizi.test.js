// 書槑子的報名規則（spec 第 0.4、0.5 節）：不選身分、沒有陪同；第一次來的人要選認識管道（朋友介紹要填介紹人）；
// 活動可以開「有吃飯」，報名時每個人勾「我會一起吃飯」，算出這天要準備幾份。
// 執行：在專案根目錄執行 node --test。測試用的名字一律用假名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function setup() {
  const env = createEnv(OCT_1, { shumeizi: true });
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const vol = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  const signup = (entries, extra) => env.post(Object.assign({ action: 'signup', dutyId: vol.id, positionId: vol.positions[0].id, dates: ['2026-10-13'], entries }, extra));
  const member = (name) => {
    const rows = env.sheets['成員'].data;
    const h = rows[0];
    const r = rows.find((x) => x[0] === name);
    return r ? Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]])) : null;
  };
  return { env, call, vol, signup, member };
}

test('第一次來的人要選認識管道；朋友介紹要填介紹人；記在成員名單（待確認）', () => {
  const { signup, member } = setup();
  const none = signup([{ name: '王小明' }]);
  assert.equal(none.error.code, 'VALIDATION');
  assert.match(none.error.details[0].message, /怎麼認識書槑子青年坊/);
  assert.match(signup([{ name: '王小明', source: '朋友介紹' }]).error.details[0].message, /介紹人/);
  assert.match(signup([{ name: '王小明', source: '路上撿到' }]).error.details[0].message, /怎麼認識/);

  const ok = signup([{ name: '王小明', source: '朋友介紹', referrer: '測試甲' }]);
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const m = member('王小明');
  assert.equal(m['認識管道'], '朋友介紹');
  assert.equal(m['介紹人'], '測試甲');
  assert.equal(m['第一次報名日'], '2026-10-01');
  assert.equal(m['待確認'], '是');
  assert.equal(m['身分'], '');
});

test('已經報名過的人（成員名單上有，含待確認）不用再選管道；其他、不確定、IG 都可以', () => {
  const { env, call, signup, member } = setup();
  assert.equal(signup([{ name: '測試乙', source: 'Instagram' }]).ok, true);
  // 第二次報名（別的活動）不用管道；送了也不會改掉第一次的
  const c = call('adminCreateDuties', { duties: [{ name: '植素園工作坊', category: '植素', nature: '工作坊', start: '2026-10-25', positions: [{ name: '參加', min: '0' }] }] });
  const d = env.get({ action: 'getDuty', id: c.data.ids[0] }).data;
  const join = (entries) => env.post({ action: 'signup', dutyId: d.id, positionId: d.positions[0].id, dates: ['2026-10-25'], entries });
  const r = join([{ name: '測試乙' }]);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(member('測試乙')['認識管道'], 'Instagram');
  assert.equal(join([{ name: '測試丙', source: '其他', sourceNote: '在市集看到攤位' }]).ok, true);
  assert.equal(member('測試丙')['管道說明'], '在市集看到攤位');
  assert.equal(join([{ name: '測試丁', source: '不確定' }]).ok, true);
  assert.equal(member('測試丁')['介紹人'], '', '不是朋友介紹就不記介紹人');
});

test('沒有身分也能報名、取消、改期；沒有陪同', () => {
  const { env, signup } = setup();
  assert.match(JSON.stringify(signup([{ name: '測試甲', source: '官網', accompany: true }]).error), /沒有「陪同」/);
  const s = signup([{ name: '測試甲', source: '官網' }]);
  assert.equal(s.ok, true, JSON.stringify(s.error));
  assert.equal(s.data.created[0].identity, '');
  const other = env.get({ action: 'getEvents', from: '2026-10-24', to: '2026-10-24' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  const m = env.post({ action: 'reschedule', signupId: s.data.created[0].id, dutyId: other.id, date: '2026-10-24', positionId: other.positions[0].id });
  assert.equal(m.ok, true, JSON.stringify(m.error));
  const log = env.sheets['操作紀錄'].data.slice(-1)[0][3];
  assert.doesNotMatch(log, /未填身分/);
  assert.equal(env.post({ action: 'cancel', signupId: m.data.signupId }).ok, true);
});

test('有吃飯的活動：報名勾吃飯，算這天要準備幾份；沒開吃飯的活動不記', () => {
  const { env, call, signup } = setup();
  const c = call('adminCreateDuties', { duties: [{ name: '槑子的靈魂健身房', category: '道務', nature: '課程', start: '2026-10-16', startTime: '19:30', location: '竹北', meal: true, positions: [{ name: '參加', min: '0' }] }] });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const d = env.get({ action: 'getDuty', id: c.data.ids[0] }).data;
  assert.equal(d.meal, true);
  const r = env.post({ action: 'signup', dutyId: d.id, positionId: d.positions[0].id, dates: ['2026-10-16'], entries: [{ name: '測試甲', source: '官網', meal: true }, { name: '測試乙', source: '官網' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const after = env.get({ action: 'getDuty', id: d.id }).data;
  assert.equal(after.days['2026-10-16'].meals, 1);
  assert.deepEqual(after.signups.map((s) => [s.name, s.meal]), [['測試甲', true], ['測試乙', false]]);
  // 沒開吃飯的志工排班：送了 meal 也不記
  assert.equal(signup([{ name: '測試丙', source: '官網', meal: true }]).ok, true);
  const v = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((x) => x.name === '彌勒山志工輪值');
  assert.equal(v.meal, false);
  assert.equal(env.sheets['報名'].data.slice(-1)[0][14] || '', '');
  // 編輯畫面帶得回「有吃飯」
  assert.equal(call('adminDutyForEdit', { id: d.id }).data.duty.meal, '是');
});

test('後台幫人報名、補登：新朋友一樣要選管道（可以不確定），不用身分', () => {
  const { call, vol, member } = setup();
  const base = { dutyId: vol.id, positionId: vol.positions[0].id, date: '2026-10-13' };
  assert.equal(call('adminAddAttendee', Object.assign({ name: '王小明' }, base)).error.code, 'VALIDATION');
  const r = call('adminAddAttendee', Object.assign({ name: '王小明', source: '不確定' }, base));
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(member('王小明')['認識管道'], '不確定');
});

test('統計：新朋友依認識管道、介紹人整理（只算這段期間第一次報名的）', () => {
  const C = require('../js/stats-calc.js');
  const list = [
    { name: '王小明', source: '朋友介紹', referrer: '測試甲', date: '2026-10-03' },
    { name: '測試乙', source: 'Instagram', referrer: '', date: '2026-10-09' },
    { name: '測試丙', source: '朋友介紹', referrer: '測試甲', date: '2026-10-20' },
    { name: '測試丁', source: '官網', referrer: '', date: '2026-09-30' }
  ];
  const n = C.newcomers(list, C.periodOf('month', '2026-10-01'));
  assert.equal(n.total, 3);
  assert.deepEqual(n.bySource, [{ source: '朋友介紹', count: 2 }, { source: 'Instagram', count: 1 }]);
  assert.deepEqual(n.byReferrer, [{ name: '測試甲', count: 2 }]);
  assert.deepEqual(n.people.map((x) => x.name), ['測試丙', '測試乙', '王小明']);
});

test('後台：統計帶新朋友；成員可以補、改認識管道', () => {
  const { call, signup, member } = setup();
  signup([{ name: '王小明', source: '朋友介紹', referrer: '測試甲' }]);
  const st = call('adminStats', {}).data;
  assert.deepEqual(st.newcomers, [{ name: '王小明', source: '朋友介紹', referrer: '測試甲', note: '', date: '2026-10-01' }]);
  const m = call('adminMembers', {}).data.members.find((x) => x.name === '王小明');
  assert.equal(m.source, '朋友介紹');
  const r = call('adminSaveMember', { row: m.row, original: m.name, member: { name: '王小明', identity: '', groups: {}, note: '', active: true, source: '其他', referrer: '測試甲', sourceNote: '市集' } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(member('王小明')['認識管道'], '其他');
  assert.equal(member('王小明')['介紹人'], '', '不是朋友介紹就清掉介紹人');
  assert.equal(member('王小明')['管道說明'], '市集');
  assert.equal(call('adminSaveMember', { row: m.row, original: m.name, member: { name: '王小明', source: '路上' } }).error.code, 'VALIDATION');
});

test('錯誤訊息換成書槑子的用詞（勤務→活動、了愿項目→項目）', () => {
  const { env, vol } = setup();
  const r = env.post({ action: 'signup', dutyId: vol.id, positionId: 'x', dates: ['2026-10-13'], entries: [{ name: '測試甲', source: '官網' }] });
  assert.equal(r.error.details[0].message, '請選擇項目');
  const past = env.post({ action: 'signup', dutyId: vol.id, positionId: vol.positions[0].id, dates: ['2026-10-01'], entries: [{ name: '測試甲', source: '官網' }] });
  assert.doesNotMatch(JSON.stringify(past.error), /勤務/);
});
