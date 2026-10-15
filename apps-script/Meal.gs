/**
 * 吃飯的餐點選項（書槑子，規格第 0.5 節）。
 *   - 勤務「餐點選項」：一行一組「組名：選項、選項」（沒寫組名＝餐點）；最多 5 組、每組 10 個選項。
 *   - 報名「餐點」：每組選一個，存成「主餐：素便當；飲料：紅茶」；「餐點備註」選填，最多 50 字。
 *   - 各人選什麼只給後台看；大家看到的活動頁只有吃飯人數。
 *
 * 2026/10/16 訂餐重新設計（規格 0.5「訂餐重新設計」）：
 *   - 勤務「點餐方式」：空白＝選項（上面那種，選項可以帶價錢「素便當 $80」）；「自己點」＝看菜單自己打「名稱、單價、份數」。
 *   - 勤務「菜單連結」「菜單說明」「菜單照片」（JSON，和 DM 同格式）：報名時顯示在點餐上面。
 *   - 勤務「訂餐截止」：「天數|時間」＝活動那天的前幾天幾點（空白＝前 1 天 12:00）；過了只能報名、不能點餐改餐（管理者不限）。
 *   - 勤務「餐費轉帳說明」：選轉帳的人報名後、查我的報名才看得到。
 *   - 報名「餐費」（這筆的金額）、「餐費付款」（現場／轉帳）、「餐費末五碼」、「餐費已付」（是／空白，後台勾）。
 *   - 自己點的「餐點」存成「素便當 $80×2；紅茶 $25×1」。
 */

var MEAL_SELF = '自己點';
var MEAL_ORDER_MAX_LINES = 10;
var MEAL_ORDER_NAME_MAX = 30;
var MEAL_PRICE_MAX = 9999;
var MEAL_QTY_MAX = 20;
var MEAL_PAY = ['現場', '轉帳'];
var MEAL_CUTOFF_DEFAULT = { days: 1, time: '12:00' };
var MEAL_MENU_NOTE_MAX = 500;
var MEAL_PAY_INFO_MAX = 300;

var MEAL_MAX_GROUPS = 5;
var MEAL_MAX_OPTIONS = 10;
var MEAL_NOTE_MAX = 50;

/** 去掉存檔用的分隔符號（：；）與換行 */
function mealWord_(s) {
  return cleanText_(s).replace(/[：:；;\r\n]+/g, ' ').replace(/\s+/g, ' ').slice(0, 20);
}

/** 一個選項的原文 → { name, price }：「素便當 $80」「素便當$80」「素便當 80元」都可以；沒寫價錢＝0 */
function mealOptionPrice_(o) {
  o = cleanText_(o);
  var m = o.match(/^(.*?)\s*[$＄]\s*(\d{1,4})\s*(元)?$/) || o.match(/^(.*?)\s+(\d{1,4})\s*元$/);
  return m ? { name: mealWord_(m[1]), price: Number(m[2]) } : { name: mealWord_(o), price: 0 };
}

/** 「勤務」餐點選項原文 → [{ name, options: [..], prices: [..] }]（格式不對的行略過；prices 和 options 一一對應） */
function parseMealOptions_(text) {
  var groups = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    line = cleanText_(line);
    if (!line) return;
    var m = line.match(/^([^：:]*)[：:](.*)$/);
    var name = mealWord_(m ? m[1] : '') || '餐點';
    var options = [];
    var prices = [];
    (m ? m[2] : line).split(/[、,，\/／]/).forEach(function (raw) {
      var o = mealOptionPrice_(raw);
      if (o.name && options.indexOf(o.name) === -1) { options.push(o.name); prices.push(o.price); }
    });
    if (!options.length || groups.some(function (g) { return g.name === name; })) return;
    groups.push({ name: name, options: options.slice(0, MEAL_MAX_OPTIONS), prices: prices.slice(0, MEAL_MAX_OPTIONS) });
  });
  return groups.slice(0, MEAL_MAX_GROUPS);
}

/** 選項＋價錢的顯示文字：「素便當 $80」；0 元只寫名稱 */
function mealOptionText_(name, price) {
  return price ? name + ' $' + price : name;
}

/** 後台填的餐點選項 → { text（整理過的原文）, errors } */
function normalizeMealOptions_(text) {
  var lines = String(text || '').split(/\r?\n/).filter(function (l) { return cleanText_(l); });
  var groups = parseMealOptions_(text);
  var errors = [];
  if (lines.length > MEAL_MAX_GROUPS) errors.push('餐點選項最多 ' + MEAL_MAX_GROUPS + ' 組（一行一組）');
  if (lines.length && groups.length < Math.min(lines.length, MEAL_MAX_GROUPS)) errors.push('餐點選項每一行請寫「組名：選項、選項」，組名不能重複');
  groups.forEach(function (g) {
    if (g.options.length < 2) errors.push('餐點選項「' + g.name + '」至少要有 2 個選項（用「、」隔開）');
  });
  return {
    text: groups.map(function (g) { return g.name + '：' + g.options.map(function (o, i) { return mealOptionText_(o, g.prices[i]); }).join('、'); }).join('\n'),
    errors: errors
  };
}

/** 報名「餐點」→ { 組名: 選項 } */
function parseMealChoice_(s) {
  var out = {};
  String(s || '').split('；').forEach(function (part) {
    var i = part.indexOf('：');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  });
  return out;
}

/**
 * 報名時選的餐點 → { value: '主餐：素便當；飲料：紅茶', error }
 * groups＝這個活動的餐點選項；choices＝{ 組名: 選項 }。沒有選項的活動一律回傳空字串。
 */
function mealChoiceValue_(groups, choices) {
  choices = choices && typeof choices === 'object' ? choices : {};
  var parts = [];
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    var c = choices[g.name];
    if (g.options.indexOf(c) === -1) return { value: '', error: '請選「' + g.name + '」' };
    parts.push(g.name + '：' + c);
  }
  return { value: parts.join('；'), error: '' };
}

/** 餐點備註：一行、最多 50 字 */
function cleanMealNote_(s) {
  return cleanText_(s).replace(/[\r\n]+/g, ' ').slice(0, MEAL_NOTE_MAX);
}

/**
 * 報名一個人的吃飯欄位：{ '吃飯', '餐點', '餐點備註', '餐費' } 或 { error }。
 * e = { meal, mealChoice: { 組名: 選項 }（選項）, mealOrder: [{ name, price, qty }]（自己點）, mealNote }；活動沒開吃飯就全部空白。
 */
function mealFields_(duty, e) {
  if (duty['有吃飯'] !== '是' || !e || !e.meal) return { '吃飯': '', '餐點': '', '餐點備註': '', '餐費': '' };
  if (duty['點餐方式'] === MEAL_SELF) {
    var o = mealOrderValue_(e.mealOrder);
    if (o.error) return { error: o.error };
    return { '吃飯': '是', '餐點': o.value, '餐點備註': cleanMealNote_(e.mealNote), '餐費': o.total ? String(o.total) : '' };
  }
  var groups = parseMealOptions_(duty['餐點選項']);
  var c = mealChoiceValue_(groups, e.mealChoice);
  if (c.error) return { error: c.error };
  var fee = mealChoiceFee_(groups, parseMealChoice_(c.value));
  return { '吃飯': '是', '餐點': c.value, '餐點備註': cleanMealNote_(e.mealNote), '餐費': fee ? String(fee) : '' };
}

/** 選項的餐費：每組選的那個的價錢加起來 */
function mealChoiceFee_(groups, choice) {
  var sum = 0;
  groups.forEach(function (g) {
    var i = g.options.indexOf(choice[g.name]);
    if (i !== -1) sum += Number(g.prices && g.prices[i]) || 0;
  });
  return sum;
}

/** 自己點的一行名稱：去掉存檔用的符號（；：$×） */
function mealOrderName_(s) {
  return cleanText_(s).replace(/[：:；;$＄×xX*＊\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MEAL_ORDER_NAME_MAX);
}

/**
 * 自己點的餐點 → { value: '素便當 $80×2；紅茶 $25×1', total, lines, error }
 * lines = [{ name, price, qty }]；整行空白的略過；至少要一行。
 */
function mealOrderValue_(lines) {
  var out = [];
  var list = Array.isArray(lines) ? lines : [];
  for (var i = 0; i < list.length; i++) {
    var l = list[i] || {};
    var name = mealOrderName_(l.name);
    var priceRaw = String(l.price === undefined || l.price === null ? '' : l.price).trim();
    var qtyRaw = String(l.qty === undefined || l.qty === null ? '' : l.qty).trim();
    if (!name && !priceRaw && (!qtyRaw || qtyRaw === '1')) continue;
    if (!name) return { error: '請填要吃什麼（第 ' + (i + 1) + ' 行）' };
    if (!/^\d{1,4}$/.test(priceRaw || '0')) return { error: '「' + name + '」的單價請填 0～' + MEAL_PRICE_MAX + ' 的整數' };
    var qty = Number(qtyRaw || 1);
    if (!/^\d{1,2}$/.test(qtyRaw || '1') || qty < 1 || qty > MEAL_QTY_MAX) return { error: '「' + name + '」的份數請填 1～' + MEAL_QTY_MAX };
    out.push({ name: name, price: Number(priceRaw || 0), qty: qty });
  }
  if (!out.length) return { error: '請填要吃什麼' };
  if (out.length > MEAL_ORDER_MAX_LINES) return { error: '最多點 ' + MEAL_ORDER_MAX_LINES + ' 樣' };
  var total = out.reduce(function (a, l) { return a + l.price * l.qty; }, 0);
  return { value: out.map(function (l) { return l.name + ' $' + l.price + '×' + l.qty; }).join('；'), total: total, lines: out, error: '' };
}

/** 自己點存的「餐點」→ [{ name, price, qty }] */
function parseMealOrder_(value) {
  var out = [];
  String(value || '').split('；').forEach(function (part) {
    var m = part.match(/^(.*) \$(\d+)×(\d+)$/);
    if (m) out.push({ name: m[1], price: Number(m[2]), qty: Number(m[3]) });
  });
  return out;
}

/** 這筆報名的餐點（給畫面用）：選項→ { 組名: 選項 }；自己點→ [{ name, price, qty }] */
function mealOfRow_(duty, row) {
  return duty && duty['點餐方式'] === MEAL_SELF ? { mealOrder: parseMealOrder_(row['餐點']) } : { mealChoice: parseMealChoice_(row['餐點']) };
}

/** 訂餐截止的設定「天數|時間」→ { days, time } */
function mealCutoff_(duty) {
  var m = String((duty && duty['訂餐截止']) || '').match(/^(\d)\|(\d{2}:\d{2})$/);
  return m ? { days: Number(m[1]), time: m[2] } : { days: MEAL_CUTOFF_DEFAULT.days, time: MEAL_CUTOFF_DEFAULT.time };
}

/** 後台填的訂餐截止 → 「天數|時間」（0～7 天、HH:mm；不對就用預設） */
function normalizeMealCutoff_(days, time) {
  var d = String(days === undefined || days === null ? '' : days).trim() === '' ? NaN : Number(days); // 空白＝預設
  var t = String(time || '').trim();
  if (!(d >= 0 && d <= 7 && Math.floor(d) === d)) d = MEAL_CUTOFF_DEFAULT.days;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) t = MEAL_CUTOFF_DEFAULT.time;
  return d + '|' + t;
}

/** 某一天的訂餐截止時間 'yyyy-MM-dd HH:mm' */
function mealDeadline_(duty, date) {
  var c = mealCutoff_(duty);
  var t = new Date(String(date) + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() - c.days);
  return t.toISOString().slice(0, 10) + ' ' + c.time;
}

/** 某一天還能不能點餐、改餐（now＝'yyyy-MM-dd HH:mm:ss'） */
function mealOpen_(duty, date, now) {
  return String(now || '').slice(0, 16) < mealDeadline_(duty, date);
}

/** 餐費付款欄位：fee＞0 才記付款方式、末五碼 */
function mealPayFields_(fee, pay, last5) {
  if (!Number(fee)) return { '餐費付款': '', '餐費末五碼': '' };
  return { '餐費付款': pay, '餐費末五碼': pay === '轉帳' ? String(last5 || '') : '' };
}

/** 檢查付款方式、末五碼；回傳錯誤訊息或 '' */
function mealPayError_(pay, last5) {
  if (MEAL_PAY.indexOf(pay) === -1) return '請選餐費怎麼付（現場付現或轉帳）';
  if (last5 && !/^\d{5}$/.test(String(last5))) return '轉帳末五碼要是 5 個數字';
  return '';
}

/** 標籤用：「素便當・紅茶」 */
function mealLabel_(value) {
  var c = parseMealChoice_(value);
  return Object.keys(c).map(function (k) { return c[k]; }).join('・');
}

/**
 * 改吃飯（查我的報名「🍱 改吃飯」、後台）：body = { signupId, meal, mealChoice, mealNote }
 * 一般人活動當天（含）之後不能改；管理者（opts.admin）不限。
 */
function updateMeal_(body, opts) {
  opts = opts || {};
  var duties = readTableCached_(SHEETS.DUTIES);
  return withSignupLock_(function () {
    var signups = readTable_(SHEETS.SIGNUPS);
    var row = findActiveSignup_(signups, body.signupId);
    if (!opts.admin && !canSelfChange_(row['日期'], todayString_())) {
      throw new ApiError_('FORBIDDEN', '活動當天（含）之後不能自己改，請聯絡小編');
    }
    var duty = findById_(duties, '勤務ID', row['勤務ID']);
    if (!duty || duty['有吃飯'] !== '是') throw new ApiError_('BAD_REQUEST', '這個活動沒有吃飯');
    if (!opts.admin && !mealOpen_(duty, row['日期'], nowString_())) {
      throw new ApiError_('FORBIDDEN', '訂餐已經截止（' + mealDeadline_(duty, row['日期']).slice(5).replace('-', '/') + '），要改請聯絡小編');
    }
    var f = mealFields_(duty, { meal: !!body.meal, mealChoice: body.mealChoice, mealOrder: body.mealOrder, mealNote: body.mealNote });
    if (f.error) throw new ApiError_('VALIDATION', f.error);
    if (Number(f['餐費'])) {
      var pay = body.mealPay || row['餐費付款'];
      var payErr = mealPayError_(pay, body.mealLast5);
      if (payErr) throw new ApiError_('VALIDATION', payErr);
      var p = mealPayFields_(f['餐費'], pay, body.mealLast5 || row['餐費末五碼']);
      f['餐費付款'] = p['餐費付款'];
      f['餐費末五碼'] = p['餐費末五碼'];
    } else {
      f['餐費付款'] = '';
      f['餐費末五碼'] = '';
    }
    var before = rowSnapshot_(SHEETS.SIGNUPS, row);
    var now = nowString_();
    f['更新時間'] = now;
    updateRow_(SHEETS.SIGNUPS, row, f);
    appendRows_(SHEETS.LOGS, [{
      '時間': now,
      '動作': '改吃飯',
      '報名ID': row['報名ID'],
      '內容摘要': [row['姓名'] + (f['吃飯'] ? '🍱' + (f['餐點'] ? mealLabelOf_(duty, f['餐點']) : '') + (Number(f['餐費']) ? ' ' + f['餐費'] + ' 元' : '') : '（不吃）'), row['日期'], duty['名稱']].join('｜') + (opts.admin ? adminTag_() : ''),
      '還原用的前一版資料': JSON.stringify(before)
    }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    var out = { signupId: row['報名ID'], meal: f['吃飯'] === '是', mealNote: f['餐點備註'], fee: Number(f['餐費']) || 0, pay: f['餐費付款'], last5: f['餐費末五碼'] };
    var m = mealOfRow_(duty, f);
    if (m.mealOrder) out.mealOrder = m.mealOrder; else out.mealChoice = m.mealChoice;
    if (out.pay === '轉帳') out.payInfo = duty['餐費轉帳說明'] || '';
    return out;
  });
}

/** 後台吃飯統計：這天各組各選項幾份、有寫備註的人（不重複的人以第一筆為準） */
function mealStats_(duty, signups, date) {
  var groups = parseMealOptions_(duty['餐點選項']);
  var counts = {};
  groups.forEach(function (g) { counts[g.name] = {}; g.options.forEach(function (o) { counts[g.name][o] = 0; }); });
  var seen = {};
  var notes = [];
  var total = 0;
  signups.forEach(function (s) {
    if (s['日期'] !== date || s['狀態'] === '已取消' || s['吃飯'] !== '是') return;
    var key = normalizeName_(s['姓名']) + '|' + (s['佛堂'] || '');
    if (seen[key]) return;
    seen[key] = true;
    total++;
    var c = parseMealChoice_(s['餐點']);
    groups.forEach(function (g) { if (counts[g.name][c[g.name]] !== undefined) counts[g.name][c[g.name]]++; });
    if (s['餐點備註']) notes.push({ name: s['姓名'], note: s['餐點備註'] });
  });
  return {
    total: total,
    groups: groups.map(function (g) { return { name: g.name, counts: g.options.map(function (o) { return { option: o, count: counts[g.name][o] }; }) }; }),
    notes: notes
  };
}

/**
 * 用過的菜單（後台新增／編輯活動時點一下帶入）：所有活動填過的餐點選項，同樣內容只列一次，
 * 最近用過的在前面，最多 MEAL_MENUS_MAX 個。回傳 { menus: [{ text, lastDate, dutyName, times }] }
 */
var MEAL_MENUS_MAX = 10;

function adminMealMenus_() {
  var byText = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) {
    if (d['有吃飯'] !== '是' || !d['餐點選項']) return;
    var text = normalizeMealOptions_(d['餐點選項']).text;
    if (!text) return;
    var m = byText[text] || (byText[text] = { text: text, lastDate: '', dutyName: '', times: 0 });
    m.times++;
    if (String(d['開始日']) >= m.lastDate) { m.lastDate = String(d['開始日']); m.dutyName = d['名稱']; }
  });
  var menus = Object.keys(byText).map(function (k) { return byText[k]; });
  menus.sort(function (a, b) { return a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0; });
  return { menus: menus.slice(0, MEAL_MENUS_MAX) };
}

/** 標籤用（兩種點餐方式）：選項「素便當・紅茶」；自己點「素便當×2・紅茶」 */
function mealLabelOf_(duty, value) {
  if (duty && duty['點餐方式'] === MEAL_SELF) {
    return parseMealOrder_(value).map(function (l) { return l.name + (l.qty > 1 ? '×' + l.qty : ''); }).join('・');
  }
  return mealLabel_(value);
}

/**
 * 轉帳後補餐費末五碼（查我的報名）：body = { signupId, last5 }。訂餐截止後也可以補，活動當天以前都行。
 */
function mealSetLast5_(body) {
  var last5 = String(body.last5 || '').trim();
  if (!/^\d{5}$/.test(last5)) throw new ApiError_('VALIDATION', '轉帳末五碼要是 5 個數字');
  return withSignupLock_(function () {
    var row = findActiveSignup_(readTable_(SHEETS.SIGNUPS), body.signupId);
    if (row['吃飯'] !== '是' || !Number(row['餐費'])) throw new ApiError_('BAD_REQUEST', '這筆報名沒有餐費');
    updateRow_(SHEETS.SIGNUPS, row, { '餐費付款': '轉帳', '餐費末五碼': last5, '更新時間': nowString_() });
    writeDutyLog_('餐費補末五碼', row['姓名'] + '｜' + row['日期'] + '｜末五碼 ' + last5);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { last5: last5 };
  });
}

/**
 * 某一天的訂餐整理（後台名單上方、訂餐統計頁共用）：同一個人同一天報好幾項只算第一筆。
 * 回傳 { total（人數）, items: [{ name, qty }]（同名合在一起，份數多的在前）, fee, paid, unpaid, notes: [{ name, note }],
 *        people: [{ signupId, name, label, fee, pay, last5, paid, note }] }
 */
function mealSummary_(duty, signups, date) {
  var seen = {};
  var items = {};
  var order = [];
  var out = { total: 0, items: [], fee: 0, paid: 0, unpaid: 0, notes: [], people: [] };
  var self = duty['點餐方式'] === MEAL_SELF;
  var groups = self ? [] : parseMealOptions_(duty['餐點選項']);
  function add(name, qty) {
    if (!items[name]) { items[name] = 0; order.push(name); }
    items[name] += qty;
  }
  signups.forEach(function (s) {
    if (s['日期'] !== date || s['狀態'] === '已取消' || s['吃飯'] !== '是') return;
    var key = normalizeName_(s['姓名']) + '|' + (s['佛堂'] || '');
    if (seen[key]) return;
    seen[key] = true;
    out.total++;
    if (self) parseMealOrder_(s['餐點']).forEach(function (l) { add(l.name, l.qty); });
    else {
      var c = parseMealChoice_(s['餐點']);
      groups.forEach(function (g) { if (c[g.name]) add(groups.length > 1 ? g.name + '・' + c[g.name] : c[g.name], 1); });
    }
    var fee = Number(s['餐費']) || 0;
    var paid = s['餐費已付'] === '是';
    out.fee += fee;
    if (fee) { if (paid) out.paid += fee; else out.unpaid += fee; }
    if (s['餐點備註']) out.notes.push({ name: s['姓名'], note: s['餐點備註'] });
    out.people.push({
      signupId: s['報名ID'], name: s['姓名'], label: mealLabelOf_(duty, s['餐點']), fee: fee,
      pay: s['餐費付款'] || '', last5: s['餐費末五碼'] || '', paid: paid, note: s['餐點備註'] || ''
    });
  });
  out.items = order.map(function (n) { return { name: n, qty: items[n] }; })
    .sort(function (a, b) { return b.qty - a.qty; });
  return out;
}

/**
 * 後台「🍱 訂餐統計」：body = { dutyId?, date? }
 * 回傳 { events: [{ dutyId, date, name, count }]（有吃飯的活動，30 天前到 90 天後，近的在前）,
 *        selected: { dutyId, date, name, mode, deadline, open, menuUrl, ...mealSummary_ } | null }
 * 沒指定就選今天以後最近的一場（沒有就最近過去的那場）。
 */
var MEAL_ORDERS_PAST_DAYS = 30;
var MEAL_ORDERS_AHEAD_DAYS = 90;

function adminMealOrders_(body) {
  body = body || {};
  var today = todayString_();
  var from = shiftDateStr_(today, -MEAL_ORDERS_PAST_DAYS);
  var to = shiftDateStr_(today, MEAL_ORDERS_AHEAD_DAYS);
  var duties = readTableCached_(SHEETS.DUTIES).filter(function (d) { return d['有吃飯'] === '是'; });
  var signups = readTable_(SHEETS.SIGNUPS);
  var byDuty = {};
  signups.forEach(function (s) { (byDuty[s['勤務ID']] = byDuty[s['勤務ID']] || []).push(s); });
  var events = [];
  duties.forEach(function (d) {
    datesInRange_(String(d['開始日']), String(d['結束日'] || d['開始日'])).forEach(function (date) {
      if (date < from || date > to) return;
      var count = mealSummary_(d, byDuty[d['勤務ID']] || [], date).total;
      events.push({ dutyId: d['勤務ID'], date: date, name: d['名稱'], count: count });
    });
  });
  events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  var pick = events.filter(function (e) { return e.dutyId === body.dutyId && e.date === body.date; })[0]
    || events.filter(function (e) { return e.date >= today; })[0]
    || events[events.length - 1] || null;
  var selected = null;
  if (pick) {
    var duty = duties.filter(function (d) { return d['勤務ID'] === pick.dutyId; })[0];
    selected = mealSummary_(duty, byDuty[pick.dutyId] || [], pick.date);
    selected.dutyId = pick.dutyId;
    selected.date = pick.date;
    selected.name = duty['名稱'];
    selected.mode = duty['點餐方式'] === MEAL_SELF ? MEAL_SELF : '選項';
    selected.deadline = mealDeadline_(duty, pick.date);
    selected.open = mealOpen_(duty, pick.date, nowString_());
    selected.menuUrl = duty['菜單連結'] || '';
  }
  // 近的在前：今天以後的照日期，過去的接在後面（新的在前）
  var future = events.filter(function (e) { return e.date >= today; });
  var past = events.filter(function (e) { return e.date < today; }).reverse();
  return { events: future.concat(past), selected: selected };
}

/** 後台勾「已付款」：body = { signupId, paid } */
function adminMealPaid_(body) {
  return withSignupLock_(function () {
    var row = findActiveSignup_(readTable_(SHEETS.SIGNUPS), body.signupId);
    var paid = body.paid === true || body.paid === 'true';
    updateRow_(SHEETS.SIGNUPS, row, { '餐費已付': paid ? '是' : '', '更新時間': nowString_() });
    writeDutyLog_(paid ? '餐費已付' : '餐費改未付', row['姓名'] + '｜' + row['日期'] + '｜' + (row['餐費'] || 0) + ' 元' + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { signupId: row['報名ID'], paid: paid };
  });
}

/** 'yyyy-MM-dd' 加減幾天 */
function shiftDateStr_(date, days) {
  var t = new Date(String(date) + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
