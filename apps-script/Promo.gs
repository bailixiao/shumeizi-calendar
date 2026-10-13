/**
 * 團購買多優惠（規格 0.6「買多優惠」）：例「一包 50、三包 100」「豆腐、豆干任選 3 件 100」。
 *   - 一個優惠＝幾樣商品（不同口味混著算）＋幾段價格 [{ qty, price }]；一樣商品只能在一個啟用中的優惠裡。
 *   - 同一個優惠的商品放一起數件數，自動找最划算的組合；價格比較貴的先算進優惠；湊不滿的照原價。
 *   - 前端 js/shop.js 的 promoApply 是同一個算法（畫面先算給大家看），下單時以這裡算的為準。
 */

var PROMO_MAX_TIERS = 5;

function promoOut_(r) {
  return {
    id: r['優惠ID'], name: r['名稱'] || '', productIds: String(r['商品'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    tiers: shopJson_(r['價格'], []).map(function (t) { return { qty: Number(t.qty) || 0, price: Number(t.price) || 0 }; }).filter(function (t) { return t.qty > 1; }),
    active: r['啟用'] !== '否'
  };
}

/** 優惠的顯示名稱：有填用填的；沒填＝「3 件 100 元、6 件 190 元」（好幾樣商品的前面加「任選」） */
function promoLabel_(p) {
  if (p.name) return p.name;
  return (p.productIds.length > 1 ? '任選 ' : '') + p.tiers.map(function (t) { return t.qty + ' 件 ' + t.price + ' 元'; }).join('、');
}

function activePromos_() {
  return readTableCached_(SHEETS.SHOP_PROMOS).filter(function (r) { return r['優惠ID'] && r['啟用'] !== '否'; }).map(promoOut_)
    .filter(function (p) { return p.tiers.length && p.productIds.length; });
}

/**
 * 一個優惠最便宜要付多少（純函式）：prices＝每一件的單價，tiers＝[{ qty, price }]。
 * 回傳 { pay, normal, units }：pay＝最少要付、normal＝原價合計、units＝算進優惠的件數。
 */
function promoBest_(prices, tiers) {
  var u = prices.map(Number).sort(function (a, b) { return b - a; }); // 貴的先算進優惠
  var n = u.length;
  var best = [0]; // best[k]＝剛好 k 件全部用優惠的最低價（null＝湊不出來）
  for (var k = 1; k <= n; k++) {
    var b = null;
    tiers.forEach(function (t) {
      if (t.qty <= k && best[k - t.qty] !== null) { var c = best[k - t.qty] + t.price; if (b === null || c < b) b = c; }
    });
    best.push(b);
  }
  var suffix = [];
  suffix[n] = 0;
  for (var i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + u[i];
  var out = { pay: suffix[0], normal: suffix[0], units: 0 };
  for (var j = 1; j <= n; j++) {
    if (best[j] !== null && best[j] + suffix[j] < out.pay) { out.pay = best[j] + suffix[j]; out.units = j; }
  }
  return out;
}

/**
 * 訂單套用優惠（純函式）：lines＝[{ id, qty, price }]，promos＝啟用中的優惠。
 * 回傳 { discounts: [{ id, name, discount }], lineDiscounts: [每一行分攤的優惠（元）], total: 扣掉後的總額 }
 * 分攤：照每一行的金額比例，四捨五入後零頭給金額大的。
 */
function promoApply_(lines, promos) {
  var lineDiscounts = lines.map(function () { return 0; });
  var discounts = [];
  var total = 0;
  lines.forEach(function (l) { total += (Number(l.qty) || 0) * (Number(l.price) || 0); });
  (promos || []).forEach(function (p) {
    var idx = [];
    var prices = [];
    lines.forEach(function (l, i) {
      if (p.productIds.indexOf(l.id) === -1) return;
      idx.push(i);
      for (var q = 0; q < (Number(l.qty) || 0); q++) prices.push(Number(l.price) || 0);
    });
    if (!prices.length) return;
    var r = promoBest_(prices, p.tiers);
    var off = r.normal - r.pay;
    if (off <= 0) return;
    discounts.push({ id: p.id, name: promoLabel_(p), discount: off });
    total -= off;
    var amounts = idx.map(function (i) { return (Number(lines[i].qty) || 0) * (Number(lines[i].price) || 0); });
    var shares = amounts.map(function (a) { return r.normal ? Math.floor(off * a / r.normal) : 0; });
    var left = off - shares.reduce(function (a, b) { return a + b; }, 0);
    idx.map(function (x, k) { return k; }).sort(function (a, b) { return amounts[b] - amounts[a]; }).forEach(function (k) { if (left > 0 && amounts[k] > shares[k]) { shares[k]++; left--; } });
    idx.forEach(function (i, k) { lineDiscounts[i] += shares[k]; });
  });
  return { discounts: discounts, lineDiscounts: lineDiscounts, total: total };
}

/** 團購畫面用：這次團購的商品有在哪些優惠裡（只列這次有賣的商品） */
function promosForItems_(items, promos) {
  var ids = items.map(function (it) { return it.id; });
  return (promos || activePromos_()).map(function (p) {
    var mine = p.productIds.filter(function (id) { return ids.indexOf(id) !== -1; });
    return mine.length ? { id: p.id, name: promoLabel_(p), productIds: mine, tiers: p.tiers } : null;
  }).filter(Boolean);
}

// ---------- 後台 ----------

function adminShopPromos_() {
  return readTable_(SHEETS.SHOP_PROMOS).filter(function (r) { return r['優惠ID']; }).map(function (r) {
    var p = promoOut_(r);
    p.label = promoLabel_(p);
    return p;
  });
}

/** body = { promo: { id?, name, productIds: [], tiers: [{ qty, price }], active } } */
function adminShopSavePromo_(body) {
  var p = body.promo || {};
  var name = cleanText_(p.name);
  var ids = (Array.isArray(p.productIds) ? p.productIds : []).map(String).filter(Boolean);
  var errors = [];
  if (name.length > 30) errors.push('名稱太長（最多 30 字）');
  if (!ids.length) errors.push('請至少選一樣商品');
  var tiers = [];
  (Array.isArray(p.tiers) ? p.tiers : []).forEach(function (t) {
    if (!t || (String(t.qty || '').trim() === '' && String(t.price || '').trim() === '')) return;
    var q = shopInt_(t.qty);
    var pr = shopInt_(t.price);
    if (!q || q < 2 || q > SHOP_MAX_QTY) errors.push('件數請填 2～' + SHOP_MAX_QTY);
    else if (pr === null || !pr) errors.push(q + ' 件的總價請填 1 以上的整數（元）');
    else if (tiers.some(function (x) { return x.qty === q; })) errors.push(q + ' 件重複了');
    else tiers.push({ qty: q, price: pr });
  });
  if (!tiers.length && !errors.length) errors.push('請至少填一段價格（例：3 件 100 元）');
  if (tiers.length > PROMO_MAX_TIERS) errors.push('價格最多 ' + PROMO_MAX_TIERS + ' 段');
  tiers.sort(function (a, b) { return a.qty - b.qty; });
  if (errors.length) throw new ApiError_('VALIDATION', '優惠沒有存檔', errors.map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var products = readTable_(SHEETS.SHOP_PRODUCTS);
    var missing = ids.filter(function (id) { return !findById_(products, '商品ID', id); });
    if (missing.length) throw new ApiError_('VALIDATION', '優惠沒有存檔', [{ message: '有商品找不到了，請重新整理' }]);
    var rows = readTable_(SHEETS.SHOP_PROMOS);
    var active = p.active !== false;
    if (active) {
      // 一樣商品只能在一個啟用中的優惠裡
      var clash = [];
      rows.forEach(function (r) {
        if (r['優惠ID'] === p.id || r['啟用'] === '否') return;
        var other = promoOut_(r);
        ids.forEach(function (id) {
          if (other.productIds.indexOf(id) !== -1) clash.push('「' + (findById_(products, '商品ID', id) || {})['名稱'] + '」已經在「' + promoLabel_(other) + '」裡');
        });
      });
      if (clash.length) throw new ApiError_('VALIDATION', '優惠沒有存檔', clash.map(function (m) { return { message: m + '（一樣商品只能有一個優惠）' }; }));
    }
    var now = nowString_();
    var values = { '名稱': name, '商品': ids.join(','), '價格': JSON.stringify(tiers), '啟用': active ? '是' : '否', '更新時間': now };
    var row;
    if (p.id) {
      row = findById_(rows, '優惠ID', p.id);
      if (!row) throw new ApiError_('NOT_FOUND', '找不到這個優惠，可能已經刪掉了');
      updateRow_(SHEETS.SHOP_PROMOS, row, values);
    } else {
      row = Object.assign({ '優惠ID': newId_('Y'), '建立時間': now }, values);
      appendRows_(SHEETS.SHOP_PROMOS, [row]);
    }
    var out = promoOut_(row);
    writeDutyLog_('團購優惠', (p.id ? '修改' : '新增') + '｜' + promoLabel_(out) + (active ? '' : '（停用）') + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_PROMOS);
    return { promos: adminShopPromos_() };
  });
}

/** body = { id } */
function adminShopDeletePromo_(body) {
  return withSignupLock_(function () {
    var r = findById_(readTable_(SHEETS.SHOP_PROMOS), '優惠ID', body.id);
    if (!r) throw new ApiError_('NOT_FOUND', '找不到這個優惠，可能已經刪掉了');
    var before = rowSnapshot_(SHEETS.SHOP_PROMOS, r);
    getSheet_(SHEETS.SHOP_PROMOS).deleteRow(r._row);
    writeDutyLog_('團購優惠', '刪除｜' + promoLabel_(promoOut_(r)) + adminTag_(), before);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_PROMOS);
    return { promos: adminShopPromos_() };
  });
}
