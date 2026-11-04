/**
 * 團購優惠碼（規格 0.6.5，2026/11/4）：結帳時打代碼，打折／折金額／買 N 送 M／滿額送。
 *   - 一張訂單只能用一個優惠碼；先算買多優惠（Promo.gs），再算優惠碼。
 *   - 折的錢照每一行金額比例分攤（l.discount 加上去，進銷存的售出金額會扣掉）；送的商品是 0 元的一行（gift: true），庫存照樣扣。
 *   - 純函式 couponApply_ 算結果；shopOrder_（Shop.gs）下單時算、shopCouponCheck_ 給結帳畫面先看。
 */

var COUPON_KINDS = ['打折', '折金額', '買送', '滿額送'];

/** 代碼：英文字母、數字，存成大寫 */
function couponCode_(v) { return String(v || '').replace(/[\s　]+/g, '').toUpperCase(); }

function couponOut_(r) {
  var s = shopJson_(r['設定'], {});
  var ids = function (v) { return (Array.isArray(v) ? v : []).map(String).filter(Boolean); };
  var num = function (v) { return v === '' || v === null || v === undefined ? null : Number(v); };
  return {
    id: r['優惠碼ID'], code: couponCode_(r['代碼']), name: r['名稱'] || '', kind: COUPON_KINDS.indexOf(r['種類']) === -1 ? '打折' : r['種類'],
    percent: num(s.percent), amount: num(s.amount), min: num(s.min), productIds: ids(s.productIds),
    buyIds: ids(s.buyIds), buyQty: num(s.buyQty), get: s.get ? { id: String(s.get.id || ''), option: String(s.get.option || ''), qty: Number(s.get.qty) || 0 } : null,
    start: r['開始'] || '', end: r['結束'] || '', maxUses: num(r['總次數']), once: r['每人一次'] === '是',
    groupIds: String(r['團購'] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), active: r['啟用'] !== '否'
  };
}

/** 幾折的寫法：90→9 折、85→85 折 */
function couponOff_(percent) { return (percent % 10 === 0 ? percent / 10 : percent) + ' 折'; }

/** 優惠碼的說明（沒填名稱就自動寫）：例「滿 500 打 9 折」「買 3 送 1」；nameOf(id) 給商品名稱 */
function couponLabel_(c, nameOf) {
  if (c.name) return c.name;
  var only = c.productIds.length && nameOf ? '（' + c.productIds.map(nameOf).join('、') + '）' : '';
  var min = c.min ? '滿 ' + c.min + ' 元' : '';
  var gift = c.get ? (c.get.id && nameOf ? nameOf(c.get.id) + (c.get.option ? '（' + c.get.option + '）' : '') : '') : '';
  if (c.kind === '打折') return (min ? min + '打 ' : '') + couponOff_(c.percent) + only;
  if (c.kind === '折金額') return (min ? min + '折 ' : '折 ') + c.amount + ' 元' + only;
  if (c.kind === '買送') return (c.buyIds.length && nameOf ? c.buyIds.map(nameOf).join('、') : '') + '買 ' + c.buyQty + ' 送 ' + (c.get ? c.get.qty : 0) + (c.get && c.get.id ? '（送' + gift + '）' : '');
  return min + '送' + gift + ' ' + (c.get ? c.get.qty : 0) + ' 件';
}

/**
 * 算優惠（純函式）。lines＝[{ id, option, qty, price, discount }]（discount＝買多優惠已經分攤的）；
 * productOf(id)＝商品 { name, unit, photo, options }（送的商品用，找不到＝null）。
 * 回傳 { ok, reason, discount, lineDiscounts, gifts: [line] }；ok＝false 時 reason 說為什麼不能用。
 */
function couponApply_(c, lines, productOf) {
  var out = { ok: false, reason: '', discount: 0, lineDiscounts: lines.map(function () { return 0; }), gifts: [] };
  var net = lines.map(function (l) { return Math.max((Number(l.qty) || 0) * (Number(l.price) || 0) - (Number(l.discount) || 0), 0); });
  var totalNet = net.reduce(function (a, b) { return a + b; }, 0);
  var nameOf = function (id) { var p = productOf(id); return p ? p.name : '（商品已刪除）'; };
  var giftLine = function (id, option, qty) {
    var p = productOf(id);
    if (!p || !qty) return null;
    return { id: id, name: p.name + (option ? '（' + option + '）' : ''), base: p.name, option: option || '', qty: qty, price: 0, unit: p.unit || '', photo: p.photo || '', gift: true };
  };
  if (c.kind === '打折' || c.kind === '折金額') {
    var idx = [];
    lines.forEach(function (l, i) { if (!c.productIds.length || c.productIds.indexOf(l.id) !== -1) idx.push(i); });
    var base = idx.reduce(function (n, i) { return n + net[i]; }, 0);
    if (!base) { out.reason = '這個優惠碼只能用在：' + c.productIds.map(nameOf).join('、'); return out; }
    if (c.min && base < c.min) { out.reason = '還差 ' + (c.min - base) + ' 元才能用（' + (c.productIds.length ? c.productIds.map(nameOf).join('、') + '要' : '') + '滿 ' + c.min + ' 元）'; return out; }
    var off = c.kind === '打折' ? Math.round(base * (100 - (c.percent || 100)) / 100) : Math.min(c.amount || 0, base);
    if (off <= 0) { out.reason = '這次沒有可以折的'; return out; }
    // 照每一行比例分攤，零頭給金額大的
    var shares = idx.map(function (i) { return Math.floor(off * net[i] / base); });
    var left = off - shares.reduce(function (a, b) { return a + b; }, 0);
    idx.map(function (x, k) { return k; }).sort(function (a, b) { return net[idx[b]] - net[idx[a]]; }).forEach(function (k) { if (left > 0 && net[idx[k]] > shares[k]) { shares[k]++; left--; } });
    idx.forEach(function (i, k) { out.lineDiscounts[i] = shares[k]; });
    out.ok = true;
    out.discount = off;
    return out;
  }
  if (!c.get || !c.get.qty) { out.reason = '這個優惠碼設定不完整，請找小編'; return out; }
  if (c.kind === '買送') {
    var count = 0;
    var byOpt = {};
    lines.forEach(function (l) {
      if (c.buyIds.indexOf(l.id) === -1) return;
      count += Number(l.qty) || 0;
      byOpt[l.option || ''] = (byOpt[l.option || ''] || 0) + (Number(l.qty) || 0);
    });
    var sets = c.buyQty ? Math.floor(count / c.buyQty) : 0;
    if (!sets) { out.reason = count ? '再買 ' + (c.buyQty - count) + ' 件' + c.buyIds.map(nameOf).join('、') + '才能用' : '要買' + c.buyIds.map(nameOf).join('、') + '才能用'; return out; }
    var gid = c.get.id || c.buyIds[0];
    var gopt = c.get.id ? c.get.option : Object.keys(byOpt).sort(function (a, b) { return byOpt[b] - byOpt[a]; })[0] || ''; // 送同一個商品：送買最多的口味
    var g = giftLine(gid, gopt, sets * c.get.qty);
    if (!g) { out.reason = '送的商品找不到了，請找小編'; return out; }
    out.gifts.push(g);
    out.ok = true;
    return out;
  }
  // 滿額送
  if (c.min && totalNet < c.min) { out.reason = '還差 ' + (c.min - totalNet) + ' 元才能用（滿 ' + c.min + ' 元）'; return out; }
  var g2 = giftLine(c.get.id, c.get.option, c.get.qty);
  if (!g2) { out.reason = '送的商品找不到了，請找小編'; return out; }
  out.gifts.push(g2);
  out.ok = true;
  return out;
}

/**
 * 這個碼現在能不能用（期間、次數、每人一次、限哪幾團、啟用）。
 * ctx = { groupId, orders: 全部訂單, who: shopWho_ 的結果（可以沒有）, exceptOrderId, today }
 * 回傳空字串＝可以；不行回傳原因
 */
function couponUsable_(c, ctx) {
  if (!c.active) return '這個優惠碼目前沒有開放';
  if (c.start && ctx.today < c.start) return '這個優惠碼 ' + shopMd_(c.start) + ' 才開始';
  if (c.end && ctx.today > c.end) return '這個優惠碼已經過期了（到 ' + shopMd_(c.end) + '）';
  if (c.groupIds.length && c.groupIds.indexOf(ctx.groupId) === -1) return '這個優惠碼不能用在這一團';
  var used = ctx.orders.filter(function (o) { return couponCode_(o['優惠碼']) === c.code && o['狀態'] !== '已取消' && o['訂單ID'] !== ctx.exceptOrderId; });
  if (c.maxUses !== null && used.length >= c.maxUses) return '這個優惠碼已經被用完了';
  if (c.once && ctx.who && used.some(function (o) { return shopIsMine_(o, ctx.who); })) return '你已經用過這個優惠碼了';
  return '';
}

function couponFind_(code) {
  code = couponCode_(code);
  if (!code) return null;
  var r = readTableCached_(SHEETS.SHOP_COUPONS).filter(function (x) { return x['優惠碼ID'] && couponCode_(x['代碼']) === code; })[0];
  return r ? couponOut_(r) : null;
}

/** 商品庫找商品（送的商品用） */
function couponProductOf_(products) {
  return function (id) {
    var p = findById_(products, '商品ID', id);
    return p ? { name: p['名稱'], unit: p['單位'] || '', photo: p['照片'] || '', options: shopOptions_(p) } : null;
  };
}

/**
 * 套到訂單上（shopOrder_、shopCouponCheck_ 共用）：lines 會被改（discount 加上分攤的、送的接在後面）。
 * opts = { code, keep: 是原本那張已經用的碼（不再檢查期間、次數，條件不符合就不折）, groupId, orders, who, exceptOrderId, products }
 * 回傳 { code, discount: { code, name, discount, gifts }（沒用到＝null）, error }
 */
function couponOnOrder_(lines, opts) {
  var code = couponCode_(opts.code);
  if (!code) return { code: '', discount: null, error: '' };
  var c = couponFind_(code);
  if (!c) return opts.keep ? { code: code, discount: null, error: '' } : { code: '', discount: null, error: '找不到優惠碼「' + code + '」，請檢查有沒有打錯' };
  if (!opts.keep) {
    var why = couponUsable_(c, { groupId: opts.groupId, orders: opts.orders, who: opts.who, exceptOrderId: opts.exceptOrderId, today: todayString_() });
    if (why) return { code: '', discount: null, error: why };
  }
  var productOf = couponProductOf_(opts.products);
  var r = couponApply_(c, lines, productOf);
  if (!r.ok) return opts.keep ? { code: code, discount: null, error: '' } : { code: '', discount: null, error: '優惠碼「' + code + '」：' + r.reason };
  lines.forEach(function (l, i) { if (r.lineDiscounts[i]) l.discount = (Number(l.discount) || 0) + r.lineDiscounts[i]; });
  r.gifts.forEach(function (g) { lines.push(g); });
  var label = couponLabel_(c, function (id) { var p = productOf(id); return p ? p.name : ''; });
  return { code: code, discount: { code: code, name: label, discount: r.discount, gifts: r.gifts.map(function (g) { return g.name + ' ×' + g.qty; }) }, error: '' };
}

/**
 * 結帳畫面按「使用」：body = { groupId, coupon, items, name?, phone?, memberToken? }
 * 回傳 { code, name, discount, gifts: ['手工豆腐 ×1'], total }（不能用＝VALIDATION 錯誤，說為什麼）
 */
function shopCouponCheck_(body) {
  var g = findById_(readTableCached_(SHEETS.SHOP_GROUPS), '團購ID', body.groupId);
  if (!g) throw new ApiError_('NOT_FOUND', '找不到這次團購');
  var products = readTableCached_(SHEETS.SHOP_PRODUCTS);
  var orders = readTableCached_(SHEETS.SHOP_ORDERS);
  var view = shopGroupView_(g, products, orders);
  var lines = shopBuildLines_(view, Array.isArray(body.items) ? body.items : []);
  if (!lines.length) throw new ApiError_('VALIDATION', '購物車是空的');
  var promo = promoApply_(lines, view.promos);
  lines.forEach(function (l, i) { if (promo.lineDiscounts[i]) l.discount = promo.lineDiscounts[i]; });
  var who = null;
  try { if (shopMemberId_(body) || body.phone) who = shopWho_(body); } catch (e) { who = null; } // 每人一次：知道是誰才先查，下單時一定會再查
  var res = couponOnOrder_(lines, { code: body.coupon, groupId: g['團購ID'], orders: orders, who: who, products: products });
  if (res.error) throw new ApiError_('VALIDATION', res.error);
  return { code: res.code, name: res.discount.name, discount: res.discount.discount, gifts: res.discount.gifts, total: promo.total - res.discount.discount };
}

// ---------- 後台 ----------

function adminShopCoupons_() {
  var products = readTable_(SHEETS.SHOP_PRODUCTS);
  var orders = readTable_(SHEETS.SHOP_ORDERS);
  var nameOf = function (id) { var p = findById_(products, '商品ID', id); return p ? p['名稱'] : '（商品已刪除）'; };
  var coupons = readTable_(SHEETS.SHOP_COUPONS).filter(function (r) { return r['優惠碼ID']; }).map(function (r) {
    var c = couponOut_(r);
    c.label = couponLabel_(c, nameOf);
    c.used = orders.filter(function (o) { return couponCode_(o['優惠碼']) === c.code && o['狀態'] !== '已取消'; }).length;
    return c;
  });
  return { coupons: coupons };
}

/**
 * body = { coupon: { id?, code, name, kind, percent, amount, min, productIds, buyIds, buyQty, get: { id, option, qty }, start, end, maxUses, once, groupIds, active } }
 */
function adminShopSaveCoupon_(body) {
  var c = body.coupon || {};
  var errors = [];
  var code = couponCode_(c.code);
  var kind = String(c.kind || '');
  var int = function (v) { return String(v === null || v === undefined ? '' : v).trim() === '' ? null : shopInt_(v); };
  if (!/^[A-Z0-9]{2,20}$/.test(code)) errors.push('代碼請用英文字母、數字，2～20 個字');
  if (COUPON_KINDS.indexOf(kind) === -1) errors.push('請選優惠的種類');
  var name = cleanText_(c.name);
  if (name.length > 30) errors.push('說明太長（最多 30 字）');
  var ids = function (v) { return (Array.isArray(v) ? v : []).map(String).filter(Boolean); };
  var s = {};
  var min = int(c.min);
  if (min === null && String(c.min || '').trim()) errors.push('「滿多少元」請填整數');
  if (kind === '打折') {
    var pc = int(c.percent);
    if (!pc || pc < 1 || pc > 99) errors.push('打幾折請填 1～99（例：9 折填 90、85 折填 85）');
    s = { percent: pc, min: min || null, productIds: ids(c.productIds) };
  } else if (kind === '折金額') {
    var am = int(c.amount);
    if (!am) errors.push('折多少元請填 1 以上的整數');
    s = { amount: am, min: min || null, productIds: ids(c.productIds) };
  } else if (kind === '買送' || kind === '滿額送') {
    var get = c.get || {};
    var gq = int(get.qty);
    if (!gq || gq > SHOP_MAX_QTY) errors.push('送幾件請填 1～' + SHOP_MAX_QTY);
    if (kind === '買送') {
      var bq = int(c.buyQty);
      if (!bq || bq > SHOP_MAX_QTY) errors.push('買幾件請填 1～' + SHOP_MAX_QTY);
      if (!ids(c.buyIds).length) errors.push('請選買哪個商品');
      if (!get.id && ids(c.buyIds).length > 1) errors.push('送「同一個商品」時，買的商品只能選一個');
      s = { buyIds: ids(c.buyIds), buyQty: bq, get: { id: String(get.id || ''), option: String(get.option || ''), qty: gq } };
    } else {
      if (!min) errors.push('滿額送請填滿多少元');
      if (!get.id) errors.push('請選送哪個商品');
      s = { min: min, get: { id: String(get.id || ''), option: String(get.option || ''), qty: gq } };
    }
  }
  var start = String(c.start || '');
  var end = String(c.end || '');
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) errors.push('開始日期不對');
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) errors.push('結束日期不對');
  if (start && end && end < start) errors.push('結束日期要在開始日期之後');
  var maxUses = int(c.maxUses);
  if (String(c.maxUses || '').trim() && !maxUses) errors.push('總共可以用幾次請填 1 以上的整數（空白＝不限）');
  if (errors.length) throw new ApiError_('VALIDATION', '優惠碼沒有存檔', errors.map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var products = readTable_(SHEETS.SHOP_PRODUCTS);
    var need = (s.productIds || []).concat(s.buyIds || []).concat(s.get && s.get.id ? [s.get.id] : []);
    if (need.some(function (id) { return !findById_(products, '商品ID', id); })) throw new ApiError_('VALIDATION', '優惠碼沒有存檔', [{ message: '有商品找不到了，請重新整理' }]);
    if (s.get && s.get.id) { // 送的商品有規格：要選送哪個
      var gp = findById_(products, '商品ID', s.get.id);
      var opt = shopOptions_(gp);
      if (opt && !opt.options.some(function (o) { return o.name === s.get.option; })) throw new ApiError_('VALIDATION', '優惠碼沒有存檔', [{ message: '「' + gp['名稱'] + '」有' + opt.label + '，請選送哪一個' }]);
      if (!opt) s.get.option = '';
    }
    var rows = readTable_(SHEETS.SHOP_COUPONS);
    if (rows.some(function (r) { return r['優惠碼ID'] && r['優惠碼ID'] !== c.id && couponCode_(r['代碼']) === code; })) throw new ApiError_('VALIDATION', '優惠碼沒有存檔', [{ message: '代碼「' + code + '」已經有了，請換一個' }]);
    var now = nowString_();
    var values = { '代碼': code, '名稱': name, '種類': kind, '設定': JSON.stringify(s), '開始': start, '結束': end, '總次數': maxUses ? String(maxUses) : '',
      '每人一次': c.once ? '是' : '', '團購': ids(c.groupIds).join(','), '啟用': c.active === false ? '否' : '是', '更新時間': now };
    var row;
    if (c.id) {
      row = findById_(rows, '優惠碼ID', c.id);
      if (!row) throw new ApiError_('NOT_FOUND', '找不到這個優惠碼，可能已經刪掉了');
      var before = rowSnapshot_(SHEETS.SHOP_COUPONS, row);
      updateRow_(SHEETS.SHOP_COUPONS, row, values);
      writeDutyLog_('團購優惠碼', '修改｜' + code + adminTag_(), before);
    } else {
      row = Object.assign({ '優惠碼ID': newId_('C'), '建立時間': now }, values);
      appendRows_(SHEETS.SHOP_COUPONS, [row]);
      writeDutyLog_('團購優惠碼', '新增｜' + code + adminTag_());
    }
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_COUPONS);
    return adminShopCoupons_();
  });
}

/** body = { id } */
function adminShopDeleteCoupon_(body) {
  return withSignupLock_(function () {
    var r = findById_(readTable_(SHEETS.SHOP_COUPONS), '優惠碼ID', body.id);
    if (!r) throw new ApiError_('NOT_FOUND', '找不到這個優惠碼，可能已經刪掉了');
    var before = rowSnapshot_(SHEETS.SHOP_COUPONS, r);
    getSheet_(SHEETS.SHOP_COUPONS).deleteRow(r._row);
    writeDutyLog_('團購優惠碼', '刪除｜' + couponCode_(r['代碼']) + adminTag_(), before);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_COUPONS);
    return adminShopCoupons_();
  });
}
