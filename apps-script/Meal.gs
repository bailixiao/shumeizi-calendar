/**
 * 吃飯的餐點選項（書槑子，規格第 0.5 節）。
 *   - 勤務「餐點選項」：一行一組「組名：選項、選項」（沒寫組名＝餐點）；最多 5 組、每組 10 個選項。
 *   - 報名「餐點」：每組選一個，存成「主餐：素便當；飲料：紅茶」；「餐點備註」選填，最多 50 字。
 *   - 各人選什麼只給後台看；大家看到的活動頁只有吃飯人數。
 */

var MEAL_MAX_GROUPS = 5;
var MEAL_MAX_OPTIONS = 10;
var MEAL_NOTE_MAX = 50;

/** 去掉存檔用的分隔符號（：；）與換行 */
function mealWord_(s) {
  return cleanText_(s).replace(/[：:；;\r\n]+/g, ' ').replace(/\s+/g, ' ').slice(0, 20);
}

/** 「勤務」餐點選項原文 → [{ name, options: [..] }]（格式不對的行略過） */
function parseMealOptions_(text) {
  var groups = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    line = cleanText_(line);
    if (!line) return;
    var m = line.match(/^([^：:]*)[：:](.*)$/);
    var name = mealWord_(m ? m[1] : '') || '餐點';
    var options = [];
    (m ? m[2] : line).split(/[、,，\/／]/).forEach(function (o) {
      o = mealWord_(o);
      if (o && options.indexOf(o) === -1) options.push(o);
    });
    if (!options.length || groups.some(function (g) { return g.name === name; })) return;
    groups.push({ name: name, options: options.slice(0, MEAL_MAX_OPTIONS) });
  });
  return groups.slice(0, MEAL_MAX_GROUPS);
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
    text: groups.map(function (g) { return g.name + '：' + g.options.join('、'); }).join('\n'),
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
 * 報名一個人的吃飯欄位：{ '吃飯', '餐點', '餐點備註' } 或 { error }。
 * e = { meal, mealChoice: { 組名: 選項 }, mealNote }；活動沒開吃飯就全部空白。
 */
function mealFields_(duty, e) {
  if (duty['有吃飯'] !== '是' || !e || !e.meal) return { '吃飯': '', '餐點': '', '餐點備註': '' };
  var c = mealChoiceValue_(parseMealOptions_(duty['餐點選項']), e.mealChoice);
  if (c.error) return { error: c.error };
  return { '吃飯': '是', '餐點': c.value, '餐點備註': cleanMealNote_(e.mealNote) };
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
    var f = mealFields_(duty, { meal: !!body.meal, mealChoice: body.mealChoice, mealNote: body.mealNote });
    if (f.error) throw new ApiError_('VALIDATION', f.error);
    var before = rowSnapshot_(SHEETS.SIGNUPS, row);
    var now = nowString_();
    f['更新時間'] = now;
    updateRow_(SHEETS.SIGNUPS, row, f);
    appendRows_(SHEETS.LOGS, [{
      '時間': now,
      '動作': '改吃飯',
      '報名ID': row['報名ID'],
      '內容摘要': [row['姓名'] + (f['吃飯'] ? '🍱' + (f['餐點'] ? mealLabel_(f['餐點']) : '') : '（不吃）'), row['日期'], duty['名稱']].join('｜') + (opts.admin ? adminTag_() : ''),
      '還原用的前一版資料': JSON.stringify(before)
    }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { signupId: row['報名ID'], meal: f['吃飯'] === '是', mealChoice: parseMealChoice_(f['餐點']), mealNote: f['餐點備註'] };
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
