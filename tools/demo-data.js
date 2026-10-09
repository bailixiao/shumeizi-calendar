// 本機測試版的示範資料（tools/dev-server.js --mock --demo）：書槑子的四類活動、幾位假名成員與報名。
// 常見問題截圖（tools/help-shots.js）、圖解教學（tools/tutorial-shots.js）都用這份。名字一律是假名。
// 日期跟著今天（台北時間）往後排，截圖永遠看起來是「最近的活動」。

function taipeiToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 今天之後（不含今天）第一個星期幾（0＝日⋯5＝五） */
function nextWeekday(today, wd) {
  for (let i = 1; i <= 7; i++) { const d = addDays(today, i); if (new Date(d + 'T00:00:00Z').getUTCDay() === wd) return d; }
  return today;
}

/** call(body) → POST 的回應、get(query) → GET 的回應（JSON）。回傳 { today, gym, gym2, sun, sun2 }（截圖要用的日期） */
async function seedDemo(call, get) {
  const today = taipeiToday();
  const gym = nextWeekday(today, 5); // 下一個星期五：靈魂健身房
  const gym2 = addDays(gym, 14);
  const sun = nextWeekday(today, 0); // 下一個星期日：課館、植素園出攤
  const sun2 = addDays(sun, 7);
  const tok = (await call({ action: 'adminLogin', password: 'test-pass' })).data.token;
  const admin = (action, body) => call(Object.assign({ action, token: tok }, body));
  const join = { name: '參加', min: '0' };
  const duties = [
    ...[gym, gym2, addDays(gym, 28)].map((d) => ({ name: '槑子的靈魂健身房', category: '道務', nature: '課程', start: d, startTime: '19:30', endTime: '21:30', location: '竹北', meal: true, mealOptions: '主餐：素便當、素麵\n飲料：紅茶、綠茶、不用',
      description: '用我們的筆，寫出我們的故事 ✍️\n18:30 可以提早來一起吃飯 🍱', positions: [join] })),
    ...[sun, addDays(sun, 14)].map((d) => ({ name: '槑青韜課館', category: '教育', nature: '課程', start: d, startTime: '11:30', endTime: '15:00', location: '安東彌勒山（厚德樓）', meal: true,
      description: '11:30 先吃飯，12:30 開課', positions: [join] })),
    ...[sun, sun2].map((d) => ({ name: '植素園出攤', category: '植素', nature: '出攤', start: d, startTime: '09:00', endTime: '13:00', location: '宏宗聖堂道學院',
      description: '植素園的蔬食與手作，歡迎來逛逛、取團購 🌿', positions: [join] })),
    ...[sun, sun2].map((d) => ({ name: '植素園出攤志工', category: '勤務', nature: '勤務', start: d, startTime: '08:30', endTime: '13:30', location: '宏宗聖堂道學院',
      description: '幫忙擺攤、收銀，結束一起收攤 💪', positions: [{ name: '擺攤', min: '2', max: '3' }, { name: '收銀', min: '1', max: '1' }] }))
  ];
  const r = await admin('adminCreateDuties', { duties });
  if (!r.ok) throw new Error('示範活動建立失敗：' + JSON.stringify(r.error));
  const all = (await get({ action: 'getEvents', from: today, to: addDays(today, 60) })).data.duties;
  const find = (name, date) => all.find((d) => d.name === name && d.start === date);
  const signup = async (d, date, entries, positionId) => {
    const res = await call({ action: 'signup', dutyId: d.id, positionId: positionId || d.positions[0].id, dates: [date], entries });
    if (!res.ok) throw new Error('示範報名失敗：' + JSON.stringify(res.error));
  };
  await signup(find('槑子的靈魂健身房', gym), gym, [
    { name: '測試甲', source: '朋友介紹', referrer: '王小明', meal: true, mealChoice: { 主餐: '素便當', 飲料: '紅茶' }, mealNote: '不吃辣' },
    { name: '王小明', source: '官方 LINE', meal: true, mealChoice: { 主餐: '素麵', 飲料: '不用' } },
    { name: '測試乙', source: 'Instagram' }
  ]);
  await signup(find('槑子的靈魂健身房', gym2), gym2, [{ name: '測試甲', meal: true, mealChoice: { 主餐: '素便當', 飲料: '綠茶' } }]);
  await signup(find('槑青韜課館', sun), sun, [{ name: '測試甲', meal: true }, { name: '測試丙', source: '官網', meal: true }]);
  const vol = find('植素園出攤志工', sun);
  await signup(vol, sun, [{ name: '王小明' }], vol.positions[0].id);
  await signup(find('植素園出攤', sun), sun, [{ name: '測試乙' }]);
  // 團購：三樣商品、一次開放中的團購（在兩場植素園出攤取貨）、幾張訂單
  // 商品照片：tools/demo-photos/*.png（自己畫的示範圖），上傳到 Cloudflare（同 DM）
  const upload = async (file) => { const data = require('fs').readFileSync(require('path').join(__dirname, 'demo-photos', file)).toString('base64'); const r = await admin('adminUploadFile', { mime: 'image/png', name: file, data }); return r.ok ? r.data.id : ''; };
  const prod = async (name, price, unit, description, photo) => (await admin('adminShopSaveProduct', { product: { name, price, unit, description, photo: photo ? await upload(photo) : '' } })).data.product.id;
  const tofu = await prod('手工豆腐', 60, '盒', '當天現做，冷藏 3 天內吃完', 'tofu.png');
  const jam = await prod('桑葚果醬', 150, '罐', '植素園自己熬的，少糖', 'jam.png');
  const bread = await prod('全麥饅頭', 80, '包', '一包 4 顆', 'bread.png');
  const pickups = [find('植素園出攤', sun).id, find('植素園出攤', sun2).id];
  const g = await admin('adminShopSaveGroup', { group: {
    name: '植素園十月團購', description: '這次有新鮮的手工豆腐、果醬和饅頭 🌿 在出攤時取貨', deadline: addDays(sun, -1) + ' 22:00', pickups,
    payInfo: '（示範）轉帳帳號：測試銀行 000-0000000-000，轉好請填末五碼',
    items: [{ id: tofu, price: '', limit: '', perPerson: '' }, { id: jam, price: '', limit: '10', perPerson: '2' }, { id: bread, price: '', limit: '', perPerson: '' }]
  } });
  if (!g.ok) throw new Error('示範團購建立失敗：' + JSON.stringify(g.error));
  const order = (name, pickup, items, pay) => call({ action: 'shopOrder', groupId: g.data.id, name, pickupId: pickup, items, pay: pay || '現場' });
  await order('測試甲', pickups[0], [{ id: tofu, qty: 2 }, { id: jam, qty: 1 }], '轉帳');
  await order('王小明', pickups[0], [{ id: bread, qty: 1 }]);
  await order('測試乙', pickups[1], [{ id: jam, qty: 2 }, { id: tofu, qty: 1 }]);
  // 待確認的新朋友保留成正式成員（名字提示才找得到）
  const members = (await admin('adminMembers', {})).data.members.filter((m) => m.pending);
  if (members.length) await admin('adminConfirmMembers', { rows: members.map((m) => ({ row: m.row, original: m.name })) });
  return { today, gym, gym2, sun, sun2 };
}

module.exports = { seedDemo, taipeiToday, addDays, nextWeekday };
