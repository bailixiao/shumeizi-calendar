/**
 * 植素園記帳（規格 0.6「記帳」＋「改成 115年簡易記帳表格 的樣子」）：
 *   - 「收支記帳」分頁一列＝一筆：日期、類型、帳戶、科目（類別）、金額、摘要（備註）、收據照片、來源、批次ID。
 *     類型＝收入／支出（金額正數，照帳戶算增減）、移轉／期初（金額＝這個帳戶的增減，可以負的）。
 *   - 帳戶：零用金、銀行存款、應收帳款（資產：收入加、支出減）；應付帳款（負債：支出加＝欠更多）。舊資料沒有帳戶＝零用金。
 *   - 年度帳本：(1)～(4) 各帳戶流水帳與餘額、(5) 分類帳、(6) 資產負債表、(7) 損益表（存貨用進銷存報表）。
 *   - 自動記帳（來源）：團購訂單付款／取貨（O:訂單ID:paid、O:訂單ID:due）、出攤現場銷售（S:活動ID）、商品增加的買進（K:批次ID）。
 */

var LEDGER_TYPES = ['收入', '支出'];
var LEDGER_ACCOUNTS = ['零用金', '銀行存款', '應收帳款', '應付帳款'];
var LEDGER_CASH = ['零用金', '銀行存款']; // 可以付錢、收錢的
var LEDGER_SUBJECTS = {
  收入: ['銷貨收入', '隨喜收入'],
  其他收入: ['利息收入', '其他收入'],
  成本: ['進貨'],
  費用: ['飲品耗材', '文具費用', '手續費', '關懷費用', '餐飲費', '攤位費', '包材', '運費'],
  其他損失: ['其他損失']
};
var LEDGER_OTHER_INCOME = ['利息收入', '其他收入', '利息']; // 舊資料的「利息」也算其他收入
var LEDGER_TRANSFERS = { 存提款: '存提款', 收回應收: '收回應收', 付清應付: '付清應付' };
var LEDGER_MAX_AMOUNT = 9999999;
// 舊版的預設類別（還是可以選，照類型歸到收入或費用）
var LEDGER_CATEGORIES = { 支出: LEDGER_SUBJECTS.成本.concat(LEDGER_SUBJECTS.費用, LEDGER_SUBJECTS.其他損失), 收入: LEDGER_SUBJECTS.收入.concat(LEDGER_SUBJECTS.其他收入) };

function ledgerAccount_(r) {
  return LEDGER_ACCOUNTS.indexOf(r['帳戶']) !== -1 ? r['帳戶'] : '零用金';
}

/** 這一筆讓帳戶餘額增減多少 */
function ledgerEffect_(r) {
  var a = Number(r['金額']) || 0;
  var debt = ledgerAccount_(r) === '應付帳款';
  if (r['類型'] === '收入') return debt ? -a : a;
  if (r['類型'] === '支出') return debt ? a : -a;
  return a; // 移轉、期初
}

/** 損益表的哪一段：收入／其他收入／成本／費用／其他損失（移轉、期初＝null） */
function ledgerSection_(type, category) {
  if (type === '收入') return LEDGER_OTHER_INCOME.indexOf(category) !== -1 ? '其他收入' : '收入';
  if (type === '支出') return category === '進貨' ? '成本' : category === '其他損失' ? '其他損失' : '費用';
  return null;
}

function ledgerOut_(r) {
  return {
    id: r['紀錄ID'], date: r['日期'], type: r['類型'], account: ledgerAccount_(r), category: r['類別'], amount: Number(r['金額']) || 0,
    effect: ledgerEffect_(r), section: ledgerSection_(r['類型'], r['類別']),
    note: r['備註'] || '', receipt: r['收據'] || '', by: r['建立者'] || '', createdAt: r['建立時間'], updatedAt: r['更新時間'],
    source: r['來源'] || '', batch: r['批次ID'] || '', auto: !!r['來源']
  };
}

function ledgerSort_(a, b) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
}

/**
 * 年度帳本（純函式，方便測試）：rows＝收支記帳的列，rep＝進銷存報表（那一年），year＝西元年。
 */
function ledgerBook_(rows, rep, year) {
  var from = year + '-01-01';
  var to = year + '-12-31';
  var all = rows.filter(function (r) { return r['紀錄ID']; }).map(ledgerOut_);
  var accounts = LEDGER_ACCOUNTS.map(function (name) {
    var mine = all.filter(function (e) { return e.account === name; });
    var opening = mine.filter(function (e) { return e.date < from || (e.type === '期初' && e.date <= to); })
      .reduce(function (n, e) { return n + e.effect; }, 0);
    var openRows = mine.filter(function (e) { return e.type === '期初' && e.date >= from && e.date <= to; });
    var bal = opening;
    var entries = mine.filter(function (e) { return e.type !== '期初' && e.date >= from && e.date <= to; }).sort(ledgerSort_)
      .map(function (e) { bal += e.effect; return Object.assign({ balance: bal }, e); });
    return { name: name, opening: opening, openingSet: openRows.length ? openRows[0].amount : null, entries: entries, closing: bal };
  });
  // (5) 分類帳：收入、成本、支出（費用、其他收入、其他損失）照科目分組
  var inYear = all.filter(function (e) { return e.section && e.date >= from && e.date <= to; }).sort(ledgerSort_);
  var order = ['收入', '其他收入', '成本', '費用', '其他損失'];
  var groups = [];
  order.forEach(function (sec) {
    var subjects = [];
    LEDGER_SUBJECTS[sec].forEach(function (s) { subjects.push(s); });
    inYear.forEach(function (e) { if (e.section === sec && subjects.indexOf(e.category) === -1) subjects.push(e.category); });
    subjects.forEach(function (s) {
      var list = inYear.filter(function (e) { return e.section === sec && e.category === s; });
      groups.push({ section: sec, subject: s, entries: list, total: list.reduce(function (n, e) { return n + e.amount; }, 0) });
    });
  });
  var secTotal = function (sec) { return groups.filter(function (g) { return g.section === sec; }).reduce(function (n, g) { return n + g.total; }, 0); };
  var lines = function (sec) { return groups.filter(function (g) { return g.section === sec && (g.total || LEDGER_SUBJECTS[sec].indexOf(g.subject) !== -1); }).map(function (g) { return { subject: g.subject, amount: g.total }; }); };
  // (7) 損益表：存貨用進銷存報表
  var openInv = rep.total.open.amount;
  var closeInv = rep.total.end.amount;
  var purchases = secTotal('成本');
  var income = secTotal('收入');
  var cogs = openInv + purchases - closeInv;
  var expense = secTotal('費用');
  var other = secTotal('其他收入') - secTotal('其他損失');
  var profit = income - cogs - expense + other;
  var is = {
    income: lines('收入'), incomeTotal: income,
    openInv: openInv, purchases: purchases, closeInv: closeInv, cogs: cogs, stockBuy: rep.total.buy.amount, // stockBuy：進銷存的本期進貨（對帳用）
    expenses: lines('費用'), expenseTotal: expense,
    others: lines('其他收入').concat(lines('其他損失').map(function (l) { return { subject: l.subject, amount: -l.amount }; })), otherTotal: other,
    profit: profit
  };
  // (6) 資產負債表（年底）
  var acc = function (n) { return accounts.filter(function (a) { return a.name === n; })[0]; };
  var assets = [
    { name: '零用金', amount: acc('零用金').closing }, { name: '銀行存款', amount: acc('銀行存款').closing },
    { name: '存貨', amount: closeInv }, { name: '應收帳款', amount: acc('應收帳款').closing }
  ];
  var assetTotal = assets.reduce(function (n, a) { return n + a.amount; }, 0);
  var debt = acc('應付帳款').closing;
  var retained = acc('零用金').opening + acc('銀行存款').opening + acc('應收帳款').opening + openInv - acc('應付帳款').opening;
  var bs = {
    date: to, assets: assets, assetTotal: assetTotal, liabilities: [{ name: '應付帳款', amount: debt }], liabilityTotal: debt,
    retained: retained, profit: profit, equityTotal: retained + profit, rightTotal: debt + retained + profit,
    diff: assetTotal - (debt + retained + profit)
  };
  return { year: year, from: from, to: to, accounts: accounts, ledger: groups.filter(function (g) { return g.entries.length; }), is: is, bs: bs };
}

/** body = { year }（西元，空白＝今年） */
function adminShopLedger_(body) {
  var today = todayString_();
  var thisYear = Number(today.slice(0, 4));
  var year = body.year ? Number(body.year) : thisYear;
  if (!(year >= 2000 && year <= thisYear + 1)) throw new ApiError_('BAD_REQUEST', '年度不對');
  var rows = readTable_(SHEETS.SHOP_LEDGER);
  var rep = stockReport_(readTable_(SHEETS.SHOP_STOCK), readTable_(SHEETS.SHOP_PRODUCTS), year + '-01-01', year + '-12-31');
  var book = ledgerBook_(rows, rep, year);
  // 科目選單：預設的＋用過的
  var used = { 收入: LEDGER_CATEGORIES.收入.slice(), 支出: LEDGER_CATEGORIES.支出.slice() };
  rows.forEach(function (r) { var t = used[r['類型']]; if (t && r['類別'] && t.indexOf(r['類別']) === -1) t.push(r['類別']); });
  var first = rows.reduce(function (y, r) { var v = Number(String(r['日期'] || '').slice(0, 4)); return v && v < y ? v : y; }, thisYear);
  var years = [];
  for (var y = thisYear; y >= first; y--) years.push(y);
  return Object.assign(book, { today: today, categoryOptions: used, accountOptions: LEDGER_ACCOUNTS, years: years });
}

function ledgerCheckDate_(v, errors) {
  var today = todayString_();
  var date = v ? stockParseDate_(v) : today;
  if (!date) errors.push('日期不對');
  else if (date > today) errors.push('日期不能是以後');
  return date;
}

function ledgerCheckAmount_(v, errors) {
  var amount = shopInt_(v);
  if (!amount) errors.push('金額請填 1 以上的整數（元）');
  else if (amount > LEDGER_MAX_AMOUNT) errors.push('金額太大');
  return amount;
}

function ledgerDone_(log, before) {
  writeDutyLog_('記帳', log + adminTag_(), before);
  SpreadsheetApp.flush();
  invalidateTable_(SHEETS.SHOP_LEDGER);
}

/** body = { entry: { id?, date, type, account, category, amount, note, receipt } }：新增或修改一筆（自動記的只能改帳戶、摘要、收據） */
function adminShopLedgerSave_(body) {
  var e = body.entry || {};
  var errors = [];
  var account = e.account || '零用金';
  if (LEDGER_ACCOUNTS.indexOf(account) === -1) errors.push('請選帳戶');
  var receipt = String(e.receipt || '').trim();
  if (receipt && !/^F-[\w-]+$/.test(receipt)) errors.push('收據照片不對，請重新上傳');
  if (cleanText_(e.note).length > 200) errors.push('摘要太長（最多 200 字）');
  var old = e.id ? findById_(readTable_(SHEETS.SHOP_LEDGER), '紀錄ID', e.id) : null;
  if (e.id && !old) throw new ApiError_('NOT_FOUND', '找不到這筆，可能已經刪掉了');
  var values;
  if (old && (old['來源'] || old['類型'] === '移轉' || old['類型'] === '期初')) {
    // 自動記的、移轉、期初：只改帳戶（自動記的）、摘要、收據
    if (old['類型'] === '收入' && account === '應付帳款') errors.push('應付帳款不能記收入');
    if (old['類型'] === '支出' && account === '應收帳款') errors.push('應收帳款不能記支出');
    values = { '備註': cleanText_(e.note), '收據': receipt };
    if (old['來源']) values['帳戶'] = account;
  } else {
    var date = ledgerCheckDate_(e.date, errors);
    var amount = ledgerCheckAmount_(e.amount, errors);
    var category = cleanText_(e.category);
    if (LEDGER_TYPES.indexOf(e.type) === -1) errors.push('請選收入或支出');
    if (!category) errors.push('請選或填科目');
    if (category.length > 20) errors.push('科目太長（最多 20 字）');
    if (e.type === '收入' && account === '應付帳款') errors.push('應付帳款不能記收入（收錢請選零用金或銀行存款）');
    if (e.type === '支出' && account === '應收帳款') errors.push('應收帳款不能記支出（付錢請選零用金、銀行存款，還沒付選應付帳款）');
    values = { '日期': date, '類型': e.type, '帳戶': account, '類別': category, '金額': String(amount), '備註': cleanText_(e.note), '收據': receipt };
  }
  if (errors.length) throw new ApiError_('VALIDATION', '沒有存檔', errors.map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var now = nowString_();
    values['更新時間'] = now;
    var row;
    if (old) {
      row = findById_(readTable_(SHEETS.SHOP_LEDGER), '紀錄ID', e.id);
      var before = rowSnapshot_(SHEETS.SHOP_LEDGER, row);
      updateRow_(SHEETS.SHOP_LEDGER, row, values);
      ledgerDone_('修改｜' + row['日期'] + ' ' + ledgerAccount_(row) + ' ' + row['類型'] + ' ' + row['類別'] + ' ' + row['金額'] + ' 元', before);
    } else {
      row = Object.assign({ '紀錄ID': newId_('L'), '建立者': ADMIN_SESSION_ ? ADMIN_SESSION_.account : '', '建立時間': now }, values);
      appendRows_(SHEETS.SHOP_LEDGER, [row]);
      ledgerDone_(row['日期'] + ' ' + account + ' ' + row['類型'] + ' ' + row['類別'] + ' ' + row['金額'] + ' 元');
    }
    return { entry: ledgerOut_(row) };
  });
}

/**
 * 移轉（不算損益）：body = { kind: 存提款／收回應收／付清應付, from, to, date, amount, note }
 *   存提款：from（零用金或銀行）減、to（另一個）加；收回應收：應收減、to 加；付清應付：應付減、from 減。
 */
function adminShopLedgerTransfer_(body) {
  var errors = [];
  var kind = LEDGER_TRANSFERS[body.kind];
  if (!kind) errors.push('請選要做什麼（存提款、收回應收、付清應付）');
  var date = ledgerCheckDate_(body.date, errors);
  var amount = ledgerCheckAmount_(body.amount, errors);
  var cash = kind === '存提款' ? body.from : kind === '收回應收' ? body.to : body.from;
  if (LEDGER_CASH.indexOf(cash) === -1) errors.push('請選零用金或銀行存款');
  if (kind === '存提款' && LEDGER_CASH.indexOf(body.to) === -1) errors.push('請選存到哪裡');
  if (kind === '存提款' && body.from === body.to) errors.push('從哪裡和存到哪裡不能一樣');
  if (cleanText_(body.note).length > 200) errors.push('摘要太長（最多 200 字）');
  if (errors.length) throw new ApiError_('VALIDATION', '沒有存檔', errors.map(function (m) { return { message: m }; }));
  var pair = kind === '存提款' ? [[body.from, -amount], [body.to, amount]]
    : kind === '收回應收' ? [['應收帳款', -amount], [body.to, amount]]
      : [['應付帳款', -amount], [body.from, -amount]];
  return withSignupLock_(function () {
    var now = nowString_();
    var batch = newId_('LT');
    var who = ADMIN_SESSION_ ? ADMIN_SESSION_.account : '';
    appendRows_(SHEETS.SHOP_LEDGER, pair.map(function (p) {
      return { '紀錄ID': newId_('L'), '日期': date, '類型': '移轉', '帳戶': p[0], '類別': kind, '金額': String(p[1]), '備註': cleanText_(body.note), '收據': '',
        '建立者': who, '建立時間': now, '更新時間': now, '批次ID': batch };
    }));
    ledgerDone_(date + ' ' + kind + ' ' + pair.map(function (p) { return p[0] + (p[1] > 0 ? '+' : '') + p[1]; }).join('、'));
    return { batch: batch };
  });
}

/** 期初餘額：body = { year, balances: { 零用金: n, 銀行存款: n, ... } }（空白＝拿掉）；記成那一年 1/1 的「期初」 */
function adminShopLedgerOpening_(body) {
  var year = Number(body.year);
  var errors = [];
  if (!(year >= 2000 && year <= Number(todayString_().slice(0, 4)) + 1)) errors.push('年度不對');
  var bal = body.balances || {};
  var clean = {};
  LEDGER_ACCOUNTS.forEach(function (a) {
    var v = bal[a];
    if (v === '' || v === undefined || v === null) { clean[a] = null; return; }
    if (!/^-?\d{1,7}$/.test(String(v).trim())) errors.push(a + '的期初餘額請填整數');
    else clean[a] = Number(String(v).trim());
  });
  if (errors.length) throw new ApiError_('VALIDATION', '沒有存檔', errors.map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var date = year + '-01-01';
    var now = nowString_();
    var rows = readTable_(SHEETS.SHOP_LEDGER);
    var del = [];
    var add = [];
    LEDGER_ACCOUNTS.forEach(function (a) {
      var row = rows.filter(function (r) { return r['類型'] === '期初' && ledgerAccount_(r) === a && r['日期'] === date; })[0];
      if (clean[a] === null || clean[a] === 0) { if (row) del.push(row); return; }
      if (row) updateRow_(SHEETS.SHOP_LEDGER, row, { '金額': String(clean[a]), '更新時間': now });
      else add.push({ '紀錄ID': newId_('L'), '日期': date, '類型': '期初', '帳戶': a, '類別': '期初餘額', '金額': String(clean[a]), '備註': '',
        '收據': '', '建立者': ADMIN_SESSION_ ? ADMIN_SESSION_.account : '', '建立時間': now, '更新時間': now });
    });
    ledgerDeleteRows_(del);
    if (add.length) appendRows_(SHEETS.SHOP_LEDGER, add);
    ledgerDone_(year + ' 年期初餘額｜' + LEDGER_ACCOUNTS.map(function (a) { return a + ' ' + (clean[a] || 0); }).join('、'));
    return { saved: true };
  });
}

/** 刪掉幾列（從下面刪，列號才不會跑掉） */
function ledgerDeleteRows_(rows) {
  rows.slice().sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { getSheet_(SHEETS.SHOP_LEDGER).deleteRow(r._row); });
}

/** body = { id }：自動記的不能刪；移轉兩筆一起刪 */
function adminShopLedgerDelete_(body) {
  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.SHOP_LEDGER);
    var r = findById_(rows, '紀錄ID', body.id);
    if (!r) throw new ApiError_('NOT_FOUND', '找不到這筆，可能已經刪掉了');
    if (r['來源']) throw new ApiError_('FORBIDDEN', '這筆是自動記的（團購訂單、出攤、進貨），請到原本的地方改');
    var list = r['批次ID'] ? rows.filter(function (x) { return x['批次ID'] === r['批次ID']; }) : [r];
    var before = rowSnapshot_(SHEETS.SHOP_LEDGER, r);
    ledgerDeleteRows_(list);
    ledgerDone_('刪除｜' + r['日期'] + ' ' + ledgerAccount_(r) + ' ' + r['類型'] + ' ' + r['類別'] + ' ' + r['金額'] + ' 元' + (list.length > 1 ? '（移轉兩筆）' : ''), before);
    return { deleted: true };
  });
}

// ---------- 自動記帳（在鎖裡面呼叫） ----------

/**
 * 讓「來源＝source」的那一筆變成 want（null 或金額 0＝拿掉）。已經有的：保留日期和帳戶（可能被改過），更新金額、科目。
 * want = { date, type, account, category, amount, note }
 */
function ledgerUpsertAuto_(source, want) {
  var rows = readTable_(SHEETS.SHOP_LEDGER).filter(function (r) { return r['來源'] === source; });
  if (!want || !want.amount) {
    if (rows.length) { ledgerDeleteRows_(rows); invalidateTable_(SHEETS.SHOP_LEDGER); }
    return;
  }
  var now = nowString_();
  if (rows.length) {
    var r = rows[0];
    var ch = { '金額': String(want.amount), '類型': want.type, '類別': want.category, '更新時間': now };
    if (want.account === '應收帳款' || ledgerAccount_(r) === '應收帳款') ch['帳戶'] = want.account; // 應收和現金不能互換時保留
    if (want.type === '收入' && ledgerAccount_(r) === '應付帳款') ch['帳戶'] = want.account;
    if (Object.keys(ch).some(function (k) { return k !== '更新時間' && String(r[k] || '') !== String(ch[k]); })) updateRow_(SHEETS.SHOP_LEDGER, r, ch);
    if (rows.length > 1) ledgerDeleteRows_(rows.slice(1));
  } else {
    appendRows_(SHEETS.SHOP_LEDGER, [{ '紀錄ID': newId_('L'), '日期': want.date, '類型': want.type, '帳戶': want.account, '類別': want.category,
      '金額': String(want.amount), '備註': want.note || '', '收據': '', '建立者': '自動', '建立時間': now, '更新時間': now, '來源': source }]);
  }
  invalidateTable_(SHEETS.SHOP_LEDGER);
}

/** 團購訂單：已付款＝現金（付現零用金、轉帳銀行）的銷貨收入；已取貨還沒付＝應收帳款 */
function ledgerSyncOrder_(o) {
  var active = o['狀態'] !== '已取消';
  var paid = active && o['已付款'] === '是';
  var due = active && !paid && o['已取貨'] === '是';
  var g = findById_(readTableCached_(SHEETS.SHOP_GROUPS), '團購ID', o['團購ID']);
  var note = '團購：' + o['姓名'] + (g ? '（' + g['名稱'] + '）' : '');
  var amount = Number(o['金額']) || 0;
  var today = todayString_();
  ledgerUpsertAuto_('O:' + o['訂單ID'] + ':paid', paid ? { date: today, type: '收入', account: o['付款方式'] === '轉帳' ? '銀行存款' : '零用金', category: '銷貨收入', amount: amount, note: note } : null);
  ledgerUpsertAuto_('O:' + o['訂單ID'] + ':due', due ? { date: today, type: '收入', account: '應收帳款', category: '銷貨收入', amount: amount, note: note + '（還沒付款）' } : null);
}

/** 出攤銷售統計表：那天現場賣的營業額→零用金的銷貨收入 */
function ledgerSyncStall_(dutyId, date, revenue, where) {
  ledgerUpsertAuto_('S:' + dutyId, { date: date, type: '收入', account: '零用金', category: '銷貨收入', amount: revenue, note: '出攤現場：' + where });
}

/** 商品增加的買進（一次送出的加起來）→ 進貨；account＝零用金／銀行存款／應付帳款（新增時用） */
function ledgerSyncStockBatch_(batch, account) {
  var rows = readTable_(SHEETS.SHOP_STOCK).filter(function (r) { return r['批次ID'] === batch && r['類型'] === '進' && r['方式'] === '買進'; });
  var amount = rows.reduce(function (n, r) { return n + stockAmount_(r); }, 0);
  var products = readTableCached_(SHEETS.SHOP_PRODUCTS);
  var names = rows.map(function (r) { var p = findById_(products, '商品ID', r['商品ID']); return p ? p['名稱'] : ''; }).filter(Boolean);
  var date = rows.length ? rows.map(stockDate_).sort()[0] : todayString_();
  ledgerUpsertAuto_('K:' + batch, rows.length ? { date: date, type: '支出', account: LEDGER_ACCOUNTS.indexOf(account) !== -1 && account !== '應收帳款' ? account : '零用金', category: '進貨', amount: amount,
    note: '進貨：' + names.slice(0, 5).join('、') + (names.length > 5 ? ' 等 ' + names.length + ' 樣' : '') } : null);
}
