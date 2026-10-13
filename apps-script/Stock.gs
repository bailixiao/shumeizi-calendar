/**
 * 團購的庫存（進出貨，規格 0.6「庫存」「照植素園成本表單加的功能」）。
 *   - 「庫存紀錄」分頁一列＝一筆進或出：日期、類型（進／出）、方式、商品ID、數量、當時的成本與售價、金額、備註、活動ID（出攤）。
 *   - 目前庫存＝進的數量－出的數量。
 *   - 進貨填的成本、售價會變成商品現在的價格。
 *   - 訂單打勾「已取貨」自動記「售出」（連著訂單ID），取消打勾就刪掉那幾筆。
 *   - 進銷存報表：加權平均成本，算法和「植素園成本表單」Excel 一樣（見 stockReport_）。
 *   - 出攤銷售統計表：一場出攤的售前、預購、現場、營業額、售後應有／實際（盤盈盤虧）。
 *   - 匯入：貼上 Excel 的「產品代號」「日報表」。
 */

var STOCK_IN_METHODS = ['初存', '買進', '了願', '盤盈', '其他'];
var STOCK_OUT_METHODS = ['售出', '損壞', '了願', '試吃', '贈送', '過期', '退貨', '盤虧', '折讓', '其他'];
var STOCK_AMOUNT_ONLY = ['折讓', '其他']; // 出貨可以數量 0、只填金額（價差、折讓）
var SHOP_CATEGORIES = [{ prefix: 'A', name: '國內食品' }, { prefix: 'B', name: '國外食品' }, { prefix: 'C', name: '用品' }];
var STOCK_MAX_ROWS = 50; // 一次最多幾列
var STOCK_LIST_MAX = 300; // 進出紀錄最多回傳幾筆（新的在前）
var STOCK_IMPORT_MAX = 2000; // 匯入一次最多幾列

// ---------- 共用 ----------

/** 紀錄的日期（以前的紀錄沒有日期欄：用建立時間） */
function stockDate_(r) {
  return String(r['日期'] || '').slice(0, 10) || String(r['時間'] || '').slice(0, 10);
}

/** 紀錄的金額：有填用填的；沒有＝數量×（售出用售價，其他用成本） */
function stockAmount_(r) {
  if (r['金額'] !== '' && r['金額'] !== undefined && r['金額'] !== null) return Number(r['金額']) || 0;
  var q = Number(r['數量']) || 0;
  var unit = r['類型'] === '出' && r['方式'] === '售出' ? r['售價'] : r['成本'];
  return q * (Number(unit) || 0);
}

/** 每個商品的庫存 { 商品ID: 數量 }；keep(r) 有給就只算回傳 true 的 */
function stockLevels_(records, keep) {
  var out = {};
  records.forEach(function (r) {
    if (keep && !keep(r)) return;
    var q = Number(r['數量']) || 0;
    out[r['商品ID']] = (out[r['商品ID']] || 0) + (r['類型'] === '出' ? -q : q);
  });
  return out;
}

function stockRecordOut_(r, products) {
  var p = findById_(products, '商品ID', r['商品ID']);
  return {
    id: r['紀錄ID'], time: r['時間'], date: stockDate_(r), type: r['類型'], method: r['方式'], productId: r['商品ID'],
    code: p ? p['編號'] || '' : '', name: p ? p['名稱'] : '（商品已刪除）', photo: p ? p['照片'] || '' : '',
    qty: Number(r['數量']) || 0, cost: r['成本'] === '' ? null : Number(r['成本']), price: r['售價'] === '' ? null : Number(r['售價']),
    amount: stockAmount_(r), note: r['備註'] || '', by: r['建立者'] || '', orderId: r['訂單ID'] || '', batch: r['批次ID'] || '', dutyId: r['活動ID'] || ''
  };
}

/** 分類的編號開頭（A、B、C；自己打的分類沒有開頭） */
function categoryPrefix_(category) {
  var c = SHOP_CATEGORIES.filter(function (x) { return x.name === category; })[0];
  return c ? c.prefix : '';
}

/** 下一個商品編號：同開頭裡最大的數字＋1，補零到 3 位（A001、A002⋯；沒開頭＝001⋯） */
function nextProductCode_(products, prefix) {
  prefix = prefix || '';
  var re = new RegExp('^' + prefix + '(\\d+)$');
  var max = 0;
  products.forEach(function (p) { var m = String(p['編號'] || '').match(re); if (m && Number(m[1]) > max) max = Number(m[1]); });
  var s = String(max + 1);
  while (s.length < 3) s = '0' + s;
  return prefix + s;
}

/** 日期：yyyy-MM-dd、yyyy/M/d、民國 114/10/20 → yyyy-MM-dd；不對回傳 '' */
function stockParseDate_(v) {
  var s = String(v || '').trim();
  var m = s.match(/^(\d{2,4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (!m) return '';
  var y = Number(m[1]);
  if (y < 1000) y += 1911; // 民國年
  var d = y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  return isDateString_(d) ? d : '';
}

/** 寫入前一列紀錄 */
function stockRow_(o) {
  return {
    '紀錄ID': newId_('S'), '時間': o.now, '日期': o.date, '類型': o.type, '方式': o.method, '商品ID': o.id, '數量': String(o.qty),
    '成本': o.cost === '' || o.cost === undefined || o.cost === null ? '' : String(o.cost),
    '售價': o.price === '' || o.price === undefined || o.price === null ? '' : String(o.price),
    '金額': String(o.amount), '備註': o.note || '', '建立者': ADMIN_SESSION_ ? ADMIN_SESSION_.account : '',
    '訂單ID': o.orderId || '', '批次ID': o.batch || '', '活動ID': o.dutyId || ''
  };
}

/** 由下往上刪好幾列（列號才不會跑掉） */
function stockDeleteRows_(rows) {
  rows.slice().sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { getSheet_(SHEETS.SHOP_STOCK).deleteRow(r._row); });
}

// ---------- 庫存、進出貨 ----------

/** 後台庫存：商品（含編號、分類、目前庫存）＋最近的進出紀錄 */
function adminShopStock_() {
  var products = readTable_(SHEETS.SHOP_PRODUCTS);
  // 以前建的商品沒有編號：照建立順序補上（001、002⋯），只做一次
  if (products.some(function (p) { return !p['編號']; })) {
    withSignupLock_(function () {
      var rows = readTable_(SHEETS.SHOP_PRODUCTS);
      rows.slice().sort(function (a, b) { return String(a['建立時間']) < String(b['建立時間']) ? -1 : 1; }).forEach(function (p) {
        if (!p['編號']) { p['編號'] = nextProductCode_(rows, categoryPrefix_(p['分類'])); updateRow_(SHEETS.SHOP_PRODUCTS, p, { '編號': p['編號'] }); }
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
    records: records.slice().sort(function (a, b) {
      var da = stockDate_(a), db = stockDate_(b);
      return da < db ? 1 : da > db ? -1 : a['時間'] < b['時間'] ? 1 : a['時間'] > b['時間'] ? -1 : 0;
    }).slice(0, STOCK_LIST_MAX).map(function (r) { return stockRecordOut_(r, products); }),
    inMethods: STOCK_IN_METHODS, outMethods: STOCK_OUT_METHODS, amountOnly: STOCK_AMOUNT_ONLY, categories: SHOP_CATEGORIES,
    today: todayString_()
  };
}

/**
 * 進貨／出貨：body = { type: 'in'|'out', rows: [{ id, date, qty, cost, price, amount, method, note }] }
 *   - date 空白＝今天；amount（總金額）有填就用，單價＝金額÷數量；沒填＝數量×單價。
 *   - 進貨：成本、售價有填就更新商品現在的價格。出貨超過庫存照樣記，回傳 warnings。
 *   - 折讓、其他（出貨）可以數量 0、只填金額。
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
  var today = todayString_();
  var clean = [];
  rows.forEach(function (r, i) {
    var p = findById_(products, '商品ID', r.id);
    var label = '第 ' + (i + 1) + ' 列' + (p ? '（' + p['名稱'] + '）' : '');
    if (!p) { errors.push(label + '：找不到這個商品'); return; }
    var date = r.date ? stockParseDate_(r.date) : today;
    if (!date) errors.push(label + '：日期不對');
    if (date > today) errors.push(label + '：日期不能是以後');
    var qty = r.qty === '' || r.qty === undefined || r.qty === null ? 0 : shopInt_(r.qty);
    var amount = r.amount === '' || r.amount === undefined || r.amount === null ? '' : shopInt_(r.amount);
    var cost = r.cost === '' || r.cost === undefined || r.cost === null ? '' : shopInt_(r.cost);
    var price = r.price === '' || r.price === undefined || r.price === null ? '' : shopInt_(r.price);
    if (qty === null) errors.push(label + '：數量請填整數');
    if (amount === null) errors.push(label + '：金額請填整數，或空白');
    if (cost === null) errors.push(label + '：成本價請填整數，或空白');
    if (price === null) errors.push(label + '：售價請填整數，或空白');
    if (methods.indexOf(r.method) === -1) errors.push(label + '：請選' + (type === '進' ? '進貨' : '出貨') + '方式（' + methods.join('、') + '）');
    var amountOnly = type === '出' && STOCK_AMOUNT_ONLY.indexOf(r.method) !== -1;
    if (qty === 0 && !(amountOnly && amount)) errors.push(label + '：數量請填 1 以上' + (amountOnly ? '（折讓、價差只填金額也可以）' : ''));
    if (cleanText_(r.note).length > 100) errors.push(label + '：備註太長（最多 100 字）');
    clean.push({ p: p, date: date, qty: qty || 0, amount: amount, cost: cost, price: price, method: r.method, note: cleanText_(r.note) });
  });
  if (errors.length) throw new ApiError_('VALIDATION', (type === '進' ? '進貨' : '出貨') + '沒有存檔', errors.map(function (m) { return { message: m }; }));

  return withSignupLock_(function () {
    var records = readTable_(SHEETS.SHOP_STOCK);
    var levels = stockLevels_(records);
    var now = nowString_();
    var batch = newId_('K');
    var warnings = [];
    var add = clean.map(function (c) {
      var id = c.p['商品ID'];
      var sale = type === '出' && c.method === '售出';
      // 單價：有填金額＝金額÷數量；沒填用填的單價，再沒有用商品現在的價格
      var unit = c.amount !== '' && c.qty ? Math.round(c.amount / c.qty) : sale ? (c.price !== '' ? c.price : Number(c.p['價格']) || 0) : (c.cost !== '' ? c.cost : Number(c.p['成本']) || 0);
      if (sale) c.price = unit; else c.cost = unit;
      if (c.amount === '') c.amount = c.qty * unit;
      if (type === '出') {
        levels[id] = (levels[id] || 0) - c.qty;
        if (levels[id] < 0) warnings.push('「' + c.p['名稱'] + '」庫存會變成 ' + levels[id]);
      } else levels[id] = (levels[id] || 0) + c.qty;
      return stockRow_({ now: now, date: c.date, type: type, method: c.method, id: id, qty: c.qty, amount: c.amount,
        cost: c.cost !== '' ? c.cost : c.p['成本'], price: c.price !== '' ? c.price : c.p['價格'], note: c.note, batch: batch });
    });
    appendRows_(SHEETS.SHOP_STOCK, add);
    // 進貨：成本、售價變成商品現在的價格
    if (type === '進') {
      clean.forEach(function (c) {
        var ch = {};
        if (c.cost !== '' && c.qty) ch['成本'] = String(c.cost);
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

/** 訂單取貨：picked＝true 記「售出」（每樣商品一列，金額＝這張訂單那樣商品的金額）；false 刪掉這張訂單記的。在鎖裡面呼叫。 */
function stockForOrder_(o, picked) {
  var records = readTable_(SHEETS.SHOP_STOCK);
  var mine = records.filter(function (r) { return r['訂單ID'] === o['訂單ID']; });
  if (!picked) {
    stockDeleteRows_(mine);
  } else if (!mine.length) {
    var products = readTable_(SHEETS.SHOP_PRODUCTS);
    var qty = {};
    var amount = {};
    shopJson_(o['品項'], []).forEach(function (l) {
      var q = Number(l.qty) || 0;
      qty[l.id] = (qty[l.id] || 0) + q;
      amount[l.id] = (amount[l.id] || 0) + q * (Number(l.price) || 0) - (Number(l.discount) || 0); // 扣掉分攤的買多優惠
    });
    var now = nowString_();
    var batch = newId_('K');
    var add = Object.keys(qty).filter(function (id) { return qty[id] > 0; }).map(function (id) {
      var p = findById_(products, '商品ID', id);
      return stockRow_({ now: now, date: todayString_(), type: '出', method: '售出', id: id, qty: qty[id], amount: amount[id],
        cost: p ? p['成本'] : '', price: Math.round(amount[id] / qty[id]), note: '訂單：' + o['姓名'], orderId: o['訂單ID'], batch: batch });
    });
    if (add.length) appendRows_(SHEETS.SHOP_STOCK, add);
  }
  invalidateTable_(SHEETS.SHOP_STOCK);
}

// ---------- 進銷存報表 ----------

/** 方式 → 報表的欄：open 期初、buy 本期進貨、add 其他加、sub 其他減、sale 銷貨 */
function stockColumn_(r) {
  if (r['類型'] === '進') return r['方式'] === '初存' ? 'open' : r['方式'] === '買進' ? 'buy' : 'add';
  return r['方式'] === '售出' ? 'sale' : 'sub';
}

/**
 * 進銷存報表（純函式，方便測試）：records、products、from、to（yyyy-MM-dd）
 * 每樣商品：期初、本期進貨、其他加、其他減、銷貨（平均成本、成本金額、售價金額）、期末。
 *   - 期初＝期間開始前的庫存（金額＝數量×那時的平均成本）＋期間內的初存。
 *   - 平均成本＝（期初金額＋進貨金額＋其他加金額－其他減金額）÷（期初數量＋進貨數量＋其他加數量－其他減數量），四捨五入（和 Excel 一樣）。
 */
function stockReport_(records, products, from, to) {
  var by = {};
  var blank = function () { return { q: 0, a: 0 }; };
  products.forEach(function (p) { by[p['商品ID']] = { before: { open: blank(), buy: blank(), add: blank(), sub: blank(), sale: blank() }, open: blank(), buy: blank(), add: blank(), sub: blank(), sale: blank(), saleQty: 0 }; });
  records.forEach(function (r) {
    var x = by[r['商品ID']];
    if (!x) return;
    var d = stockDate_(r);
    if (d > to) return;
    var col = stockColumn_(r);
    var q = Number(r['數量']) || 0;
    var a = stockAmount_(r);
    var t = d < from ? x.before : x;
    t[col].q += q;
    t[col].a += a;
  });
  var avgOf = function (o, b, ad, s) { var qq = o.q + b.q + ad.q - s.q; return qq ? Math.round((o.a + b.a + ad.a - s.a) / qq) : 0; };
  var rows = products.map(function (p) {
    var x = by[p['商品ID']];
    var bf = x.before;
    // 期間開始前：剩下的數量×那時的平均成本
    var beforeQty = bf.open.q + bf.buy.q + bf.add.q - bf.sub.q - bf.sale.q;
    var beforeAvg = avgOf(bf.open, bf.buy, bf.add, bf.sub);
    var open = { q: beforeQty + x.open.q, a: beforeQty * beforeAvg + x.open.a };
    var avg = avgOf(open, x.buy, x.add, x.sub);
    var saleCost = x.sale.q * avg;
    var endQty = open.q + x.buy.q + x.add.q - x.sub.q - x.sale.q;
    var unit = function (o) { return o.q ? Math.round(o.a / o.q) : 0; };
    return {
      id: p['商品ID'], code: p['編號'] || '', name: p['名稱'], category: p['分類'] || '', unit: p['單位'] || '',
      open: { qty: open.q, price: unit(open), amount: open.a },
      buy: { qty: x.buy.q, price: unit(x.buy), amount: x.buy.a },
      add: { qty: x.add.q, price: unit(x.add), amount: x.add.a },
      sub: { qty: x.sub.q, price: unit(x.sub), amount: x.sub.a },
      saleCost: { qty: x.sale.q, price: avg, amount: saleCost },
      sale: { qty: x.sale.q, price: unit(x.sale), amount: x.sale.a },
      end: { qty: endQty, price: avg, amount: endQty * avg }
    };
  }).filter(function (r) { return r.open.qty || r.buy.qty || r.add.qty || r.sub.qty || r.sale.qty || r.sub.amount || r.end.qty; })
    .sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'zh-Hant', { numeric: true }); });
  var sum = function (key, f) { return rows.reduce(function (n, r) { return n + r[key][f]; }, 0); };
  var keys = ['open', 'buy', 'add', 'sub', 'saleCost', 'sale', 'end'];
  var total = {};
  keys.forEach(function (k) { total[k] = { qty: sum(k, 'qty'), amount: sum(k, 'amount') }; });
  var profit = total.sale.amount - total.saleCost.amount;
  return { from: from, to: to, rows: rows, total: total, profit: profit, margin: total.sale.amount ? profit / total.sale.amount : 0 };
}

/** body = { from, to }（空白＝今年 1/1 到今天） */
function adminShopStockReport_(body) {
  var today = todayString_();
  var from = body.from ? stockParseDate_(body.from) : today.slice(0, 4) + '-01-01';
  var to = body.to ? stockParseDate_(body.to) : today;
  if (!from || !to) throw new ApiError_('BAD_REQUEST', '日期不對');
  if (from > to) throw new ApiError_('BAD_REQUEST', '開始日期要在結束日期之前');
  return stockReport_(readTable_(SHEETS.SHOP_STOCK), readTable_(SHEETS.SHOP_PRODUCTS), from, to);
}

// ---------- 出攤銷售統計表 ----------

/** 這場出攤的紀錄：預購（那場取貨的訂單自動售出）、這場記的（現場、盤點） */
function stockStallParts_(records, orders, dutyId) {
  var orderIds = {};
  orders.forEach(function (o) { if (o['取貨活動ID'] === dutyId && o['狀態'] !== '已取消') orderIds[o['訂單ID']] = true; });
  return {
    pre: records.filter(function (r) { return r['訂單ID'] && orderIds[r['訂單ID']]; }),
    own: records.filter(function (r) { return r['活動ID'] === dutyId && !r['訂單ID']; })
  };
}

/** 出攤的活動與那天之前的庫存 */
function stockStallBase_(dutyId) {
  var d = findById_(readTableCached_(SHEETS.DUTIES), '勤務ID', dutyId);
  if (!d) throw new ApiError_('NOT_FOUND', '找不到這場活動');
  var records = readTable_(SHEETS.SHOP_STOCK);
  var orders = readTable_(SHEETS.SHOP_ORDERS);
  var parts = stockStallParts_(records, orders, dutyId);
  var mine = {};
  parts.pre.concat(parts.own).forEach(function (r) { mine[r['紀錄ID']] = true; });
  var date = d['開始日'];
  // 售前＝那天（含）之前、不是這場的紀錄
  var before = stockLevels_(records, function (r) { return !mine[r['紀錄ID']] && stockDate_(r) <= date; });
  return { duty: d, date: date, records: records, parts: parts, before: before };
}

/** body = { dutyId }：出攤銷售統計表；沒有 dutyId＝列出可以選的活動（前 120 天到後 30 天，植素園的在前） */
function adminShopStall_(body) {
  if (!body.dutyId) {
    var today = todayString_();
    var from = addDaysStr_(today, -120);
    var to = addDaysStr_(today, 30);
    return { duties: readTableCached_(SHEETS.DUTIES).filter(function (d) { return d['開始日'] >= from && d['開始日'] <= to; })
      .map(function (d) { return { id: d['勤務ID'], name: d['名稱'], date: d['開始日'], startTime: d['開始時間'] || '', location: d['地點'] || '', category: dutyCategory_(d) }; })
      .sort(function (x, y) { return ((y.category === '植素') - (x.category === '植素')) || (x.date < y.date ? 1 : -1); }), today: today };
  }
  var b = stockStallBase_(body.dutyId);
  var products = readTable_(SHEETS.SHOP_PRODUCTS);
  var sumBy = function (list, keep) {
    var q = {}, a = {};
    list.forEach(function (r) { if (!keep(r)) return; q[r['商品ID']] = (q[r['商品ID']] || 0) + (Number(r['數量']) || 0); a[r['商品ID']] = (a[r['商品ID']] || 0) + stockAmount_(r); });
    return { q: q, a: a };
  };
  var pre = sumBy(b.parts.pre, function (r) { return r['方式'] === '售出'; });
  var onsite = sumBy(b.parts.own, function (r) { return r['方式'] === '售出'; });
  var plus = sumBy(b.parts.own, function (r) { return r['方式'] === '盤盈'; });
  var minus = sumBy(b.parts.own, function (r) { return r['方式'] === '盤虧'; });
  var counted = b.parts.own.length > 0; // 存過＝點過（沒有盤盈盤虧＝實際和應有一樣）
  var notes = {};
  b.parts.own.forEach(function (r) { if (r['方式'] === '售出' && r['備註'] && r['備註'].indexOf('出攤：') !== 0) notes[r['商品ID']] = r['備註']; }); // 自動寫的「出攤：⋯」不算
  var rows = products.filter(function (p) { return p['啟用'] !== '否' || b.before[p['商品ID']] || pre.q[p['商品ID']] || onsite.q[p['商品ID']]; }).map(function (p) {
    var id = p['商品ID'];
    var beforeQty = b.before[id] || 0;
    var preQty = pre.q[id] || 0;
    var onQty = onsite.q[id] || 0;
    var price = onQty ? Math.round(onsite.a[id] / onQty) : Number(p['價格']) || 0;
    var expected = beforeQty - preQty - onQty;
    return {
      id: id, code: p['編號'] || '', name: p['名稱'], unit: p['單位'] || '', photo: p['照片'] || '',
      before: beforeQty, pre: preQty, onsite: onQty, price: price,
      revenue: (pre.a[id] || 0) + (onsite.a[id] || 0), expected: expected,
      actual: counted ? expected + (plus.q[id] || 0) - (minus.q[id] || 0) : null, note: notes[id] || ''
    };
  }).sort(function (a, c) { return String(a.code).localeCompare(String(c.code), 'zh-Hant', { numeric: true }); });
  var d = b.duty;
  return {
    duty: { id: d['勤務ID'], name: d['名稱'], date: b.date, startTime: d['開始時間'] || '', location: d['地點'] || '', category: dutyCategory_(d) },
    rows: rows, saved: b.parts.own.length > 0,
    total: { pre: rows.reduce(function (n, r) { return n + r.pre; }, 0), onsite: rows.reduce(function (n, r) { return n + r.onsite; }, 0), revenue: rows.reduce(function (n, r) { return n + r.revenue; }, 0) }
  };
}

/**
 * 存出攤銷售統計表：body = { dutyId, rows: [{ id, onsite, price, actual, note }] }
 * 這場原本記的（現場、盤點）先刪掉，再記：現場賣的＝售出（日期＝那天）；actual 有填就和應有比，差＝盤盈／盤虧。
 */
function adminShopStallSave_(body) {
  var rows = (Array.isArray(body.rows) ? body.rows : []).filter(function (r) { return r && r.id; });
  var errors = [];
  rows.forEach(function (r) {
    if (shopInt_(r.onsite || 0) === null) errors.push('現場賣的數量請填整數');
    if (r.price !== '' && r.price !== undefined && r.price !== null && shopInt_(r.price) === null) errors.push('單價請填整數');
    if (r.actual !== '' && r.actual !== undefined && r.actual !== null && !/^-?\d{1,6}$/.test(String(r.actual).trim())) errors.push('售後實際數量請填整數');
  });
  if (errors.length) throw new ApiError_('VALIDATION', '沒有存檔', errors.filter(function (m, i, a) { return a.indexOf(m) === i; }).map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var b = stockStallBase_(body.dutyId);
    var products = readTable_(SHEETS.SHOP_PRODUCTS);
    stockDeleteRows_(b.parts.own);
    var now = nowString_();
    var batch = newId_('K');
    var where = (b.duty['地點'] ? b.duty['地點'] + ' ' : '') + b.duty['名稱'];
    var add = [];
    var preQty = stockLevels_(b.parts.pre); // 負數＝售出
    rows.forEach(function (r) {
      var p = findById_(products, '商品ID', r.id);
      if (!p) return;
      var onsite = Number(shopInt_(r.onsite || 0)) || 0;
      var price = r.price === '' || r.price === undefined || r.price === null ? Number(p['價格']) || 0 : Number(shopInt_(r.price));
      var note = cleanText_(r.note).slice(0, 100);
      if (onsite) add.push(stockRow_({ now: now, date: b.date, type: '出', method: '售出', id: r.id, qty: onsite, amount: onsite * price, cost: p['成本'], price: price, note: note || '出攤：' + where, batch: batch, dutyId: b.duty['勤務ID'] }));
      if (r.actual === '' || r.actual === undefined || r.actual === null) return;
      var expected = (b.before[r.id] || 0) + (preQty[r.id] || 0) - onsite;
      var diff = Number(String(r.actual).trim()) - expected;
      var cost = Number(p['成本']) || 0;
      if (diff > 0) add.push(stockRow_({ now: now, date: b.date, type: '進', method: '盤盈', id: r.id, qty: diff, amount: diff * cost, cost: cost, price: p['價格'], note: '出攤盤點：' + where, batch: batch, dutyId: b.duty['勤務ID'] }));
      else if (diff < 0) add.push(stockRow_({ now: now, date: b.date, type: '出', method: '盤虧', id: r.id, qty: -diff, amount: -diff * cost, cost: cost, price: p['價格'], note: '出攤盤點：' + where, batch: batch, dutyId: b.duty['勤務ID'] }));
    });
    if (add.length) appendRows_(SHEETS.SHOP_STOCK, add);
    writeDutyLog_('團購出攤統計', b.date + ' ' + where + '｜' + add.filter(function (x) { return x['方式'] === '售出'; }).length + ' 樣現場售出' + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_STOCK);
    return { count: add.length };
  });
}

// ---------- 匯入 Excel ----------

/** Excel「2-日報表」的分類 → [類型, 方式] */
var STOCK_IMPORT_KINDS = { '初存': ['進', '初存'], '進貨': ['進', '買進'], '銷貨': ['出', '售出'], '其他：加': ['進', '其他'], '其他:加': ['進', '其他'], '其他：減': ['出', '其他'], '其他:減': ['出', '其他'] };

/**
 * 匯入：body = { products: [{ code, name }], rows: [{ date, kind, code, name, unit, qty, amount, note }] }
 * 代號沒有的商品自動新增（啟用；成本、售價用匯入的最新進貨、銷貨單價）；同一筆已經匯入過就跳過。
 */
function adminShopStockImport_(body) {
  var list = Array.isArray(body.rows) ? body.rows : [];
  var plist = Array.isArray(body.products) ? body.products : [];
  if (list.length > STOCK_IMPORT_MAX) throw new ApiError_('BAD_REQUEST', '一次最多匯入 ' + STOCK_IMPORT_MAX + ' 列');
  return withSignupLock_(function () {
    var products = readTable_(SHEETS.SHOP_PRODUCTS);
    var records = readTable_(SHEETS.SHOP_STOCK);
    var now = nowString_();
    var batch = newId_('K');
    var byCode = {};
    products.forEach(function (p) { if (p['編號']) byCode[p['編號']] = p; });
    var names = {};
    plist.forEach(function (x) { var c = cleanText_(x && x.code); if (c) names[c] = cleanText_(x.name); });
    var created = [];
    var skipped = [];
    var addRows = [];
    var seen = {};
    records.forEach(function (r) { seen[[stockDate_(r), r['類型'], r['方式'], r['商品ID'], r['數量'], stockAmount_(r), r['備註'] || ''].join('|')] = true; });
    var ensure = function (code, name, unit) {
      if (byCode[code]) return byCode[code];
      var row = { '商品ID': newId_('G'), '名稱': (name || names[code] || code).slice(0, 40), '價格': '0', '單位': cleanText_(unit).slice(0, 6), '說明': '', '照片': '',
        '啟用': '是', '排序': '0', '建立時間': now, '更新時間': now, '成本': '', '更多照片': '', '規格': '', '編號': code, '分類': stockCategoryOf_(code) };
      appendRows_(SHEETS.SHOP_PRODUCTS, [row]);
      byCode[code] = row;
      created.push(code + ' ' + row['名稱']);
      return row;
    };
    // 先建產品代號表上的商品
    Object.keys(names).forEach(function (code) { ensure(code, names[code], ''); });
    list.forEach(function (x, i) {
      var label = '第 ' + (i + 1) + ' 列';
      var code = cleanText_(x && x.code);
      var kind = STOCK_IMPORT_KINDS[cleanText_(x && x.kind)];
      var date = stockParseDate_(x && x.date);
      var qty = Number(String((x && x.qty) || 0).replace(/,/g, ''));
      var amount = Number(String((x && x.amount) || '').replace(/,/g, ''));
      if (!code || !kind || !date || !isFinite(qty) || qty < 0) { if (code || (x && x.kind)) skipped.push(label + (code ? '（' + code + '）' : '')); return; }
      if (!isFinite(amount) || String((x && x.amount) || '').trim() === '') amount = qty * (Number(String((x && x.price) || 0).replace(/,/g, '')) || 0);
      if (!qty && !amount) { skipped.push(label + '（' + code + '，數量和金額都是 0）'); return; }
      var p = ensure(code, cleanText_(x.name), x.unit);
      var note = cleanText_(x.note).slice(0, 100);
      var key = [date, kind[0], kind[1], p['商品ID'], String(qty), Math.round(amount), note].join('|');
      if (seen[key]) { skipped.push(label + '（' + code + '，已經匯入過）'); return; }
      seen[key] = true;
      var unitPrice = qty ? Math.round(amount / qty) : 0;
      var sale = kind[1] === '售出';
      addRows.push(stockRow_({ now: now, date: date, type: kind[0], method: kind[1], id: p['商品ID'], qty: qty, amount: Math.round(amount),
        cost: sale ? p['成本'] : unitPrice, price: sale ? unitPrice : p['價格'], note: note, batch: batch }));
      // 商品的成本、售價：用最新的進貨單價、銷貨單價
      if (!sale && kind[0] === '進' && unitPrice) p['成本'] = String(unitPrice);
      if (sale && unitPrice) p['價格'] = String(unitPrice);
    });
    if (addRows.length) appendRows_(SHEETS.SHOP_STOCK, addRows);
    // 把算出來的成本、售價寫回商品
    readTable_(SHEETS.SHOP_PRODUCTS).forEach(function (row) {
      var p = byCode[row['編號']];
      if (!p) return;
      var ch = {};
      if (p['成本'] !== undefined && String(p['成本']) !== String(row['成本'])) ch['成本'] = String(p['成本']);
      if (p['價格'] !== undefined && String(p['價格']) !== String(row['價格'])) ch['價格'] = String(p['價格']);
      if (Object.keys(ch).length) updateRow_(SHEETS.SHOP_PRODUCTS, row, ch);
    });
    writeDutyLog_('團購庫存匯入', addRows.length + ' 筆紀錄、新增 ' + created.length + ' 樣商品' + (skipped.length ? '、跳過 ' + skipped.length + ' 列' : '') + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_PRODUCTS);
    invalidateTable_(SHEETS.SHOP_STOCK);
    return { records: addRows.length, created: created, skipped: skipped };
  });
}

/** 編號開頭 → 分類（A001 → 國內食品） */
function stockCategoryOf_(code) {
  var c = SHOP_CATEGORIES.filter(function (x) { return new RegExp('^' + x.prefix + '\\d').test(code); })[0];
  return c ? c.name : '';
}
