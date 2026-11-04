/**
 * 以 Excel 為準重設庫存（2026/11/4，規格 0.6「以 Excel 為準重設庫存」）。
 * 後台記的進出貨和植素園自己的 Excel（3-進銷存）對不起來時，照 Excel 的期初、進貨、銷貨重記：
 *   - 列出來的每個「商品＋規格」：手動記的紀錄（沒有訂單ID的）全部拿掉，改記
 *     初存（openDate）、買進（date）、售出（date；團購訂單自動記的售出照留，只補差的）。
 *   - 期初、進貨、銷貨都是 0 的＝歸零（只拿掉手動記的）。
 *   - create：後台還沒有的商品先新增（不啟用、大家看不到）；同名的已經有了就用那一個（再按一次不會重複新增）。
 *   - 記帳不動（買進不同步到記帳），拿掉的紀錄回傳給前端下載備份。
 * body = { items: [{ code, option, create: { name, category, price }, open: [數量, 金額], buy: [..], sale: [..] }], openDate, date, note, dryRun }
 */
var STOCK_REALIGN_MAX = 200;

function adminShopStockRealign_(body) {
  var items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new ApiError_('BAD_REQUEST', '沒有要重設的商品');
  if (items.length > STOCK_REALIGN_MAX) throw new ApiError_('BAD_REQUEST', '一次最多 ' + STOCK_REALIGN_MAX + ' 樣');
  var openDate = stockParseDate_(body.openDate);
  var date = stockParseDate_(body.date) || todayString_();
  if (!openDate) throw new ApiError_('BAD_REQUEST', '初存的日期不對');
  var note = cleanText_(body.note || '以 Excel 為準重設').slice(0, 100);
  var dry = !!body.dryRun;
  var run = function () {
    var products = readTable_(SHEETS.SHOP_PRODUCTS);
    var records = readTable_(SHEETS.SHOP_STOCK);
    var now = nowString_();
    var batch = newId_('K');
    var pair = function (v) { v = Array.isArray(v) ? v : [0, 0]; return { q: Number(v[0]) || 0, a: Math.round(Number(v[1]) || 0) }; };
    var levels = stockLevels_(records);
    var plan = [];
    var toCreate = [];
    var seenKey = {};
    items.forEach(function (it, i) {
      var label = '第 ' + (i + 1) + ' 樣';
      var option = cleanText_(it.option || '');
      var p = null;
      if (it.create) {
        var name = cleanText_(it.create.name).slice(0, 40);
        if (!name) throw new ApiError_('VALIDATION', label + '：新商品要有名稱');
        p = products.filter(function (x) { return x['名稱'] === name; })[0] || toCreate.filter(function (x) { return x['名稱'] === name; })[0] || null;
        if (!p) {
          var cat = SHOP_CATEGORIES.filter(function (c) { return c.name === it.create.category; })[0] ? it.create.category : SHOP_CATEGORIES[0].name;
          p = { '商品ID': newId_('G'), '名稱': name, '價格': String(Math.max(0, Math.round(Number(it.create.price) || 0))), '單位': cleanText_(it.create.unit || '').slice(0, 6), '說明': '', '照片': '',
            '啟用': '否', '排序': '0', '建立時間': now, '更新時間': now, '成本': '', '更多照片': '', '規格': '', '編號': nextProductCode_(products.concat(toCreate), categoryPrefix_(cat)), '分類': cat, _new: true };
          toCreate.push(p);
        }
        option = '';
      } else {
        var code = cleanText_(it.code);
        p = products.filter(function (x) { return x['編號'] === code; })[0];
        if (!p) throw new ApiError_('VALIDATION', label + '：找不到編號 ' + code + ' 的商品');
        if (stockVariantNames_(p).indexOf(option) === -1) throw new ApiError_('VALIDATION', label + '：' + p['名稱'] + ' 沒有「' + option + '」這個規格');
      }
      var key = stockKeyOf_(p['商品ID'], option);
      if (seenKey[key]) throw new ApiError_('VALIDATION', label + '：' + p['名稱'] + (option ? '（' + option + '）' : '') + ' 重複了');
      seenKey[key] = true;
      var mine = records.filter(function (r) { return stockKey_(r) === key; });
      var manual = mine.filter(function (r) { return !r['訂單ID']; });
      var orderSale = mine.filter(function (r) { return r['訂單ID'] && r['類型'] === '出'; })
        .reduce(function (s, r) { return { q: s.q + (Number(r['數量']) || 0), a: s.a + stockAmount_(r) }; }, { q: 0, a: 0 });
      var open = pair(it.open), buy = pair(it.buy), sale = pair(it.sale);
      var extra = { q: sale.q - orderSale.q, a: Math.round(sale.a - orderSale.a) };
      if (extra.q < 0) throw new ApiError_('VALIDATION', label + '：' + p['名稱'] + ' 團購訂單已經賣了 ' + orderSale.q + '，比 Excel 的銷貨 ' + sale.q + ' 多');
      manual.forEach(function (r) { ledgerLockCheck_(stockDate_(r), '那一年的進出貨'); });
      plan.push({ p: p, option: option, manual: manual, open: open, buy: buy, extra: extra, orderSale: orderSale,
        before: levels[key] || 0, after: open.q + buy.q - sale.q });
    });
    ledgerLockCheck_(openDate, '那一年的進出貨');
    ledgerLockCheck_(date, '那一年的進出貨');
    var out = {
      openDate: openDate, date: date,
      items: plan.map(function (x) {
        return { code: x.p['編號'], name: x.p['名稱'] + (x.option ? '（' + x.option + '）' : ''), isNew: !!x.p._new, before: x.before, after: x.after,
          removed: x.manual.length, open: x.open.q, buy: x.buy.q, sale: x.extra.q + x.orderSale.q, orderSale: x.orderSale.q };
      }),
      removed: [].concat.apply([], plan.map(function (x) { return x.manual.map(function (r) { return stockRecordOut_(r, products); }); }))
    };
    if (dry) return out;
    // 新增商品（成本＝初存或進貨的單價）
    toCreate.forEach(function (p) {
      var x = plan.filter(function (y) { return y.p === p; })[0];
      var src = x && (x.open.q ? x.open : x.buy);
      if (src && src.q) p['成本'] = String(Math.round(src.a / src.q));
      var row = {};
      Object.keys(p).forEach(function (k) { if (k !== '_new') row[k] = p[k]; });
      appendRows_(SHEETS.SHOP_PRODUCTS, [row]);
    });
    // 拿掉手動記的，再照 Excel 記
    var del = [].concat.apply([], plan.map(function (x) { return x.manual; }));
    if (del.length) stockDeleteRows_(del);
    var add = [];
    plan.forEach(function (x) {
      var id = x.p['商品ID'];
      var unit = function (v) { return v.q ? Math.round(v.a / v.q) : 0; };
      if (x.open.q || x.open.a) add.push(stockRow_({ now: now, date: openDate, type: '進', method: '初存', id: id, option: x.option, qty: x.open.q, amount: x.open.a, cost: unit(x.open), price: '', note: note, batch: batch }));
      if (x.buy.q || x.buy.a) add.push(stockRow_({ now: now, date: date, type: '進', method: '買進', id: id, option: x.option, qty: x.buy.q, amount: x.buy.a, cost: unit(x.buy), price: '', note: note, batch: batch }));
      if (x.extra.q || x.extra.a) add.push(stockRow_({ now: now, date: date, type: '出', method: '售出', id: id, option: x.option, qty: x.extra.q, amount: x.extra.a, cost: '', price: unit(x.extra), note: note, batch: batch }));
    });
    if (add.length) appendRows_(SHEETS.SHOP_STOCK, add);
    writeDutyLog_('團購庫存重設', plan.length + ' 樣（' + note + '）：拿掉 ' + del.length + ' 筆、新記 ' + add.length + ' 筆' + (toCreate.length ? '、新增商品 ' + toCreate.map(function (p) { return p['名稱']; }).join('、') : '') + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_PRODUCTS);
    invalidateTable_(SHEETS.SHOP_STOCK);
    out.added = add.length;
    out.created = toCreate.map(function (p) { return p['編號'] + ' ' + p['名稱']; });
    return out;
  };
  return dry ? run() : withSignupLock_(run);
}
