/**
 * 植素園記帳（規格 0.6「記帳」）：跟商品無關的收入、支出（攤位費、包材、印刷、運費；佈施、利息⋯）。
 *   - 「收支記帳」分頁一列＝一筆：日期、類型（收入／支出）、類別、金額、備註、收據照片。
 *   - 收支表：選期間，收入、支出、各類別小計；加上同期間進銷存的毛利，淨利＝毛利＋收入－支出。
 */

var LEDGER_TYPES = ['收入', '支出'];
var LEDGER_CATEGORIES = { 支出: ['攤位費', '包材', '印刷文具', '運費', '其他支出'], 收入: ['佈施', '利息', '其他收入'] };
var LEDGER_MAX_AMOUNT = 9999999;

function ledgerOut_(r) {
  return {
    id: r['紀錄ID'], date: r['日期'], type: r['類型'], category: r['類別'], amount: Number(r['金額']) || 0,
    note: r['備註'] || '', receipt: r['收據'] || '', by: r['建立者'] || '', createdAt: r['建立時間'], updatedAt: r['更新時間']
  };
}

/** body = { from, to }（空白＝這個月 1 號到今天） */
function adminShopLedger_(body) {
  var today = todayString_();
  var from = body.from ? stockParseDate_(body.from) : today.slice(0, 8) + '01';
  var to = body.to ? stockParseDate_(body.to) : today;
  if (!from || !to) throw new ApiError_('BAD_REQUEST', '日期不對');
  if (from > to) throw new ApiError_('BAD_REQUEST', '開始日期要在結束日期之前');
  var all = readTable_(SHEETS.SHOP_LEDGER);
  var list = all.filter(function (r) { return r['日期'] >= from && r['日期'] <= to; }).map(ledgerOut_)
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1); });
  var sum = { 收入: 0, 支出: 0 };
  var byCat = {};
  list.forEach(function (e) {
    sum[e.type] = (sum[e.type] || 0) + e.amount;
    var k = e.type + '|' + e.category;
    byCat[k] = (byCat[k] || 0) + e.amount;
  });
  var cats = Object.keys(byCat).map(function (k) { var p = k.split('|'); return { type: p[0], category: p[1], amount: byCat[k] }; })
    .sort(function (a, b) { return a.type === b.type ? b.amount - a.amount : a.type === '收入' ? -1 : 1; });
  // 同期間的毛利（進銷存報表）
  var rep = stockReport_(readTable_(SHEETS.SHOP_STOCK), readTable_(SHEETS.SHOP_PRODUCTS), from, to);
  // 類別選單：預設的＋用過的
  var used = { 收入: LEDGER_CATEGORIES.收入.slice(), 支出: LEDGER_CATEGORIES.支出.slice() };
  all.forEach(function (r) { var t = used[r['類型']]; if (t && r['類別'] && t.indexOf(r['類別']) === -1) t.push(r['類別']); });
  return {
    from: from, to: to, today: today, entries: list, categories: cats, categoryOptions: used,
    income: sum.收入, expense: sum.支出, sales: rep.total.sale.amount, salesCost: rep.total.saleCost.amount, profit: rep.profit,
    net: rep.profit + sum.收入 - sum.支出
  };
}

/** body = { entry: { id?, date, type, category, amount, note, receipt } }：新增或修改一筆 */
function adminShopLedgerSave_(body) {
  var e = body.entry || {};
  var today = todayString_();
  var date = e.date ? stockParseDate_(e.date) : today;
  var amount = shopInt_(e.amount);
  var category = cleanText_(e.category);
  var errors = [];
  if (!date) errors.push('日期不對');
  else if (date > today) errors.push('日期不能是以後');
  if (LEDGER_TYPES.indexOf(e.type) === -1) errors.push('請選收入或支出');
  if (!category) errors.push('請選或填類別');
  if (category.length > 20) errors.push('類別太長（最多 20 字）');
  if (!amount) errors.push('金額請填 1 以上的整數（元）');
  else if (amount > LEDGER_MAX_AMOUNT) errors.push('金額太大');
  if (cleanText_(e.note).length > 200) errors.push('備註太長（最多 200 字）');
  var receipt = String(e.receipt || '').trim();
  if (receipt && !/^F-[\w-]+$/.test(receipt)) errors.push('收據照片不對，請重新上傳');
  if (errors.length) throw new ApiError_('VALIDATION', '沒有存檔', errors.map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var now = nowString_();
    var values = { '日期': date, '類型': e.type, '類別': category, '金額': String(amount), '備註': cleanText_(e.note), '收據': receipt, '更新時間': now };
    var row;
    if (e.id) {
      row = findById_(readTable_(SHEETS.SHOP_LEDGER), '紀錄ID', e.id);
      if (!row) throw new ApiError_('NOT_FOUND', '找不到這筆，可能已經刪掉了');
      var before = rowSnapshot_(SHEETS.SHOP_LEDGER, row);
      updateRow_(SHEETS.SHOP_LEDGER, row, values);
      writeDutyLog_('記帳', '修改｜' + date + ' ' + e.type + ' ' + category + ' ' + amount + ' 元' + adminTag_(), before);
    } else {
      row = Object.assign({ '紀錄ID': newId_('L'), '建立者': ADMIN_SESSION_ ? ADMIN_SESSION_.account : '', '建立時間': now }, values);
      appendRows_(SHEETS.SHOP_LEDGER, [row]);
      writeDutyLog_('記帳', date + ' ' + e.type + ' ' + category + ' ' + amount + ' 元' + adminTag_());
    }
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_LEDGER);
    return { entry: ledgerOut_(row) };
  });
}

/** body = { id } */
function adminShopLedgerDelete_(body) {
  return withSignupLock_(function () {
    var r = findById_(readTable_(SHEETS.SHOP_LEDGER), '紀錄ID', body.id);
    if (!r) throw new ApiError_('NOT_FOUND', '找不到這筆，可能已經刪掉了');
    var before = rowSnapshot_(SHEETS.SHOP_LEDGER, r);
    getSheet_(SHEETS.SHOP_LEDGER).deleteRow(r._row);
    writeDutyLog_('記帳', '刪除｜' + r['日期'] + ' ' + r['類型'] + ' ' + r['類別'] + ' ' + r['金額'] + ' 元' + adminTag_(), before);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_LEDGER);
    return { deleted: true };
  });
}
