/**
 * 年度結帳（規格 0.6「記帳會計系統：年度結算」段 3）。
 *   - Cloudflare 這邊：對帳檢查（訂單、庫存、盤點）、結帳鎖住（LEDGER_LOCKED_UNTIL＝yyyy-12-31：那一年以前的進出貨、訂單、出攤、記帳不能再動）。
 *   - Google 這邊（Apps Script 網頁應用程式，同步密鑰驗證；由 Cloudflare 呼叫）：讀試算表的帳戶餘額、資產負債表；
 *     結帳時寫「年度結算」頁（純數字）、保護整份、另存 Excel／PDF 到雲端硬碟「植素園記帳封存」、建立下一年那份並帶入期初餘額。
 */

var YEAR_ARCHIVE_FOLDER = '植素園記帳封存';
var YEAR_ARCHIVE_TAB = '年度結算';

// ---------- 鎖住（Cloudflare 這邊檢查） ----------

/** 結帳鎖到哪一天（'' ＝沒有） */
function ledgerLockedUntil_() {
  return PropertiesService.getScriptProperties().getProperty('LEDGER_LOCKED_UNTIL') || '';
}

/** 這個日期已經結帳了就擋下來 */
function ledgerLockCheck_(date, what) {
  var locked = ledgerLockedUntil_();
  var d = String(date || '').slice(0, 10);
  if (locked && d && d <= locked) {
    throw new ApiError_('LOCKED_YEAR', (Number(locked.slice(0, 4)) - 1911) + ' 年已經結帳，不能再改' + (what || '那一年的帳') + '（真的要改請總管理者先到「年度結帳」解除結帳）');
  }
}

// ---------- 對帳檢查（Cloudflare 這邊的資料） ----------

/** 這一年的對帳檢查（純讀取）：還沒付款／確認／取貨的訂單、庫存負的、盤點、結帳狀態 */
function yearCloseChecks_(year) {
  var from = year + '-01-01';
  var to = year + '-12-31';
  var groups = readTable_(SHEETS.SHOP_GROUPS);
  var orders = readTable_(SHEETS.SHOP_ORDERS).filter(function (o) {
    var d = String(o['建立時間'] || '').slice(0, 10);
    var g = findById_(groups, '團購ID', o['團購ID']);
    return o['狀態'] !== '已取消' && d >= from && d <= to && !(g && g['賣場連結']);
  });
  var brief = function (o) { var g = findById_(groups, '團購ID', o['團購ID']); return { id: o['訂單ID'], name: o['姓名'], group: g ? g['名稱'] : '', total: Number(o['金額']) || 0, pay: o['付款方式'] }; };
  var unpaid = orders.filter(function (o) { return o['已付款'] !== '是'; }).map(brief);
  var unconfirmed = orders.filter(function (o) { return o['已確認'] !== '是'; }).map(brief);
  var unpicked = orders.filter(function (o) { return o['已取貨'] !== '是'; }).map(brief);
  var records = readTable_(SHEETS.SHOP_STOCK);
  var products = readTable_(SHEETS.SHOP_PRODUCTS);
  var levels = stockLevels_(records.filter(function (r) { return stockDate_(r) <= to; }));
  var negative = [];
  products.forEach(function (p) {
    stockVariantNames_(p).concat(levels[p['商品ID']] && stockVariantNames_(p)[0] !== '' ? [''] : []).forEach(function (o) {
      var q = levels[stockKeyOf_(p['商品ID'], o)] || 0;
      if (q < 0) negative.push({ name: p['名稱'] + (o ? '（' + o + '）' : ''), qty: q });
    });
  });
  var counts = {};
  records.forEach(function (r) { var t = String(r['活動ID'] || ''); if (t.indexOf('COUNT:' + year) === 0) counts[t.slice(6)] = true; });
  var countDates = Object.keys(counts).sort();
  return {
    year: year, locked: ledgerLockedUntil_(),
    unpaid: { count: unpaid.length, amount: unpaid.reduce(function (n, o) { return n + o.total; }, 0), list: unpaid.slice(0, 30) },
    unconfirmed: { count: unconfirmed.length, list: unconfirmed.slice(0, 30) },
    unpicked: { count: unpicked.length, list: unpicked.slice(0, 30) },
    negative: negative,
    count: { dates: countDates, yearEnd: !!counts[to], last: countDates[countDates.length - 1] || '' }
  };
}

/** 結帳後鎖住／解除（Cloudflare 那邊的指令碼屬性）；寫操作紀錄 */
function yearCloseSetLock_(year, lock) {
  var props = PropertiesService.getScriptProperties();
  if (lock) props.setProperty('LEDGER_LOCKED_UNTIL', year + '-12-31');
  else if (year - 1 >= 2000 && ledgerLockedUntil_() >= year + '-12-31') props.setProperty('LEDGER_LOCKED_UNTIL', (year - 1) + '-12-31');
  writeDutyLog_('年度結帳', (Number(year) - 1911) + ' 年' + (lock ? '結帳（鎖住）' : '解除結帳') + adminTag_());
}

// ---------- Google 這邊（Apps Script 網頁應用程式） ----------

/** 網頁應用程式的動作（Code.gs doPost 先處理這幾個；同步密鑰驗證） */
var GAS_YEAR_ACTIONS = { yearCheck: 'yearCheckGas_', yearClose: 'yearCloseGas_', yearUnlock: 'yearUnlockGas_', yearTrial: 'yearTrialGas_' };

function gasKeyCheck_(body) {
  var key = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  if (!key || String(body.key || '') !== key) throw new ApiError_('UNAUTHORIZED', '同步密鑰不對');
}

/** 先把最新的資料同步過來，再打開那一年的試算表 */
function yearSheetFresh_(year) {
  syncFromWorkerLocked_();
  var id = ledgerSheetMap_()[year];
  if (!id) throw new ApiError_('NOT_FOUND', (year - 1911) + ' 年還沒有植素園記帳試算表');
  return SpreadsheetApp.openById(id);
}

/** 試算表上的帳戶期末餘額、資產負債表（讀公式算好的值） */
function yearSheetNumbers_(ss) {
  var num = function (sh, cell) { var s = ss.getSheetByName(sh); var v = s ? s.getRange(cell).getValue() : 0; return typeof v === 'number' ? Math.round(v * 100) / 100 : Number(v) || 0; };
  var balances = {};
  LS_ACCOUNT_TABS.forEach(function (t, i) { balances[LEDGER_ACCOUNTS[i]] = num(t, 'E2'); });
  return {
    balances: balances,
    bs: { assetTotal: num(LS.bs, 'B15'), rightTotal: num(LS.bs, 'D15'), diff: num(LS.bs, 'G15'), profit: num(LS.bs, 'D12'), inventory: num(LS.bs, 'B7') }
  };
}

/** body = { key, year }：對帳檢查要的試算表數字 */
function yearCheckGas_(body) {
  gasKeyCheck_(body);
  var year = Number(body.year);
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var ss = yearSheetFresh_(year);
    var out = yearSheetNumbers_(ss);
    out.url = ss.getUrl();
    out.start = ledgerSheetStart_(ss, year);
    return out;
  } finally {
    lock.releaseLock();
  }
}

/**
 * body = { key, year }：結帳。(1) 寫「年度結算」頁（損益表、資產負債表、進銷存報表的數字） (2) 保護整份
 * (3) 另存 Excel、PDF 到「植素園記帳封存」 (4) 建立／更新下一年那份：期初餘額＝這一年的期末餘額
 */
function yearCloseGas_(body) {
  gasKeyCheck_(body);
  var year = Number(body.year);
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var ss = yearSheetFresh_(year);
    var nums = yearSheetNumbers_(ss);
    var start = ledgerSheetStart_(ss, year);
    yearArchiveTab_(ss, year, start);
    SpreadsheetApp.flush();
    yearProtect_(ss, true);
    var files = yearExport_(ss, year);
    var next = yearNextSheet_(year + 1, nums.balances);
    PropertiesService.getScriptProperties().setProperty('LEDGER_LOCKED_UNTIL', year + '-12-31'); // 這一年不再寫系統記帳
    return { numbers: nums, archive: files, next: next, url: ss.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * body = { key, year }：🧪 試結帳。複製一份那一年的試算表，在複本寫「年度結算」頁、另存成「試算」的 Excel／PDF，複本丟到垃圾桶。
 * 原本那份不動、不鎖、不開下一年；回傳封存檔連結和「下一年會帶過去的期初餘額」。
 */
function yearTrialGas_(body) {
  gasKeyCheck_(body);
  var year = Number(body.year);
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var ss = yearSheetFresh_(year);
    var nums = yearSheetNumbers_(ss);
    var start = ledgerSheetStart_(ss, year);
    var copyFile = DriveApp.getFileById(ss.getId()).makeCopy(ledgerSheetTitle_(year) + '（試算）');
    try {
      var copy = SpreadsheetApp.openById(copyFile.getId());
      yearArchiveTab_(copy, year, start);
      SpreadsheetApp.flush();
      var files = yearExport_(copy, year, '試算');
    } finally {
      copyFile.setTrashed(true);
    }
    return { numbers: nums, archive: files, nextBalances: nums.balances, trial: true };
  } finally {
    lock.releaseLock();
  }
}

/** body = { key, year }：解除結帳（拿掉保護，之後同步會再寫系統記帳） */
function yearUnlockGas_(body) {
  gasKeyCheck_(body);
  var year = Number(body.year);
  var id = ledgerSheetMap_()[year];
  if (id) yearProtect_(SpreadsheetApp.openById(id), false);
  var props = PropertiesService.getScriptProperties();
  if ((props.getProperty('LEDGER_LOCKED_UNTIL') || '') >= year + '-12-31') props.setProperty('LEDGER_LOCKED_UNTIL', (year - 1) + '-12-31');
  return { unlocked: true };
}

/** 「年度結算」頁：純數字（不是公式），結帳那一刻的損益表、資產負債表、進銷存報表 */
function yearArchiveTab_(ss, year, start) {
  var old = ss.getSheetByName(YEAR_ARCHIVE_TAB);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(YEAR_ARCHIVE_TAB, 0);
  var blocks = [];
  var roc = year - 1911;
  blocks.push([['植素園 ' + roc + ' 年度結算（結帳時間 ' + nowString_() + '）']]);
  [LS.is, LS.bs].forEach(function (name) {
    var src = ss.getSheetByName(name);
    if (src) blocks.push([['']].concat(src.getDataRange().getDisplayValues()));
  });
  var rep = stockReport_(readTable_(SHEETS.SHOP_STOCK), readTable_(SHEETS.SHOP_PRODUCTS), start, year + '-12-31');
  var f2 = function (n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); };
  var f0 = function (n) { return String(Math.round(Number(n) || 0)); };
  var inv = [[''], ['進銷存報表（' + start + ' 至 ' + year + '-12-31，金額到個位數、單價到小數第二位）'],
    ['代號', '品項', '期初數量', '期初金額', '進貨數量', '進貨金額', '其他加數量', '其他加金額', '其他減數量', '其他減金額', '銷貨數量', '平均成本', '銷貨成本', '銷貨金額', '期末數量', '期末金額']];
  rep.rows.forEach(function (r) {
    inv.push([r.code, r.name, r.open.qty, f0(r.open.amount), r.buy.qty, f0(r.buy.amount), r.add.qty, f0(r.add.amount), r.sub.qty, f0(r.sub.amount), r.saleCost.qty, f2(r.saleCost.price), f0(r.saleCost.amount), f0(r.sale.amount), r.end.qty, f0(r.end.amount)]);
  });
  inv.push(['', '合計', rep.total.open.qty, f0(rep.total.open.amount), rep.total.buy.qty, f0(rep.total.buy.amount), rep.total.add.qty, f0(rep.total.add.amount), rep.total.sub.qty, f0(rep.total.sub.amount), rep.total.saleCost.qty, '', f0(rep.total.saleCost.amount), f0(rep.total.sale.amount), rep.total.end.qty, f0(rep.total.end.amount)]);
  inv.push(['', '毛利', f0(rep.profit)]);
  blocks.push(inv);
  var rows = [].concat.apply([], blocks);
  var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
  var padded = rows.map(function (r) { var c = r.slice(); while (c.length < width) c.push(''); return c; });
  sh.getRange(1, 1, padded.length, width).setNumberFormat('@').setValues(padded);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 180);
}

/** 保護整份（只有建立的人能改）；lock＝false 拿掉 */
function yearProtect_(ss, lock) {
  ss.getSheets().forEach(function (sh) {
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { if (p.getDescription() === '年度結帳') p.remove(); });
    if (!lock) return;
    var p = sh.protect().setDescription('年度結帳');
    p.removeEditors(p.getEditors());
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
}

/** 另存 Excel、PDF 到雲端硬碟「植素園記帳封存」；回傳 { folder, xlsx, pdf } 網址 */
function yearExport_(ss, year, tag) {
  var folders = DriveApp.getFoldersByName(YEAR_ARCHIVE_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(YEAR_ARCHIVE_FOLDER);
  var name = ledgerSheetTitle_(year) + '（' + (tag || '結帳') + ' ' + todayString_() + '）';
  var token = ScriptApp.getOAuthToken();
  var get = function (format, ext) {
    var resp = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=' + format, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new ApiError_('EXPORT', '另存 ' + ext + ' 失敗（' + resp.getResponseCode() + '）');
    return folder.createFile(resp.getBlob().setName(name + '.' + ext)).getUrl();
  };
  return { folder: folder.getUrl(), xlsx: get('xlsx', 'xlsx'), pdf: get('pdf', 'pdf') };
}

/** 下一年那份：沒有就建立；設定的開始記帳日＝1/1、各帳戶開始餘額＝這一年的期末餘額 */
function yearNextSheet_(year, balances) {
  var props = PropertiesService.getScriptProperties();
  var map = ledgerSheetMap_();
  var ss = null;
  if (map[year]) { try { ss = SpreadsheetApp.openById(map[year]); } catch (e) { ss = null; } }
  if (!ss) {
    ss = ledgerSheetCreate_(readTable_(SHEETS.SHOP_LEDGER), year);
    map[year] = ss.getId();
    props.setProperty('LEDGER_SHEETS', JSON.stringify(map));
  }
  var set = ss.getSheetByName(LS.setting);
  set.getRange('B2').setValue(lsDate_(year + '-01-01')).setNumberFormat('yyyy/mm/dd');
  set.getRange('B4:B7').setValues(LEDGER_ACCOUNTS.map(function (a) { return [balances[a] || 0]; }));
  return { year: year, url: ss.getUrl() };
}
