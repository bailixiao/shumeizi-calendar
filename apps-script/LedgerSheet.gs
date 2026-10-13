/**
 * 植素園記帳 Google 試算表（規格 0.6「改成 Google Sheet」）：
 *   - 每 10 分鐘同步時（syncFromWorker）：沒有就建立一份「植素園記帳」，網址交給 Cloudflare（後台「💰 記帳」按鈕直接開）。
 *   - 系統只重寫「系統記帳」（收支記帳的每一筆：團購、出攤、進貨自動記的，和以前在後台記的）、「系統存貨」（每年的存貨）。
 *   - 其他分頁（設定、手動記帳、科目、全部記帳、(1)～(7)）建立時寫好公式，之後系統不再動，可以自己改公式。
 *   - 金額：和「115年簡易記帳表格」一樣，帳戶增加是正數、減少是負數（應付帳款：欠更多是正數）。
 */

var LEDGER_SHEET_NAME = '植素園記帳';
var LS = { help: '使用說明', setting: '設定', manual: '手動記帳', system: '系統記帳', stock: '系統存貨', subjects: '科目', all: '全部記帳', ledger: '(5) 分類帳', bs: '(6) BS', is: '(7) IS' };
var LS_ACCOUNT_TABS = ['(1) 零用金', '(2) 銀行存款', '(3) 應收帳款', '(4) 應付帳款'];
var LS_SECTIONS = ['收入', '其他收入', '成本', '費用', '其他損失', '移轉'];

/** 來源代號 → 給人看的 */
function ledgerSourceLabel_(s) {
  s = String(s || '');
  return s.indexOf('O:') === 0 ? '團購訂單' : s.indexOf('S:') === 0 ? '出攤銷售統計' : s.indexOf('K:') === 0 ? '商品增加（進貨）' : '後台記的';
}

/** 「系統記帳」的列（純函式）：[日期(yyyy-MM-dd), 帳戶, 科目, 摘要, 金額(帳戶增減), 來源, 紀錄ID]，照日期排 */
function ledgerSheetSystemRows_(rows) {
  return rows.filter(function (r) { return r['紀錄ID'] && r['日期']; }).map(function (r) {
    return [r['日期'], ledgerAccount_(r), r['類型'] === '期初' ? '期初餘額' : r['類別'], r['備註'] || '', ledgerEffect_(r), ledgerSourceLabel_(r['來源']), r['紀錄ID'], r['建立時間'] || ''];
  }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[7] < b[7] ? -1 : 1); }).map(function (x) { return x.slice(0, 7); });
}

/** 「系統存貨」的列（純函式）：每一年 [年度, 期初存貨, 進銷存本期進貨, 期末存貨] */
function ledgerSheetStockRows_(records, products, firstYear, lastYear) {
  var out = [];
  for (var y = firstYear; y <= lastYear; y++) {
    var rep = stockReport_(records, products, y + '-01-01', y + '-12-31');
    out.push([y, rep.total.open.amount, rep.total.buy.amount, rep.total.end.amount]);
  }
  return out;
}

/** 科目分頁的預設：[科目, 分類]（預設的＋收支記帳用過的） */
function ledgerSheetSubjects_(rows) {
  var list = [];
  var seen = {};
  var add = function (s, sec) { if (s && !seen[s]) { seen[s] = true; list.push([s, sec]); } };
  ['收入', '其他收入', '成本', '費用', '其他損失'].forEach(function (sec) { LEDGER_SUBJECTS[sec].forEach(function (s) { add(s, sec); }); });
  ['存提款', '收回應收', '付清應付', '期初餘額'].forEach(function (s) { add(s, '移轉'); });
  rows.forEach(function (r) { if (r['類型'] === '收入' || r['類型'] === '支出') add(r['類別'], ledgerSection_(r['類型'], r['類別'])); });
  return list;
}

function lsDate_(s) {
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/** （同步時呼叫）沒有就建立，然後重寫系統記帳、系統存貨。出錯不影響同步。 */
function ledgerSheetSync_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var ss = null;
    var id = props.getProperty('LEDGER_SHEET_ID');
    if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
    var rows = readTable_(SHEETS.SHOP_LEDGER);
    if (!ss) {
      ss = ledgerSheetCreate_(rows);
      props.setProperty('LEDGER_SHEET_ID', ss.getId());
    }
    var url = ss.getUrl();
    if (props.getProperty('LEDGER_SHEET_URL') !== url) {
      workerPost_({ action: 'import', password: syncKey_(), sheets: {}, props: { LEDGER_SHEET_URL: url } });
      props.setProperty('LEDGER_SHEET_URL', url);
    }
    ledgerSheetWriteSystem_(ss, rows);
  } catch (e) {
    Logger.log('植素園記帳試算表沒有更新：' + (e && e.message ? e.message : e));
  }
}

function ledgerSheetWriteSystem_(ss, rows) {
  var sys = ss.getSheetByName(LS.system);
  var data = ledgerSheetSystemRows_(rows).map(function (r) { return [lsDate_(r[0])].concat(r.slice(1)); });
  var last = sys.getLastRow();
  if (last > 1) sys.getRange(2, 1, last - 1, 7).clearContent();
  if (data.length) {
    sys.getRange(2, 1, data.length, 7).setValues(data);
    sys.getRange(2, 1, data.length, 1).setNumberFormat('yyyy/mm/dd');
    sys.getRange(2, 5, data.length, 1).setNumberFormat('#,##0');
  }
  var records = readTable_(SHEETS.SHOP_STOCK);
  var thisYear = Number(todayString_().slice(0, 4));
  var first = thisYear;
  rows.concat(records).forEach(function (r) { var y = Number(String(r['日期'] || '').slice(0, 4)); if (y >= 2000 && y < first) first = y; });
  var inv = ledgerSheetStockRows_(records, readTable_(SHEETS.SHOP_PRODUCTS), first, thisYear);
  var st = ss.getSheetByName(LS.stock);
  if (st.getLastRow() > 1) st.getRange(2, 1, st.getLastRow() - 1, 4).clearContent();
  st.getRange(2, 1, inv.length, 4).setValues(inv);
  st.getRange(2, 2, inv.length, 3).setNumberFormat('#,##0');
}

/** 建立「植素園記帳」：分頁、表頭、公式（之後系統只重寫系統記帳、系統存貨） */
function ledgerSheetCreate_(rows) {
  var ss = SpreadsheetApp.create(LEDGER_SHEET_NAME);
  var Y = '設定!$B$1';
  var yearText = 'TEXT(' + Y + '-1911,"0")';
  var range = '=' + yearText + '&".01.01 至 "&' + yearText + '&".12.31"';
  var bold = function (r) { r.setFontWeight('bold'); return r; };
  var yellow = function (r) { r.setBackground('#fff2cc'); return r; };
  var head = function (sh, cols) { bold(sh.getRange(1, 1, 1, cols.length).setValues([cols])).setBackground('#f3ead8'); sh.setFrozenRows(1); };
  var sheet = function (name, i) { var sh = i === 0 ? ss.getSheets()[0].setName(name) : ss.insertSheet(name); return sh; };

  // 使用說明
  var help = sheet(LS.help, 0);
  help.getRange(1, 1, 12, 1).setValues([
    ['植素園記帳（和「115年簡易記帳表格」一樣的格式）'],
    ['1、自己記的收入、支出打在「手動記帳」：日期、帳戶（零用金／銀行存款／應收帳款／應付帳款）、科目、摘要、金額。錢進來填正數、出去填負數；應付帳款欠更多填正數、付掉填負數。'],
    ['2、團購付款（付現＝零用金、轉帳＝銀行）、取貨還沒付（應收帳款）、出攤現場營業額（零用金）、商品增加的買進（進貨）會自動寫在「系統記帳」，每 10 分鐘更新。「系統記帳」「系統存貨」會整頁重寫，請不要改。'],
    ['3、錢換地方（零用金存銀行、收回應收、付清應付）：在「手動記帳」記兩筆，科目選「存提款／收回應收／付清應付」（不算損益），例：零用金 -5000、銀行存款 +5000。'],
    ['4、第一次用：在「設定」填年度和記帳開始前各帳戶的餘額。看別的年度改「設定」的年度就好。'],
    ['5、「科目」分頁決定每個科目算在損益表哪裡（收入、其他收入、成本、費用、其他損失、移轉）；新科目加在下面就好。'],
    ['6、(1)～(7) 都是公式自動算的（黃底＝公式）。這些分頁和「設定」「手動記帳」「科目」「全部記帳」系統不會再動，公式可以自己改、也可以自己加分頁。'],
    ['7、(7) IS 的費用下面有空白列，打新科目名稱就會算；存貨用後台進銷存報表的金額（系統存貨）。'],
    ['8、要給會計：檔案 → 下載 → Microsoft Excel。'],
    [''], ['這份試算表只有建立的人看得到；要給管帳的人，按右上角「共用」。'], ['']
  ]);
  bold(help.getRange(1, 1)).setFontSize(14);
  help.setColumnWidth(1, 900);
  help.getRange(1, 1, 12, 1).setWrap(true);

  // 設定
  var set = sheet(LS.setting, 1);
  set.getRange(1, 1, 8, 3).setValues([
    ['年度（西元）', Number(todayString_().slice(0, 4)), ''],
    ['', '', ''],
    ['記帳開始前各帳戶的餘額（第一次用填；之後不用改）', '', ''],
    ['零用金', 0, ''], ['銀行存款', 0, ''], ['應收帳款', 0, ''], ['應付帳款', 0, ''], ['', '', '']
  ]);
  set.getRange('C1').setFormula('="民國 "&' + yearText + '&" 年"');
  bold(set.getRange('A1:C1'));
  bold(set.getRange('A3'));
  set.getRange('B4:B7').setNumberFormat('#,##0');
  set.setColumnWidth(1, 360);

  // 科目
  var sub = sheet(LS.subjects, 2);
  head(sub, ['科目', '分類（收入／其他收入／成本／費用／其他損失／移轉）']);
  var subjects = ledgerSheetSubjects_(rows);
  sub.getRange(2, 1, subjects.length, 2).setValues(subjects);
  sub.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(LS_SECTIONS, true).setAllowInvalid(false).build());
  sub.setColumnWidth(1, 140);
  sub.setColumnWidth(2, 360);

  // 手動記帳
  var man = sheet(LS.manual, 3);
  head(man, ['日期', '帳戶', '科目', '摘要', '金額（進來正、出去負）', '備註']);
  man.getRange('A2:A').setNumberFormat('yyyy/mm/dd').setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).setHelpText('請打日期，例：2026/10/13').build());
  man.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(LEDGER_ACCOUNTS, true).setAllowInvalid(false).build());
  man.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(sub.getRange('A2:A'), true).setAllowInvalid(true).build());
  man.getRange('E2:E').setNumberFormat('#,##0');
  man.setColumnWidths(1, 3, 120);
  man.setColumnWidth(4, 260);
  man.setColumnWidth(5, 170);

  // 系統記帳、系統存貨（系統重寫）
  var sys = sheet(LS.system, 4);
  head(sys, ['日期', '帳戶', '科目', '摘要', '金額', '來源', '紀錄ID']);
  sys.setTabColor('#999999');
  sys.setColumnWidth(4, 260);
  var st = sheet(LS.stock, 5);
  head(st, ['年度', '期初存貨', '進銷存本期進貨', '期末存貨']);
  st.setTabColor('#999999');

  // 全部記帳（公式：系統＋手動）
  var all = sheet(LS.all, 6);
  head(all, ['日期', '帳戶', '科目', '摘要', '金額', '年度', '分類', '損益金額', '排序']);
  all.getRange('A2').setFormula('=IFERROR(QUERY({\'' + LS.system + '\'!A2:E;\'' + LS.manual + '\'!A2:E},"select * where Col1 is not null",0),)');
  all.getRange('F2').setFormula('=ARRAYFORMULA(IF(A2:A="",,YEAR(A2:A)))');
  all.getRange('G2').setFormula('=ARRAYFORMULA(IF(A2:A="",,IFERROR(VLOOKUP(C2:C,科目!A:B,2,FALSE),IF(E2:E>0,"收入","費用"))))');
  all.getRange('H2').setFormula('=ARRAYFORMULA(IF(A2:A="",,ABS(E2:E)))');
  all.getRange('I2').setFormula('=ARRAYFORMULA(IF(A2:A="",,IFERROR(MATCH(G2:G,{"收入";"其他收入";"成本";"費用";"其他損失";"移轉"},0),9)))');
  all.getRange('A2:A').setNumberFormat('yyyy/mm/dd');
  all.getRange('E2:E').setNumberFormat('#,##0');
  all.getRange('H2:H').setNumberFormat('#,##0');
  all.setColumnWidth(4, 260);

  // (1)～(4) 帳戶
  LS_ACCOUNT_TABS.forEach(function (tab, i) {
    var name = LEDGER_ACCOUNTS[i];
    var sh = sheet(tab, 7 + i);
    bold(sh.getRange('A1').setValue(name)).setFontSize(14);
    sh.getRange('A2').setFormula(range);
    bold(sh.getRange('D2').setValue('期末餘額'));
    yellow(bold(sh.getRange('E2').setFormula('=E4+SUM(D5:D)')));
    bold(sh.getRange(3, 1, 1, 5).setValues([['日期', '科目', '摘要', '金額(TWD)', '餘額(TWD)']])).setBackground('#f3ead8');
    sh.getRange('A4').setValue('期初餘額');
    yellow(sh.getRange('E4').setFormula('=設定!$B$' + (4 + i) + '+SUMIFS(全部記帳!E:E,全部記帳!B:B,"' + name + '",全部記帳!A:A,"<"&DATE(' + Y + ',1,1))'));
    sh.getRange('A5').setFormula('=IFERROR(SORT(FILTER({全部記帳!A2:A,全部記帳!C2:E},全部記帳!B2:B="' + name + '",全部記帳!F2:F=' + Y + '),1,TRUE),)');
    yellow(sh.getRange('E5').setFormula('=ARRAYFORMULA(IF(A5:A="",,E4+SUMIF(ROW(D5:D),"<="&ROW(D5:D),D5:D)))'));
    sh.getRange('A4:A').setNumberFormat('yyyy/mm/dd');
    sh.getRange('D2:E').setNumberFormat('#,##0');
    sh.setFrozenRows(3);
    sh.setColumnWidth(1, 110);
    sh.setColumnWidth(3, 280);
  });

  // (5) 分類帳：明細（照分類、科目、日期）＋右邊科目小計
  var led = sheet(LS.ledger, 11);
  head(led, ['分類', '日期', '科目', '摘要', '明細金額', '', '', '分類', '科目', '總計金額']);
  var src = '{全部記帳!I2:I,全部記帳!G2:G,全部記帳!A2:A,全部記帳!C2:C,全部記帳!D2:D,全部記帳!H2:H,全部記帳!F2:F}';
  led.getRange('A2').setFormula('=IFERROR(QUERY(' + src + ',"select Col2,Col3,Col4,Col5,Col6 where Col7="&' + Y + '&" and Col1<6 order by Col1,Col4,Col3",0),)');
  yellow(led.getRange('G2').setFormula('=IFERROR(QUERY({全部記帳!I2:I,全部記帳!G2:G,全部記帳!C2:C,全部記帳!H2:H,全部記帳!F2:F},"select Col1,Col2,Col3,sum(Col4) where Col5="&' + Y + '&" and Col1<6 group by Col1,Col2,Col3 order by Col1,Col3 label sum(Col4) \'\'",0),)'));
  led.hideColumns(7);
  led.getRange('B2:B').setNumberFormat('yyyy/mm/dd');
  led.getRange('E2:E').setNumberFormat('#,##0');
  led.getRange('J2:J').setNumberFormat('#,##0');
  led.setColumnWidth(4, 260);

  // (7) IS（先建，BS 要用損益那一格）
  var is = sheet(LS.is, 12);
  var lines = [];
  var put = function (a, b, d, f, opt) { lines.push({ a: a || '', b: b || '', d: d || '', f: f || '', opt: opt || {} }); return lines.length + 4; }; // 第 5 列開始
  var sumif = function (r, neg) { return '=IF(B' + r + '="","",' + (neg ? '-' : '') + 'SUMIFS(全部記帳!$H:$H,全部記帳!$C:$C,B' + r + ',全部記帳!$F:$F,' + Y + '))'; };
  var inv = function (col) { return 'IFERROR(VLOOKUP(' + Y + ',系統存貨!$A:$D,' + col + ',FALSE),0)'; };
  var block = function (sec, blanks, neg) {
    var first = lines.length + 5;
    subjects.filter(function (s) { return s[1] === sec; }).forEach(function (s) { var r = lines.length + 5; put('', s[0], sumif(r, neg)); });
    for (var k = 0; k < blanks; k++) { var r = lines.length + 5; put('', '', sumif(r, neg)); }
    return [first, lines.length + 4];
  };
  put('收入', '', '', '', { b: true });
  var rIn = block('收入', 2);
  var inTotal = put('收入總額', '', '', '=SUM(D' + rIn[0] + ':D' + rIn[1] + ')', { b: true, y: true });
  put('', '', '', '');
  put('成本', '', '', '', { b: true });
  var c1 = put('', '期初存貨', '=' + inv(2));
  put('', '進貨', '=SUMIFS(全部記帳!$H:$H,全部記帳!$C:$C,"進貨",全部記帳!$F:$F,' + Y + ')', '="進銷存的本期進貨："&TEXT(' + inv(3) + ',"#,##0")', { note: true });
  var c3 = put('', '減：期末存貨', '=-' + inv(4));
  var cogs = put('銷貨成本', '', '', '=SUM(D' + c1 + ':D' + c3 + ')', { b: true, y: true });
  put('', '', '', '');
  put('費用', '', '', '', { b: true });
  var rEx = block('費用', 5);
  var exTotal = put('費用總額', '', '', '=SUM(D' + rEx[0] + ':D' + rEx[1] + ')', { b: true, y: true });
  put('', '', '', '');
  put('其他收入（損失）', '', '', '', { b: true });
  var o1 = block('其他收入', 1);
  block('其他損失', 1, true);
  var otherTotal = put('其他收入（損失）合計', '', '', '=SUM(D' + o1[0] + ':D' + (lines.length + 4) + ')', { b: true, y: true });
  put('', '', '', '');
  var profitRow = put('損益', '', '', '=F' + inTotal + '-F' + cogs + '-F' + exTotal + '+F' + otherTotal, { b: true, y: true });
  bold(is.getRange('A1').setValue('植素園')).setFontSize(14);
  bold(is.getRange('A2').setValue('損益表'));
  is.getRange('A3').setFormula(range);
  is.getRange('F3').setValue('幣別：新台幣');
  bold(is.getRange(4, 1, 1, 6).setValues([['項目', '', '', '金額', '', '總計']])).setBackground('#f3ead8');
  lines.forEach(function (l, i) {
    var r = i + 5;
    if (l.a) is.getRange(r, 1).setValue(l.a);
    if (l.b) is.getRange(r, 2).setValue(l.b);
    if (l.d) yellow(is.getRange(r, 4).setFormula(l.d));
    if (l.f) { var c = l.opt.note ? 7 : 6; var cell = is.getRange(r, c).setFormula(l.f); if (!l.opt.note) yellow(cell); }
    if (l.opt.b) bold(is.getRange(r, 1, 1, 6));
  });
  is.getRange('D5:F' + (lines.length + 4)).setNumberFormat('#,##0');
  is.setColumnWidth(1, 150);
  is.setColumnWidth(2, 130);
  is.setColumnWidth(7, 220);

  // (6) BS
  var bs = sheet(LS.bs, 12);
  var acc = function (i, cell) { return '\'' + LS_ACCOUNT_TABS[i] + '\'!' + cell; };
  bold(bs.getRange('A1').setValue('植素園')).setFontSize(14);
  bold(bs.getRange('A2').setValue('資產負債表'));
  bs.getRange('C3').setFormula('=' + yearText + '&".12.31"');
  bs.getRange('D3').setValue('幣別：新台幣');
  bold(bs.getRange('A4:D4').setValues([['資產項目', '金額', '負債項目', '金額']])).setBackground('#f3ead8');
  bs.getRange('A5:A8').setValues([['零用金'], ['銀行存款'], ['存貨'], ['應收帳款']]);
  yellow(bs.getRange('B5').setFormula('=' + acc(0, 'E2')));
  yellow(bs.getRange('B6').setFormula('=' + acc(1, 'E2')));
  yellow(bs.getRange('B7').setFormula('=' + inv(4)));
  yellow(bs.getRange('B8').setFormula('=' + acc(2, 'E2')));
  bs.getRange('C5').setValue('應付帳款');
  yellow(bs.getRange('D5').setFormula('=' + acc(3, 'E2')));
  bold(bs.getRange('C8').setValue('負債總額'));
  yellow(bs.getRange('D8').setFormula('=SUM(D5:D7)'));
  bold(bs.getRange('C10').setValue('結餘'));
  bs.getRange('C11:C13').setValues([['累積結餘'], ['本期結餘'], ['結餘總額']]);
  yellow(bs.getRange('D11').setFormula('=' + acc(0, 'E4') + '+' + acc(1, 'E4') + '+' + acc(2, 'E4') + '+' + inv(2) + '-' + acc(3, 'E4')));
  yellow(bs.getRange('D12').setFormula('=\'' + LS.is + '\'!F' + profitRow));
  yellow(bs.getRange('D13').setFormula('=D11+D12'));
  bold(bs.getRange('A15').setValue('資產總額'));
  yellow(bs.getRange('B15').setFormula('=SUM(B5:B14)'));
  bold(bs.getRange('C15').setValue('負債及結餘總額'));
  yellow(bs.getRange('D15').setFormula('=D8+D13'));
  bs.getRange('F15').setValue('借貸方差額');
  yellow(bs.getRange('G15').setFormula('=B15-D15'));
  bs.getRange('B5:D15').setNumberFormat('#,##0');
  bs.getRange('G15').setNumberFormat('#,##0');
  bs.setColumnWidth(1, 120);
  bs.setColumnWidth(3, 150);

  // 分頁順序：使用說明、設定、手動記帳、(1)～(7)、科目、全部記帳、系統記帳、系統存貨
  var order = [LS.help, LS.setting, LS.manual].concat(LS_ACCOUNT_TABS, [LS.ledger, LS.bs, LS.is, LS.subjects, LS.all, LS.system, LS.stock]);
  order.forEach(function (n, i) { ss.setActiveSheet(ss.getSheetByName(n)); ss.moveActiveSheet(i + 1); });
  ss.setActiveSheet(ss.getSheetByName(LS.manual));
  return ss;
}
