/**
 * 團購的庫存（進出貨，規格 0.6「庫存」）。
 *   - 「庫存紀錄」分頁一列＝一筆進或出：類型（進／出）、方式、商品ID、數量、當時的成本與售價、備註。
 *   - 目前庫存＝進的數量－出的數量。
 *   - 進貨填的成本、售價會變成商品現在的價格。
 *   - 訂單打勾「已取貨」自動記「售出」（連著訂單ID），取消打勾就刪掉那幾筆。
 */

var STOCK_IN_METHODS = ['買進', '了願', '其他'];
var STOCK_OUT_METHODS = ['售出', '損壞', '了願', '其他'];
var STOCK_MAX_ROWS = 50; // 一次最多幾列
var STOCK_LIST_MAX = 300; // 進出紀錄最多回傳幾筆（新的在前）

/** 每個商品目前的庫存 { 商品ID: 數量 } */
function stockLevels_(records) {
  var out = {};
  records.forEach(function (r) {
    var q = Number(r['數量']) || 0;
    out[r['商品ID']] = (out[r['商品ID']] || 0) + (r['類型'] === '出' ? -q : q);
  });
  return out;
}

function stockRecordOut_(r, products) {
  var p = findById_(products, '商品ID', r['商品ID']);
  return {
    id: r['紀錄ID'], time: r['時間'], type: r['類型'], method: r['方式'], productId: r['商品ID'],
    code: p ? p['編號'] || '' : '', name: p ? p['名稱'] : '（商品已刪除）', photo: p ? p['照片'] || '' : '',
    qty: Number(r['數量']) || 0, cost: r['成本'] === '' ? null : Number(r['成本']), price: r['售價'] === '' ? null : Number(r['售價']),
    note: r['備註'] || '', by: r['建立者'] || '', orderId: r['訂單ID'] || '', batch: r['批次ID'] || ''
  };
}

/** 後台庫存：商品（含編號、目前庫存）＋最近的進出紀錄 */
function adminShopStock_() {
  var products = readTable_(SHEETS.SHOP_PRODUCTS);
  // 以前建的商品沒有編號：照建立順序補上（001、002⋯），只做一次
  if (products.some(function (p) { return !p['編號']; })) {
    withSignupLock_(function () {
      var rows = readTable_(SHEETS.SHOP_PRODUCTS);
      rows.slice().sort(function (a, b) { return String(a['建立時間']) < String(b['建立時間']) ? -1 : 1; }).forEach(function (p) {
        if (!p['編號']) { p['編號'] = nextProductCode_(rows); updateRow_(SHEETS.SHOP_PRODUCTS, p, { '編號': p['編號'] }); }
      });
      SpreadsheetApp.flush();
      invalidateTable_(SHEETS.SHOP_PRODUCTS);
    });
    products = readTable_(SHEETS.SHOP_PRODUCTS);
  }
  var records = readTable_(SHEETS.SHOP_STOCK);
  var levels = stockLevels_(records);
  return {
    products: products.map(function (p) { var o = shopProductOut_(p); o.stock = levels[p['商品ID']] || 0; return o; })
      .sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'zh-Hant', { numeric: true }) || (a.name < b.name ? -1 : 1); }),
    records: records.slice().sort(function (a, b) { return a['時間'] < b['時間'] ? 1 : a['時間'] > b['時間'] ? -1 : 0; })
      .slice(0, STOCK_LIST_MAX).map(function (r) { return stockRecordOut_(r, products); }),
    inMethods: STOCK_IN_METHODS, outMethods: STOCK_OUT_METHODS
  };
}

/**
 * 進貨／出貨：body = { type: 'in'|'out', rows: [{ id, qty, cost, price, method, note }] }
 * 進貨：成本、售價有填就更新商品現在的價格。出貨超過庫存照樣記，回傳 warnings。
 */
function adminShopStockMove_(body) {
  var type = body.type === 'out' ? '出' : body.type === 'in' ? '進' : '';
  if (!type) throw new ApiError_('BAD_REQUEST', '要選進貨或出貨');
  var methods = type === '進' ? STOCK_IN_METHODS : STOCK_OUT_METHODS;
  var rows = (Array.isArray(body.rows) ? body.rows : []).filter(function (r) { return r && r.id; });
  var errors = [];
  if (!rows.length) errors.push('請至少填一列（選商品、填數量）');
  if (rows.length > STOCK_MAX_ROWS) errors.push('一次最多 ' + STOCK_MAX_ROWS + ' 列');
  var products = readTable_(SHEETS.SHOP_PRODUCTS);
  var clean = [];
  rows.forEach(function (r, i) {
    var p = findById_(products, '商品ID', r.id);
    var label = '第 ' + (i + 1) + ' 列' + (p ? '（' + p['名稱'] + '）' : '');
    if (!p) { errors.push(label + '：找不到這個商品'); return; }
    var qty = shopInt_(r.qty);
    if (!qty) errors.push(label + '：數量請填 1 以上的整數');
    var cost = r.cost === '' || r.cost === undefined || r.cost === null ? '' : shopInt_(r.cost);
    var price = r.price === '' || r.price === undefined || r.price === null ? '' : shopInt_(r.price);
    if (cost === null) errors.push(label + '：成本價請填整數，或空白');
    if (price === null) errors.push(label + '：售價請填整數，或空白');
    if (methods.indexOf(r.method) === -1) errors.push(label + '：請選' + (type === '進' ? '進貨' : '出貨') + '方式（' + methods.join('、') + '）');
    if (cleanText_(r.note).length > 100) errors.push(label + '：備註太長（最多 100 字）');
    clean.push({ p: p, qty: qty, cost: cost, price: price, method: r.method, note: cleanText_(r.note) });
  });
  if (errors.length) throw new ApiError_('VALIDATION', (type === '進' ? '進貨' : '出貨') + '沒有存檔', errors.map(function (m) { return { message: m }; }));

  return withSignupLock_(function () {
    var records = readTable_(SHEETS.SHOP_STOCK);
    var levels = stockLevels_(records);
    var now = nowString_();
    var batch = newId_('K');
    var who = ADMIN_SESSION_ ? ADMIN_SESSION_.account : '';
    var warnings = [];
    var add = clean.map(function (c) {
      var id = c.p['商品ID'];
      if (type === '出') {
        levels[id] = (levels[id] || 0) - c.qty;
        if (levels[id] < 0) warnings.push('「' + c.p['名稱'] + '」庫存會變成 ' + levels[id]);
      } else levels[id] = (levels[id] || 0) + c.qty;
      return {
        '紀錄ID': newId_('S'), '時間': now, '類型': type, '方式': c.method, '商品ID': id, '數量': String(c.qty),
        '成本': c.cost === '' ? String(c.p['成本'] || '') : String(c.cost), '售價': c.price === '' ? String(c.p['價格'] || '') : String(c.price),
        '備註': c.note, '建立者': who, '訂單ID': '', '批次ID': batch
      };
    });
    appendRows_(SHEETS.SHOP_STOCK, add);
    // 進貨：成本、售價變成商品現在的價格
    if (type === '進') {
      clean.forEach(function (c) {
        var ch = {};
        if (c.cost !== '') ch['成本'] = String(c.cost);
        if (c.price !== '') ch['價格'] = String(c.price);
        if (Object.keys(ch).length) { ch['更新時間'] = now; updateRow_(SHEETS.SHOP_PRODUCTS, c.p, ch); }
      });
      invalidateTable_(SHEETS.SHOP_PRODUCTS);
    }
    writeDutyLog_('團購' + (type === '進' ? '進貨' : '出貨'), clean.map(function (c) { return c.p['名稱'] + '×' + c.qty + '（' + c.method + '）'; }).join('、') + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_STOCK);
    return { batch: batch, count: add.length, warnings: warnings };
  });
}

/** 刪一筆手動的進出紀錄（記錯時）。body = { id }；訂單自動記的要從訂單取消「已取貨」 */
function adminShopStockDelete_(body) {
  return withSignupLock_(function () {
    var r = findById_(readTable_(SHEETS.SHOP_STOCK), '紀錄ID', body.id);
    if (!r) throw new ApiError_('NOT_FOUND', '找不到這筆紀錄，可能已經刪掉了');
    if (r['訂單ID']) throw new ApiError_('FORBIDDEN', '這筆是訂單取貨自動記的，請到那張訂單取消「已取貨」');
    var p = findById_(readTable_(SHEETS.SHOP_PRODUCTS), '商品ID', r['商品ID']);
    getSheet_(SHEETS.SHOP_STOCK).deleteRow(r._row);
    writeDutyLog_('團購庫存刪除', (r['類型'] === '進' ? '進貨' : '出貨') + '｜' + (p ? p['名稱'] : r['商品ID']) + '×' + r['數量'] + '（' + r['方式'] + '）' + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_STOCK);
    return { deleted: true };
  });
}

/** 訂單取貨：picked＝true 記「售出」（每樣商品一列）；false 刪掉這張訂單記的。在鎖裡面呼叫。 */
function stockForOrder_(o, picked) {
  var records = readTable_(SHEETS.SHOP_STOCK);
  var mine = records.filter(function (r) { return r['訂單ID'] === o['訂單ID']; });
  if (!picked) {
    // 由下往上刪，列號才不會跑掉
    mine.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { getSheet_(SHEETS.SHOP_STOCK).deleteRow(r._row); });
  } else if (!mine.length) {
    var products = readTable_(SHEETS.SHOP_PRODUCTS);
    var qty = {};
    var price = {};
    shopJson_(o['品項'], []).forEach(function (l) { qty[l.id] = (qty[l.id] || 0) + (Number(l.qty) || 0); price[l.id] = l.price; });
    var now = nowString_();
    var batch = newId_('K');
    var add = Object.keys(qty).filter(function (id) { return qty[id] > 0; }).map(function (id) {
      var p = findById_(products, '商品ID', id);
      return {
        '紀錄ID': newId_('S'), '時間': now, '類型': '出', '方式': '售出', '商品ID': id, '數量': String(qty[id]),
        '成本': p ? String(p['成本'] || '') : '', '售價': price[id] === undefined ? '' : String(price[id]),
        '備註': '訂單：' + o['姓名'], '建立者': ADMIN_SESSION_ ? ADMIN_SESSION_.account : '', '訂單ID': o['訂單ID'], '批次ID': batch
      };
    });
    if (add.length) appendRows_(SHEETS.SHOP_STOCK, add);
  }
  invalidateTable_(SHEETS.SHOP_STOCK);
}

/** 下一個商品編號：目前最大的數字＋1，補零到 3 位（001、002⋯） */
function nextProductCode_(products) {
  var max = 0;
  products.forEach(function (p) { var n = /^\d+$/.test(String(p['編號'] || '')) ? Number(p['編號']) : 0; if (n > max) max = n; });
  var s = String(max + 1);
  while (s.length < 3) s = '0' + s;
  return s;
}
